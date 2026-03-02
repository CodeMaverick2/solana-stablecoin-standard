/// PDA seed for the stablecoin configuration account.
pub const CONFIG_SEED: &[u8] = b"stablecoin_config";

/// PDA seed for the stablecoin mint account.
pub const MINT_SEED: &[u8] = b"stablecoin_mint";

/// PDA seed for per-minter configuration accounts.
pub const MINTER_SEED: &[u8] = b"minter";

/// PDA seed for the role configuration account.
pub const ROLES_SEED: &[u8] = b"roles";

/// PDA seed for blacklist entry accounts (SSS-2).
pub const BLACKLIST_SEED: &[u8] = b"blacklist";

/// PDA seed for allowlist entry accounts (SSS-3).
pub const ALLOWLIST_SEED: &[u8] = b"allowlist";

/// Maximum length for stablecoin name.
pub const MAX_NAME_LEN: usize = 32;

/// Maximum length for stablecoin symbol.
pub const MAX_SYMBOL_LEN: usize = 10;

/// Maximum length for metadata URI.
pub const MAX_URI_LEN: usize = 200;

/// Maximum length for blacklist reason string.
pub const MAX_REASON_LEN: usize = 128;

/// Default decimal places for stablecoin (matches USDC).
pub const DEFAULT_DECIMALS: u8 = 6;

/// Maximum allowed decimal places.
pub const MAX_DECIMALS: u8 = 9;
