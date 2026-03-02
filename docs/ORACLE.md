# Oracle Integration

## Overview

For USD-pegged stablecoins the target price is a hard-coded constant (`1.0`). For stablecoins that track a non-USD peg -- EUR, BRL, gold, BTC, or any other reference asset -- the issuer needs a live, on-chain price feed to know whether the peg is holding.

The Solana Stablecoin Standard SDK ships an `OracleModule` class that reads price data directly from two major oracle networks without requiring their full SDKs as dependencies. It is built on `@solana/web3.js` only and parses the raw account layouts documented by each provider.

Typical usage patterns:

- **Gating mint operations**: Refuse to mint new tokens if the peg deviates more than a configured number of basis points from the target.
- **Triggering circuit breakers**: Automatically pause the stablecoin when the underlying asset price moves outside the allowed band.
- **Off-chain monitoring**: Alert operations teams when the peg is approaching its deviation limit.

---

## Supported Oracle Providers

### Switchboard V2

[Switchboard](https://switchboard.xyz/) is a decentralized oracle network built natively on Solana. Feed accounts are `AggregatorAccountData` accounts owned by the Switchboard V2 program. The SDK parses the relevant fields from the raw account data using documented byte offsets from the Switchboard V2 Anchor IDL.

Key characteristics:

- Feeds are permissionless -- anyone can create a feed for any data source.
- Large number of established mainnet feeds covering DeFi, equities, commodities, and FX.
- The result struct stores a `mantissa` (i128) and `exponent` (i32): `price = mantissa × 10^exponent`.
- Confidence is not stored in the aggregator result struct; the SDK returns `0` for this field from Switchboard feeds.
- The `latestConfirmedRound.roundOpenTimestamp` field (i64 Unix seconds) is used as the publish timestamp.

### Pyth Network

[Pyth](https://pyth.network/) is an oracle network that aggregates prices from institutional data providers. Price accounts store an aggregate price, a 1-sigma confidence interval, and the price component type.

Key characteristics:

- Price accounts use a compact, non-Anchor layout identified by a magic number (`0xa1b2c3e4`).
- The SDK validates the magic number before reading any other field.
- Both the aggregate price (i64) and confidence (u64) are scaled by the same exponent (i32): `price = rawPrice × 10^exponent`.
- The `agg.pub_slot` field is returned as `publishTime`; callers can convert slot numbers to wall-clock time if needed.
- Pyth maintains separate key stores for devnet and mainnet-beta.

---

## SDK Usage Examples

### Basic Setup

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import {
  OracleModule,
  WELL_KNOWN_DEVNET_FEEDS,
  WELL_KNOWN_MAINNET_FEEDS,
} from "@solana-stablecoin-standard/core";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const oracle = new OracleModule(connection);
```

### Reading a Pyth Price

```typescript
const SOL_USD_PYTH = new PublicKey(
  WELL_KNOWN_MAINNET_FEEDS["SOL/USD"].pyth!
);

const price = await oracle.getPythPrice(SOL_USD_PYTH);

console.log(`SOL/USD price:      $${price.price.toFixed(4)}`);
console.log(`Confidence:         ±$${price.confidence.toFixed(4)}`);
console.log(`Exponent:           ${price.exponent}`);
console.log(`Published at slot:  ${price.publishTime}`);
console.log(`Source:             ${price.source}`);
// SOL/USD price:      $142.8300
// Confidence:         ±$0.0520
// Exponent:           -8
// Published at slot:  295831042
// Source:             pyth
```

### Reading a Switchboard Price

```typescript
const SOL_USD_SB = new PublicKey(
  WELL_KNOWN_MAINNET_FEEDS["SOL/USD"].switchboard!
);

const price = await oracle.getSwitchboardPrice(SOL_USD_SB);

console.log(`SOL/USD price:  $${price.price.toFixed(4)}`);
console.log(`Source:         ${price.source}`);
// SOL/USD price:  $142.8150
// Source:         switchboard
```

### Getting Both Providers and Averaging

```typescript
const [pythResult, sbResult] = await Promise.all([
  oracle.getPythPrice(new PublicKey(WELL_KNOWN_MAINNET_FEEDS["SOL/USD"].pyth!)),
  oracle.getSwitchboardPrice(new PublicKey(WELL_KNOWN_MAINNET_FEEDS["SOL/USD"].switchboard!)),
]);

const averagePrice = (pythResult.price + sbResult.price) / 2;
console.log(`Averaged SOL/USD: $${averagePrice.toFixed(4)}`);
```

### Listing Well-Known Feeds

```typescript
// Get devnet feeds (default)
const devnetFeeds = oracle.getWellKnownFeeds();
console.log("Devnet SOL/USD Pyth:", devnetFeeds["SOL/USD"].pyth);

// Access mainnet feeds via the exported constant
console.log("Mainnet BTC/USD Switchboard:", WELL_KNOWN_MAINNET_FEEDS["BTC/USD"].switchboard);
console.log("Mainnet BTC/USD Pyth:", WELL_KNOWN_MAINNET_FEEDS["BTC/USD"].pyth);
```

---

## Peg Deviation Checking

`OracleModule.checkPegDeviation(currentPrice, pegPrice, maxDeviationBps)` returns `true` when the current price is within the allowed band, `false` when it has deviated too far.

Deviation is measured in basis points (bps). 1 bps = 0.01%. A 50 bps limit corresponds to ±0.5%.

```typescript
// Allow ±50 bps (0.5%) deviation from the $1.00 USD peg
oracle.checkPegDeviation(0.998, 1.0, 50);  // true  — 0.2% deviation, within band
oracle.checkPegDeviation(0.990, 1.0, 50);  // false — 1.0% deviation, outside band
oracle.checkPegDeviation(1.006, 1.0, 50);  // false — 0.6% deviation, outside band
```

Formula:

```
deviationBps = (|currentPrice - pegPrice| / pegPrice) * 10,000
isWithinBand = deviationBps <= maxDeviationBps
```

### Non-USD Pegs

For stablecoins pegged to something other than $1.00, supply the appropriate peg price:

```typescript
// BRL stablecoin pegged to ~5.00 USD/BRL (i.e. BRL/USD ≈ 0.20)
// Fetch live BRL/USD price — use a Switchboard or Pyth BRL/USD feed
const brlPrice = await oracle.getPythPrice(new PublicKey("BRL_USD_FEED_ADDRESS"));
const withinPeg = oracle.checkPegDeviation(brlPrice.price, 0.20, 100); // 100 bps = 1%
```

---

## Gating Mint Operations

The primary integration pattern is to check the oracle before allowing a mint to proceed.

### Pattern 1 — Off-Chain Gate (Recommended)

The minter's backend service checks the oracle before submitting the `mint_tokens` transaction. If the peg is off, the service withholds the transaction rather than submitting it.

```typescript
import { SolanaStablecoin, OracleModule } from "@solana-stablecoin-standard/core";
import { BN } from "@coral-xyz/anchor";

async function safeMint(
  sdk: SolanaStablecoin,
  oracle: OracleModule,
  feedAddress: PublicKey,
  pegPrice: number,
  maxDeviationBps: number,
  recipient: PublicKey,
  amount: BN,
  minter: PublicKey
): Promise<string> {
  // 1. Read the current price from the oracle
  const oraclePrice = await oracle.getPythPrice(feedAddress);

  // 2. Verify the peg is within bounds
  const withinPeg = oracle.checkPegDeviation(
    oraclePrice.price,
    pegPrice,
    maxDeviationBps
  );

  if (!withinPeg) {
    const deviation = Math.abs(oraclePrice.price - pegPrice) / pegPrice * 10_000;
    throw new Error(
      `Mint blocked: peg deviation of ${deviation.toFixed(1)} bps exceeds ` +
      `maximum allowed ${maxDeviationBps} bps. Current price: ${oraclePrice.price}`
    );
  }

  // 3. Peg is healthy — proceed with the mint
  return sdk.mint({ recipient, amount, minter });
}

// Usage
const oracle = new OracleModule(connection);
const EURC_USD_FEED = new PublicKey("YOUR_EUR_USD_FEED_ADDRESS");

await safeMint(
  sdk,
  oracle,
  EURC_USD_FEED,
  1.09,       // 1 EUR = $1.09 USD
  50,         // Allow ±50 bps (0.5%)
  recipientPubkey,
  new BN(1_000_000),  // 1 EURC (6 decimals)
  minterPubkey
);
```

### Pattern 2 — Circuit Breaker with Pause

If the peg breaks, automatically pause the stablecoin and alert operators.

```typescript
async function monitorPeg(
  sdk: SolanaStablecoin,
  oracle: OracleModule,
  feedAddress: PublicKey,
  pegPrice: number,
  maxDeviationBps: number,
  intervalMs: number
): Promise<void> {
  setInterval(async () => {
    try {
      const oraclePrice = await oracle.getPythPrice(feedAddress);
      const withinPeg = oracle.checkPegDeviation(
        oraclePrice.price,
        pegPrice,
        maxDeviationBps
      );

      if (!withinPeg) {
        console.error(
          `PEG BREAK DETECTED: price=${oraclePrice.price}, ` +
          `peg=${pegPrice}, maxBps=${maxDeviationBps}. Pausing stablecoin.`
        );
        await sdk.pause();
        // Notify operations team via PagerDuty, Slack, etc.
      }
    } catch (err) {
      console.error("Oracle monitor error:", err);
    }
  }, intervalMs);
}

// Check every 60 seconds
monitorPeg(sdk, oracle, feedAddress, 1.0, 50, 60_000);
```

### Pattern 3 — Dual-Oracle Validation

Use both Pyth and Switchboard and require both feeds to agree before proceeding.

```typescript
async function dualOracleMintGate(
  oracle: OracleModule,
  pegPrice: number,
  maxDeviationBps: number
): Promise<void> {
  const [pyth, sb] = await Promise.all([
    oracle.getPythPrice(new PublicKey(WELL_KNOWN_MAINNET_FEEDS["SOL/USD"].pyth!)),
    oracle.getSwitchboardPrice(new PublicKey(WELL_KNOWN_MAINNET_FEEDS["SOL/USD"].switchboard!)),
  ]);

  const pythOk = oracle.checkPegDeviation(pyth.price, pegPrice, maxDeviationBps);
  const sbOk = oracle.checkPegDeviation(sb.price, pegPrice, maxDeviationBps);

  if (!pythOk || !sbOk) {
    throw new Error(
      `Dual oracle gate failed: ` +
      `Pyth=${pyth.price} (${pythOk ? "ok" : "FAIL"}), ` +
      `Switchboard=${sb.price} (${sbOk ? "ok" : "FAIL"})`
    );
  }
}
```

---

## Well-Known Feed Addresses

### Devnet

| Pair | Pyth |
|------|------|
| SOL/USD | `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG` |
| BTC/USD | `HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J` |
| ETH/USD | `EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw` |
| USDC/USD | `5SSkXsEKQepHHAewytPVwdej4epN1nxgLVM84L4KXgy7` |

Switchboard devnet feeds are not included in the SDK defaults because Switchboard's devnet deployment is not maintained as consistently as Pyth's. Use the [Switchboard Explorer](https://app.switchboard.xyz/solana/devnet) to find current devnet feed addresses when needed.

### Mainnet-Beta

| Pair | Switchboard | Pyth |
|------|-------------|------|
| SOL/USD | `GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR` | `H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG` |
| BTC/USD | `8SXvChNYFhRq4EZuZvnhjrB3jJRQCv4k3P4W6hesH3Ee` | `GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU` |
| ETH/USD | `HNStfhaLnqwF2ZtJUizaA9uHDAVB976r2AgTavyeqQrt` | `JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB` |
| USDC/USD | `BjUgj6YCnFBZ49wF54ddBVA9qu8TeqkFtkbqmZcee8uW` | `Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD` |

Always verify feed addresses against the official Pyth and Switchboard dashboards before using in production. Feed addresses occasionally change when providers migrate to new aggregators.

**Pyth mainnet dashboard**: https://pyth.network/price-feeds
**Switchboard mainnet explorer**: https://app.switchboard.xyz/solana/mainnet-beta

---

## OraclePrice Interface

```typescript
interface OraclePrice {
  /** Human-readable price value (already scaled by the exponent). */
  price: number;
  /** 1-sigma confidence interval around price (already scaled). 0 for Switchboard feeds. */
  confidence: number;
  /** Raw exponent used to scale the integer mantissa from the feed. */
  exponent: number;
  /** Unix timestamp (seconds) for Switchboard; slot number for Pyth. */
  publishTime: number;
  /** Which oracle network produced this price. */
  source: "switchboard" | "pyth";
}
```

Note that `publishTime` has different semantics depending on the source:

- **Switchboard**: Unix timestamp in seconds (`latestConfirmedRound.roundOpenTimestamp`).
- **Pyth**: Slot number (`agg.pub_slot`). To convert to approximate wall-clock time, multiply the slot number by the average slot duration (~0.4 seconds on Solana mainnet) and add the genesis timestamp.

---

## Error Handling

Both `getSwitchboardPrice` and `getPythPrice` throw descriptive errors:

| Condition | Error |
|-----------|-------|
| Feed account does not exist | `"Switchboard feed account not found: <address>"` |
| Account data too short | `"Switchboard feed account too small: expected >= N bytes, got M"` |
| Pyth magic number mismatch | `"Invalid Pyth magic number: expected 0xa1b2c3e4, got 0x..."` |
| Pyth account does not exist | `"Pyth price account not found: <address>"` |
| `pegPrice === 0` in `checkPegDeviation` | `"pegPrice must not be zero"` |

```typescript
try {
  const price = await oracle.getPythPrice(feedAddress);
  // ...
} catch (err) {
  if (err instanceof Error) {
    console.error("Oracle read failed:", err.message);
    // Implement fallback: use cached price, use other provider, halt minting, etc.
  }
}
```

---

## Implementation Notes

### No Oracle SDK Dependency

The `OracleModule` parses account data directly using documented byte offsets. This avoids adding `@switchboard-xyz/solana.js` or `@pythnetwork/client` as production dependencies. The tradeoff is that if Switchboard or Pyth change their on-chain account layouts, the parser offsets must be updated.

The relevant offsets are documented in `oracle.ts` as named constants:

```typescript
// Switchboard V2 AggregatorAccountData offsets
const SB_EXPONENT_OFFSET  = 93;   // i32
const SB_MANTISSA_OFFSET  = 97;   // i128
const SB_TIMESTAMP_OFFSET = 185;  // i64

// Pyth price account offsets
const PYTH_MAGIC_OFFSET    = 0;   // u32 — must equal 0xa1b2c3e4
const PYTH_EXP_OFFSET      = 20;  // i32
const PYTH_PRICE_OFFSET    = 208; // i64 aggregate price
const PYTH_CONF_OFFSET     = 216; // u64 aggregate confidence
const PYTH_PUBSLOT_OFFSET  = 228; // i64 publish slot
```

### Staleness Checks

The `OracleModule` does not automatically reject stale prices. Callers should compare `publishTime` against the current time and reject prices that are too old for their use case.

```typescript
const MAX_STALENESS_SECONDS = 60;

const price = await oracle.getSwitchboardPrice(feedAddress);
const ageSeconds = Math.floor(Date.now() / 1000) - price.publishTime;

if (ageSeconds > MAX_STALENESS_SECONDS) {
  throw new Error(
    `Oracle price is stale: last updated ${ageSeconds}s ago ` +
    `(max allowed: ${MAX_STALENESS_SECONDS}s)`
  );
}
```

For Pyth feeds, `publishTime` is a slot number rather than a Unix timestamp. Use the slot age from `connection.getSlot()` to check staleness:

```typescript
const price = await oracle.getPythPrice(feedAddress);
const currentSlot = await connection.getSlot();
const slotAge = currentSlot - price.publishTime;
const MAX_SLOT_AGE = 150; // ~60 seconds at 0.4s/slot

if (slotAge > MAX_SLOT_AGE) {
  throw new Error(`Pyth price is stale: ${slotAge} slots old`);
}
```
