use anchor_lang::prelude::*;

use crate::error::StablecoinError;
use crate::events::MinterUpdated;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateMinterParams {
    pub quota: u64,
    pub active: bool,
}

#[derive(Accounts)]
#[instruction(minter_pubkey: Pubkey)]
pub struct UpdateMinter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The master authority.
    pub authority: Signer<'info>,

    /// The stablecoin configuration.
    #[account(
        seeds = [StablecoinConfig::SEED_PREFIX, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The minter configuration PDA — created if it doesn't exist.
    #[account(
        init_if_needed,
        payer = payer,
        space = MinterConfig::LEN,
        seeds = [MinterConfig::SEED_PREFIX, config.key().as_ref(), minter_pubkey.as_ref()],
        bump,
    )]
    pub minter_config: Account<'info, MinterConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpdateMinter>,
    minter_pubkey: Pubkey,
    params: UpdateMinterParams,
) -> Result<()> {
    let minter_config = &mut ctx.accounts.minter_config;

    // If this is a new minter, initialize identity fields.
    if minter_config.minter == Pubkey::default() {
        minter_config.minter = minter_pubkey;
        minter_config.stablecoin_config = ctx.accounts.config.key();
        minter_config.minted = 0;
        minter_config.bump = ctx.bumps.minter_config;
    }

    minter_config.quota = params.quota;
    minter_config.active = params.active;

    emit!(MinterUpdated {
        config: ctx.accounts.config.key(),
        minter: minter_pubkey,
        quota: params.quota,
        active: params.active,
        updated_by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
