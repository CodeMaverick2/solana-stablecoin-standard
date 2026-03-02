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

describe("Full Lifecycle: End-to-end for both presets", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stablecoinProgram = anchor.workspace.Stablecoin as Program<Stablecoin>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  const authority = provider.wallet as anchor.Wallet;

  // --- SSS-1 entities ---
  const sss1MintKeypair = Keypair.generate();
  const sss1MinterKeypair = Keypair.generate();
  const sss1UserA = Keypair.generate();
  const sss1UserB = Keypair.generate();

  let sss1ConfigPda: PublicKey;
  let sss1RolesPda: PublicKey;
  let sss1MinterConfigPda: PublicKey;
  let sss1UserAAta: PublicKey;
  let sss1UserBAta: PublicKey;

  // --- SSS-2 entities ---
  const sss2MintKeypair = Keypair.generate();
  const sss2MinterKeypair = Keypair.generate();
  const sss2UserA = Keypair.generate();
  const sss2UserB = Keypair.generate();
  const sss2Treasury = Keypair.generate();

  let sss2ConfigPda: PublicKey;
  let sss2RolesPda: PublicKey;
  let sss2MinterConfigPda: PublicKey;
  let sss2ExtraAccountMetaListPda: PublicKey;
  let sss2UserAAta: PublicKey;
  let sss2UserBAta: PublicKey;
  let sss2TreasuryAta: PublicKey;

  const DECIMALS = 6;

  before(async () => {
    // Derive SSS-1 PDAs
    [sss1ConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss1MintKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss1RolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), sss1ConfigPda.toBuffer()],
      stablecoinProgram.programId
    );
    [sss1MinterConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter"), sss1ConfigPda.toBuffer(), sss1MinterKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );

    // Derive SSS-2 PDAs
    [sss2ConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss2MintKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss2RolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), sss2ConfigPda.toBuffer()],
      stablecoinProgram.programId
    );
    [sss2MinterConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter"), sss2ConfigPda.toBuffer(), sss2MinterKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss2ExtraAccountMetaListPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), sss2MintKeypair.publicKey.toBuffer()],
      transferHookProgram.programId
    );

    // Derive ATAs
    sss1UserAAta = getAssociatedTokenAddressSync(
      sss1MintKeypair.publicKey, sss1UserA.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    sss1UserBAta = getAssociatedTokenAddressSync(
      sss1MintKeypair.publicKey, sss1UserB.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    sss2UserAAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, sss2UserA.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    sss2UserBAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, sss2UserB.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    sss2TreasuryAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, sss2Treasury.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    // Airdrop SOL to all participants
    const allKeypairs = [
      sss1MinterKeypair, sss1UserA, sss1UserB,
      sss2MinterKeypair, sss2UserA, sss2UserB, sss2Treasury,
    ];
    for (const kp of allKeypairs) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }
  });

  // ========== SSS-1 Full Cycle ==========

  describe("SSS-1: Full mint-transfer-freeze-thaw-burn cycle", () => {
    it("Initializes SSS-1 stablecoin", async () => {
      await stablecoinProgram.methods
        .initialize({
          name: "Lifecycle USD",
          symbol: "LUSD",
          uri: "https://example.com/lusd.json",
          decimals: DECIMALS,
          enablePermanentDelegate: false,
          enableTransferHook: false,
        enableConfidentialTransfer: false,
        enableAllowlist: false,
        })
        .accounts({
          payer: authority.publicKey,
          authority: authority.publicKey,
          config: sss1ConfigPda,
          mint: sss1MintKeypair.publicKey,
          roles: sss1RolesPda,
          transferHookProgram: null,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([sss1MintKeypair])
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(sss1ConfigPda);
      expect(config.enablePermanentDelegate).to.be.false;
      expect(config.enableTransferHook).to.be.false;
    });

    it("Sets up minter and creates ATAs", async () => {
      // Add minter
      await stablecoinProgram.methods
        .updateMinter(sss1MinterKeypair.publicKey, {
          quota: new BN(10_000_000_000),
          active: true,
        })
        .accounts({
          payer: authority.publicKey,
          authority: authority.publicKey,
          config: sss1ConfigPda,
          minterConfig: sss1MinterConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create ATAs
      const tx = new Transaction()
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss1UserAAta, sss1UserA.publicKey,
          sss1MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ))
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss1UserBAta, sss1UserB.publicKey,
          sss1MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ));
      await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);
    });

    it("Mints tokens to User A", async () => {
      await stablecoinProgram.methods
        .mintTokens(new BN(1_000_000_000))
        .accounts({
          minter: sss1MinterKeypair.publicKey,
          minterConfig: sss1MinterConfigPda,
          config: sss1ConfigPda,
          mint: sss1MintKeypair.publicKey,
          recipientTokenAccount: sss1UserAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([sss1MinterKeypair])
        .rpc();

      const account = await getAccount(provider.connection, sss1UserAAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(1_000_000_000);
    });

    it("Transfers tokens from User A to User B", async () => {
      const transferIx = createTransferCheckedInstruction(
        sss1UserAAta, sss1MintKeypair.publicKey, sss1UserBAta,
        sss1UserA.publicKey, BigInt(300_000_000), DECIMALS, [], TOKEN_2022_PROGRAM_ID
      );
      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [sss1UserA]);

      const accountA = await getAccount(provider.connection, sss1UserAAta, undefined, TOKEN_2022_PROGRAM_ID);
      const accountB = await getAccount(provider.connection, sss1UserBAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(Number(accountA.amount)).to.equal(700_000_000);
      expect(Number(accountB.amount)).to.equal(300_000_000);
    });

    it("Freezes User B's account", async () => {
      await stablecoinProgram.methods
        .freezeAccount()
        .accounts({
          freezer: authority.publicKey,
          roles: sss1RolesPda,
          config: sss1ConfigPda,
          mint: sss1MintKeypair.publicKey,
          targetTokenAccount: sss1UserBAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const account = await getAccount(provider.connection, sss1UserBAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.be.true;
    });

    it("Thaws User B's account", async () => {
      await stablecoinProgram.methods
        .thawAccount()
        .accounts({
          freezer: authority.publicKey,
          roles: sss1RolesPda,
          config: sss1ConfigPda,
          mint: sss1MintKeypair.publicKey,
          targetTokenAccount: sss1UserBAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const account = await getAccount(provider.connection, sss1UserBAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.be.false;
    });

    it("User A burns tokens", async () => {
      await stablecoinProgram.methods
        .burnTokens(new BN(200_000_000))
        .accounts({
          burner: sss1UserA.publicKey,
          config: sss1ConfigPda,
          mint: sss1MintKeypair.publicKey,
          burnerTokenAccount: sss1UserAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([sss1UserA])
        .rpc();

      const account = await getAccount(provider.connection, sss1UserAAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(500_000_000);
    });

    it("Verifies SSS-1 supply tracking", async () => {
      const config = await stablecoinProgram.account.stablecoinConfig.fetch(sss1ConfigPda);
      expect(config.totalMinted.toNumber()).to.equal(1_000_000_000);
      expect(config.totalBurned.toNumber()).to.equal(200_000_000);
    });
  });

  // ========== SSS-2 Full Cycle ==========

  describe("SSS-2: Full mint-transfer-blacklist-seize-burn cycle", () => {
    it("Initializes SSS-2 stablecoin", async () => {
      await stablecoinProgram.methods
        .initialize({
          name: "Compliant Lifecycle",
          symbol: "CLUSD",
          uri: "https://example.com/clusd.json",
          decimals: DECIMALS,
          enablePermanentDelegate: true,
          enableTransferHook: true,
        enableConfidentialTransfer: false,
        enableAllowlist: false,
        })
        .accounts({
          payer: authority.publicKey,
          authority: authority.publicKey,
          config: sss2ConfigPda,
          mint: sss2MintKeypair.publicKey,
          roles: sss2RolesPda,
          transferHookProgram: transferHookProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([sss2MintKeypair])
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(sss2ConfigPda);
      expect(config.enablePermanentDelegate).to.be.true;
      expect(config.enableTransferHook).to.be.true;
    });

    it("Initializes extra account meta list", async () => {
      await transferHookProgram.methods
        .initializeExtraAccountMetaList(sss2ConfigPda, stablecoinProgram.programId)
        .accounts({
          payer: authority.publicKey,
          mint: sss2MintKeypair.publicKey,
          extraAccountMetaList: sss2ExtraAccountMetaListPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("Sets up minter and creates ATAs", async () => {
      // Add minter
      await stablecoinProgram.methods
        .updateMinter(sss2MinterKeypair.publicKey, {
          quota: new BN(10_000_000_000),
          active: true,
        })
        .accounts({
          payer: authority.publicKey,
          authority: authority.publicKey,
          config: sss2ConfigPda,
          minterConfig: sss2MinterConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Create ATAs
      const tx = new Transaction()
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss2UserAAta, sss2UserA.publicKey,
          sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ))
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss2UserBAta, sss2UserB.publicKey,
          sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ))
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss2TreasuryAta, sss2Treasury.publicKey,
          sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ));
      await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);
    });

    it("Mints tokens to User A", async () => {
      await stablecoinProgram.methods
        .mintTokens(new BN(2_000_000_000))
        .accounts({
          minter: sss2MinterKeypair.publicKey,
          minterConfig: sss2MinterConfigPda,
          config: sss2ConfigPda,
          mint: sss2MintKeypair.publicKey,
          recipientTokenAccount: sss2UserAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([sss2MinterKeypair])
        .rpc();

      const account = await getAccount(provider.connection, sss2UserAAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(2_000_000_000);
    });

    it("Transfers tokens from User A to User B (non-blacklisted)", async () => {
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        sss2UserAAta, sss2MintKeypair.publicKey, sss2UserBAta,
        sss2UserA.publicKey, BigInt(500_000_000), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
      );
      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [sss2UserA]);

      const accountB = await getAccount(provider.connection, sss2UserBAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(Number(accountB.amount)).to.equal(500_000_000);
    });

    it("Blacklists User A and verifies transfer fails", async () => {
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss2ConfigPda.toBuffer(), sss2UserA.publicKey.toBuffer()],
        stablecoinProgram.programId
      );

      await stablecoinProgram.methods
        .addToBlacklist(sss2UserA.publicKey, "Compliance investigation")
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Attempt transfer from blacklisted User A (should fail)
      try {
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          provider.connection,
          sss2UserAAta, sss2MintKeypair.publicKey, sss2UserBAta,
          sss2UserA.publicKey, BigInt(100_000_000), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
        );
        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(provider.connection, tx, [sss2UserA]);
        expect.fail("Should have thrown - sender is blacklisted");
      } catch (e: any) {
        expect(e.toString()).to.include("failed");
      }
    });

    it("Seizes tokens from User A to treasury via permanent delegate", async () => {
      const seizeAmount = new BN(500_000_000);

      await stablecoinProgram.methods
        .seize(seizeAmount)
        .accounts({
          seizer: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          mint: sss2MintKeypair.publicKey,
          fromTokenAccount: sss2UserAAta,
          toTokenAccount: sss2TreasuryAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const treasuryAccount = await getAccount(
        provider.connection, sss2TreasuryAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(Number(treasuryAccount.amount)).to.equal(500_000_000);

      const userAAccount = await getAccount(
        provider.connection, sss2UserAAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(Number(userAAccount.amount)).to.equal(1_000_000_000); // 2000M - 500M transfer - 500M seized
    });

    it("Burns tokens from User B's account", async () => {
      await stablecoinProgram.methods
        .burnTokens(new BN(100_000_000))
        .accounts({
          burner: sss2UserB.publicKey,
          config: sss2ConfigPda,
          mint: sss2MintKeypair.publicKey,
          burnerTokenAccount: sss2UserBAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([sss2UserB])
        .rpc();

      const account = await getAccount(provider.connection, sss2UserBAta, undefined, TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(400_000_000);
    });

    it("Verifies SSS-2 supply tracking", async () => {
      const config = await stablecoinProgram.account.stablecoinConfig.fetch(sss2ConfigPda);
      // Seize (500M) does burn + mint, so both counters include the seized amount.
      expect(config.totalMinted.toNumber()).to.equal(2_500_000_000);
      expect(config.totalBurned.toNumber()).to.equal(600_000_000);
    });
  });

  // ========== Coexistence Verification ==========

  describe("Verifies both stablecoins can coexist", () => {
    it("Both configs exist and are independent", async () => {
      const sss1Config = await stablecoinProgram.account.stablecoinConfig.fetch(sss1ConfigPda);
      const sss2Config = await stablecoinProgram.account.stablecoinConfig.fetch(sss2ConfigPda);

      // Different mints
      expect(sss1Config.mint.toBase58()).to.not.equal(sss2Config.mint.toBase58());

      // Different feature flags
      expect(sss1Config.enablePermanentDelegate).to.be.false;
      expect(sss2Config.enablePermanentDelegate).to.be.true;
      expect(sss1Config.enableTransferHook).to.be.false;
      expect(sss2Config.enableTransferHook).to.be.true;

      // Independent supply tracking (seize 500M adds to both minted+burned on SSS-2)
      expect(sss1Config.totalMinted.toNumber()).to.equal(1_000_000_000);
      expect(sss2Config.totalMinted.toNumber()).to.equal(2_500_000_000);
      expect(sss1Config.totalBurned.toNumber()).to.equal(200_000_000);
      expect(sss2Config.totalBurned.toNumber()).to.equal(600_000_000);
    });

    it("SSS-1 operations do not affect SSS-2 and vice versa", async () => {
      // Mint more on SSS-1
      await stablecoinProgram.methods
        .mintTokens(new BN(50_000_000))
        .accounts({
          minter: sss1MinterKeypair.publicKey,
          minterConfig: sss1MinterConfigPda,
          config: sss1ConfigPda,
          mint: sss1MintKeypair.publicKey,
          recipientTokenAccount: sss1UserAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([sss1MinterKeypair])
        .rpc();

      // Verify SSS-2 is unaffected (includes 500M from seize re-mint)
      const sss2Config = await stablecoinProgram.account.stablecoinConfig.fetch(sss2ConfigPda);
      expect(sss2Config.totalMinted.toNumber()).to.equal(2_500_000_000);

      // Verify SSS-1 updated correctly
      const sss1Config = await stablecoinProgram.account.stablecoinConfig.fetch(sss1ConfigPda);
      expect(sss1Config.totalMinted.toNumber()).to.equal(1_050_000_000);
    });
  });
});
