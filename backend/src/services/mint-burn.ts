import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { BorshCoder, Idl } from "@coral-xyz/anchor";
import pino from "pino";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MintRequest {
  /** Base-58 recipient wallet address. */
  recipient: string;
  /** Token amount in smallest unit (e.g. lamports-equivalent). */
  amount: number;
  /** Base-58 encoded minter keypair secret key. */
  minterKeypair: string;
}

export interface BurnRequest {
  /** Token amount to burn. */
  amount: number;
  /** Base-58 encoded burner keypair secret key. */
  burnerKeypair: string;
}

export interface SupplyStats {
  /** Current circulating supply (total_minted - total_burned). */
  circulatingSupply: string;
  /** Cumulative tokens ever minted. */
  totalMinted: string;
  /** Cumulative tokens ever burned. */
  totalBurned: string;
  /** Decimals for the mint. */
  decimals: number;
  /** Whether the stablecoin is paused. */
  isPaused: boolean;
  /** Whether compliance features are enabled (SSS-2). */
  complianceEnabled: boolean;
}

// ---------------------------------------------------------------------------
// PDA Derivation
// ---------------------------------------------------------------------------

const CONFIG_SEED = Buffer.from("stablecoin_config");
const MINTER_SEED = Buffer.from("minter");

function getConfigPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    config.stablecoinProgramId,
  );
}

function getMinterPda(configPda: PublicKey, minter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_SEED, configPda.toBuffer(), minter.toBuffer()],
    config.stablecoinProgramId,
  );
}

// ---------------------------------------------------------------------------
// Anchor Instruction Discriminators
// ---------------------------------------------------------------------------

// Anchor uses the first 8 bytes of sha256("global:<instruction_name>")
// We compute these at module load time so they are always available.
import { createHash } from "crypto";

