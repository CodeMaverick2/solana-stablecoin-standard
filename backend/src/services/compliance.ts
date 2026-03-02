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
} from "@solana/spl-token";
import pino from "pino";
import Redis from "ioredis";
import { createHash } from "crypto";
import { config } from "../config";
import { ServiceError } from "./mint-burn";
import { AUDIT_LOG_KEY } from "./event-listener";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlacklistAddRequest {
  /** Base-58 address to blacklist. */
  address: string;
  /** Reason for blacklisting (max 128 chars). */
  reason: string;
  /** Base-58 encoded blacklister keypair secret key. */
  blacklisterKeypair: string;
}

export interface BlacklistRemoveRequest {
  /** Base-58 address to remove from blacklist. */
  address: string;
  /** Base-58 encoded blacklister keypair secret key. */
  blacklisterKeypair: string;
}

export interface SeizeRequest {
  /** Base-58 source token account (ATA of the blacklisted user). */
  fromAccount: string;
  /** Base-58 destination token account (treasury ATA). */
  toAccount: string;
  /** Amount to seize. */
  amount: number;
  /** Base-58 encoded seizer keypair secret key. */
  seizerKeypair: string;
}

export interface BlacklistInfo {
  address: string;
  reason: string;
  blacklistedAt: string;
  blacklistedBy: string;
}

export interface AuditLogEntry {
  eventName: string;
  signature: string;
  slot: number;
  indexedAt: string;
  decoded: Record<string, string>;
}

export interface AuditLogQuery {
  /** Filter by event action name (e.g. "AddedToBlacklist"). */
  action?: string;
  /** Start timestamp (Unix ms). */
  from?: number;
  /** End timestamp (Unix ms). */
  to?: number;
  /** Max results to return (default 100). */
  limit?: number;
}

// ---------------------------------------------------------------------------
// PDA Seeds
// ---------------------------------------------------------------------------

const CONFIG_SEED = Buffer.from("stablecoin_config");
const ROLES_SEED = Buffer.from("roles");
const BLACKLIST_SEED = Buffer.from("blacklist");

function getConfigPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    config.stablecoinProgramId,
  );
}

function getRolesPda(configPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLES_SEED, configPda.toBuffer()],
    config.stablecoinProgramId,
  );
}

function getBlacklistPda(configPda: PublicKey, address: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, configPda.toBuffer(), address.toBuffer()],
    config.stablecoinProgramId,
  );
}

// ---------------------------------------------------------------------------
// Anchor Instruction Discriminators
// ---------------------------------------------------------------------------

