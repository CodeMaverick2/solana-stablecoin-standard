use anchor_lang::prelude::*;

#[error_code]
pub enum TransferHookError {
    #[msg("Sender is blacklisted")]
    SenderBlacklisted,

    #[msg("Recipient is blacklisted")]
    RecipientBlacklisted,

    #[msg("Stablecoin is currently paused")]
    StablecoinPaused,

    #[msg("The token is not currently being transferred")]
    IsNotCurrentlyTransferring,

    #[msg("Sender is not on the allowlist")]
    SenderNotOnAllowlist,

    #[msg("Recipient is not on the allowlist")]
    RecipientNotOnAllowlist,
}
