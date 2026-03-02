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
  createTransferCheckedInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Stablecoin } from "../target/types/stablecoin";
import { TransferHook } from "../target/types/transfer_hook";

describe("SSS-2: Compliant Stablecoin Lifecycle", () => {
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
  const treasuryKeypair = Keypair.generate();

  // PDAs
  let configPda: PublicKey;
  let configBump: number;
  let rolesPda: PublicKey;
  let minterConfigPda: PublicKey;
  let extraAccountMetaListPda: PublicKey;

  // Token accounts
  let recipientAta: PublicKey;
  let recipient2Ata: PublicKey;
  let treasuryAta: PublicKey;

  // Constants
  const DECIMALS = 6;
  const MINT_AMOUNT = new BN(1_000_000_000); // 1000 tokens

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

    // Airdrop SOL
    const airdropPromises = [
      minterKeypair,
      recipientKeypair,
      recipient2Keypair,
      treasuryKeypair,
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

    treasuryAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      treasuryKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Initializes SSS-2 stablecoin (permanent delegate + transfer hook)", async () => {
    await stablecoinProgram.methods
      .initialize({
        name: "Compliant USD",
        symbol: "CUSD",
        uri: "https://example.com/cusd.json",
        decimals: DECIMALS,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        enableConfidentialTransfer: false,
        enableAllowlist: false,
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
    expect(config.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
  });

  it("Initializes extra account meta list for the transfer hook", async () => {
    await transferHookProgram.methods
      .initializeExtraAccountMetaList(configPda, stablecoinProgram.programId)
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

    // Mint tokens
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

  it("Creates recipient2 and treasury ATAs", async () => {
    const createAta2Ix = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      recipient2Ata,
      recipient2Keypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const createTreasuryAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      treasuryAta,
      treasuryKeypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(createAta2Ix).add(createTreasuryAtaIx);
    await sendAndConfirmTransaction(provider.connection, tx, [
      (authority as any).payer,
    ]);
  });

  it("Adds address to blacklist", async () => {
    const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), configPda.toBuffer(), recipientKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    await stablecoinProgram.methods
      .addToBlacklist(recipientKeypair.publicKey, "OFAC sanctions match")
      .accounts({
        payer: authority.publicKey,
        blacklister: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        blacklistEntry: blacklistEntryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const entry = await stablecoinProgram.account.blacklistEntry.fetch(blacklistEntryPda);
    expect(entry.address.toBase58()).to.equal(recipientKeypair.publicKey.toBase58());
    expect(entry.reason).to.equal("OFAC sanctions match");
    expect(entry.blacklistedBy.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(entry.blacklistedAt.toNumber()).to.be.greaterThan(0);
  });

  it("Verifies transfer fails when sender is blacklisted (transfer hook rejects)", async () => {
    try {
      // Attempt to transfer from blacklisted sender
      // For SSS-2, we need to use transferChecked which invokes the transfer hook.
      // The transfer hook will see the sender is blacklisted and reject.
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        recipientAta,
        mintKeypair.publicKey,
        recipient2Ata,
        recipientKeypair.publicKey,
        BigInt(100_000_000),
        DECIMALS,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [recipientKeypair]);
      expect.fail("Should have thrown - sender is blacklisted");
    } catch (e: any) {
      // Transfer hook rejects blacklisted senders
      expect(e.toString()).to.include("failed");
    }
  });

  it("Removes address from blacklist and verifies transfer works", async () => {
    const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), configPda.toBuffer(), recipientKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    await stablecoinProgram.methods
      .removeFromBlacklist(recipientKeypair.publicKey)
      .accounts({
        payer: authority.publicKey,
        blacklister: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        blacklistEntry: blacklistEntryPda,
      })
      .rpc();

    // Verify the blacklist entry is closed
    const accountInfo = await provider.connection.getAccountInfo(blacklistEntryPda);
    expect(accountInfo).to.be.null;

    // Transfer should now succeed
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      provider.connection,
      recipientAta,
      mintKeypair.publicKey,
      recipient2Ata,
      recipientKeypair.publicKey,
      BigInt(200_000_000),
      DECIMALS,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    await sendAndConfirmTransaction(provider.connection, tx, [recipientKeypair]);

    const recipientAccount = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(recipientAccount.amount)).to.equal(800_000_000); // 1000M - 200M
  });

  it("Freezes account and seizes tokens via permanent delegate", async () => {
    // First freeze recipient2's account
    await stablecoinProgram.methods
      .freezeAccount()
      .accounts({
        freezer: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: recipient2Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Verify frozen
    let account = await getAccount(
      provider.connection,
      recipient2Ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.be.true;
    const frozenBalance = Number(account.amount);

    // Thaw first so we can seize (transfer_checked requires unfrozen account)
    await stablecoinProgram.methods
      .thawAccount()
      .accounts({
        freezer: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: recipient2Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Seize tokens using permanent delegate
    const seizeAmount = new BN(100_000_000); // 100 tokens
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

    // Verify tokens were seized
    const recipient2Account = await getAccount(
      provider.connection,
      recipient2Ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(recipient2Account.amount)).to.equal(frozenBalance - seizeAmount.toNumber());

    const treasuryAccount = await getAccount(
      provider.connection,
      treasuryAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(treasuryAccount.amount)).to.equal(seizeAmount.toNumber());
  });

  it("Verifies SSS-2 config flags are correctly set", async () => {
    const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);

    expect(config.enablePermanentDelegate).to.be.true;
    expect(config.enableTransferHook).to.be.true;
    // Seize does burn + mint, so both counters include the seized amount (100_000_000).
    expect(config.totalMinted.toNumber()).to.equal(MINT_AMOUNT.toNumber() + 100_000_000);
    expect(config.totalBurned.toNumber()).to.equal(100_000_000);
  });
});
