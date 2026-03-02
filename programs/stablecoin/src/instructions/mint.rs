use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

use crate::error::StablecoinError;
use crate::events::TokensMinted;
use crate::state::*;

#[derive(Accounts)]
pub struct MintTokens<'info> {
    /// The minter executing this mint operation.
    pub minter: Signer<'info>,

    /// The minter's configuration PDA — tracks quota usage.
    #[account(
        mut,
        seeds = [MinterConfig::SEED_PREFIX, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_config.bump,
        constraint = minter_config.stablecoin_config == config.key() @ StablecoinError::Unauthorized,
    )]
    pub minter_config: Account<'info, MinterConfig>,

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

    /// Recipient's token account.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::InvalidAmount);

    let minter_config = &mut ctx.accounts.minter_config;
    require!(minter_config.active, StablecoinError::MinterNotActive);
    require!(
        minter_config.remaining_quota() >= amount,
        StablecoinError::MinterQuotaExceeded
    );

    // Update minter tracking.
    minter_config.minted = minter_config
        .minted
        .checked_add(amount)
        .ok_or(StablecoinError::Overflow)?;

    // CPI: mint tokens using config PDA as mint authority.
    let mint_key = ctx.accounts.mint.key();
    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        StablecoinConfig::SEED_PREFIX,
        mint_key.as_ref(),
        &[config_bump],
    ]];

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Update global tracking.
    let config = &mut ctx.accounts.config;
    config.total_minted = config
        .total_minted
        .checked_add(amount)
        .ok_or(StablecoinError::Overflow)?;

    emit!(TokensMinted {
        config: config.key(),
        minter: ctx.accounts.minter.key(),
        recipient: ctx.accounts.recipient_token_account.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
