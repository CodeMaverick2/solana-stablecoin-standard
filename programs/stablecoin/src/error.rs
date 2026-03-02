use anchor_lang::prelude::*;

#[error_code]
pub enum StablecoinError {
    #[msg("Unauthorized: caller does not have the required role")]
    Unauthorized,

    #[msg("Stablecoin operations are currently paused")]
    Paused,

    #[msg("Stablecoin is not currently paused")]
    NotPaused,

    #[msg("Amount must be greater than zero")]
    InvalidAmount,

    #[msg("Minter quota exceeded")]
    MinterQuotaExceeded,

    #[msg("Minter is not active")]
    MinterNotActive,

    #[msg("Address is already blacklisted")]
    AlreadyBlacklisted,

    #[msg("Address is not blacklisted")]
    NotBlacklisted,

    #[msg("Compliance features are not enabled on this stablecoin")]
    ComplianceNotEnabled,

    #[msg("Transfer hook is not enabled on this stablecoin")]
    TransferHookNotEnabled,

    #[msg("Invalid decimals: must be between 0 and 9")]
    InvalidDecimals,

    #[msg("Name exceeds maximum length")]
    NameTooLong,

    #[msg("Symbol exceeds maximum length")]
    SymbolTooLong,

    #[msg("URI exceeds maximum length")]
    UriTooLong,

    #[msg("Blacklist reason exceeds maximum length")]
    ReasonTooLong,

    #[msg("An authority transfer is already pending")]
    AuthorityTransferPending,

    #[msg("No authority transfer is pending")]
    NoAuthorityTransferPending,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Invalid configuration: permanent delegate requires transfer hook")]
    InvalidConfig,

    #[msg("Allowlist features are not enabled on this stablecoin")]
    AllowlistNotEnabled,

    #[msg("Address is already on the allowlist")]
    AlreadyOnAllowlist,

    #[msg("Address is not on the allowlist")]
    NotOnAllowlist,
}
