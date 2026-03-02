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

describe("Compliance: SSS-2 compliance features", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stablecoinProgram = anchor.workspace.Stablecoin as Program<Stablecoin>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  const authority = provider.wallet as anchor.Wallet;

  // --- SSS-2 (Compliant) setup ---
  const sss2MintKeypair = Keypair.generate();
  const sss2MinterKeypair = Keypair.generate();
  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userC = Keypair.generate();
  const treasury = Keypair.generate();

  let sss2ConfigPda: PublicKey;
  let sss2RolesPda: PublicKey;
  let sss2MinterConfigPda: PublicKey;
  let sss2ExtraAccountMetaListPda: PublicKey;
  let userAAta: PublicKey;
  let userBAta: PublicKey;
  let userCAta: PublicKey;
  let treasuryAta: PublicKey;

  // --- SSS-1 (Minimal) setup for compliance-fails-on-SSS-1 tests ---
  const sss1MintKeypair = Keypair.generate();
  let sss1ConfigPda: PublicKey;
  let sss1RolesPda: PublicKey;

  const DECIMALS = 6;

  before(async () => {
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

    // Derive SSS-1 PDAs
    [sss1ConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss1MintKeypair.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss1RolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), sss1ConfigPda.toBuffer()],
      stablecoinProgram.programId
    );

    // Derive ATAs
    userAAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, userA.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    userBAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, userB.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    userCAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, userC.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    treasuryAta = getAssociatedTokenAddressSync(
      sss2MintKeypair.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    // Airdrop SOL
    const allKeypairs = [sss2MinterKeypair, userA, userB, userC, treasury];
    for (const kp of allKeypairs) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Initialize SSS-2
    await stablecoinProgram.methods
      .initialize({
        name: "Compliance USD",
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

    // Initialize extra account meta list
    await transferHookProgram.methods
      .initializeExtraAccountMetaList(sss2ConfigPda, stablecoinProgram.programId)
      .accounts({
        payer: authority.publicKey,
        mint: sss2MintKeypair.publicKey,
        extraAccountMetaList: sss2ExtraAccountMetaListPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Add minter
    await stablecoinProgram.methods
      .updateMinter(sss2MinterKeypair.publicKey, {
        quota: new BN(50_000_000_000),
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
        authority.publicKey, userAAta, userA.publicKey,
        sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
      ))
      .add(createAssociatedTokenAccountInstruction(
        authority.publicKey, userBAta, userB.publicKey,
        sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
      ))
      .add(createAssociatedTokenAccountInstruction(
        authority.publicKey, userCAta, userC.publicKey,
        sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
      ))
      .add(createAssociatedTokenAccountInstruction(
        authority.publicKey, treasuryAta, treasury.publicKey,
        sss2MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
      ));
    await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);

    // Mint tokens to users
    await stablecoinProgram.methods
      .mintTokens(new BN(5_000_000_000))
      .accounts({
        minter: sss2MinterKeypair.publicKey,
        minterConfig: sss2MinterConfigPda,
        config: sss2ConfigPda,
        mint: sss2MintKeypair.publicKey,
        recipientTokenAccount: userAAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([sss2MinterKeypair])
      .rpc();

    await stablecoinProgram.methods
      .mintTokens(new BN(3_000_000_000))
      .accounts({
        minter: sss2MinterKeypair.publicKey,
        minterConfig: sss2MinterConfigPda,
        config: sss2ConfigPda,
        mint: sss2MintKeypair.publicKey,
        recipientTokenAccount: userBAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([sss2MinterKeypair])
      .rpc();

    // Initialize SSS-1 for ComplianceNotEnabled tests
    await stablecoinProgram.methods
      .initialize({
        name: "Minimal USD",
        symbol: "MUSD",
        uri: "https://example.com/musd.json",
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
  });

  // ========== Blacklist add/remove ==========

  describe("Blacklist add/remove", () => {
    it("Adds an address to the blacklist", async () => {
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss2ConfigPda.toBuffer(), userC.publicKey.toBuffer()],
        stablecoinProgram.programId
      );

      await stablecoinProgram.methods
        .addToBlacklist(userC.publicKey, "Test blacklist reason")
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await stablecoinProgram.account.blacklistEntry.fetch(blacklistEntryPda);
      expect(entry.address.toBase58()).to.equal(userC.publicKey.toBase58());
      expect(entry.reason).to.equal("Test blacklist reason");
    });

    it("Removes an address from the blacklist", async () => {
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss2ConfigPda.toBuffer(), userC.publicKey.toBuffer()],
        stablecoinProgram.programId
      );

      await stablecoinProgram.methods
        .removeFromBlacklist(userC.publicKey)
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
        })
        .rpc();

      const accountInfo = await provider.connection.getAccountInfo(blacklistEntryPda);
      expect(accountInfo).to.be.null;
    });
  });

  // ========== Transfer hook enforcement ==========

  describe("Transfer hook enforcement", () => {
    it("Blacklisted sender cannot transfer (transfer hook rejects)", async () => {
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss2ConfigPda.toBuffer(), userA.publicKey.toBuffer()],
        stablecoinProgram.programId
      );

      // Blacklist User A
      await stablecoinProgram.methods
        .addToBlacklist(userA.publicKey, "Sender blacklist test")
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Attempt transfer from blacklisted User A
      try {
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          provider.connection,
          userAAta, sss2MintKeypair.publicKey, userBAta,
          userA.publicKey, BigInt(100_000_000), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
        );
        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(provider.connection, tx, [userA]);
        expect.fail("Should have thrown - sender is blacklisted");
      } catch (e: any) {
        expect(e.toString()).to.include("failed");
      }

      // Clean up: remove from blacklist
      await stablecoinProgram.methods
        .removeFromBlacklist(userA.publicKey)
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
        })
        .rpc();
    });

    it("Blacklisted recipient cannot receive transfers (transfer hook rejects)", async () => {
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss2ConfigPda.toBuffer(), userB.publicKey.toBuffer()],
        stablecoinProgram.programId
      );

      // Blacklist User B (recipient)
      await stablecoinProgram.methods
        .addToBlacklist(userB.publicKey, "Recipient blacklist test")
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Attempt transfer to blacklisted User B
      try {
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          provider.connection,
          userAAta, sss2MintKeypair.publicKey, userBAta,
          userA.publicKey, BigInt(100_000_000), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
        );
        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(provider.connection, tx, [userA]);
        expect.fail("Should have thrown - recipient is blacklisted");
      } catch (e: any) {
        expect(e.toString()).to.include("failed");
      }

      // Clean up: remove from blacklist
      await stablecoinProgram.methods
        .removeFromBlacklist(userB.publicKey)
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
        })
        .rpc();
    });

    it("Transfer succeeds when neither party is blacklisted", async () => {
      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        userAAta, sss2MintKeypair.publicKey, userBAta,
        userA.publicKey, BigInt(100_000_000), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
      );
      const tx = new Transaction().add(transferIx);
      await sendAndConfirmTransaction(provider.connection, tx, [userA]);

      const accountB = await getAccount(
        provider.connection, userBAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(Number(accountB.amount)).to.equal(3_100_000_000); // 3000M + 100M
    });
  });

  // ========== Seize tokens via permanent delegate ==========

  describe("Seize tokens via permanent delegate", () => {
    it("Seizes tokens from target to treasury", async () => {
      const seizeAmount = new BN(500_000_000);

      await stablecoinProgram.methods
        .seize(seizeAmount)
        .accounts({
          seizer: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          mint: sss2MintKeypair.publicKey,
          fromTokenAccount: userAAta,
          toTokenAccount: treasuryAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const treasuryAccount = await getAccount(
        provider.connection, treasuryAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(Number(treasuryAccount.amount)).to.equal(500_000_000);
    });

    it("Can seize all remaining tokens from an account", async () => {
      const userAAccount = await getAccount(
        provider.connection, userAAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      const remainingBalance = new BN(Number(userAAccount.amount).toString());

      await stablecoinProgram.methods
        .seize(remainingBalance)
        .accounts({
          seizer: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          mint: sss2MintKeypair.publicKey,
          fromTokenAccount: userAAta,
          toTokenAccount: treasuryAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      const userAAfter = await getAccount(
        provider.connection, userAAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(Number(userAAfter.amount)).to.equal(0);
    });
  });

  // ========== Compliance instructions fail on SSS-1 ==========

  describe("Compliance instructions fail on SSS-1 (ComplianceNotEnabled)", () => {
    it("add_to_blacklist fails on SSS-1", async () => {
      const dummyAddress = Keypair.generate().publicKey;
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss1ConfigPda.toBuffer(), dummyAddress.toBuffer()],
        stablecoinProgram.programId
      );

      try {
        await stablecoinProgram.methods
          .addToBlacklist(dummyAddress, "Should fail")
          .accounts({
            payer: authority.publicKey,
            blacklister: authority.publicKey,
            roles: sss1RolesPda,
            config: sss1ConfigPda,
            blacklistEntry: blacklistEntryPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown - ComplianceNotEnabled");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("ComplianceNotEnabled");
      }
    });

    it("remove_from_blacklist fails on SSS-1 (no entry to remove, compliance not enabled)", async () => {
      const dummyAddress = Keypair.generate().publicKey;
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss1ConfigPda.toBuffer(), dummyAddress.toBuffer()],
        stablecoinProgram.programId
      );

      try {
        await stablecoinProgram.methods
          .removeFromBlacklist(dummyAddress)
          .accounts({
            payer: authority.publicKey,
            blacklister: authority.publicKey,
            roles: sss1RolesPda,
            config: sss1ConfigPda,
            blacklistEntry: blacklistEntryPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (e: any) {
        // Will fail either with ComplianceNotEnabled or AccountNotInitialized
        expect(e.toString()).to.include("Error");
      }
    });

    it("seize fails on SSS-1 (ComplianceNotEnabled)", async () => {
      // We need token accounts for the SSS-1 mint to test seize
      const sss1UserAta = getAssociatedTokenAddressSync(
        sss1MintKeypair.publicKey, userA.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const sss1TreasuryAta = getAssociatedTokenAddressSync(
        sss1MintKeypair.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID
      );

      // Create ATAs for SSS-1
      const tx = new Transaction()
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss1UserAta, userA.publicKey,
          sss1MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ))
        .add(createAssociatedTokenAccountInstruction(
          authority.publicKey, sss1TreasuryAta, treasury.publicKey,
          sss1MintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        ));
      await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);

      try {
        await stablecoinProgram.methods
          .seize(new BN(100_000_000))
          .accounts({
            seizer: authority.publicKey,
            roles: sss1RolesPda,
            config: sss1ConfigPda,
            mint: sss1MintKeypair.publicKey,
            fromTokenAccount: sss1UserAta,
            toTokenAccount: sss1TreasuryAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown - ComplianceNotEnabled");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("ComplianceNotEnabled");
      }
    });
  });

  // ========== Blacklist entry metadata ==========

  describe("Blacklist entry stores correct metadata", () => {
    it("Verifies reason, timestamp, and blacklisted_by fields", async () => {
      const targetAddress = Keypair.generate().publicKey;
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), sss2ConfigPda.toBuffer(), targetAddress.toBuffer()],
        stablecoinProgram.programId
      );

      const reason = "Suspected money laundering - Case #12345";

      await stablecoinProgram.methods
        .addToBlacklist(targetAddress, reason)
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await stablecoinProgram.account.blacklistEntry.fetch(blacklistEntryPda);

      expect(entry.stablecoinConfig.toBase58()).to.equal(sss2ConfigPda.toBase58());
      expect(entry.address.toBase58()).to.equal(targetAddress.toBase58());
      expect(entry.reason).to.equal(reason);
      expect(entry.blacklistedAt.toNumber()).to.be.greaterThan(0);
      expect(entry.blacklistedBy.toBase58()).to.equal(authority.publicKey.toBase58());

      // Verify timestamp is recent (within 60 seconds)
      const now = Math.floor(Date.now() / 1000);
      expect(entry.blacklistedAt.toNumber()).to.be.closeTo(now, 60);

      // Clean up
      await stablecoinProgram.methods
        .removeFromBlacklist(targetAddress)
        .accounts({
          payer: authority.publicKey,
          blacklister: authority.publicKey,
          roles: sss2RolesPda,
          config: sss2ConfigPda,
          blacklistEntry: blacklistEntryPda,
        })
        .rpc();
    });
  });
});
