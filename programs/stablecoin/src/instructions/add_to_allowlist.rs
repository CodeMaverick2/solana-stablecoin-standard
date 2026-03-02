use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::AddedToAllowlist;
use crate::state::*;

#[derive(Accounts)]
#[instruction(address: Pubkey, reason: String)]
pub struct AddToAllowlist<'info> {
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

    /// The allowlist entry PDA — existence means the address is allowed.
    #[account(
        init,
        payer = payer,
        space = AllowlistEntry::LEN,
        seeds = [AllowlistEntry::SEED_PREFIX, config.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddToAllowlist>, address: Pubkey, reason: String) -> Result<()> {
    require!(reason.len() <= crate::constants::MAX_REASON_LEN, StablecoinError::ReasonTooLong);

    let entry = &mut ctx.accounts.allowlist_entry;
    entry.stablecoin_config = ctx.accounts.config.key();
    entry.address = address;
    entry.reason = reason.clone();
    entry.allowlisted_at = Clock::get()?.unix_timestamp;
    entry.allowlisted_by = ctx.accounts.blacklister.key();
    entry.bump = ctx.bumps.allowlist_entry;

    emit!(AddedToAllowlist {
        config: ctx.accounts.config.key(),
        address,
        reason,
        allowlisted_by: ctx.accounts.blacklister.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
