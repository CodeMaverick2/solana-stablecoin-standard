use anchor_lang::prelude::*;

/// Mirrors the StablecoinConfig from the stablecoin program to read its is_paused field.
/// We only need to read the fields up to is_paused for the transfer hook check.
/// Layout must match the stablecoin program's StablecoinConfig exactly.
#[account]
pub struct StablecoinConfigRef {
    pub master_authority: Pubkey,
    pub pending_authority: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
    pub is_paused: bool,
}
