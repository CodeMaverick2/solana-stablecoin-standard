import pino from "pino";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import type { StablecoinEvent } from "./event-listener";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookRegistration {
  /** Unique webhook ID. */
  id: string;
  /** Target URL to POST events to. */
  url: string;
  /** Optional: only deliver events matching these names. Empty = all events. */
  eventFilter: string[];
  /** Secret used to sign the webhook payload (HMAC-SHA256). */
  secret: string;
  /** ISO-8601 timestamp of registration. */
  createdAt: string;
  /** Whether the webhook is active. */
  active: boolean;
}

export interface WebhookDelivery {
  /** Webhook ID this delivery belongs to. */
  webhookId: string;
  /** The event that was delivered. */
  event: StablecoinEvent;
  /** HTTP status code from the target, or null if unreachable. */
  statusCode: number | null;
  /** Number of attempts made. */
  attempts: number;
  /** Whether delivery succeeded. */
  success: boolean;
  /** ISO-8601 timestamp of last attempt. */
  lastAttemptAt: string;
  /** Error message if failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Redis Keys
// ---------------------------------------------------------------------------

const WEBHOOKS_HASH = "sss:webhooks";
const WEBHOOK_DELIVERIES_PREFIX = "sss:webhook_deliveries:";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WebhookService {
  private readonly logger: pino.Logger;
  private readonly redis: Redis;

  constructor(parentLogger: pino.Logger, redis: Redis) {
    this.logger = parentLogger.child({ service: "webhook" });
    this.redis = redis;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  async register(url: string, eventFilter: string[] = [], secret?: string): Promise<WebhookRegistration> {
    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new WebhookError("Invalid webhook URL", 400);
    }

    const webhook: WebhookRegistration = {
      id: uuidv4(),
      url,
      eventFilter,
      secret: secret ?? uuidv4(), // Auto-generate a secret if not provided
      createdAt: new Date().toISOString(),
      active: true,
    };

    await this.redis.hset(WEBHOOKS_HASH, webhook.id, JSON.stringify(webhook));

    this.logger.info({ webhookId: webhook.id, url }, "Webhook registered");
    return webhook;
  }

  async list(): Promise<WebhookRegistration[]> {
    const all = await this.redis.hgetall(WEBHOOKS_HASH);
    return Object.values(all).map((v) => JSON.parse(v) as WebhookRegistration);
  }

  async get(id: string): Promise<WebhookRegistration | null> {
    const raw = await this.redis.hget(WEBHOOKS_HASH, id);
    return raw ? (JSON.parse(raw) as WebhookRegistration) : null;
  }

  async remove(id: string): Promise<boolean> {
    const deleted = await this.redis.hdel(WEBHOOKS_HASH, id);
    if (deleted > 0) {
      // Clean up delivery history
      await this.redis.del(`${WEBHOOK_DELIVERIES_PREFIX}${id}`);
      this.logger.info({ webhookId: id }, "Webhook removed");
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Event Dispatch (called by event listener)
  // -----------------------------------------------------------------------

  /**
   * Dispatch a stablecoin event to all matching registered webhooks.
   * This is designed to be called from EventListenerService.onEvent().
   */
  async dispatch(event: StablecoinEvent): Promise<void> {
    const webhooks = await this.list();
    const active = webhooks.filter((w) => w.active);

    for (const webhook of active) {
      // Check event filter
      if (webhook.eventFilter.length > 0 && !webhook.eventFilter.includes(event.eventName)) {
        continue;
      }

      // Deliver asynchronously — don't block the event loop
      this.deliverWithRetry(webhook, event).catch((err) => {
        this.logger.error(
          { err: err.message, webhookId: webhook.id },
          "Webhook delivery failed permanently",
        );
      });
    }
  }

  // -----------------------------------------------------------------------
  // Delivery with Exponential Backoff
  // -----------------------------------------------------------------------

  private async deliverWithRetry(webhook: WebhookRegistration, event: StablecoinEvent): Promise<void> {
    const maxRetries = config.webhookMaxRetries;
    const baseDelay = config.webhookBaseDelayMs;
    const timeout = config.webhookTimeoutMs;

    const payload = JSON.stringify({
      id: uuidv4(),
      webhookId: webhook.id,
      timestamp: new Date().toISOString(),
      event,
    });

    // Compute HMAC signature
    const { createHmac } = await import("crypto");
    const signature = createHmac("sha256", webhook.secret).update(payload).digest("hex");

    let lastError: string | undefined;
    let lastStatusCode: number | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-SSS-Signature": signature,
            "X-SSS-Event": event.eventName,
            "X-SSS-Delivery-Attempt": String(attempt),
          },
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(timer);
        lastStatusCode = response.status;

        if (response.ok) {
          this.logger.info(
            {
              webhookId: webhook.id,
              eventName: event.eventName,
              attempt,
              statusCode: response.status,
            },
            "Webhook delivered successfully",
          );

          // Record delivery success
          const delivery: WebhookDelivery = {
            webhookId: webhook.id,
            event,
            statusCode: response.status,
            attempts: attempt,
            success: true,
            lastAttemptAt: new Date().toISOString(),
          };
          await this.recordDelivery(webhook.id, delivery);
          return;
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
        this.logger.warn(
          {
            webhookId: webhook.id,
            attempt,
            statusCode: response.status,
            maxRetries,
          },
          "Webhook delivery failed, will retry",
        );
      } catch (err: any) {
        lastError = err.name === "AbortError" ? "Request timed out" : err.message;
        this.logger.warn(
          { webhookId: webhook.id, attempt, error: lastError, maxRetries },
          "Webhook delivery error, will retry",
        );
      }

      // Exponential backoff with jitter
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * delay * 0.3;
        await sleep(delay + jitter);
      }
    }

    // All retries exhausted
    this.logger.error(
      { webhookId: webhook.id, eventName: event.eventName, attempts: maxRetries, lastError },
      "Webhook delivery permanently failed after all retries",
    );

    const delivery: WebhookDelivery = {
      webhookId: webhook.id,
      event,
      statusCode: lastStatusCode,
      attempts: maxRetries,
      success: false,
      lastAttemptAt: new Date().toISOString(),
      error: lastError,
    };
    await this.recordDelivery(webhook.id, delivery);
  }

  // -----------------------------------------------------------------------
  // Delivery History
  // -----------------------------------------------------------------------

  private async recordDelivery(webhookId: string, delivery: WebhookDelivery): Promise<void> {
    const key = `${WEBHOOK_DELIVERIES_PREFIX}${webhookId}`;
    const pipeline = this.redis.pipeline();
    pipeline.lpush(key, JSON.stringify(delivery));
    // Keep only the last 100 deliveries per webhook
    pipeline.ltrim(key, 0, 99);
    await pipeline.exec();
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class WebhookError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "WebhookError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
