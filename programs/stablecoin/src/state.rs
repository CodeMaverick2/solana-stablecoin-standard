use anchor_lang::prelude::*;

use crate::constants::*;

/// Global configuration for a stablecoin instance.
/// Stores authorities, feature flags, and operational state.
#[account]
pub struct StablecoinConfig {
    /// Master authority — can update all roles and transfer authority.
    pub master_authority: Pubkey,
    /// Pending authority for two-step transfer. Pubkey::default() if none pending.
    pub pending_authority: Pubkey,
    /// The stablecoin Token-2022 mint address.
    pub mint: Pubkey,
    /// Decimal places for the stablecoin (typically 6).
    pub decimals: u8,
    /// Whether permanent delegate extension is enabled (SSS-2).
    pub enable_permanent_delegate: bool,
    /// Whether transfer hook extension is enabled (SSS-2).
    pub enable_transfer_hook: bool,
    /// Whether the stablecoin is globally paused.
    pub is_paused: bool,
    /// Cumulative amount minted across all minters.
    pub total_minted: u64,
    /// Cumulative amount burned.
    pub total_burned: u64,
    /// PDA bump seed.
    pub bump: u8,
    /// Whether confidential transfer extension is enabled (SSS-3).
    pub enable_confidential_transfer: bool,
    /// Whether allowlist mode is enabled (SSS-3). Inverts blacklist logic:
    /// only allowlisted addresses can send/receive.
    pub enable_allowlist: bool,
    /// Reserved for future upgrades.
    pub _reserved: [u8; 126],
}

impl StablecoinConfig {
    pub const LEN: usize = 8   // discriminator
        + 32                     // master_authority
        + 32                     // pending_authority
        + 32                     // mint
        + 1                      // decimals
        + 1                      // enable_permanent_delegate
        + 1                      // enable_transfer_hook
        + 1                      // is_paused
        + 8                      // total_minted
        + 8                      // total_burned
        + 1                      // bump
        + 1                      // enable_confidential_transfer
        + 1                      // enable_allowlist
        + 126;                   // _reserved

    pub const SEED_PREFIX: &'static [u8] = CONFIG_SEED;

    /// SSS-2 compliance: blacklist + permanent delegate + transfer hook.
    pub fn is_compliance_enabled(&self) -> bool {
        self.enable_permanent_delegate && self.enable_transfer_hook
    }

    /// SSS-3 privacy: allowlist + confidential transfers + transfer hook.
    pub fn is_privacy_enabled(&self) -> bool {
        self.enable_allowlist && self.enable_transfer_hook
    }

    pub fn has_pending_transfer(&self) -> bool {
        self.pending_authority != Pubkey::default()
    }
}

/// Per-minter configuration with quota tracking.
#[account]
pub struct MinterConfig {
    /// The minter's public key.
    pub minter: Pubkey,
    /// The stablecoin config this minter belongs to.
    pub stablecoin_config: Pubkey,
    /// Maximum amount this minter is allowed to mint.
    pub quota: u64,
    /// Amount already minted by this minter.
    pub minted: u64,
    /// Whether this minter is active.
    pub active: bool,
    /// PDA bump seed.
    pub bump: u8,
}

impl MinterConfig {
    pub const LEN: usize = 8   // discriminator
        + 32                     // minter
        + 32                     // stablecoin_config
        + 8                      // quota
        + 8                      // minted
        + 1                      // active
        + 1;                     // bump

    pub const SEED_PREFIX: &'static [u8] = MINTER_SEED;

    pub fn remaining_quota(&self) -> u64 {
        self.quota.saturating_sub(self.minted)
    }
}

/// Role assignments for operational functions.
/// Each role can be assigned to a different keypair.
#[account]
pub struct RoleConfig {
    /// The stablecoin config this role set belongs to.
    pub stablecoin_config: Pubkey,
    /// Authority that can pause/unpause the stablecoin.
    pub pauser: Pubkey,
    /// Authority that can freeze/thaw token accounts.
    pub freezer: Pubkey,
    /// Authority that can add/remove addresses from blacklist (SSS-2).
    pub blacklister: Pubkey,
    /// Authority that can seize tokens via permanent delegate (SSS-2).
    pub seizer: Pubkey,
    /// PDA bump seed.
    pub bump: u8,
}

impl RoleConfig {
    pub const LEN: usize = 8   // discriminator
        + 32                     // stablecoin_config
        + 32                     // pauser
        + 32                     // freezer
        + 32                     // blacklister
        + 32                     // seizer
        + 1;                     // bump

    pub const SEED_PREFIX: &'static [u8] = ROLES_SEED;
}

/// A blacklist entry for a specific address (SSS-2).
/// Existence of this PDA means the address is blacklisted.
#[account]
pub struct BlacklistEntry {
    /// The stablecoin config this entry belongs to.
    pub stablecoin_config: Pubkey,
    /// The blacklisted address.
    pub address: Pubkey,
    /// Reason for blacklisting (e.g., "OFAC match").
    pub reason: String,
    /// Unix timestamp when blacklisted.
    pub blacklisted_at: i64,
    /// Authority who blacklisted this address.
    pub blacklisted_by: Pubkey,
    /// PDA bump seed.
    pub bump: u8,
}

impl BlacklistEntry {
    pub const LEN: usize = 8   // discriminator
        + 32                     // stablecoin_config
        + 32                     // address
        + 4 + MAX_REASON_LEN     // reason (string prefix + max content)
        + 8                      // blacklisted_at
        + 32                     // blacklisted_by
        + 1;                     // bump

    pub const SEED_PREFIX: &'static [u8] = BLACKLIST_SEED;
}

/// An allowlist entry for a specific address (SSS-3).
/// Existence of this PDA means the address is allowed to transact.
#[account]
pub struct AllowlistEntry {
    /// The stablecoin config this entry belongs to.
    pub stablecoin_config: Pubkey,
    /// The allowlisted address.
    pub address: Pubkey,
    /// Reason for allowlisting (e.g., "KYC verified").
    pub reason: String,
    /// Unix timestamp when allowlisted.
    pub allowlisted_at: i64,
    /// Authority who allowlisted this address.
    pub allowlisted_by: Pubkey,
    /// PDA bump seed.
    pub bump: u8,
}

impl AllowlistEntry {
    pub const LEN: usize = 8   // discriminator
        + 32                     // stablecoin_config
        + 32                     // address
        + 4 + MAX_REASON_LEN     // reason (string prefix + max content)
        + 8                      // allowlisted_at
        + 32                     // allowlisted_by
        + 1;                     // bump

    pub const SEED_PREFIX: &'static [u8] = ALLOWLIST_SEED;
}
