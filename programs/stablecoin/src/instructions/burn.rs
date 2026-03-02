use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::error::StablecoinError;
use crate::events::TokensBurned;
use crate::state::*;

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    /// The token holder burning their own tokens.
    pub burner: Signer<'info>,

    /// The stablecoin configuration.
    #[account(
        mut,
        seeds = [StablecoinConfig::SEED_PREFIX, mint.key().as_ref()],
        bump = config.bump,
        constraint = !config.is_paused @ StablecoinError::Paused,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The stablecoin mint.
    #[account(
        mut,
        address = config.mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The burner's token account.
    #[account(
        mut,
        token::mint = mint,
        token::authority = burner,
        token::token_program = token_program,
    )]
    pub burner_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::InvalidAmount);

    let config = &mut ctx.accounts.config;
    config.total_burned = config
        .total_burned
        .checked_add(amount)
        .ok_or(StablecoinError::Overflow)?;

    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.burner_token_account.to_account_info(),
                authority: ctx.accounts.burner.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(TokensBurned {
        config: config.key(),
        burner: ctx.accounts.burner.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
