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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Stablecoin } from "../target/types/stablecoin";
import { TransferHook } from "../target/types/transfer_hook";

describe("Roles: Role-based access control", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stablecoinProgram = anchor.workspace.Stablecoin as Program<Stablecoin>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;

  const authority = provider.wallet as anchor.Wallet;

  // SSS-2 stablecoin for full role testing (including compliance roles)
  const mintKeypair = Keypair.generate();
  const minterKeypair = Keypair.generate();
  const userA = Keypair.generate();

  // Role-specific keypairs
  const pauserKeypair = Keypair.generate();
  const freezerKeypair = Keypair.generate();
  const blacklisterKeypair = Keypair.generate();
  const seizerKeypair = Keypair.generate();
  const unauthorizedKeypair = Keypair.generate();
  const newAuthority = Keypair.generate();

  // PDAs
  let configPda: PublicKey;
  let rolesPda: PublicKey;
  let minterConfigPda: PublicKey;
  let extraAccountMetaListPda: PublicKey;
  let userAAta: PublicKey;

  const DECIMALS = 6;

  before(async () => {
    // Derive PDAs
    [configPda] = PublicKey.findProgramAddressSync(
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

    userAAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey, userA.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    // Airdrop SOL to all keypairs
    const allKeypairs = [
      minterKeypair, userA, pauserKeypair, freezerKeypair,
      blacklisterKeypair, seizerKeypair, unauthorizedKeypair, newAuthority,
    ];
    for (const kp of allKeypairs) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Initialize SSS-2
    await stablecoinProgram.methods
      .initialize({
        name: "Roles Test USD",
        symbol: "RTSD",
        uri: "https://example.com/rtsd.json",
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

    // Initialize extra account meta list
    await transferHookProgram.methods
      .initializeExtraAccountMetaList(configPda, stablecoinProgram.programId)
      .accounts({
        payer: authority.publicKey,
        mint: mintKeypair.publicKey,
        extraAccountMetaList: extraAccountMetaListPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create user A ATA
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, userAAta, userA.publicKey,
        mintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);
  });

  // ========== Master authority for update_minter ==========

  describe("Only master authority can update minter", () => {
    it("Master authority can add a minter", async () => {
      await stablecoinProgram.methods
        .updateMinter(minterKeypair.publicKey, {
          quota: new BN(5_000_000_000),
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
      expect(minterConfig.active).to.be.true;
      expect(minterConfig.quota.toNumber()).to.equal(5_000_000_000);
    });

    it("Unauthorized caller cannot update minter", async () => {
      const dummyMinterPubkey = Keypair.generate().publicKey;
      const [dummyMinterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("minter"), configPda.toBuffer(), dummyMinterPubkey.toBuffer()],
        stablecoinProgram.programId
      );

      try {
        await stablecoinProgram.methods
          .updateMinter(dummyMinterPubkey, {
            quota: new BN(1_000_000),
            active: true,
          })
          .accounts({
            payer: unauthorizedKeypair.publicKey,
            authority: unauthorizedKeypair.publicKey,
            config: configPda,
            minterConfig: dummyMinterPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });
  });

  // ========== Master authority for update_roles ==========

  describe("Only master authority can update roles", () => {
    it("Master authority can update roles", async () => {
      await stablecoinProgram.methods
        .updateRoles({
          pauser: pauserKeypair.publicKey,
          freezer: freezerKeypair.publicKey,
          blacklister: blacklisterKeypair.publicKey,
          seizer: seizerKeypair.publicKey,
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          roles: rolesPda,
        })
        .rpc();

      const roles = await stablecoinProgram.account.roleConfig.fetch(rolesPda);
      expect(roles.pauser.toBase58()).to.equal(pauserKeypair.publicKey.toBase58());
      expect(roles.freezer.toBase58()).to.equal(freezerKeypair.publicKey.toBase58());
      expect(roles.blacklister.toBase58()).to.equal(blacklisterKeypair.publicKey.toBase58());
      expect(roles.seizer.toBase58()).to.equal(seizerKeypair.publicKey.toBase58());
    });

    it("Unauthorized caller cannot update roles", async () => {
      try {
        await stablecoinProgram.methods
          .updateRoles({
            pauser: unauthorizedKeypair.publicKey,
            freezer: null,
            blacklister: null,
            seizer: null,
          })
          .accounts({
            authority: unauthorizedKeypair.publicKey,
            config: configPda,
            roles: rolesPda,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });

    it("Partial role update only changes specified roles", async () => {
      const newPauser = Keypair.generate();

      await stablecoinProgram.methods
        .updateRoles({
          pauser: newPauser.publicKey,
          freezer: null,
          blacklister: null,
          seizer: null,
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          roles: rolesPda,
        })
        .rpc();

      const roles = await stablecoinProgram.account.roleConfig.fetch(rolesPda);
      expect(roles.pauser.toBase58()).to.equal(newPauser.publicKey.toBase58());
      // Other roles should remain unchanged
      expect(roles.freezer.toBase58()).to.equal(freezerKeypair.publicKey.toBase58());
      expect(roles.blacklister.toBase58()).to.equal(blacklisterKeypair.publicKey.toBase58());
      expect(roles.seizer.toBase58()).to.equal(seizerKeypair.publicKey.toBase58());

      // Restore pauser for subsequent tests
      await stablecoinProgram.methods
        .updateRoles({
          pauser: pauserKeypair.publicKey,
          freezer: null,
          blacklister: null,
          seizer: null,
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          roles: rolesPda,
        })
        .rpc();
    });
  });

  // ========== Minter quota enforcement ==========

  describe("Minter quota enforcement", () => {
    it("Minter can mint within quota", async () => {
      await stablecoinProgram.methods
        .mintTokens(new BN(1_000_000_000))
        .accounts({
          minter: minterKeypair.publicKey,
          minterConfig: minterConfigPda,
          config: configPda,
          mint: mintKeypair.publicKey,
          recipientTokenAccount: userAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minterKeypair])
        .rpc();

      const minterConfig = await stablecoinProgram.account.minterConfig.fetch(minterConfigPda);
      expect(minterConfig.minted.toNumber()).to.equal(1_000_000_000);
    });

    it("Minter cannot mint beyond quota", async () => {
      // Quota is 5B, already minted 1B, try to mint 5B (would exceed)
      try {
        await stablecoinProgram.methods
          .mintTokens(new BN(5_000_000_000))
          .accounts({
            minter: minterKeypair.publicKey,
            minterConfig: minterConfigPda,
            config: configPda,
            mint: mintKeypair.publicKey,
            recipientTokenAccount: userAAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([minterKeypair])
          .rpc();
        expect.fail("Should have thrown - MinterQuotaExceeded");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("MinterQuotaExceeded");
      }
    });
  });

  // ========== Pauser role ==========

  describe("Pauser role for pause/unpause", () => {
    it("Designated pauser can pause the stablecoin", async () => {
      await stablecoinProgram.methods
        .pause()
        .accounts({
          pauser: pauserKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
        })
        .signers([pauserKeypair])
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);
      expect(config.isPaused).to.be.true;
    });

    it("Designated pauser can unpause the stablecoin", async () => {
      await stablecoinProgram.methods
        .unpause()
        .accounts({
          pauser: pauserKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
        })
        .signers([pauserKeypair])
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);
      expect(config.isPaused).to.be.false;
    });

    it("Non-pauser cannot pause", async () => {
      try {
        await stablecoinProgram.methods
          .pause()
          .accounts({
            pauser: unauthorizedKeypair.publicKey,
            roles: rolesPda,
            config: configPda,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });
  });

  // ========== Freezer role ==========

  describe("Freezer role for freeze/thaw", () => {
    it("Designated freezer can freeze a token account", async () => {
      await stablecoinProgram.methods
        .freezeAccount()
        .accounts({
          freezer: freezerKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          mint: mintKeypair.publicKey,
          targetTokenAccount: userAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezerKeypair])
        .rpc();

      const account = await getAccount(
        provider.connection, userAAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(account.isFrozen).to.be.true;
    });

    it("Designated freezer can thaw a token account", async () => {
      await stablecoinProgram.methods
        .thawAccount()
        .accounts({
          freezer: freezerKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          mint: mintKeypair.publicKey,
          targetTokenAccount: userAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezerKeypair])
        .rpc();

      const account = await getAccount(
        provider.connection, userAAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(account.isFrozen).to.be.false;
    });

    it("Non-freezer cannot freeze", async () => {
      try {
        await stablecoinProgram.methods
          .freezeAccount()
          .accounts({
            freezer: unauthorizedKeypair.publicKey,
            roles: rolesPda,
            config: configPda,
            mint: mintKeypair.publicKey,
            targetTokenAccount: userAAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });
  });

  // ========== Blacklister role ==========

  describe("Blacklister role for blacklist operations", () => {
    it("Designated blacklister can add to blacklist", async () => {
      const targetAddress = Keypair.generate().publicKey;
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), configPda.toBuffer(), targetAddress.toBuffer()],
        stablecoinProgram.programId
      );

      await stablecoinProgram.methods
        .addToBlacklist(targetAddress, "Blacklister role test")
        .accounts({
          payer: blacklisterKeypair.publicKey,
          blacklister: blacklisterKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          blacklistEntry: blacklistEntryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklisterKeypair])
        .rpc();

      const entry = await stablecoinProgram.account.blacklistEntry.fetch(blacklistEntryPda);
      expect(entry.address.toBase58()).to.equal(targetAddress.toBase58());
      expect(entry.blacklistedBy.toBase58()).to.equal(blacklisterKeypair.publicKey.toBase58());

      // Clean up
      await stablecoinProgram.methods
        .removeFromBlacklist(targetAddress)
        .accounts({
          payer: blacklisterKeypair.publicKey,
          blacklister: blacklisterKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          blacklistEntry: blacklistEntryPda,
        })
        .signers([blacklisterKeypair])
        .rpc();
    });

    it("Non-blacklister cannot add to blacklist", async () => {
      const targetAddress = Keypair.generate().publicKey;
      const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), configPda.toBuffer(), targetAddress.toBuffer()],
        stablecoinProgram.programId
      );

      try {
        await stablecoinProgram.methods
          .addToBlacklist(targetAddress, "Should fail")
          .accounts({
            payer: unauthorizedKeypair.publicKey,
            blacklister: unauthorizedKeypair.publicKey,
            roles: rolesPda,
            config: configPda,
            blacklistEntry: blacklistEntryPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });
  });

  // ========== Seizer role ==========

  describe("Seizer role for seize", () => {
    it("Designated seizer can seize tokens", async () => {
      const treasuryAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey, seizerKeypair.publicKey, false, TOKEN_2022_PROGRAM_ID
      );

      // Create treasury ATA
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, treasuryAta, seizerKeypair.publicKey,
          mintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);

      await stablecoinProgram.methods
        .seize(new BN(100_000_000))
        .accounts({
          seizer: seizerKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          mint: mintKeypair.publicKey,
          fromTokenAccount: userAAta,
          toTokenAccount: treasuryAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([seizerKeypair])
        .rpc();

      const account = await getAccount(
        provider.connection, treasuryAta, undefined, TOKEN_2022_PROGRAM_ID
      );
      expect(Number(account.amount)).to.equal(100_000_000);
    });

    it("Non-seizer cannot seize tokens", async () => {
      const dummyAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey, unauthorizedKeypair.publicKey, false, TOKEN_2022_PROGRAM_ID
      );

      // Create dummy ATA
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, dummyAta, unauthorizedKeypair.publicKey,
          mintKeypair.publicKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(provider.connection, tx, [(authority as any).payer]);

      try {
        await stablecoinProgram.methods
          .seize(new BN(50_000_000))
          .accounts({
            seizer: unauthorizedKeypair.publicKey,
            roles: rolesPda,
            config: configPda,
            mint: mintKeypair.publicKey,
            fromTokenAccount: userAAta,
            toTokenAccount: dummyAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });
  });

  // ========== Unauthorized callers ==========

  describe("Unauthorized callers get Unauthorized error", () => {
    it("Unauthorized caller cannot unpause", async () => {
      // First pause as the real pauser
      await stablecoinProgram.methods
        .pause()
        .accounts({
          pauser: pauserKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
        })
        .signers([pauserKeypair])
        .rpc();

      try {
        await stablecoinProgram.methods
          .unpause()
          .accounts({
            pauser: unauthorizedKeypair.publicKey,
            roles: rolesPda,
            config: configPda,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }

      // Clean up: unpause
      await stablecoinProgram.methods
        .unpause()
        .accounts({
          pauser: pauserKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
        })
        .signers([pauserKeypair])
        .rpc();
    });

    it("Unauthorized caller cannot thaw", async () => {
      // Freeze first
      await stablecoinProgram.methods
        .freezeAccount()
        .accounts({
          freezer: freezerKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          mint: mintKeypair.publicKey,
          targetTokenAccount: userAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezerKeypair])
        .rpc();

      try {
        await stablecoinProgram.methods
          .thawAccount()
          .accounts({
            freezer: unauthorizedKeypair.publicKey,
            roles: rolesPda,
            config: configPda,
            mint: mintKeypair.publicKey,
            targetTokenAccount: userAAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }

      // Clean up: thaw
      await stablecoinProgram.methods
        .thawAccount()
        .accounts({
          freezer: freezerKeypair.publicKey,
          roles: rolesPda,
          config: configPda,
          mint: mintKeypair.publicKey,
          targetTokenAccount: userAAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freezerKeypair])
        .rpc();
    });
  });

  // ========== Two-step authority transfer ==========

  describe("Two-step authority transfer", () => {
    it("Current authority can initiate transfer", async () => {
      await stablecoinProgram.methods
        .transferAuthority(newAuthority.publicKey)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);
      expect(config.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
      // Master authority should NOT have changed yet
      expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    });

    it("Unauthorized caller cannot accept authority transfer", async () => {
      try {
        await stablecoinProgram.methods
          .acceptAuthority()
          .accounts({
            newAuthority: unauthorizedKeypair.publicKey,
            config: configPda,
          })
          .signers([unauthorizedKeypair])
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });

    it("Pending authority can accept the transfer", async () => {
      await stablecoinProgram.methods
        .acceptAuthority()
        .accounts({
          newAuthority: newAuthority.publicKey,
          config: configPda,
        })
        .signers([newAuthority])
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
      expect(config.pendingAuthority.toBase58()).to.equal(PublicKey.default.toBase58());
    });

    it("Old authority can no longer update roles", async () => {
      try {
        await stablecoinProgram.methods
          .updateRoles({
            pauser: authority.publicKey,
            freezer: null,
            blacklister: null,
            seizer: null,
          })
          .accounts({
            authority: authority.publicKey,
            config: configPda,
            roles: rolesPda,
          })
          .rpc();
        expect.fail("Should have thrown - Unauthorized");
      } catch (e: any) {
        expect(e.error.errorCode.code).to.equal("Unauthorized");
      }
    });

    it("New authority can update roles", async () => {
      await stablecoinProgram.methods
        .updateRoles({
          pauser: pauserKeypair.publicKey,
          freezer: null,
          blacklister: null,
          seizer: null,
        })
        .accounts({
          authority: newAuthority.publicKey,
          config: configPda,
          roles: rolesPda,
        })
        .signers([newAuthority])
        .rpc();

      const roles = await stablecoinProgram.account.roleConfig.fetch(rolesPda);
      expect(roles.pauser.toBase58()).to.equal(pauserKeypair.publicKey.toBase58());
    });

    it("Transfer authority back for cleanup", async () => {
      // Initiate transfer back
      await stablecoinProgram.methods
        .transferAuthority(authority.publicKey)
        .accounts({
          authority: newAuthority.publicKey,
          config: configPda,
        })
        .signers([newAuthority])
        .rpc();

      // Accept as original authority
      await stablecoinProgram.methods
        .acceptAuthority()
        .accounts({
          newAuthority: authority.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await stablecoinProgram.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    });
  });
});
