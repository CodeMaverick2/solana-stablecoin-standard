use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");

#[program]
pub mod stablecoin {
    use super::*;

    /// Initialize a new stablecoin with Token-2022 extensions based on params.
    /// SSS-1: mint authority + freeze authority + metadata.
    /// SSS-2: SSS-1 + permanent delegate + transfer hook.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Mint new stablecoin tokens to a recipient. Requires an authorized minter with quota.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    /// Burn stablecoin tokens from the caller's own token account.
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::handler(ctx, amount)
    }

    /// Freeze a token account, preventing all transfers. Requires the freezer role.
    pub fn freeze_account(ctx: Context<FreezeTokenAccount>) -> Result<()> {
        instructions::freeze_account::handler(ctx)
    }

    /// Thaw a previously frozen token account. Requires the freezer role.
    pub fn thaw_account(ctx: Context<ThawTokenAccount>) -> Result<()> {
        instructions::thaw_account::handler(ctx)
    }

    /// Pause all stablecoin operations globally. Requires the pauser role.
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx)
    }

    /// Unpause stablecoin operations. Requires the pauser role.
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::unpause::handler(ctx)
    }

    /// Create or update a minter's configuration (quota and active status).
    /// Requires the master authority.
    pub fn update_minter(
        ctx: Context<UpdateMinter>,
        minter_pubkey: Pubkey,
        params: UpdateMinterParams,
    ) -> Result<()> {
        instructions::update_minter::handler(ctx, minter_pubkey, params)
    }

    /// Update role assignments (pauser, freezer, blacklister, seizer).
    /// Requires the master authority.
    pub fn update_roles(ctx: Context<UpdateRoles>, params: UpdateRolesParams) -> Result<()> {
        instructions::update_roles::handler(ctx, params)
    }

    /// Initiate a two-step authority transfer. Requires the current master authority.
    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::handler(ctx, new_authority)
    }

    /// Accept a pending authority transfer. Must be called by the pending authority.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::transfer_authority::accept_handler(ctx)
    }

    /// Add an address to the blacklist (SSS-2 only). Requires the blacklister role.
    pub fn add_to_blacklist(
        ctx: Context<AddToBlacklist>,
        address: Pubkey,
        reason: String,
    ) -> Result<()> {
        instructions::add_to_blacklist::handler(ctx, address, reason)
    }

    /// Remove an address from the blacklist (SSS-2 only). Requires the blacklister role.
    pub fn remove_from_blacklist(ctx: Context<RemoveFromBlacklist>, address: Pubkey) -> Result<()> {
        instructions::remove_from_blacklist::handler(ctx, address)
    }

    /// Seize tokens from an account using permanent delegate authority (SSS-2 only).
    /// Transfers tokens from the target account to a treasury account.
    /// Requires the seizer role.
    pub fn seize(ctx: Context<Seize>, amount: u64) -> Result<()> {
        instructions::seize::handler(ctx, amount)
    }

    /// Add an address to the allowlist (SSS-3 only). Requires the blacklister role.
    /// Only allowlisted addresses can send/receive tokens in allowlist mode.
    pub fn add_to_allowlist(
        ctx: Context<AddToAllowlist>,
        address: Pubkey,
        reason: String,
    ) -> Result<()> {
        instructions::add_to_allowlist::handler(ctx, address, reason)
    }

    /// Remove an address from the allowlist (SSS-3 only). Requires the blacklister role.
    pub fn remove_from_allowlist(ctx: Context<RemoveFromAllowlist>, address: Pubkey) -> Result<()> {
        instructions::remove_from_allowlist::handler(ctx, address)
    }
}
