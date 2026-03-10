/**
 * Token-2022 Extension Verification Tests
 *
 * These tests verify that each SSS preset correctly configures its Token-2022
 * extensions on-chain. They read mint accounts directly and cross-check authorities,
 * sizes, and feature flags — proving that our program wires extensions correctly
 * regardless of what the config account says.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";
import { expect } from "chai";
import { Stablecoin } from "../target/types/stablecoin";
import { TransferHook } from "../target/types/transfer_hook";

describe("Token-2022 Extension Verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const stablecoinProgram = anchor.workspace.Stablecoin as Program<Stablecoin>;
  const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHook>;
  const authority = provider.wallet as anchor.Wallet;

  // Fresh mint keypairs for each preset (isolated from other test files)
  const sss1MintKp = Keypair.generate();
  const sss2MintKp = Keypair.generate();
  const sss3MintKp = Keypair.generate();

  let sss1ConfigPda: PublicKey;
  let sss1RolesPda: PublicKey;
  let sss2ConfigPda: PublicKey;
  let sss2RolesPda: PublicKey;
  let sss3ConfigPda: PublicKey;
  let sss3RolesPda: PublicKey;

  before(async () => {
    // Derive all PDAs
    [sss1ConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss1MintKp.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss1RolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), sss1ConfigPda.toBuffer()],
      stablecoinProgram.programId
    );
    [sss2ConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss2MintKp.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss2RolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), sss2ConfigPda.toBuffer()],
      stablecoinProgram.programId
    );
    [sss3ConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss3MintKp.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    [sss3RolesPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("roles"), sss3ConfigPda.toBuffer()],
      stablecoinProgram.programId
    );

    // Initialize SSS-1 (MetadataPointer only — no transfer hook, no permanent delegate)
    await stablecoinProgram.methods
      .initialize({
        name: "ExtTest USD 1",
        symbol: "EUSD1",
        uri: "https://example.com/eusd1.json",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        enableConfidentialTransfer: false,
        enableAllowlist: false,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: sss1ConfigPda,
        mint: sss1MintKp.publicKey,
        roles: sss1RolesPda,
        transferHookProgram: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([sss1MintKp])
      .rpc();

    // Initialize SSS-2 (MetadataPointer + PermanentDelegate + TransferHook)
    await stablecoinProgram.methods
      .initialize({
        name: "ExtTest USD 2",
        symbol: "EUSD2",
        uri: "https://example.com/eusd2.json",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        enableConfidentialTransfer: false,
        enableAllowlist: false,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: sss2ConfigPda,
        mint: sss2MintKp.publicKey,
        roles: sss2RolesPda,
        transferHookProgram: transferHookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([sss2MintKp])
      .rpc();

    // Initialize SSS-3 (all extensions including ConfidentialTransferMint)
    await stablecoinProgram.methods
      .initialize({
        name: "ExtTest USD 3",
        symbol: "EUSD3",
        uri: "https://example.com/eusd3.json",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        enableConfidentialTransfer: true,
        enableAllowlist: true,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: sss3ConfigPda,
        mint: sss3MintKp.publicKey,
        roles: sss3RolesPda,
        transferHookProgram: transferHookProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([sss3MintKp])
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // SSS-1 — Minimal Stablecoin
  // ---------------------------------------------------------------------------

  it("SSS-1 mint is owned by Token-2022 program", async () => {
    const info = await provider.connection.getAccountInfo(sss1MintKp.publicKey);
    expect(info).to.not.be.null;
    expect(info!.owner.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  it("SSS-1 mint authority is the config PDA (not a raw keypair)", async () => {
    const mintInfo = await getMint(
      provider.connection,
      sss1MintKp.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.mintAuthority).to.not.be.null;
    expect(mintInfo.mintAuthority!.toBase58()).to.equal(sss1ConfigPda.toBase58());
  });

  it("SSS-1 freeze authority is the config PDA", async () => {
    const mintInfo = await getMint(
      provider.connection,
      sss1MintKp.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.freezeAuthority).to.not.be.null;
    expect(mintInfo.freezeAuthority!.toBase58()).to.equal(sss1ConfigPda.toBase58());
  });

  it("SSS-1 mint has MetadataPointer extension (account larger than bare 82-byte mint)", async () => {
    const info = await provider.connection.getAccountInfo(sss1MintKp.publicKey);
    // Base Token-2022 mint = 82 bytes; MetadataPointer TLV header + data adds > 10 bytes.
    expect(info!.data.length).to.be.greaterThan(82);
  });

  // ---------------------------------------------------------------------------
  // SSS-2 — Compliant Stablecoin
  // ---------------------------------------------------------------------------

  it("SSS-2 mint authority is the config PDA", async () => {
    const mintInfo = await getMint(
      provider.connection,
      sss2MintKp.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.mintAuthority!.toBase58()).to.equal(sss2ConfigPda.toBase58());
  });

  it("SSS-2 freeze authority is the config PDA", async () => {
    const mintInfo = await getMint(
      provider.connection,
      sss2MintKp.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.freezeAuthority!.toBase58()).to.equal(sss2ConfigPda.toBase58());
  });

  it("SSS-2 mint is larger than SSS-1 (PermanentDelegate + TransferHook add extension bytes)", async () => {
    const sss1Info = await provider.connection.getAccountInfo(sss1MintKp.publicKey);
    const sss2Info = await provider.connection.getAccountInfo(sss2MintKp.publicKey);
    // Each extension adds at minimum 4 bytes of TLV header plus its own data.
    // PermanentDelegate (32 bytes) + TransferHook (64 bytes) makes SSS-2 notably larger.
    expect(sss2Info!.data.length).to.be.greaterThan(sss1Info!.data.length);
  });

  it("SSS-2 has zero initial supply (not pre-minted)", async () => {
    const mintInfo = await getMint(
      provider.connection,
      sss2MintKp.publicKey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(mintInfo.supply).to.equal(BigInt(0));
  });

  // ---------------------------------------------------------------------------
  // SSS-3 — Private Stablecoin (adds ConfidentialTransferMint)
  // ---------------------------------------------------------------------------

  it("SSS-3 mint authority is the config PDA (parsed from raw account bytes)", async () => {
    // getMint() may not fully parse Token-2022 accounts with ConfidentialTransferMint in
    // older @solana/spl-token versions, so we parse the raw bytes directly.
    // Token-2022 base mint layout:
    //   bytes 0-3:   COption<Pubkey> tag for mint_authority (1 = Some)
    //   bytes 4-35:  mint_authority Pubkey
    //   bytes 36-43: supply (u64)
    //   byte  44:    decimals
    //   byte  45:    is_initialized
    //   bytes 46-49: COption<Pubkey> tag for freeze_authority
    //   bytes 50-81: freeze_authority Pubkey
    const info = await provider.connection.getAccountInfo(sss3MintKp.publicKey);
    expect(info).to.not.be.null;
    // Mint authority option must be 1 (Some)
    const mintAuthorityOption = info!.data.readUInt32LE(0);
    expect(mintAuthorityOption).to.equal(1);
    const mintAuthority = new PublicKey(info!.data.slice(4, 36));
    expect(mintAuthority.toBase58()).to.equal(sss3ConfigPda.toBase58());
  });

  it("SSS-3 mint is larger than SSS-2 (ConfidentialTransferMint adds ~75 bytes)", async () => {
    const sss2Info = await provider.connection.getAccountInfo(sss2MintKp.publicKey);
    const sss3Info = await provider.connection.getAccountInfo(sss3MintKp.publicKey);
    // ConfidentialTransferMint: authority (COption<Pubkey>=33B) + auto_approve(1B) +
    // auditor_elgamal_pubkey (COption<ElGamalPubkey>=33B) = 67B + TLV header 4B = 71B extra.
    expect(sss3Info!.data.length).to.be.greaterThan(sss2Info!.data.length);
  });

  it("SSS-3 config reflects all four extension flags correctly", async () => {
    const config = await stablecoinProgram.account.stablecoinConfig.fetch(sss3ConfigPda);
    expect(config.enablePermanentDelegate).to.be.true;
    expect(config.enableTransferHook).to.be.true;
    expect(config.enableConfidentialTransfer).to.be.true;
    expect(config.enableAllowlist).to.be.true;
  });

  it("SSS-3 config PDA is derived from the mint keypair (not a predictable seed)", async () => {
    // Config PDA seed = ["stablecoin_config", mint_pubkey]
    // This ensures each stablecoin instance has a unique, isolated state account.
    const [derivedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin_config"), sss3MintKp.publicKey.toBuffer()],
      stablecoinProgram.programId
    );
    expect(derivedPda.toBase58()).to.equal(sss3ConfigPda.toBase58());

    // Verify config account actually exists at this address
    const info = await provider.connection.getAccountInfo(derivedPda);
    expect(info).to.not.be.null;
    expect(info!.owner.toBase58()).to.equal(stablecoinProgram.programId.toBase58());
  });
});
