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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Stablecoin } from "../target/types/stablecoin";
import { TransferHook } from "../target/types/transfer_hook";

describe("SSS-1: Minimal Stablecoin Lifecycle", () => {
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
  let rolesBump: number;
  let minterConfigPda: PublicKey;

  // Token accounts
  let recipientAta: PublicKey;
  let recipient2Ata: PublicKey;

  // Constants
  const DECIMALS = 6;
  const MINT_AMOUNT = new BN(1_000_000_000); // 1000 tokens
  const TRANSFER_AMOUNT = new BN(500_000_000); // 500 tokens
  const BURN_AMOUNT = new BN(100_000_000); // 100 tokens

  before(async () => {
    // Derive PDAs
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), mintKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    [rolesPda, rolesBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), configPda.toBuffer()],
      stablecoinProgram.programId
    );

    [minterConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter"), configPda.toBuffer(), minterKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    // Airdrop SOL to minter and recipients
    const airdropSig1 = await provider.connection.requestAirdrop(
      minterKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig1);

    const airdropSig2 = await provider.connection.requestAirdrop(
      recipientKeypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig2);

    const airdropSig3 = await provider.connection.requestAirdrop(
      recipient2Keypair.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig3);

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

  it("Initializes SSS-1 stablecoin (no permanent delegate, no transfer hook)", async () => {
    await stablecoinProgram.methods
      .initialize({
        name: "Test USD",
        symbol: "TUSD",
        uri: "https://example.com/tusd.json",
        decimals: DECIMALS,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        enableConfidentialTransfer: false,
        enableAllowlist: false,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        roles: rolesPda,
        transferHookProgram: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
  });

  it("Verifies config account state after initialization", async () => {
    const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);

    expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(config.pendingAuthority.toBase58()).to.equal(PublicKey.default.toBase58());
    expect(config.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
    expect(config.decimals).to.equal(DECIMALS);
    expect(config.enablePermanentDelegate).to.be.false;
    expect(config.enableTransferHook).to.be.false;
    expect(config.isPaused).to.be.false;
    expect(config.totalMinted.toNumber()).to.equal(0);
    expect(config.totalBurned.toNumber()).to.equal(0);
  });

  it("Verifies role config is initialized with authority as all roles", async () => {
    const roles = await stablecoinProgram.account.roleConfig.fetch(rolesPda);

    expect(roles.stablecoinConfig.toBase58()).to.equal(configPda.toBase58());
    expect(roles.pauser.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(roles.freezer.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(roles.blacklister.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(roles.seizer.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("Adds a minter with quota", async () => {
    await stablecoinProgram.methods
      .updateMinter(minterKeypair.publicKey, {
        quota: new BN(5_000_000_000), // 5000 tokens
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

    const minterConfig = await stablecoinProgram.account.minterConfig.fetch(minterConfigPda);

    expect(minterConfig.minter.toBase58()).to.equal(minterKeypair.publicKey.toBase58());
    expect(minterConfig.stablecoinConfig.toBase58()).to.equal(configPda.toBase58());
    expect(minterConfig.quota.toNumber()).to.equal(5_000_000_000);
    expect(minterConfig.minted.toNumber()).to.equal(0);
    expect(minterConfig.active).to.be.true;
  });

  it("Creates associated token account for recipient", async () => {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      recipientAta,
      recipientKeypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(createAtaIx);
    await sendAndConfirmTransaction(provider.connection, tx, [
      (authority as any).payer,
    ]);

    const account = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
    expect(account.owner.toBase58()).to.equal(recipientKeypair.publicKey.toBase58());
  });

  it("Mints tokens to recipient", async () => {
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

    // Verify minter config updated
    const minterConfig = await stablecoinProgram.account.minterConfig.fetch(minterConfigPda);
    expect(minterConfig.minted.toNumber()).to.equal(MINT_AMOUNT.toNumber());
  });

  it("Creates ATA for recipient2 and transfers tokens between accounts", async () => {
    // Create ATA for recipient2
    const createAta2Ix = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      recipient2Ata,
      recipient2Keypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const createTx = new Transaction().add(createAta2Ix);
    await sendAndConfirmTransaction(provider.connection, createTx, [
      (authority as any).payer,
    ]);

    // Transfer tokens from recipient to recipient2
    const transferIx = createTransferCheckedInstruction(
      recipientAta,
      mintKeypair.publicKey,
      recipient2Ata,
      recipientKeypair.publicKey,
      BigInt(TRANSFER_AMOUNT.toString()),
      DECIMALS,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const transferTx = new Transaction().add(transferIx);
    await sendAndConfirmTransaction(provider.connection, transferTx, [
      recipientKeypair,
    ]);

    // Verify balances
    const recipientAccount = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(recipientAccount.amount)).to.equal(
      MINT_AMOUNT.sub(TRANSFER_AMOUNT).toNumber()
    );

    const recipient2Account = await getAccount(
      provider.connection,
      recipient2Ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(recipient2Account.amount)).to.equal(TRANSFER_AMOUNT.toNumber());
  });

  it("Freezes an account and verifies transfer fails when frozen", async () => {
    // Freeze recipient's account
    await stablecoinProgram.methods
      .freezeAccount()
      .accounts({
        freezer: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Verify the account is frozen
    const account = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.be.true;

    // Attempt transfer from frozen account (should fail)
    try {
      const transferIx = createTransferCheckedInstruction(
        recipientAta,
        mintKeypair.publicKey,
        recipient2Ata,
        recipientKeypair.publicKey,
        BigInt(100_000_000),
        DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [
        recipientKeypair,
      ]);
      expect.fail("Should have thrown - account is frozen");
    } catch (e: any) {
      // Token-2022 rejects transfers from frozen accounts
      expect(e.toString()).to.contain("frozen");
    }
  });

  it("Thaws the account and verifies transfer works again", async () => {
    // Thaw recipient's account
    await stablecoinProgram.methods
      .thawAccount()
      .accounts({
        freezer: authority.publicKey,
        roles: rolesPda,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Verify the account is thawed
    const account = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(account.isFrozen).to.be.false;

    // Transfer should work now
    const transferIx = createTransferCheckedInstruction(
      recipientAta,
      mintKeypair.publicKey,
      recipient2Ata,
      recipientKeypair.publicKey,
      BigInt(100_000_000),
      DECIMALS,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    await sendAndConfirmTransaction(provider.connection, tx, [
      recipientKeypair,
    ]);

    const recipientAccount = await getAccount(
      provider.connection,
      recipientAta,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    // Had 500M, transferred 100M more
    expect(Number(recipientAccount.amount)).to.equal(400_000_000);
  });

  it("Burns tokens from holder's own account", async () => {
    // Recipient2 burns some of their tokens
    await stablecoinProgram.methods
      .burnTokens(BURN_AMOUNT)
      .accounts({
        burner: recipient2Keypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        burnerTokenAccount: recipient2Ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([recipient2Keypair])
      .rpc();

    const account = await getAccount(
      provider.connection,
      recipient2Ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    // Had 500M + 100M = 600M, burned 100M = 500M
    expect(Number(account.amount)).to.equal(500_000_000);
  });

  it("Verifies supply tracking (totalMinted, totalBurned)", async () => {
    const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);

    expect(config.totalMinted.toNumber()).to.equal(MINT_AMOUNT.toNumber());
    expect(config.totalBurned.toNumber()).to.equal(BURN_AMOUNT.toNumber());

    // Net supply should be totalMinted - totalBurned
    const netSupply = config.totalMinted.sub(config.totalBurned);
    expect(netSupply.toNumber()).to.equal(900_000_000); // 1000M - 100M = 900M
  });
});
