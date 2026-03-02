use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::{AuthorityTransferCompleted, AuthorityTransferInitiated};
use crate::state::*;

/// Initiates a two-step authority transfer by setting pending_authority.
#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    /// Current master authority.
    pub authority: Signer<'info>,

    /// The stablecoin configuration.
    #[account(
        mut,
        seeds = [StablecoinConfig::SEED_PREFIX, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
        constraint = !config.has_pending_transfer() @ StablecoinError::AuthorityTransferPending,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,
}

pub fn handler(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.pending_authority = new_authority;

    emit!(AuthorityTransferInitiated {
        config: config.key(),
        current_authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Accepts a pending authority transfer.
#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    /// The pending authority accepting the transfer.
    pub new_authority: Signer<'info>,

    /// The stablecoin configuration.
    #[account(
        mut,
        seeds = [StablecoinConfig::SEED_PREFIX, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.pending_authority == new_authority.key() @ StablecoinError::Unauthorized,
        constraint = config.has_pending_transfer() @ StablecoinError::NoAuthorityTransferPending,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,
}

pub fn accept_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let old_authority = config.master_authority;

    config.master_authority = ctx.accounts.new_authority.key();
    config.pending_authority = Pubkey::default();

    emit!(AuthorityTransferCompleted {
        config: config.key(),
        old_authority,
        new_authority: ctx.accounts.new_authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
