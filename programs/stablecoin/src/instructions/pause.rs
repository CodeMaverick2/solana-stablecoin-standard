use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::StablecoinPaused;
use crate::state::*;

#[derive(Accounts)]
pub struct Pause<'info> {
    /// The pauser authority.
    pub pauser: Signer<'info>,

    /// Role configuration — validates the pauser role.
    #[account(
        seeds = [RoleConfig::SEED_PREFIX, config.key().as_ref()],
        bump = roles.bump,
        constraint = roles.pauser == pauser.key() @ StablecoinError::Unauthorized,
    )]
    pub roles: Account<'info, RoleConfig>,

    /// The stablecoin configuration.
    #[account(
        mut,
        seeds = [StablecoinConfig::SEED_PREFIX, config.mint.as_ref()],
        bump = config.bump,
        constraint = !config.is_paused @ StablecoinError::Paused,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,
}

pub fn handler(ctx: Context<Pause>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.is_paused = true;

    emit!(StablecoinPaused {
        config: config.key(),
        paused_by: ctx.accounts.pauser.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
