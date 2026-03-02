use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::AddedToBlacklist;
use crate::state::*;

#[derive(Accounts)]
#[instruction(address: Pubkey, reason: String)]
pub struct AddToBlacklist<'info> {
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

    /// The blacklist entry PDA — existence means the address is blacklisted.
    #[account(
        init,
        payer = payer,
        space = BlacklistEntry::LEN,
        seeds = [BlacklistEntry::SEED_PREFIX, config.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddToBlacklist>, address: Pubkey, reason: String) -> Result<()> {
    require!(reason.len() <= crate::constants::MAX_REASON_LEN, StablecoinError::ReasonTooLong);

    let entry = &mut ctx.accounts.blacklist_entry;
    entry.stablecoin_config = ctx.accounts.config.key();
    entry.address = address;
    entry.reason = reason.clone();
    entry.blacklisted_at = Clock::get()?.unix_timestamp;
    entry.blacklisted_by = ctx.accounts.blacklister.key();
    entry.bump = ctx.bumps.blacklist_entry;

    emit!(AddedToBlacklist {
        config: ctx.accounts.config.key(),
        address,
        reason,
        blacklisted_by: ctx.accounts.blacklister.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
