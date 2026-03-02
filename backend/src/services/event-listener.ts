import { Connection, PublicKey, Logs, Context } from "@solana/web3.js";
import pino from "pino";
import Redis from "ioredis";
import { createHash } from "crypto";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed on-chain event stored in Redis. */
export interface StablecoinEvent {
  /** Event type name (e.g. "TokensMinted", "AddedToBlacklist"). */
  eventName: string;
  /** Transaction signature that emitted the event. */
  signature: string;
  /** Slot number. */
  slot: number;
  /** ISO-8601 timestamp when the event was indexed. */
  indexedAt: string;
  /** Raw base64 event data (for downstream consumers to decode). */
  rawData: string;
  /** Human-readable decoded fields (best-effort). */
  decoded: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Known Anchor Event Discriminators
// ---------------------------------------------------------------------------

/**
 * Anchor events are emitted via `emit!()` which logs base64 data whose first
 * 8 bytes are sha256("event:<EventName>")[0..8].
 */
const EVENT_NAMES = [
  "StablecoinInitialized",
  "TokensMinted",
  "TokensBurned",
  "AccountFrozen",
  "AccountThawed",
  "StablecoinPaused",
  "StablecoinUnpaused",
  "MinterUpdated",
  "RolesUpdated",
  "AuthorityTransferInitiated",
  "AuthorityTransferCompleted",
  "AddedToBlacklist",
  "RemovedFromBlacklist",
  "TokensSeized",
  "AddedToAllowlist",
  "RemovedFromAllowlist",
] as const;

type EventName = (typeof EVENT_NAMES)[number];

const discriminatorMap = new Map<string, EventName>();

for (const name of EVENT_NAMES) {
  const hash = createHash("sha256").update(`event:${name}`).digest();
  const disc = hash.subarray(0, 8).toString("hex");
  discriminatorMap.set(disc, name);
}

// ---------------------------------------------------------------------------
// Decoder helpers
// ---------------------------------------------------------------------------

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function readI64(buf: Buffer, offset: number): string {
  return buf.readBigInt64LE(offset).toString();
}

function readU64(buf: Buffer, offset: number): string {
  return buf.readBigUInt64LE(offset).toString();
}

function readBool(buf: Buffer, offset: number): string {
  return buf.readUInt8(offset) !== 0 ? "true" : "false";
}

function readU8(buf: Buffer, offset: number): string {
  return buf.readUInt8(offset).toString();
}

function readString(buf: Buffer, offset: number): { value: string; bytesRead: number } {
  const len = buf.readUInt32LE(offset);
  const value = buf.subarray(offset + 4, offset + 4 + len).toString("utf8");
  return { value, bytesRead: 4 + len };
}

/**
 * Best-effort decode of event data after the 8-byte discriminator.
 * Returns key-value pairs for the known fields of each event.
 */
function decodeEventFields(name: EventName, payload: Buffer): Record<string, string> {
  try {
    // All events start at offset 0 (after discriminator has been stripped).
    switch (name) {
      case "StablecoinInitialized":
        return {
          config: readPubkey(payload, 0),
          mint: readPubkey(payload, 32),
          authority: readPubkey(payload, 64),
          enable_permanent_delegate: readBool(payload, 96),
          enable_transfer_hook: readBool(payload, 97),
          enable_confidential_transfer: readBool(payload, 98),
          enable_allowlist: readBool(payload, 99),
          decimals: readU8(payload, 100),
          timestamp: readI64(payload, 101),
        };

      case "TokensMinted":
        return {
          config: readPubkey(payload, 0),
          minter: readPubkey(payload, 32),
          recipient: readPubkey(payload, 64),
          amount: readU64(payload, 96),
          timestamp: readI64(payload, 104),
        };

      case "TokensBurned":
        return {
          config: readPubkey(payload, 0),
          burner: readPubkey(payload, 32),
          amount: readU64(payload, 64),
          timestamp: readI64(payload, 72),
        };

      case "AccountFrozen":
        return {
          config: readPubkey(payload, 0),
          account: readPubkey(payload, 32),
          frozen_by: readPubkey(payload, 64),
          timestamp: readI64(payload, 96),
        };

      case "AccountThawed":
        return {
          config: readPubkey(payload, 0),
          account: readPubkey(payload, 32),
          thawed_by: readPubkey(payload, 64),
          timestamp: readI64(payload, 96),
        };

      case "StablecoinPaused":
        return {
          config: readPubkey(payload, 0),
          paused_by: readPubkey(payload, 32),
          timestamp: readI64(payload, 64),
        };

      case "StablecoinUnpaused":
        return {
          config: readPubkey(payload, 0),
          unpaused_by: readPubkey(payload, 32),
          timestamp: readI64(payload, 64),
        };

      case "MinterUpdated":
        return {
          config: readPubkey(payload, 0),
          minter: readPubkey(payload, 32),
          quota: readU64(payload, 64),
          active: readBool(payload, 72),
          updated_by: readPubkey(payload, 73),
          timestamp: readI64(payload, 105),
        };

      case "RolesUpdated":
        return {
          config: readPubkey(payload, 0),
          updated_by: readPubkey(payload, 32),
          timestamp: readI64(payload, 64),
        };

      case "AuthorityTransferInitiated":
        return {
          config: readPubkey(payload, 0),
          current_authority: readPubkey(payload, 32),
          pending_authority: readPubkey(payload, 64),
          timestamp: readI64(payload, 96),
        };

      case "AuthorityTransferCompleted":
        return {
          config: readPubkey(payload, 0),
          old_authority: readPubkey(payload, 32),
          new_authority: readPubkey(payload, 64),
          timestamp: readI64(payload, 96),
        };

      case "AddedToBlacklist": {
        const cfg = readPubkey(payload, 0);
        const address = readPubkey(payload, 32);
        const { value: reason, bytesRead } = readString(payload, 64);
        const blacklistedBy = readPubkey(payload, 64 + bytesRead);
        const timestamp = readI64(payload, 64 + bytesRead + 32);
        return { config: cfg, address, reason, blacklisted_by: blacklistedBy, timestamp };
      }

      case "RemovedFromBlacklist":
        return {
          config: readPubkey(payload, 0),
          address: readPubkey(payload, 32),
          removed_by: readPubkey(payload, 64),
          timestamp: readI64(payload, 96),
        };

      case "TokensSeized":
        return {
          config: readPubkey(payload, 0),
          from: readPubkey(payload, 32),
          to: readPubkey(payload, 64),
          amount: readU64(payload, 96),
          seized_by: readPubkey(payload, 104),
          timestamp: readI64(payload, 136),
        };

      case "AddedToAllowlist": {
        const cfg = readPubkey(payload, 0);
        const address = readPubkey(payload, 32);
        const { value: reason, bytesRead } = readString(payload, 64);
        const allowlistedBy = readPubkey(payload, 64 + bytesRead);
        const timestamp = readI64(payload, 64 + bytesRead + 32);
        return { config: cfg, address, reason, allowlisted_by: allowlistedBy, timestamp };
      }

      case "RemovedFromAllowlist":
        return {
          config: readPubkey(payload, 0),
          address: readPubkey(payload, 32),
          removed_by: readPubkey(payload, 64),
          timestamp: readI64(payload, 96),
        };

      default:
        return {};
    }
  } catch {
    // If decoding fails, return empty — rawData is still available.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Redis Keys
// ---------------------------------------------------------------------------

/** Sorted set of all events ordered by slot. */
const EVENTS_KEY = "sss:events";

/** Per-event-type sorted set for filtered queries. */
function eventTypeKey(name: string): string {
  return `sss:events:${name}`;
}

/** Key for the audit log sorted set (scored by timestamp). */
export const AUDIT_LOG_KEY = "sss:audit_log";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EventListenerService {
  private readonly logger: pino.Logger;
  private readonly connection: Connection;
  private readonly redis: Redis;
  private subscriptionId: number | null = null;
  private onEventCallbacks: Array<(event: StablecoinEvent) => void> = [];

  constructor(parentLogger: pino.Logger, redis: Redis) {
    this.logger = parentLogger.child({ service: "event-listener" });
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: config.solanaCommitment,
      wsEndpoint: config.solanaWsUrl,
    });
    this.redis = redis;
  }

  /** Register a callback that fires for every parsed event. */
  onEvent(cb: (event: StablecoinEvent) => void): void {
    this.onEventCallbacks.push(cb);
  }

  /** Start WebSocket subscription to the stablecoin program logs. */
  async start(): Promise<void> {
    this.logger.info(
      { programId: config.stablecoinProgramId.toBase58() },
      "Starting event listener subscription",
    );

    this.subscriptionId = this.connection.onLogs(
      config.stablecoinProgramId,
      (logs: Logs, ctx: Context) => {
        this.handleLogs(logs, ctx).catch((err) => {
          this.logger.error({ err: err.message }, "Error handling logs");
        });
      },
      config.solanaCommitment,
    );

    this.logger.info({ subscriptionId: this.subscriptionId }, "Event listener started");
  }

  /** Stop the WebSocket subscription. */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.logger.info({ subscriptionId: this.subscriptionId }, "Event listener stopped");
      this.subscriptionId = null;
    }
  }

  /** Check if the subscription is active. */
  isRunning(): boolean {
    return this.subscriptionId !== null;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async handleLogs(logs: Logs, ctx: Context): Promise<void> {
    if (logs.err) {
      // Failed transactions — skip.
      return;
    }

    // Anchor events appear as "Program data: <base64>" log entries.
    for (const logLine of logs.logs) {
      if (!logLine.startsWith("Program data: ")) continue;

      const base64Data = logLine.slice("Program data: ".length);
      let rawBuf: Buffer;
      try {
        rawBuf = Buffer.from(base64Data, "base64");
      } catch {
        continue;
      }

      if (rawBuf.length < 8) continue;

      const disc = rawBuf.subarray(0, 8).toString("hex");
      const eventName = discriminatorMap.get(disc);
      if (!eventName) continue;

      const payload = rawBuf.subarray(8);
      const decoded = decodeEventFields(eventName, payload);
      const now = new Date().toISOString();

      const event: StablecoinEvent = {
        eventName,
        signature: logs.signature,
        slot: ctx.slot,
        indexedAt: now,
        rawData: base64Data,
        decoded,
      };

      this.logger.info({ eventName, signature: logs.signature, slot: ctx.slot }, "Event indexed");

      // Persist to Redis
      const eventJson = JSON.stringify(event);
      const score = ctx.slot;

      const pipeline = this.redis.pipeline();
      pipeline.zadd(EVENTS_KEY, score, eventJson);
      pipeline.zadd(eventTypeKey(eventName), score, eventJson);

      // Also write to the audit log sorted set (scored by Unix ms timestamp)
      const auditScore = Date.now();
      pipeline.zadd(AUDIT_LOG_KEY, auditScore, eventJson);

      await pipeline.exec();

      // Notify callbacks (used by webhook service)
      for (const cb of this.onEventCallbacks) {
        try {
          cb(event);
        } catch (err: any) {
          this.logger.error({ err: err.message }, "Event callback error");
        }
      }
    }
  }
}
