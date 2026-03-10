import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Stablecoin } from "../target/types/stablecoin";
import { TransferHook } from "../target/types/transfer_hook";

describe("SSS-3: Private Stablecoin Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stablecoinProgram = anchor.workspace.Stablecoin as Program<Stablecoin>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  // Keypairs
  const authority = provider.wallet as anchor.Wallet;
  const mintKeypair = Keypair.generate();
  const minterKeypair = Keypair.generate();
  const recipientKeypair = Keypair.generate();
  const recipient2Keypair = Keypair.generate();

  // PDAs
  let configPda: PublicKey;
  let configBump: number;
  let rolesPda: PublicKey;
  let minterConfigPda: PublicKey;
  let extraAccountMetaListPda: PublicKey;

  // Token accounts
  let recipientAta: PublicKey;
  let recipient2Ata: PublicKey;

  // Constants
  const DECIMALS = 6;
  const MINT_AMOUNT = new BN(1_000_000_000); // 1000 tokens

  // Helper: derive allowlist entry PDA for a given address
  function getAllowlistEntryPda(address: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("allowlist"), configPda.toBuffer(), address.toBuffer()],
      stablecoinProgram.programId
    );
    return pda;
  }

  before(async () => {
    // Derive PDAs
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), mintKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    [rolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), configPda.toBuffer()],
      stablecoinProgram.programId
    );

    [minterConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter"), configPda.toBuffer(), minterKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
      transferHookProgram.programId
    );

    // Airdrop SOL to test keypairs
    const airdropPromises = [
      minterKeypair,
      recipientKeypair,
      recipient2Keypair,
    ].map(async (kp) => {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      return provider.connection.confirmTransaction(sig);
    });
    await Promise.all(airdropPromises);

    // Derive associated token accounts
    recipientAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      recipientKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    recipient2Ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      recipient2Keypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Initializes SSS-3 stablecoin (confidential transfer + allowlist + transfer hook)", async () => {
    await stablecoinProgram.methods
      .initialize({
        name: "Private USD",
        symbol: "PUSD",
        uri: "https://example.com/pusd.json",
        decimals: DECIMALS,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        enableConfidentialTransfer: true,
        enableAllowlist: true,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        roles: rolesPda,
        transferHookProgram: transferHookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);
    expect(config.enablePermanentDelegate).to.be.true;
    expect(config.enableTransferHook).to.be.true;
    expect(config.enableConfidentialTransfer).to.be.true;
    expect(config.enableAllowlist).to.be.true;
    expect(config.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
  });

  it("Initializes extra account meta list for allowlist mode", async () => {
    await transferHookProgram.methods
      .initializeExtraAccountMetaListAllowlist(configPda, stablecoinProgram.programId)
      .accounts({
        payer: authority.publicKey,
        mint: mintKeypair.publicKey,
        extraAccountMetaList: extraAccountMetaListPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify the PDA was created
    const accountInfo = await provider.connection.getAccountInfo(extraAccountMetaListPda);
    expect(accountInfo).to.not.be.null;
    expect(accountInfo!.owner.toBase58()).to.equal(transferHookProgram.programId.toBase58());
  });

  it("Adds a minter and mints tokens to recipient", async () => {
    // Add minter
    await stablecoinProgram.methods
      .updateMinter(minterKeypair.publicKey, {
        quota: new BN(10_000_000_000),
        active: true,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: configPda,
        minterConfig: minterConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create recipient ATA
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      recipientAta,
      recipientKeypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );
    const createTx = new Transaction().add(createAtaIx);
    await sendAndConfirmTransaction(provider.connection, createTx, [
      (authority as any).payer,
    ]);

    // Mint tokens to recipient
    await stablecoinProgram.methods
      .mintTokens(MINT_AMOUNT)
      .accounts({
        minter: minterKeypair.publicKey,
        minterConfig: minterConfigPda,
        config: configPda,
        mint: mintKeypair.publicKey,
        recipientTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minterKeypair])
      .rpc();

    const account = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(account.amount)).to.equal(MINT_AMOUNT.toNumber());
  });

  it("Creates recipient2 ATA", async () => {
    const createAta2Ix = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      recipient2Ata,
      recipient2Keypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(createAta2Ix);
    await sendAndConfirmTransaction(provider.connection, tx, [
      (authority as any).payer,
    ]);
  });

  it("Transfer FAILS when neither party is on the allowlist (hook rejects)", async () => {
    try {
      // Attempt to transfer from recipient to recipient2.
      // Neither is on the allowlist, so the transfer hook should reject.
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        recipientAta,
        mintKeypair.publicKey,
        recipient2Ata,
        recipientKeypair.publicKey,
        BigInt(100_000_000), // 100 tokens
        DECIMALS,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [recipientKeypair]);
      expect.fail("Should have thrown - neither party is on the allowlist");
    } catch (e: any) {
      // Transfer hook rejects because sender is not on the allowlist
      expect(e.toString()).to.include("failed");
    }
  });

  it("Adds both sender and recipient to the allowlist", async () => {
    const senderAllowlistPda = getAllowlistEntryPda(recipientKeypair.publicKey);
    const recipient2AllowlistPda = getAllowlistEntryPda(recipient2Keypair.publicKey);

    // Add sender (recipientKeypair) to allowlist
    await stablecoinProgram.methods
      .addToAllowlist(recipientKeypair.publicKey, "KYC verified")
      .accounts({
        payer: authority.publicKey,
        blacklister: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        allowlistEntry: senderAllowlistPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify sender's allowlist entry
    const senderEntry = await stablecoinProgram.account.allowlistEntry.fetch(senderAllowlistPda);
    expect(senderEntry.address.toBase58()).to.equal(recipientKeypair.publicKey.toBase58());
    expect(senderEntry.reason).to.equal("KYC verified");
    expect(senderEntry.allowlistedBy.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(senderEntry.allowlistedAt.toNumber()).to.be.greaterThan(0);

    // Add recipient (recipient2Keypair) to allowlist
    await stablecoinProgram.methods
      .addToAllowlist(recipient2Keypair.publicKey, "KYC verified")
      .accounts({
        payer: authority.publicKey,
        blacklister: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        allowlistEntry: recipient2AllowlistPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify recipient's allowlist entry
    const recipientEntry = await stablecoinProgram.account.allowlistEntry.fetch(recipient2AllowlistPda);
    expect(recipientEntry.address.toBase58()).to.equal(recipient2Keypair.publicKey.toBase58());
    expect(recipientEntry.reason).to.equal("KYC verified");
  });

  it("Transfer SUCCEEDS when both parties are on the allowlist", async () => {
    const transferAmount = BigInt(200_000_000); // 200 tokens

    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      recipientAta,
      mintKeypair.publicKey,
      recipient2Ata,
      recipientKeypair.publicKey,
      transferAmount,
      DECIMALS,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    await sendAndConfirmTransaction(provider.connection, tx, [recipientKeypair]);

    // Verify sender balance decreased
    const senderAccount = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(senderAccount.amount)).to.equal(
      MINT_AMOUNT.toNumber() - Number(transferAmount)
    ); // 1000M - 200M = 800M

    // Verify recipient balance increased
    const recipientAccount = await getAccount(
      provider.connection,
      recipient2Ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(recipientAccount.amount)).to.equal(Number(transferAmount)); // 200M
  });

  it("Removes sender from the allowlist", async () => {
    const senderAllowlistPda = getAllowlistEntryPda(recipientKeypair.publicKey);

    await stablecoinProgram.methods
      .removeFromAllowlist(recipientKeypair.publicKey)
      .accounts({
        payer: authority.publicKey,
        blacklister: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        allowlistEntry: senderAllowlistPda,
      })
      .rpc();

    // Verify the allowlist entry is closed (account no longer exists)
    const accountInfo = await provider.connection.getAccountInfo(senderAllowlistPda);
    expect(accountInfo).to.be.null;
  });

  it("Transfer FAILS again after sender is removed from the allowlist", async () => {
    try {
      // Sender (recipientKeypair) is no longer on the allowlist.
      // The transfer hook should reject even though recipient2 is still allowed.
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        recipientAta,
        mintKeypair.publicKey,
        recipient2Ata,
        recipientKeypair.publicKey,
        BigInt(50_000_000), // 50 tokens
        DECIMALS,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [recipientKeypair]);
      expect.fail("Should have thrown - sender is not on the allowlist");
    } catch (e: any) {
      // Transfer hook rejects because sender is no longer on the allowlist
      expect(e.toString()).to.include("failed");
    }
  });

  it("Verifies SSS-3 config flags are correctly set", async () => {
    const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);

    expect(config.enablePermanentDelegate).to.be.true;
    expect(config.enableTransferHook).to.be.true;
    expect(config.enableConfidentialTransfer).to.be.true;
    expect(config.enableAllowlist).to.be.true;
    expect(config.isPaused).to.be.false;
    expect(config.totalMinted.toNumber()).to.equal(MINT_AMOUNT.toNumber());
    expect(config.totalBurned.toNumber()).to.equal(0);
  });

  it("ConfidentialTransferMint extension occupies space on the SSS-3 mint account", async () => {
    const info = await provider.connection.getAccountInfo(mintKeypair.publicKey);
    expect(info).to.not.be.null;
    // Token-2022 owns this account
    expect(info!.owner.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
    // SSS-3 has 4 extensions: MetadataPointer + PermanentDelegate + TransferHook +
    // ConfidentialTransferMint. The ConfidentialTransferMint extension alone adds ~71 bytes
    // (authority + auto_approve + auditor ElGamal pubkey fields).
    // Total account is significantly larger than the base 82-byte Token-2022 mint.
    expect(info!.data.length).to.be.greaterThan(350);
  });

  it("Seize bypasses allowlist in SSS-3 — burn+mint does not trigger transfer hook", async () => {
    // recipient2 still holds 200 tokens from the earlier allowlist-gated transfer.
    // Even though the transfer hook would reject non-allowlisted destinations,
    // seize uses burn_checked + mint_to_checked — these bypass the hook entirely.
    const seizeAmount = new BN(50_000_000); // 50 tokens

    // Treasury ATA for authority (not on the allowlist — proves hook is bypassed)
    const treasuryAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Create treasury ATA
    try {
      const createTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          treasuryAta,
          authority.publicKey,
          mintKeypair.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(provider.connection, createTx, [(authority as any).payer]);
    } catch { /* may already exist */ }

    const beforeFrom = await getAccount(
      provider.connection, recipient2Ata, undefined, TOKEN_2022_PROGRAM_ID
    );

    await stablecoinProgram.methods
      .seize(seizeAmount)
      .accounts({
        seizer: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        mint: mintKeypair.publicKey,
        fromTokenAccount: recipient2Ata,
        toTokenAccount: treasuryAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const afterFrom = await getAccount(
      provider.connection, recipient2Ata, undefined, TOKEN_2022_PROGRAM_ID
    );
    // Source balance decreased by seizeAmount
    expect(Number(afterFrom.amount)).to.equal(
      Number(beforeFrom.amount) - seizeAmount.toNumber()
    );
  });

  it("Allowlist entries are independent — removing one does not affect others", async () => {
    const addr1 = Keypair.generate().publicKey;
    const addr2 = Keypair.generate().publicKey;
    const addr3 = Keypair.generate().publicKey;

    const pda1 = getAllowlistEntryPda(addr1);
    const pda2 = getAllowlistEntryPda(addr2);
    const pda3 = getAllowlistEntryPda(addr3);

    // Add all three addresses with different reasons
    for (const [addr, pda, reason] of [
      [addr1, pda1, "KYC batch A"],
      [addr2, pda2, "KYC batch A"],
      [addr3, pda3, "KYC batch B"],
    ] as [PublicKey, PublicKey, string][]) {
      await stablecoinProgram.methods
        .addToAllowlist(addr, reason)
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: rolesPda,
          config: configPda,
          allowlistEntry: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Remove only addr2
    await stablecoinProgram.methods
      .removeFromAllowlist(addr2)
      .accounts({
        payer: authority.publicKey,
        blacklister: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        allowlistEntry: pda2,
      })
      .rpc();

    // addr1 and addr3 must still exist with their original data
    const entry1 = await stablecoinProgram.account.allowlistEntry.fetch(pda1);
    expect(entry1.address.toBase58()).to.equal(addr1.toBase58());
    expect(entry1.reason).to.equal("KYC batch A");

    const entry3 = await stablecoinProgram.account.allowlistEntry.fetch(pda3);
    expect(entry3.address.toBase58()).to.equal(addr3.toBase58());
    expect(entry3.reason).to.equal("KYC batch B");

    // addr2's PDA must be closed
    const closedInfo = await provider.connection.getAccountInfo(pda2);
    expect(closedInfo).to.be.null;
  });
});
