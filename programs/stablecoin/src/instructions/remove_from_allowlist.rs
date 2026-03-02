use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::RemovedFromAllowlist;
use crate::state::*;

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct RemoveFromAllowlist<'info> {
    /// Receives rent from closing the allowlist entry.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The blacklister authority (manages both blacklist and allowlist).
    pub blacklister: Signer<'info>,

    /// Role configuration — validates the blacklister role.
    #[account(
        seeds = [RoleConfig::SEED_PREFIX, config.key().as_ref()],
        bump = roles.bump,
        constraint = roles.blacklister == blacklister.key() @ StablecoinError::Unauthorized,
    )]
    pub roles: Account<'info, RoleConfig>,

    /// The stablecoin configuration.
    #[account(
        seeds = [StablecoinConfig::SEED_PREFIX, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_privacy_enabled() @ StablecoinError::AllowlistNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The allowlist entry PDA — closing it removes the address from the allowlist.
    #[account(
        mut,
        close = payer,
        seeds = [AllowlistEntry::SEED_PREFIX, config.key().as_ref(), address.as_ref()],
        bump = allowlist_entry.bump,
        constraint = allowlist_entry.address == address @ StablecoinError::NotOnAllowlist,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,
}

pub fn handler(ctx: Context<RemoveFromAllowlist>, address: Pubkey) -> Result<()> {
    emit!(RemovedFromAllowlist {
        config: ctx.accounts.config.key(),
        address,
        removed_by: ctx.accounts.blacklister.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
