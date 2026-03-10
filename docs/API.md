# Backend API Reference

This document covers the REST API provided by the backend service. The backend is a Docker-containerized Express.js application that coordinates on-chain operations, indexes events via WebSocket, manages compliance workflows, and provides webhook notifications.

**Source**: `backend/src/routes/index.ts`

---

## Base URL

```
http://localhost:3001
```

> Default host port is **3001** (mapped from container port 3000) to avoid conflicting with the Next.js frontend on port 3000.

For production deployments, use HTTPS and configure a reverse proxy (e.g., nginx, Caddy, or a cloud load balancer).

---

## Health Checks

### Liveness

```
GET /health
```

Returns `200 OK` if the service is running.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-02-24T12:00:00.000Z"
}
```

### Readiness

```
GET /health/ready
```

Returns `200 OK` if all dependencies are healthy, or `503 Service Unavailable` if any check fails.

**Response (200 OK):**

```json
{
  "status": "ready",
  "checks": {
    "solana": true,
    "redis": true,
    "eventListener": true
  },
  "timestamp": "2024-02-24T12:00:00.000Z"
}
```

**Response (503 Degraded):**

```json
{
  "status": "degraded",
  "checks": {
    "solana": true,
    "redis": false,
    "eventListener": true
  },
  "timestamp": "2024-02-24T12:00:00.000Z"
}
```

The readiness check verifies:
- **solana**: RPC connectivity via `getSlot()`.
- **redis**: Connectivity via `PING` / `PONG`.
- **eventListener**: Whether the WebSocket event listener is running.

---

## Mint and Burn

### Mint Tokens

```
POST /api/mint
```

Mint new tokens to a recipient. Requires a minter keypair with available quota.

**Request Body:**

```json
{
  "recipient": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "amount": 1000000000,
  "minterKeypair": "<base58-encoded-keypair>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recipient` | string (base58) | Yes | Recipient wallet address |
| `amount` | number | Yes | Amount in base units (e.g., 1000000000 = 1000.0 with 6 decimals) |
| `minterKeypair` | string (base58) | Yes | The minter's keypair (used to sign the on-chain transaction) |

**Response (200 OK):**

The response is the result returned by `MintBurnService.mint()`. It typically includes the transaction signature.

**Errors:**

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing required fields: `recipient`, `amount`, or `minterKeypair` |
| 500 | On-chain transaction failed (e.g., paused, quota exceeded, minter not active) |

---

### Burn Tokens

```
POST /api/burn
```

Burn tokens from the burner's token account.

**Request Body:**

```json
{
  "amount": 500000000,
  "burnerKeypair": "<base58-encoded-keypair>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes | Amount in base units to burn |
| `burnerKeypair` | string (base58) | Yes | The burner's keypair (must own tokens) |

**Response (200 OK):**

The response is the result returned by `MintBurnService.burn()`.

**Errors:**

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing required fields: `amount` or `burnerKeypair` |
| 500 | On-chain transaction failed (e.g., paused, insufficient balance) |

---

### Get Supply

```
GET /api/supply
```

Get current supply metrics from the on-chain `StablecoinConfig` PDA.

**Response (200 OK):**

The response is the result returned by `MintBurnService.getSupply()`, which reads `total_minted` and `total_burned` from the config account.

---

## Status

### Get Stablecoin Status

```
GET /api/status
```

Get full stablecoin configuration and state by reading the `StablecoinConfig` PDA on-chain.

**Response (200 OK):**

```json
{
  "configPda": "9aE476sH92Vz7DMPyq5WLPkrKWivxeuTKEFKd2sZZcjj",
  "masterAuthority": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "pendingAuthority": "11111111111111111111111111111111",
  "mint": "3Fh7bHNKEQp9Mrz1C3f7NpFuAKJdJDE8CwGwCAXkxbjR",
  "decimals": 6,
  "enablePermanentDelegate": true,
  "enableTransferHook": true,
  "complianceEnabled": true,
  "isPaused": false,
  "totalMinted": "1500000000",
  "totalBurned": "500000000",
  "programId": "B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs",
  "transferHookProgramId": "HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou"
}
```

The status endpoint derives the config PDA from the `STABLECOIN_MINT` environment variable using seeds `["stablecoin_config", mint.key()]`, then reads the raw account data at the following byte offsets:

| Offset | Size | Field |
|--------|------|-------|
| 8 | 32 | `masterAuthority` |
| 40 | 32 | `pendingAuthority` |
| 72 | 32 | `mint` |
| 104 | 1 | `decimals` |
| 105 | 1 | `enablePermanentDelegate` |
| 106 | 1 | `enableTransferHook` |
| 107 | 1 | `isPaused` |
| 108 | 8 | `totalMinted` (u64 LE) |
| 116 | 8 | `totalBurned` (u64 LE) |

`complianceEnabled` is derived as `enablePermanentDelegate && enableTransferHook`.

**Errors:**

| HTTP Status | Condition |
|-------------|-----------|
| 404 | Stablecoin config not found on-chain |
| 500 | `STABLECOIN_MINT` not configured |

---

## Compliance (SSS-2)

### Add to Blacklist

```
POST /api/blacklist
```

Add an address to the on-chain blacklist.

**Request Body:**

```json
{
  "address": "SuspectAddr11111111111111111111111111111111",
  "reason": "OFAC SDN List match - Entity XYZ Corp",
  "blacklisterKeypair": "<base58-encoded-keypair>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | string (base58) | Yes | Wallet address to blacklist |
| `reason` | string | Yes | Reason for blacklisting (max 128 chars) |
| `blacklisterKeypair` | string (base58) | Yes | The blacklister's keypair (must have blacklister role) |

**Response (200 OK):**

The response is the result returned by `ComplianceService.addToBlacklist()`.

**Errors:**

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing required fields: `address`, `reason`, or `blacklisterKeypair` |
| 500 | On-chain transaction failed (e.g., already blacklisted, compliance not enabled) |

---

### Remove from Blacklist

```
DELETE /api/blacklist/:address
```

Remove an address from the blacklist.

**Request Body:**

```json
{
  "blacklisterKeypair": "<base58-encoded-keypair>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blacklisterKeypair` | string (base58) | Yes | The blacklister's keypair |

**Response (200 OK):**

The response is the result returned by `ComplianceService.removeFromBlacklist()`.

**Errors:**

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing required field: `blacklisterKeypair` |
| 500 | On-chain transaction failed (e.g., not blacklisted) |

---

### List Blacklisted Addresses

```
GET /api/blacklist
```

List all blacklisted addresses (from the compliance service's index).

**Response (200 OK):**

```json
{
  "count": 2,
  "entries": [
    {
      "address": "SuspectAddr11111111111111111111111111111111",
      "reason": "OFAC SDN List match",
      "blacklistedAt": 1708819200,
      "blacklistedBy": "ComplianceOp111111111111111111111111111111"
    }
  ]
}
```

---

### Check Blacklist Status

```
GET /api/blacklist/:address
```

Check if a specific address is blacklisted.

**Response (200 OK):**

```json
{
  "address": "SuspectAddr11111111111111111111111111111111",
  "blacklisted": true,
  "info": {
    "reason": "OFAC SDN List match",
    "blacklistedAt": 1708819200,
    "blacklistedBy": "ComplianceOp111111111111111111111111111111"
  }
}
```

If the address is not blacklisted:

```json
{
  "address": "CleanAddr111111111111111111111111111111111111",
  "blacklisted": false,
  "info": null
}
```

---

### Seize Tokens

```
POST /api/seize
```

Seize tokens from an account using the burn + mint pattern via the permanent delegate.

**Request Body:**

```json
{
  "fromAccount": "TargetTokenAccount111111111111111111111111111",
  "toAccount": "TreasuryTokenAccount11111111111111111111111111",
  "amount": 5000000,
  "seizerKeypair": "<base58-encoded-keypair>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fromAccount` | string (base58) | Yes | Source token account to seize from |
| `toAccount` | string (base58) | Yes | Treasury token account to receive seized tokens |
| `amount` | number | Yes | Amount to seize in base units |
| `seizerKeypair` | string (base58) | Yes | The seizer's keypair (must have seizer role) |

**Response (200 OK):**

The response is the result returned by `ComplianceService.seize()`.

**Errors:**

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing required fields: `fromAccount`, `toAccount`, `amount`, or `seizerKeypair` |
| 500 | On-chain transaction failed (e.g., compliance not enabled, insufficient balance) |

---

## Audit Log

### Get Audit Log

```
GET /api/audit-log
```

Query the indexed event log stored in Redis.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `action` | string | all | Filter by event type name (e.g., `TokensMinted`, `AddedToBlacklist`) |
| `from` | number (Unix timestamp) | -- | Start timestamp filter |
| `to` | number (Unix timestamp) | -- | End timestamp filter |
| `limit` | number | -- | Maximum number of entries to return |

**Response (200 OK):**

```json
{
  "count": 3,
  "entries": [
    {
      "eventName": "TokensMinted",
      "signature": "5xR7kL3m...",
      "slot": 12345678,
      "data": {
        "config": "9aE476sH92Vz7DMPyq5WLPkrKWivxeuTKEFKd2sZZcjj",
        "minter": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "recipient": "BrLHN4YKNq26rBzY3g5EwTJi7gfPLmPHE5Fh9bFNhNs",
        "amount": 1000000000,
        "timestamp": 1708819200
      }
    }
  ]
}
```

---

## Webhooks

### Register a Webhook

```
POST /api/webhooks
```

Register a URL to receive event notifications. Webhooks are stored in Redis.

**Request Body:**

```json
{
  "url": "https://your-service.com/webhook",
  "eventFilter": ["TokensMinted", "TokensBurned", "AddedToBlacklist", "TokensSeized"],
  "secret": "your-webhook-secret"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string (URL) | Yes | Endpoint to receive POST notifications |
| `eventFilter` | string[] | No | List of event names to subscribe to. Empty array or omitted = all events. |
| `secret` | string | No | Secret for HMAC-SHA256 signature. Auto-generated if not provided. |

**Response (201 Created):**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://your-service.com/webhook",
  "eventFilter": ["TokensMinted", "TokensBurned", "AddedToBlacklist", "TokensSeized"],
  "secret": "your-webhook-secret",
  "createdAt": "2024-02-24T12:00:00.000Z",
  "active": true
}
```

---

### List Webhooks

```
GET /api/webhooks
```

List all registered webhooks. Secrets are omitted from the response.

**Response (200 OK):**

```json
{
  "count": 1,
  "webhooks": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "url": "https://your-service.com/webhook",
      "eventFilter": ["TokensMinted", "TokensBurned"],
      "createdAt": "2024-02-24T12:00:00.000Z",
      "active": true
    }
  ]
}
```

---

### Delete a Webhook

```
DELETE /api/webhooks/:id
```

Remove a webhook registration and its delivery history from Redis.

**Response (200 OK):**

```json
{
  "message": "Webhook removed",
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response (404 Not Found):**

```json
{
  "error": "Webhook not found"
}
```

---

### Webhook Delivery

When an event matches a registered webhook's filter, the backend sends a POST request to the configured URL.

**Request Headers:**

```
Content-Type: application/json
X-SSS-Signature: <HMAC-SHA256 hex digest of the payload body>
X-SSS-Event: <event name, e.g., TokensMinted>
X-SSS-Delivery-Attempt: <attempt number, starting at 1>
```

**Request Body:**

```json
{
  "id": "unique-delivery-id",
  "webhookId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2024-02-24T12:30:00.000Z",
  "event": {
    "eventName": "TokensMinted",
    "signature": "5xR7kL3m...",
    "slot": 12345678,
    "data": {
      "config": "9aE476sH92Vz7DMPyq5WLPkrKWivxeuTKEFKd2sZZcjj",
      "minter": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "recipient": "BrLHN4YKNq26rBzY3g5EwTJi7gfPLmPHE5Fh9bFNhNs",
      "amount": 1000000000,
      "timestamp": 1708819200
    }
  }
}
```

### Signature Verification

To verify a webhook delivery, compute the HMAC-SHA256 of the raw request body using the webhook secret, and compare it to the `X-SSS-Signature` header value:

```typescript
import { createHmac } from "crypto";

function verifySignature(body: string, secret: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return expected === signature;
}
```

### Retry Policy

The webhook service uses exponential backoff with jitter for failed deliveries:

- **Base delay**: Configurable via `WEBHOOK_BASE_DELAY_MS` (default: 1000ms).
- **Backoff formula**: `baseDelay * 2^(attempt - 1)` with up to 30% random jitter.
- **Max retries**: Configurable via `WEBHOOK_MAX_RETRIES` (default: 5).
- **Request timeout**: Configurable via `WEBHOOK_TIMEOUT_MS` (default: 10000ms).

After all retries are exhausted, the delivery is recorded as permanently failed. The webhook remains registered and active for future events.

The last 100 deliveries per webhook are retained in Redis for debugging.

---

## Error Handling

All error responses follow a consistent format:

```json
{
  "error": "Error message describing what went wrong"
}
```

`ServiceError` and `WebhookError` instances return their associated HTTP status code. Unexpected errors return `500` with `"Internal server error"`.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Node environment |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `SOLANA_RPC_URL` | No | `https://api.devnet.solana.com` | Solana HTTP RPC endpoint |
| `SOLANA_WS_URL` | No | `wss://api.devnet.solana.com` | Solana WebSocket endpoint |
| `SOLANA_COMMITMENT` | No | `confirmed` | Transaction commitment level |
| `STABLECOIN_PROGRAM_ID` | No | `B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs` | Stablecoin on-chain program ID |
| `TRANSFER_HOOK_PROGRAM_ID` | No | `HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou` | Transfer hook on-chain program ID |
| `STABLECOIN_MINT` | Yes* | -- | Token-2022 mint address (* required for `/api/status`) |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `WEBHOOK_MAX_RETRIES` | No | `5` | Maximum webhook delivery retry attempts |
| `WEBHOOK_BASE_DELAY_MS` | No | `1000` | Webhook exponential backoff base delay in milliseconds |
| `WEBHOOK_TIMEOUT_MS` | No | `10000` | Webhook HTTP request timeout in milliseconds |

---

## Docker Deployment

```bash
cd backend
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

The `docker-compose.yml` runs the backend service and a Redis instance:

```yaml
services:
  backend:
    build: .
    ports:
      - "3001:3000"
    env_file: .env
    depends_on:
      - redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

The Dockerfile uses a multi-stage build for a minimal production image.

---

## Service Architecture

The backend is composed of four services, injected into the route factory via dependency injection:

| Service | Module | Responsibilities |
|---------|--------|-----------------|
| **MintBurnService** | `services/mint-burn.ts` | Build and submit mint/burn transactions, query supply |
| **ComplianceService** | `services/compliance.ts` | Blacklist management, seizure, audit log queries |
| **EventListenerService** | `services/event-listener.ts` | WebSocket subscription to program logs, event decoding, Redis storage |
| **WebhookService** | `services/webhook.ts` | Webhook registration, delivery with HMAC and retry, delivery history |

### Event Listener

The `EventListenerService` subscribes to the stablecoin program's logs via Solana's `logsSubscribe` WebSocket API. It decodes 14 Anchor event types using their discriminators and stores decoded events in Redis sorted sets (keyed by slot and by timestamp). Decoded events are also dispatched to the webhook service for real-time notifications.

### Graceful Shutdown

The backend handles `SIGTERM` and `SIGINT` signals for graceful shutdown:
1. Stops accepting new HTTP connections.
2. Stops the event listener WebSocket subscription.
3. Closes the Redis connection.
4. Exits the process.