function anchorDiscriminator(name: string): Buffer {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

const MINT_TOKENS_DISC = anchorDiscriminator("mint_tokens");
const BURN_TOKENS_DISC = anchorDiscriminator("burn_tokens");

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MintBurnService {
  private readonly logger: pino.Logger;
  private readonly connection: Connection;

  constructor(parentLogger: pino.Logger) {
    this.logger = parentLogger.child({ service: "mint-burn" });
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: config.solanaCommitment,
      wsEndpoint: config.solanaWsUrl,
    });
  }

  // -----------------------------------------------------------------------
  // Mint
  // -----------------------------------------------------------------------

  async mint(req: MintRequest): Promise<{ signature: string }> {
    const mint = config.stablecoinMint;
    if (!mint) {
      throw new ServiceError("STABLECOIN_MINT not configured", 500);
    }

    // Validate inputs
    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(req.recipient);
    } catch {
      throw new ServiceError("Invalid recipient address", 400);
    }

    if (!Number.isInteger(req.amount) || req.amount <= 0) {
      throw new ServiceError("Amount must be a positive integer", 400);
    }

    let minterKeypair: Keypair;
    try {
      const secretKey = Buffer.from(req.minterKeypair, "base64");
      minterKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      throw new ServiceError("Invalid minter keypair (expected base64-encoded secret key)", 400);
    }

    const [configPda] = getConfigPda(mint);
    const [minterPda] = getMinterPda(configPda, minterKeypair.publicKey);

    // Derive associated token account for the recipient (Token-2022)
    const recipientAta = getAssociatedTokenAddressSync(
      mint,
      recipientPubkey,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    this.logger.info(
      {
        recipient: req.recipient,
        amount: req.amount,
        minter: minterKeypair.publicKey.toBase58(),
      },
      "Building mint transaction",
    );

    // Build instruction data: discriminator + amount (u64 LE)
    const data = Buffer.alloc(8 + 8);
    MINT_TOKENS_DISC.copy(data, 0);
    data.writeBigUInt64LE(BigInt(req.amount), 8);

    const tx = new Transaction();

    // Idempotent ATA creation so the recipient doesn't need to pre-create
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        minterKeypair.publicKey, // payer
        recipientAta,
        recipientPubkey,
        mint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    tx.add({
      programId: config.stablecoinProgramId,
      keys: [
        { pubkey: minterKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: minterPda, isSigner: false, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    try {
      const signature = await sendAndConfirmTransaction(this.connection, tx, [minterKeypair], {
        commitment: config.solanaCommitment,
      });

      this.logger.info({ signature, recipient: req.recipient, amount: req.amount }, "Mint successful");
      return { signature };
    } catch (err: any) {
      this.logger.error({ err: err.message }, "Mint transaction failed");
      throw new ServiceError(`Mint transaction failed: ${err.message}`, 502);
    }
  }

  // -----------------------------------------------------------------------
  // Burn
  // -----------------------------------------------------------------------

  async burn(req: BurnRequest): Promise<{ signature: string }> {
    const mint = config.stablecoinMint;
    if (!mint) {
      throw new ServiceError("STABLECOIN_MINT not configured", 500);
    }

    if (!Number.isInteger(req.amount) || req.amount <= 0) {
      throw new ServiceError("Amount must be a positive integer", 400);
    }

    let burnerKeypair: Keypair;
    try {
      const secretKey = Buffer.from(req.burnerKeypair, "base64");
      burnerKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      throw new ServiceError("Invalid burner keypair (expected base64-encoded secret key)", 400);
    }

    const [configPda] = getConfigPda(mint);

    // Derive burner's ATA
    const burnerAta = getAssociatedTokenAddressSync(
      mint,
      burnerKeypair.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    this.logger.info(
      { amount: req.amount, burner: burnerKeypair.publicKey.toBase58() },
      "Building burn transaction",
    );

    // Build instruction data: discriminator + amount (u64 LE)
    const data = Buffer.alloc(8 + 8);
    BURN_TOKENS_DISC.copy(data, 0);
    data.writeBigUInt64LE(BigInt(req.amount), 8);

    const tx = new Transaction().add({
      programId: config.stablecoinProgramId,
      keys: [
        { pubkey: burnerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: burnerAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    try {
      const signature = await sendAndConfirmTransaction(this.connection, tx, [burnerKeypair], {
        commitment: config.solanaCommitment,
      });

      this.logger.info({ signature, amount: req.amount }, "Burn successful");
      return { signature };
    } catch (err: any) {
      this.logger.error({ err: err.message }, "Burn transaction failed");
      throw new ServiceError(`Burn transaction failed: ${err.message}`, 502);
    }
  }

  // -----------------------------------------------------------------------
  // Supply
  // -----------------------------------------------------------------------

  async getSupply(): Promise<SupplyStats> {
    const mint = config.stablecoinMint;
    if (!mint) {
      throw new ServiceError("STABLECOIN_MINT not configured", 500);
    }

    const [configPda] = getConfigPda(mint);

    try {
      const accountInfo = await this.connection.getAccountInfo(configPda, config.solanaCommitment);
      if (!accountInfo) {
        throw new ServiceError("Stablecoin config account not found on-chain", 404);
      }

      // Decode the StablecoinConfig account manually.
      // Layout after 8-byte Anchor discriminator:
      //   master_authority:          32 bytes  (offset  8)
      //   pending_authority:         32 bytes  (offset 40)
      //   mint:                      32 bytes  (offset 72)
      //   decimals:                   1 byte   (offset 104)
      //   enable_permanent_delegate:  1 byte   (offset 105)
      //   enable_transfer_hook:       1 byte   (offset 106)
      //   is_paused:                  1 byte   (offset 107)
      //   total_minted:               8 bytes  (offset 108)
      //   total_burned:               8 bytes  (offset 116)
      //   bump:                       1 byte   (offset 124)
      //   _reserved:                128 bytes  (offset 125)

      const data = accountInfo.data;
      const decimals = data.readUInt8(104);
      const enablePermanentDelegate = data.readUInt8(105) !== 0;
      const enableTransferHook = data.readUInt8(106) !== 0;
      const isPaused = data.readUInt8(107) !== 0;
      const totalMinted = data.readBigUInt64LE(108);
      const totalBurned = data.readBigUInt64LE(116);
      const circulatingSupply = totalMinted - totalBurned;

      return {
        circulatingSupply: circulatingSupply.toString(),
        totalMinted: totalMinted.toString(),
        totalBurned: totalBurned.toString(),
        decimals,
        isPaused,
        complianceEnabled: enablePermanentDelegate && enableTransferHook,
      };
    } catch (err: any) {
      if (err instanceof ServiceError) throw err;
      this.logger.error({ err: err.message }, "Failed to fetch supply stats");
      throw new ServiceError(`Failed to fetch supply stats: ${err.message}`, 502);
    }
  }
}

// ---------------------------------------------------------------------------
// Error class with HTTP status
// ---------------------------------------------------------------------------

export class ServiceError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
  }
}
