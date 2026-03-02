import dotenv from "dotenv";
import { PublicKey, Commitment } from "@solana/web3.js";

dotenv.config();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: ${raw}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Config Object
// ---------------------------------------------------------------------------

export interface AppConfig {
  /** Express server port. */
  port: number;
  /** Node environment (development | production | test). */
  nodeEnv: string;
  /** Pino log level. */
  logLevel: string;

  /** Solana HTTP RPC URL. */
  solanaRpcUrl: string;
  /** Solana WebSocket URL for subscriptions. */
  solanaWsUrl: string;
  /** Transaction commitment level. */
  solanaCommitment: Commitment;

  /** Stablecoin on-chain program ID. */
  stablecoinProgramId: PublicKey;
  /** Transfer hook on-chain program ID. */
  transferHookProgramId: PublicKey;
  /** Token-2022 mint address for this stablecoin instance. */
  stablecoinMint: PublicKey | null;

  /** Redis connection URL. */
  redisUrl: string;

  /** Webhook max retry attempts. */
  webhookMaxRetries: number;
  /** Webhook exponential backoff base delay (ms). */
  webhookBaseDelayMs: number;
  /** Webhook HTTP request timeout (ms). */
  webhookTimeoutMs: number;
}

function loadConfig(): AppConfig {
  const mintRaw = process.env.STABLECOIN_MINT;

  return {
    port: parseIntEnv("PORT", 3000),
    nodeEnv: optionalEnv("NODE_ENV", "development"),
    logLevel: optionalEnv("LOG_LEVEL", "info"),

    solanaRpcUrl: optionalEnv("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    solanaWsUrl: optionalEnv("SOLANA_WS_URL", "wss://api.devnet.solana.com"),
    solanaCommitment: optionalEnv("SOLANA_COMMITMENT", "confirmed") as Commitment,

    stablecoinProgramId: new PublicKey(
      optionalEnv("STABLECOIN_PROGRAM_ID", "B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs"),
    ),
    transferHookProgramId: new PublicKey(
      optionalEnv("TRANSFER_HOOK_PROGRAM_ID", "HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou"),
    ),
    stablecoinMint: mintRaw ? new PublicKey(mintRaw) : null,

    redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),

    webhookMaxRetries: parseIntEnv("WEBHOOK_MAX_RETRIES", 5),
    webhookBaseDelayMs: parseIntEnv("WEBHOOK_BASE_DELAY_MS", 1000),
    webhookTimeoutMs: parseIntEnv("WEBHOOK_TIMEOUT_MS", 10000),
  };
}

/** Singleton configuration loaded once at startup. */
export const config: AppConfig = loadConfig();
