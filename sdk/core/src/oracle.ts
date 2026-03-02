/**
 * Oracle Integration Module
 *
 * Reads price data from Switchboard V2 aggregator feeds and Pyth price accounts
 * via raw on-chain account data parsing. No oracle-specific SDK dependencies are
 * required — only @solana/web3.js.
 *
 * Usage:
 *   const oracle = new OracleModule(connection);
 *   const price  = await oracle.getSwitchboardPrice(feedPubkey);
 *   const ok     = oracle.checkPegDeviation(price.price, 1.0, 50); // 50 bps
 */

import { Connection, PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Normalised price record returned by both oracle adapters. */
export interface OraclePrice {
  /** Human-readable price value (already scaled by exponent). */
  price: number;
  /** 1-sigma confidence interval around price (already scaled). */
  confidence: number;
  /** Raw exponent used to scale the integer mantissa from the feed. */
  exponent: number;
  /** Unix timestamp (seconds) when the price was last published. */
  publishTime: number;
  /** Which oracle network produced this price. */
  source: "switchboard" | "pyth";
}

/** Well-known feed addresses grouped by trading pair. */
export interface WellKnownFeeds {
  "SOL/USD": { switchboard?: string; pyth?: string };
  "BTC/USD": { switchboard?: string; pyth?: string };
  "ETH/USD": { switchboard?: string; pyth?: string };
  "USDC/USD": { switchboard?: string; pyth?: string };
}

// ---------------------------------------------------------------------------
// Well-Known Feed Address Constants
// ---------------------------------------------------------------------------

/**
 * Devnet feed addresses for common trading pairs.
 *
 * Pyth devnet uses a separate key-store; always verify against the official
 * Pyth documentation before using in production.
 */
export const WELL_KNOWN_DEVNET_FEEDS: WellKnownFeeds = {
  "SOL/USD": {
    // Pyth devnet SOL/USD price account
    pyth: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  },
  "BTC/USD": {
    pyth: "HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J",
  },
  "ETH/USD": {
    pyth: "EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw",
  },
  "USDC/USD": {
    pyth: "5SSkXsEKQepHHAewytPVwdej4epN1nxgLVM84L4KXgy7",
  },
};

/**
 * Mainnet-beta feed addresses for common trading pairs.
 *
 * Switchboard mainnet feeds: https://app.switchboard.xyz/solana/mainnet-beta
 * Pyth mainnet feeds: https://pyth.network/price-feeds
 */
export const WELL_KNOWN_MAINNET_FEEDS: WellKnownFeeds = {
  "SOL/USD": {
    // Switchboard V2 SOL/USD mainnet aggregator
    switchboard: "GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR",
    // Pyth mainnet SOL/USD price account
    pyth: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  },
  "BTC/USD": {
    switchboard: "8SXvChNYFhRq4EZuZvnhjrB3jJRQCv4k3P4W6hesH3Ee",
    pyth: "GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU",
  },
  "ETH/USD": {
    switchboard: "HNStfhaLnqwF2ZtJUizaA9uHDAVB976r2AgTavyeqQrt",
    pyth: "JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB",
  },
  "USDC/USD": {
    switchboard: "BjUgj6YCnFBZ49wF54ddBVA9qu8TeqkFtkbqmZcee8uW",
    pyth: "Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD",
  },
};

// ---------------------------------------------------------------------------
// Internal layout helpers
// ---------------------------------------------------------------------------

/**
 * Read an i128 value stored as two consecutive i64 LE words starting at
 * `offset` in `data`.  JavaScript cannot represent all i128 values in a
 * standard 64-bit float, so we reconstruct it as a BigInt and then convert
 * to number for the price (precision loss is acceptable for price data).
 */
function readI128LE(data: Buffer, offset: number): bigint {
  // i128 = 16 bytes, little-endian.  Read low 8 bytes and high 8 bytes.
  const lo = data.readBigInt64LE(offset);       // lower 64 bits (signed)
  const hi = data.readBigInt64LE(offset + 8);   // upper 64 bits (signed)
  // Reconstruct: value = hi * 2^64 + lo (treat lo as unsigned contribution)
  const loUnsigned = data.readBigUInt64LE(offset);
  return hi * (BigInt(1) << BigInt(64)) + loUnsigned;
}

/**
 * Read a signed 64-bit integer (i64) little-endian at `offset`.
 */
function readI64LE(data: Buffer, offset: number): bigint {
  return data.readBigInt64LE(offset);
}

/**
 * Read an unsigned 64-bit integer (u64) little-endian at `offset`.
 */
function readU64LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

/**
 * Read a signed 32-bit integer (i32) little-endian at `offset`.
 */
function readI32LE(data: Buffer, offset: number): number {
  return data.readInt32LE(offset);
}

/**
 * Read an unsigned 32-bit integer (u32) little-endian at `offset`.
 */
function readU32LE(data: Buffer, offset: number): number {
  return data.readUInt32LE(offset);
}

// ---------------------------------------------------------------------------
// Switchboard V2 aggregator layout
// ---------------------------------------------------------------------------
//
// The full on-chain AggregatorAccountData layout is defined in the
// Switchboard V2 SDK.  The fields we consume are:
//
//   Offset  Size  Type   Field
//   ------  ----  ----   -----
//     0      8    u8[8]  discriminator
//     8     32    pubkey name (padded)  — actually stored as [u8;32]
//    …many fixed-size fields…
//    93      4    i32    latestConfirmedRound.result.mantissa exponent
//    97     16    i128   latestConfirmedRound.result.mantissa value
//   185      8    i64    latestConfirmedRound.roundOpenTimestamp
//
// NOTE: These offsets were verified against the Switchboard V2 anchor IDL
// (switchboard-v2 v0.3.x).  If the Switchboard team changes the layout in a
// future version, this parser must be updated accordingly.

const SB_EXPONENT_OFFSET = 93;
const SB_MANTISSA_OFFSET = 97;
const SB_TIMESTAMP_OFFSET = 185;

// ---------------------------------------------------------------------------
// Pyth price account layout
// ---------------------------------------------------------------------------
//
// Pyth uses a compact, non-Anchor layout documented in:
// https://docs.pyth.network/documentation/pythnet-price-feeds/account-structure
//
//   Offset  Size  Type   Field
//   ------  ----  ----   -----
//     0      4    u32    magic   (0xa1b2c3e4)
//     4      4    u32    ver
//     8      4    u32    atype   (1 = price)
//    12      4    u32    size
//    16      4    i32    ptype   (price component type)
//    20      4    i32    exponent
//    24      4    u32    num_component_prices
//    28      4    u32    num_quoters
//    32      8    i64    last_slot
//    40      8    i64    valid_slot
//   208      8    i64    agg.price
//   216      8    u64    agg.conf
//   224      4    i32    agg.status  (1 = TRADING)
//   228      8    i64    agg.pub_slot (or corp_act_status + pub_slot)
//
// The exponent field at offset 20 applies to BOTH price and confidence.

const PYTH_MAGIC = 0xa1b2c3e4;
const PYTH_MAGIC_OFFSET = 0;
const PYTH_PRICE_OFFSET = 208;
const PYTH_CONF_OFFSET = 216;
const PYTH_EXP_OFFSET = 20;
const PYTH_PUBSLOT_OFFSET = 228;

// ---------------------------------------------------------------------------
// OracleModule
// ---------------------------------------------------------------------------

/** Reads live price data from Switchboard V2 and Pyth oracle feeds. */
export class OracleModule {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  // -------------------------------------------------------------------------
  // Switchboard V2
  // -------------------------------------------------------------------------

  /**
   * Fetch and parse a Switchboard V2 AggregatorAccountData price feed.
   *
   * @param feedAddress - The on-chain aggregator account address.
   * @returns Decoded OraclePrice with source = 'switchboard'.
   * @throws If the account does not exist or has insufficient data.
   */
  async getSwitchboardPrice(feedAddress: PublicKey): Promise<OraclePrice> {
    const accountInfo = await this.connection.getAccountInfo(feedAddress);
    if (!accountInfo) {
      throw new Error(
        `Switchboard feed account not found: ${feedAddress.toBase58()}`
      );
    }

    const data = Buffer.from(accountInfo.data);
    const minSize = SB_TIMESTAMP_OFFSET + 8;
    if (data.length < minSize) {
      throw new Error(
        `Switchboard feed account too small: expected >= ${minSize} bytes, ` +
          `got ${data.length}`
      );
    }

    // Exponent (i32 LE at offset 93)
    const exponent = readI32LE(data, SB_EXPONENT_OFFSET);

    // Mantissa (i128 LE at offset 97) — converted to Number for practical use
    const mantissaBig = readI128LE(data, SB_MANTISSA_OFFSET);
    const mantissa = Number(mantissaBig);

    // Scale the raw mantissa by 10^exponent to obtain the human-readable price.
    // Switchboard uses a negative exponent convention (like Pyth), meaning
    // price = mantissa * 10^exponent.
    const price = mantissa * Math.pow(10, exponent);

    // Switchboard V2 does not expose a separate confidence value in the
    // aggregator result struct; use 0 to signal "not available".
    const confidence = 0;

    // Timestamp (i64 LE at offset 185) — Unix seconds
    const publishTime = Number(readI64LE(data, SB_TIMESTAMP_OFFSET));

    return { price, confidence, exponent, publishTime, source: "switchboard" };
  }

  // -------------------------------------------------------------------------
  // Pyth
  // -------------------------------------------------------------------------

  /**
   * Fetch and parse a Pyth price account.
   *
   * @param feedAddress - The on-chain Pyth price account address.
   * @returns Decoded OraclePrice with source = 'pyth'.
   * @throws If the account does not exist, is too small, or fails the magic
   *         number check.
   */
  async getPythPrice(feedAddress: PublicKey): Promise<OraclePrice> {
    const accountInfo = await this.connection.getAccountInfo(feedAddress);
    if (!accountInfo) {
      throw new Error(
        `Pyth price account not found: ${feedAddress.toBase58()}`
      );
    }

    const data = Buffer.from(accountInfo.data);
    const minSize = PYTH_PUBSLOT_OFFSET + 8;
    if (data.length < minSize) {
      throw new Error(
        `Pyth price account too small: expected >= ${minSize} bytes, ` +
          `got ${data.length}`
      );
    }

    // Magic number validation (u32 LE at offset 0)
    const magic = readU32LE(data, PYTH_MAGIC_OFFSET);
    if (magic !== PYTH_MAGIC) {
      throw new Error(
        `Invalid Pyth magic number: expected 0x${PYTH_MAGIC.toString(16)}, ` +
          `got 0x${magic.toString(16)}`
      );
    }

    // Exponent (i32 LE at offset 20) — applies to both price and confidence
    const exponent = readI32LE(data, PYTH_EXP_OFFSET);

    // Aggregate price (i64 LE at offset 208)
    const rawPrice = Number(readI64LE(data, PYTH_PRICE_OFFSET));

    // Aggregate confidence (u64 LE at offset 216)
    const rawConf = Number(readU64LE(data, PYTH_CONF_OFFSET));

    // Scale by exponent: price = rawPrice * 10^exponent
    const scale = Math.pow(10, exponent);
    const price = rawPrice * scale;
    const confidence = rawConf * scale;

    // Publish slot / timestamp (i64 LE at offset 228).
    // Pyth stores a slot number here, not a Unix timestamp. We return it as-is
    // so callers can convert with known slot durations if needed.
    const publishTime = Number(readI64LE(data, PYTH_PUBSLOT_OFFSET));

    return { price, confidence, exponent, publishTime, source: "pyth" };
  }

  // -------------------------------------------------------------------------
  // Peg Deviation Check
  // -------------------------------------------------------------------------

  /**
   * Check whether a current price is within an acceptable deviation from the
   * peg price.
   *
   * @param currentPrice    - The live price obtained from an oracle.
   * @param pegPrice        - The target peg price (e.g. 1.0 for a USD stablecoin).
   * @param maxDeviationBps - Maximum allowed deviation in basis points (1 bps = 0.01%).
   * @returns `true` if the price is within the allowed band, `false` otherwise.
   *
   * @example
   * // Allow ±50 bps (0.5%) deviation from the $1.00 USD peg
   * oracle.checkPegDeviation(0.998, 1.0, 50); // true  — 0.2% deviation
   * oracle.checkPegDeviation(0.990, 1.0, 50); // false — 1.0% deviation
   */
  checkPegDeviation(
    currentPrice: number,
    pegPrice: number,
    maxDeviationBps: number
  ): boolean {
    if (pegPrice === 0) {
      throw new Error("pegPrice must not be zero");
    }
    const deviationBps =
      (Math.abs(currentPrice - pegPrice) / pegPrice) * 10_000;
    return deviationBps <= maxDeviationBps;
  }

  // -------------------------------------------------------------------------
  // Well-Known Feeds
  // -------------------------------------------------------------------------

  /**
   * Return a snapshot of well-known devnet feed addresses for common pairs.
   *
   * These addresses are baked into the library for convenience. Always confirm
   * them against the official Pyth and Switchboard dashboards before using in
   * a production deployment.
   */
  getWellKnownFeeds(): WellKnownFeeds {
    // Return devnet feeds by default; callers needing mainnet addresses should
    // reference the exported WELL_KNOWN_MAINNET_FEEDS constant directly.
    return WELL_KNOWN_DEVNET_FEEDS;
  }
}
