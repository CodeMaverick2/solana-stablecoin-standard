use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::RemovedFromBlacklist;
use crate::state::*;

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct RemoveFromBlacklist<'info> {
    /// Receives rent from closing the blacklist entry.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The blacklister authority.
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
        constraint = config.is_compliance_enabled() @ StablecoinError::ComplianceNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The blacklist entry PDA — closing it removes the address from the blacklist.
    #[account(
        mut,
        close = payer,
        seeds = [BlacklistEntry::SEED_PREFIX, config.key().as_ref(), address.as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.address == address @ StablecoinError::NotBlacklisted,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
}

pub fn handler(ctx: Context<RemoveFromBlacklist>, address: Pubkey) -> Result<()> {
    emit!(RemovedFromBlacklist {
        config: ctx.accounts.config.key(),
        address,
        removed_by: ctx.accounts.blacklister.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
