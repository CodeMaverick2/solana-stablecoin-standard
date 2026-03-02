/// accounts_snapshots.rs
///
/// Snapshot structs capturing on-chain state before and after each fuzz
/// instruction. Trident uses these to supply account data to invariant
/// check functions without requiring another RPC round-trip.

use anchor_lang::prelude::Pubkey;
use trident_client::fuzzing::*;

// ---------------------------------------------------------------------------
// StablecoinConfig snapshot
// ---------------------------------------------------------------------------

/// A plain-data snapshot of the `StablecoinConfig` on-chain account.
///
/// Fields mirror the Rust struct in `programs/stablecoin/src/state.rs`.
/// We keep only the fields that invariant checks actually inspect; the
/// reserved bytes are intentionally omitted.
#[derive(Clone, Debug, Default)]
pub struct StablecoinConfigSnapshot {
    /// Master authority pubkey.
    pub master_authority: Pubkey,
    /// The Token-2022 mint address.
    pub mint: Pubkey,
    /// Decimal places (0–9).
    pub decimals: u8,
    /// Whether permanent-delegate extension is enabled (SSS-2).
    pub enable_permanent_delegate: bool,
    /// Whether the transfer-hook extension is enabled (SSS-2 / SSS-3).
    pub enable_transfer_hook: bool,
    /// Whether confidential-transfer extension is enabled (SSS-3).
    pub enable_confidential_transfer: bool,
    /// Whether allowlist mode is enabled (SSS-3).
    pub enable_allowlist: bool,
    /// True while the stablecoin is globally paused.
    pub is_paused: bool,
    /// Cumulative tokens minted across all minters (raw u64, scaled by decimals).
    pub total_minted: u64,
    /// Cumulative tokens burned.
    pub total_burned: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl StablecoinConfigSnapshot {
    /// Deserialize from the raw account data bytes produced by Anchor.
    ///
    /// Layout (after the 8-byte discriminator):
    ///   master_authority (32) | pending_authority (32) | mint (32) |
    ///   decimals (1) | enable_permanent_delegate (1) | enable_transfer_hook (1) |
    ///   is_paused (1) | total_minted (8) | total_burned (8) | bump (1) |
    ///   enable_confidential_transfer (1) | enable_allowlist (1) | _reserved (126)
    pub fn from_account_data(data: &[u8]) -> Option<Self> {
        // Must have at least discriminator (8) + fixed fields
        if data.len() < 8 + 32 + 32 + 32 + 1 + 1 + 1 + 1 + 8 + 8 + 1 + 1 + 1 {
            return None;
        }

        let mut offset = 8; // skip discriminator

        let master_authority = Pubkey::try_from(&data[offset..offset + 32]).ok()?;
        offset += 32;

        offset += 32; // skip pending_authority

        let mint = Pubkey::try_from(&data[offset..offset + 32]).ok()?;
        offset += 32;

        let decimals = data[offset];
        offset += 1;

        let enable_permanent_delegate = data[offset] != 0;
        offset += 1;

        let enable_transfer_hook = data[offset] != 0;
        offset += 1;

        let is_paused = data[offset] != 0;
        offset += 1;

        let total_minted = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let total_burned = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let bump = data[offset];
        offset += 1;

        let enable_confidential_transfer = data[offset] != 0;
        offset += 1;

        let enable_allowlist = data[offset] != 0;

        Some(Self {
            master_authority,
            mint,
            decimals,
            enable_permanent_delegate,
            enable_transfer_hook,
            enable_confidential_transfer,
            enable_allowlist,
            is_paused,
            total_minted,
            total_burned,
            bump,
        })
    }

    /// Circulating supply implied by the config counters.
    ///
    /// Returns `None` on underflow (total_burned > total_minted), which should
    /// never happen on a correctly operating program and would itself be an
    /// invariant violation.
    pub fn circulating(&self) -> Option<u64> {
        self.total_minted.checked_sub(self.total_burned)
    }
}

// ---------------------------------------------------------------------------
// MinterConfig snapshot
// ---------------------------------------------------------------------------

/// A plain-data snapshot of the `MinterConfig` on-chain account.
///
/// Layout (after 8-byte discriminator):
///   minter (32) | stablecoin_config (32) | quota (8) | minted (8) |
///   active (1) | bump (1)
#[derive(Clone, Debug, Default)]
pub struct MinterConfigSnapshot {
    /// The minter's public key.
    pub minter: Pubkey,
    /// The config PDA this minter belongs to.
    pub stablecoin_config: Pubkey,
    /// Maximum tokens this minter may mint (raw u64).
    pub quota: u64,
    /// Tokens already minted by this minter (raw u64).
    pub minted: u64,
    /// Whether this minter is currently active.
    pub active: bool,
    /// PDA bump seed.
    pub bump: u8,
}

impl MinterConfigSnapshot {
    /// Deserialize from raw account data bytes.
    pub fn from_account_data(data: &[u8]) -> Option<Self> {
        // discriminator(8) + minter(32) + config(32) + quota(8) + minted(8) + active(1) + bump(1)
        if data.len() < 8 + 32 + 32 + 8 + 8 + 1 + 1 {
            return None;
        }

        let mut offset = 8; // skip discriminator

        let minter = Pubkey::try_from(&data[offset..offset + 32]).ok()?;
        offset += 32;

        let stablecoin_config = Pubkey::try_from(&data[offset..offset + 32]).ok()?;
        offset += 32;

        let quota = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let minted = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let active = data[offset] != 0;
        offset += 1;

        let bump = data[offset];

        Some(Self {
            minter,
            stablecoin_config,
            quota,
            minted,
            active,
            bump,
        })
    }

    /// Remaining mintable quota for this minter.
    pub fn remaining_quota(&self) -> u64 {
        self.quota.saturating_sub(self.minted)
    }

    /// True if the minter has exceeded its quota (should never occur).
    pub fn quota_exceeded(&self) -> bool {
        self.minted > self.quota
    }
}

// ---------------------------------------------------------------------------
// Snapshot pair helper
// ---------------------------------------------------------------------------

/// Holds a before/after pair of snapshots for a single instruction execution.
///
/// Invariant-check functions receive this struct so they can compare state
/// transitions.
#[derive(Debug)]
pub struct InstructionSnapshot {
    pub config_before: Option<StablecoinConfigSnapshot>,
    pub config_after: Option<StablecoinConfigSnapshot>,
    pub minter_before: Option<MinterConfigSnapshot>,
    pub minter_after: Option<MinterConfigSnapshot>,
}

impl InstructionSnapshot {
    pub fn new(
        config_before: Option<StablecoinConfigSnapshot>,
        config_after: Option<StablecoinConfigSnapshot>,
        minter_before: Option<MinterConfigSnapshot>,
        minter_after: Option<MinterConfigSnapshot>,
    ) -> Self {
        Self {
            config_before,
            config_after,
            minter_before,
            minter_after,
        }
    }
}
