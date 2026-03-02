import { Router, Request, Response, NextFunction } from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import pino from "pino";
import Redis from "ioredis";
import { config } from "../config";
import { MintBurnService, ServiceError } from "../services/mint-burn";
import { ComplianceService } from "../services/compliance";
import { EventListenerService } from "../services/event-listener";
import { WebhookService, WebhookError } from "../services/webhook";

// ---------------------------------------------------------------------------
// Types for request bodies
// ---------------------------------------------------------------------------

interface MintBody {
  recipient: string;
  amount: number;
  minterKeypair: string;
}

interface BurnBody {
  amount: number;
  burnerKeypair: string;
}

interface BlacklistAddBody {
  address: string;
  reason: string;
  blacklisterKeypair: string;
}

interface BlacklistRemoveBody {
  blacklisterKeypair: string;
}

interface SeizeBody {
  fromAccount: string;
  toAccount: string;
  amount: number;
  seizerKeypair: string;
}

interface WebhookRegisterBody {
  url: string;
  eventFilter?: string[];
  secret?: string;
}

// ---------------------------------------------------------------------------
// Async Handler Wrapper
// ---------------------------------------------------------------------------

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Route Factory
// ---------------------------------------------------------------------------

export function createRoutes(deps: {
  logger: pino.Logger;
  redis: Redis;
  mintBurnService: MintBurnService;
  complianceService: ComplianceService;
  eventListenerService: EventListenerService;
  webhookService: WebhookService;
}): Router {
  const router = Router();
  const { logger, redis, mintBurnService, complianceService, eventListenerService, webhookService } = deps;

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  router.get(
    "/health",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    }),
  );

  router.get(
    "/health/ready",
    asyncHandler(async (_req: Request, res: Response) => {
      const checks: Record<string, boolean> = {};

      // Check Solana RPC connectivity
      try {
        const conn = new Connection(config.solanaRpcUrl, { commitment: config.solanaCommitment });
        const slot = await conn.getSlot();
        checks.solana = slot > 0;
      } catch {
        checks.solana = false;
      }

      // Check Redis connectivity
      try {
        const pong = await redis.ping();
        checks.redis = pong === "PONG";
      } catch {
        checks.redis = false;
      }

      // Check event listener
      checks.eventListener = eventListenerService.isRunning();

      const allHealthy = Object.values(checks).every(Boolean);

      res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? "ready" : "degraded",
        checks,
        timestamp: new Date().toISOString(),
      });
    }),
  );

  // -----------------------------------------------------------------------
  // Mint / Burn / Supply
  // -----------------------------------------------------------------------

  router.post(
    "/api/mint",
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as MintBody;

      if (!body.recipient || !body.amount || !body.minterKeypair) {
        res.status(400).json({ error: "Missing required fields: recipient, amount, minterKeypair" });
        return;
      }

      const result = await mintBurnService.mint({
        recipient: body.recipient,
        amount: body.amount,
        minterKeypair: body.minterKeypair,
      });

      res.status(200).json(result);
    }),
  );

  router.post(
    "/api/burn",
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as BurnBody;

      if (!body.amount || !body.burnerKeypair) {
        res.status(400).json({ error: "Missing required fields: amount, burnerKeypair" });
        return;
      }

      const result = await mintBurnService.burn({
        amount: body.amount,
        burnerKeypair: body.burnerKeypair,
      });

      res.status(200).json(result);
    }),
  );

  router.get(
    "/api/supply",
    asyncHandler(async (_req: Request, res: Response) => {
      const stats = await mintBurnService.getSupply();
      res.json(stats);
    }),
  );

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  router.get(
    "/api/status",
    asyncHandler(async (_req: Request, res: Response) => {
      const mint = config.stablecoinMint;
      if (!mint) {
        res.status(500).json({ error: "STABLECOIN_MINT not configured" });
        return;
      }

      const conn = new Connection(config.solanaRpcUrl, { commitment: config.solanaCommitment });
      const CONFIG_SEED = Buffer.from("stablecoin_config");
      const [configPda] = PublicKey.findProgramAddressSync(
        [CONFIG_SEED, mint.toBuffer()],
        config.stablecoinProgramId,
      );

      const accountInfo = await conn.getAccountInfo(configPda, config.solanaCommitment);
      if (!accountInfo) {
        res.status(404).json({ error: "Stablecoin config not found on-chain" });
        return;
      }

      const data = accountInfo.data;

      // Decode relevant fields from StablecoinConfig
      const masterAuthority = new PublicKey(data.subarray(8, 40)).toBase58();
      const pendingAuthority = new PublicKey(data.subarray(40, 72)).toBase58();
      const mintAddress = new PublicKey(data.subarray(72, 104)).toBase58();
      const decimals = data.readUInt8(104);
      const enablePermanentDelegate = data.readUInt8(105) !== 0;
      const enableTransferHook = data.readUInt8(106) !== 0;
      const isPaused = data.readUInt8(107) !== 0;
      const totalMinted = data.readBigUInt64LE(108).toString();
      const totalBurned = data.readBigUInt64LE(116).toString();

      res.json({
        configPda: configPda.toBase58(),
        masterAuthority,
        pendingAuthority,
        mint: mintAddress,
        decimals,
        enablePermanentDelegate,
        enableTransferHook,
        complianceEnabled: enablePermanentDelegate && enableTransferHook,
        isPaused,
        totalMinted,
        totalBurned,
        programId: config.stablecoinProgramId.toBase58(),
        transferHookProgramId: config.transferHookProgramId.toBase58(),
      });
    }),
  );

  // -----------------------------------------------------------------------
  // Blacklist (SSS-2 Compliance)
  // -----------------------------------------------------------------------

  router.post(
    "/api/blacklist",
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as BlacklistAddBody;

      if (!body.address || !body.reason || !body.blacklisterKeypair) {
        res.status(400).json({
          error: "Missing required fields: address, reason, blacklisterKeypair",
        });
        return;
      }

      const result = await complianceService.addToBlacklist({
        address: body.address,
        reason: body.reason,
        blacklisterKeypair: body.blacklisterKeypair,
      });

      res.status(200).json(result);
    }),
  );

  router.delete(
    "/api/blacklist/:address",
    asyncHandler(async (req: Request, res: Response) => {
      const address = req.params.address as string;
      const body = req.body as BlacklistRemoveBody;

      if (!body.blacklisterKeypair) {
        res.status(400).json({ error: "Missing required field: blacklisterKeypair" });
        return;
      }

      const result = await complianceService.removeFromBlacklist({
        address,
        blacklisterKeypair: body.blacklisterKeypair,
      });

      res.status(200).json(result);
    }),
  );

  router.get(
    "/api/blacklist",
    asyncHandler(async (_req: Request, res: Response) => {
      const list = await complianceService.listBlacklisted();
      res.json({ count: list.length, entries: list });
    }),
  );

  router.get(
    "/api/blacklist/:address",
    asyncHandler(async (req: Request, res: Response) => {
      const address = req.params.address as string;

      const isBlacklisted = await complianceService.isBlacklisted(address);
      const info = isBlacklisted ? await complianceService.getBlacklistInfo(address) : null;

      res.json({
        address,
        blacklisted: isBlacklisted,
        info,
      });
    }),
  );

  // -----------------------------------------------------------------------
  // Seize (SSS-2 Compliance)
  // -----------------------------------------------------------------------

  router.post(
    "/api/seize",
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as SeizeBody;

      if (!body.fromAccount || !body.toAccount || !body.amount || !body.seizerKeypair) {
        res.status(400).json({
          error: "Missing required fields: fromAccount, toAccount, amount, seizerKeypair",
        });
        return;
      }

      const result = await complianceService.seize({
        fromAccount: body.fromAccount,
        toAccount: body.toAccount,
        amount: body.amount,
        seizerKeypair: body.seizerKeypair,
      });

      res.status(200).json(result);
    }),
  );

  // -----------------------------------------------------------------------
  // Audit Log
  // -----------------------------------------------------------------------

  router.get(
    "/api/audit-log",
    asyncHandler(async (req: Request, res: Response) => {
      const action = req.query.action as string | undefined;
      const from = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const to = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      const entries = await complianceService.getAuditLog({ action, from, to, limit });
      res.json({ count: entries.length, entries });
    }),
  );

  // -----------------------------------------------------------------------
  // Webhooks
  // -----------------------------------------------------------------------

  router.post(
    "/api/webhooks",
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as WebhookRegisterBody;

      if (!body.url) {
        res.status(400).json({ error: "Missing required field: url" });
        return;
      }

      const webhook = await webhookService.register(
        body.url,
        body.eventFilter ?? [],
        body.secret,
      );

      res.status(201).json(webhook);
    }),
  );

  router.get(
    "/api/webhooks",
    asyncHandler(async (_req: Request, res: Response) => {
      const webhooks = await webhookService.list();
      // Omit secrets from list response
      const sanitized = webhooks.map(({ secret, ...rest }) => rest);
      res.json({ count: sanitized.length, webhooks: sanitized });
    }),
  );

  router.delete(
    "/api/webhooks/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const removed = await webhookService.remove(id);

      if (removed) {
        res.json({ message: "Webhook removed", id });
      } else {
        res.status(404).json({ error: "Webhook not found" });
      }
    }),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Error Handling Middleware
// ---------------------------------------------------------------------------

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ServiceError || err instanceof WebhookError) {
    res.status((err as any).statusCode).json({ error: err.message });
    return;
  }

  // Unexpected errors
  const logger = pino({ name: "error-handler" });
  logger.error({ err: err.message, stack: err.stack }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
}