function anchorDiscriminator(name: string): Buffer {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

const ADD_BLACKLIST_DISC = anchorDiscriminator("add_to_blacklist");
const REMOVE_BLACKLIST_DISC = anchorDiscriminator("remove_from_blacklist");
const SEIZE_DISC = anchorDiscriminator("seize");

// ---------------------------------------------------------------------------
// Redis Keys
// ---------------------------------------------------------------------------

/** Hash map of blacklisted addresses. Field = address, Value = JSON info. */
const BLACKLIST_HASH = "sss:blacklist";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ComplianceService {
  private readonly logger: pino.Logger;
  private readonly connection: Connection;
  private readonly redis: Redis;

  constructor(parentLogger: pino.Logger, redis: Redis) {
    this.logger = parentLogger.child({ service: "compliance" });
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: config.solanaCommitment,
      wsEndpoint: config.solanaWsUrl,
    });
    this.redis = redis;
  }

  // -----------------------------------------------------------------------
  // Compliance gate
  // -----------------------------------------------------------------------

  /**
   * Fetches the StablecoinConfig account and verifies that compliance features
   * (permanent delegate + transfer hook) are enabled. Throws if not SSS-2.
   */
  private async requireComplianceEnabled(configPda: PublicKey): Promise<void> {
    const accountInfo = await this.connection.getAccountInfo(configPda, config.solanaCommitment);
    if (!accountInfo) {
      throw new ServiceError("Stablecoin config account not found on-chain", 404);
    }

    const data = accountInfo.data;
    const enablePermanentDelegate = data.readUInt8(105) !== 0;
    const enableTransferHook = data.readUInt8(106) !== 0;

    if (!enablePermanentDelegate || !enableTransferHook) {
      throw new ServiceError(
        "Compliance features are not enabled. This stablecoin is not SSS-2 compliant.",
        403,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Blacklist — Add
  // -----------------------------------------------------------------------

  async addToBlacklist(req: BlacklistAddRequest): Promise<{ signature: string }> {
    const mint = config.stablecoinMint;
    if (!mint) throw new ServiceError("STABLECOIN_MINT not configured", 500);

    // Validate inputs
    let addressPubkey: PublicKey;
    try {
      addressPubkey = new PublicKey(req.address);
    } catch {
      throw new ServiceError("Invalid address", 400);
    }

    if (!req.reason || req.reason.length === 0) {
      throw new ServiceError("Reason is required", 400);
    }
    if (req.reason.length > 128) {
      throw new ServiceError("Reason must be 128 characters or fewer", 400);
    }

    let blacklisterKeypair: Keypair;
    try {
      const secretKey = Buffer.from(req.blacklisterKeypair, "base64");
      blacklisterKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      throw new ServiceError("Invalid blacklister keypair", 400);
    }

    const [configPda] = getConfigPda(mint);
    await this.requireComplianceEnabled(configPda);

    const [rolesPda] = getRolesPda(configPda);
    const [blacklistPda] = getBlacklistPda(configPda, addressPubkey);

    this.logger.info(
      { address: req.address, reason: req.reason },
      "Adding address to blacklist",
    );

    // Instruction data: discriminator + pubkey (32 bytes) + string (4-byte len prefix + utf8)
    const reasonBuf = Buffer.from(req.reason, "utf8");
    const data = Buffer.alloc(8 + 32 + 4 + reasonBuf.length);
    ADD_BLACKLIST_DISC.copy(data, 0);
    addressPubkey.toBuffer().copy(data, 8);
    data.writeUInt32LE(reasonBuf.length, 40);
    reasonBuf.copy(data, 44);

    const { SystemProgram } = await import("@solana/web3.js");

    const tx = new Transaction().add({
      programId: config.stablecoinProgramId,
      keys: [
        { pubkey: blacklisterKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: rolesPda, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [blacklisterKeypair],
        { commitment: config.solanaCommitment },
      );

      // Cache in Redis for fast lookup
      const info: BlacklistInfo = {
        address: req.address,
        reason: req.reason,
        blacklistedAt: new Date().toISOString(),
        blacklistedBy: blacklisterKeypair.publicKey.toBase58(),
      };
      await this.redis.hset(BLACKLIST_HASH, req.address, JSON.stringify(info));

      this.logger.info({ signature, address: req.address }, "Address added to blacklist");
      return { signature };
    } catch (err: any) {
      this.logger.error({ err: err.message }, "Add to blacklist failed");
      throw new ServiceError(`Add to blacklist failed: ${err.message}`, 502);
    }
  }

  // -----------------------------------------------------------------------
  // Blacklist — Remove
  // -----------------------------------------------------------------------

  async removeFromBlacklist(req: BlacklistRemoveRequest): Promise<{ signature: string }> {
    const mint = config.stablecoinMint;
    if (!mint) throw new ServiceError("STABLECOIN_MINT not configured", 500);

    let addressPubkey: PublicKey;
    try {
      addressPubkey = new PublicKey(req.address);
    } catch {
      throw new ServiceError("Invalid address", 400);
    }

    let blacklisterKeypair: Keypair;
    try {
      const secretKey = Buffer.from(req.blacklisterKeypair, "base64");
      blacklisterKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      throw new ServiceError("Invalid blacklister keypair", 400);
    }

    const [configPda] = getConfigPda(mint);
    await this.requireComplianceEnabled(configPda);

    const [rolesPda] = getRolesPda(configPda);
    const [blacklistPda] = getBlacklistPda(configPda, addressPubkey);

    this.logger.info({ address: req.address }, "Removing address from blacklist");

    // Instruction data: discriminator + pubkey
    const data = Buffer.alloc(8 + 32);
    REMOVE_BLACKLIST_DISC.copy(data, 0);
    addressPubkey.toBuffer().copy(data, 8);

    const tx = new Transaction().add({
      programId: config.stablecoinProgramId,
      keys: [
        { pubkey: blacklisterKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: rolesPda, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: blacklistPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [blacklisterKeypair],
        { commitment: config.solanaCommitment },
      );

      // Remove from Redis cache
      await this.redis.hdel(BLACKLIST_HASH, req.address);

      this.logger.info({ signature, address: req.address }, "Address removed from blacklist");
      return { signature };
    } catch (err: any) {
      this.logger.error({ err: err.message }, "Remove from blacklist failed");
      throw new ServiceError(`Remove from blacklist failed: ${err.message}`, 502);
    }
  }

  // -----------------------------------------------------------------------
  // Blacklist — Check (on-chain)
  // -----------------------------------------------------------------------

  async isBlacklisted(address: string): Promise<boolean> {
    const mint = config.stablecoinMint;
    if (!mint) throw new ServiceError("STABLECOIN_MINT not configured", 500);

    let addressPubkey: PublicKey;
    try {
      addressPubkey = new PublicKey(address);
    } catch {
      throw new ServiceError("Invalid address", 400);
    }

    const [configPda] = getConfigPda(mint);
    const [blacklistPda] = getBlacklistPda(configPda, addressPubkey);

    try {
      const accountInfo = await this.connection.getAccountInfo(blacklistPda, config.solanaCommitment);
      // PDA exists and has data => blacklisted
      return accountInfo !== null && accountInfo.data.length > 0;
    } catch (err: any) {
      this.logger.error({ err: err.message, address }, "Failed to check blacklist status");
      throw new ServiceError(`Failed to check blacklist status: ${err.message}`, 502);
    }
  }

  // -----------------------------------------------------------------------
  // Blacklist — Get info (Redis cache, falls back to on-chain)
  // -----------------------------------------------------------------------

  async getBlacklistInfo(address: string): Promise<BlacklistInfo | null> {
    // Try Redis cache first
    const cached = await this.redis.hget(BLACKLIST_HASH, address);
    if (cached) {
      return JSON.parse(cached) as BlacklistInfo;
    }

    // Fall back to on-chain check
    const onChain = await this.isBlacklisted(address);
    if (!onChain) return null;

    // On-chain account exists but not cached — decode if possible
    const mint = config.stablecoinMint!;
    const [configPda] = getConfigPda(mint);
    let addressPubkey: PublicKey;
    try {
      addressPubkey = new PublicKey(address);
    } catch {
      return null;
    }
    const [blacklistPda] = getBlacklistPda(configPda, addressPubkey);

    try {
      const accountInfo = await this.connection.getAccountInfo(blacklistPda, config.solanaCommitment);
      if (!accountInfo) return null;

      // Decode BlacklistEntry manually:
      // discriminator: 8 bytes
      // stablecoin_config: 32 bytes  (offset 8)
      // address: 32 bytes            (offset 40)
      // reason: 4-byte len + utf8    (offset 72)
      // blacklisted_at: i64          (offset 72 + 4 + len)
      // blacklisted_by: Pubkey       (offset above + 8)
      const data = accountInfo.data;
      const reasonLen = data.readUInt32LE(72);
      const reason = data.subarray(76, 76 + reasonLen).toString("utf8");
      const blacklistedAtOffset = 76 + reasonLen;
      const blacklistedAtUnix = Number(data.readBigInt64LE(blacklistedAtOffset));
      const blacklistedBy = new PublicKey(
        data.subarray(blacklistedAtOffset + 8, blacklistedAtOffset + 40),
      ).toBase58();

      const info: BlacklistInfo = {
        address,
        reason,
        blacklistedAt: new Date(blacklistedAtUnix * 1000).toISOString(),
        blacklistedBy,
      };

      // Cache for future lookups
      await this.redis.hset(BLACKLIST_HASH, address, JSON.stringify(info));
      return info;
    } catch (err: any) {
      this.logger.warn({ err: err.message, address }, "Failed to decode blacklist entry");
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Blacklist — List all (from Redis cache)
  // -----------------------------------------------------------------------

  async listBlacklisted(): Promise<BlacklistInfo[]> {
    const all = await this.redis.hgetall(BLACKLIST_HASH);
    return Object.values(all).map((v) => JSON.parse(v) as BlacklistInfo);
  }

  // -----------------------------------------------------------------------
  // Seize
  // -----------------------------------------------------------------------

  async seize(req: SeizeRequest): Promise<{ signature: string }> {
    const mint = config.stablecoinMint;
    if (!mint) throw new ServiceError("STABLECOIN_MINT not configured", 500);

    let fromAccount: PublicKey;
    let toAccount: PublicKey;
    try {
      fromAccount = new PublicKey(req.fromAccount);
    } catch {
      throw new ServiceError("Invalid fromAccount address", 400);
    }
    try {
      toAccount = new PublicKey(req.toAccount);
    } catch {
      throw new ServiceError("Invalid toAccount address", 400);
    }

    if (!Number.isInteger(req.amount) || req.amount <= 0) {
      throw new ServiceError("Amount must be a positive integer", 400);
    }

    let seizerKeypair: Keypair;
    try {
      const secretKey = Buffer.from(req.seizerKeypair, "base64");
      seizerKeypair = Keypair.fromSecretKey(secretKey);
    } catch {
      throw new ServiceError("Invalid seizer keypair", 400);
    }

    const [configPda] = getConfigPda(mint);
    await this.requireComplianceEnabled(configPda);

    const [rolesPda] = getRolesPda(configPda);

    this.logger.info(
      { from: req.fromAccount, to: req.toAccount, amount: req.amount },
      "Seizing tokens",
    );

    // Instruction data: discriminator + amount (u64 LE)
    const data = Buffer.alloc(8 + 8);
    SEIZE_DISC.copy(data, 0);
    data.writeBigUInt64LE(BigInt(req.amount), 8);

    const tx = new Transaction().add({
      programId: config.stablecoinProgramId,
      keys: [
        { pubkey: seizerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: rolesPda, isSigner: false, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: fromAccount, isSigner: false, isWritable: true },
        { pubkey: toAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [seizerKeypair],
        { commitment: config.solanaCommitment },
      );

      this.logger.info(
        { signature, from: req.fromAccount, to: req.toAccount, amount: req.amount },
        "Tokens seized",
      );
      return { signature };
    } catch (err: any) {
      this.logger.error({ err: err.message }, "Seize transaction failed");
      throw new ServiceError(`Seize transaction failed: ${err.message}`, 502);
    }
  }

  // -----------------------------------------------------------------------
  // Audit Log
  // -----------------------------------------------------------------------

  async getAuditLog(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    const from = query.from ?? 0;
    const to = query.to ?? Date.now();
    const limit = Math.min(query.limit ?? 100, 1000);

    // Fetch from Redis sorted set by score range (timestamp)
    const rawEntries = await this.redis.zrangebyscore(
      AUDIT_LOG_KEY,
      from,
      to,
      "LIMIT",
      0,
      limit,
    );

    let entries: AuditLogEntry[] = rawEntries.map((raw) => {
      const parsed = JSON.parse(raw);
      return {
        eventName: parsed.eventName,
        signature: parsed.signature,
        slot: parsed.slot,
        indexedAt: parsed.indexedAt,
        decoded: parsed.decoded,
      };
    });

    // Filter by action if specified
    if (query.action) {
      entries = entries.filter((e) => e.eventName === query.action);
    }

    return entries;
  }
}
