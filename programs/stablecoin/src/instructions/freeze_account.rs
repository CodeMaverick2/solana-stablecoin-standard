use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, FreezeAccount, Mint, TokenAccount, TokenInterface};

use crate::error::StablecoinError;
use crate::events::AccountFrozen;
use crate::state::*;

#[derive(Accounts)]
pub struct FreezeTokenAccount<'info> {
    /// The freezer authority.
    pub freezer: Signer<'info>,

    /// Role configuration — validates the freezer role.
    #[account(
        seeds = [RoleConfig::SEED_PREFIX, config.key().as_ref()],
        bump = roles.bump,
        constraint = roles.freezer == freezer.key() @ StablecoinError::Unauthorized,
    )]
    pub roles: Account<'info, RoleConfig>,

    /// The stablecoin configuration.
    #[account(
        seeds = [StablecoinConfig::SEED_PREFIX, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The stablecoin mint.
    #[account(
        mut,
        address = config.mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The token account to freeze.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub target_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<FreezeTokenAccount>) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        StablecoinConfig::SEED_PREFIX,
        mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ]];

    token_interface::freeze_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            FreezeAccount {
                account: ctx.accounts.target_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
    )?;

    emit!(AccountFrozen {
        config: ctx.accounts.config.key(),
        account: ctx.accounts.target_token_account.key(),
        frozen_by: ctx.accounts.freezer.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
