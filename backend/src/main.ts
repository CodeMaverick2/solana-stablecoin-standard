import express from "express";
import pino from "pino";
import Redis from "ioredis";
import { config } from "./config";
import { MintBurnService } from "./services/mint-burn";
import { EventListenerService } from "./services/event-listener";
import { ComplianceService } from "./services/compliance";
import { WebhookService } from "./services/webhook";
import { createRoutes, errorHandler } from "./routes/index";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  name: "sss-backend",
  level: config.logLevel,
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 10) {
      logger.error("Redis connection permanently failed after 10 retries");
      return null; // stop retrying
    }
    const delay = Math.min(times * 200, 5000);
    logger.warn({ attempt: times, delayMs: delay }, "Retrying Redis connection");
    return delay;
  },
  lazyConnect: true,
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.error({ err: err.message }, "Redis error"));
redis.on("close", () => logger.warn("Redis connection closed"));

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const mintBurnService = new MintBurnService(logger);
const complianceService = new ComplianceService(logger, redis);
const eventListenerService = new EventListenerService(logger, redis);
const webhookService = new WebhookService(logger, redis);

// Wire event listener to webhook dispatcher
eventListenerService.onEvent((event) => {
  webhookService.dispatch(event).catch((err) => {
    logger.error({ err: err.message }, "Webhook dispatch error");
  });
});

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------

const app = express();

// Middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
      },
      "HTTP request completed",
    );
  });
  next();
});

// CORS headers (permissive for development, tighten for production)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Routes
const routes = createRoutes({
  logger,
  redis,
  mintBurnService,
  complianceService,
  eventListenerService,
  webhookService,
});
app.use(routes);

// Error handler (must be last)
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  logger.info({
    port: config.port,
    nodeEnv: config.nodeEnv,
    rpcUrl: config.solanaRpcUrl,
    stablecoinProgramId: config.stablecoinProgramId.toBase58(),
    transferHookProgramId: config.transferHookProgramId.toBase58(),
    stablecoinMint: config.stablecoinMint?.toBase58() ?? "(not configured)",
  }, "Starting SSS Backend");

  // Connect Redis
  try {
    await redis.connect();
    logger.info("Redis connection established");
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to connect to Redis");
    process.exit(1);
  }

  // Start event listener (only if mint is configured)
  if (config.stablecoinMint) {
    try {
      await eventListenerService.start();
      logger.info("Event listener started");
    } catch (err: any) {
      logger.warn({ err: err.message }, "Event listener failed to start (non-fatal)");
    }
  } else {
    logger.warn("STABLECOIN_MINT not set — event listener skipped. Set it in .env to enable.");
  }

  // Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "SSS Backend listening");
  });

  // -----------------------------------------------------------------------
  // Graceful Shutdown
  // -----------------------------------------------------------------------

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Stop event listener
    try {
      await eventListenerService.stop();
    } catch (err: any) {
      logger.error({ err: err.message }, "Error stopping event listener");
    }

    // Disconnect Redis
    try {
      await redis.quit();
      logger.info("Redis disconnected");
    } catch (err: any) {
      logger.error({ err: err.message }, "Error disconnecting Redis");
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Unhandled rejection / exception safety net
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, "Uncaught exception — shutting down");
    process.exit(1);
  });
}

start().catch((err) => {
  logger.fatal({ err: err.message }, "Fatal startup error");
  process.exit(1);
});
