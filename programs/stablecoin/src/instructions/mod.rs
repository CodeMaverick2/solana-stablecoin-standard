pub mod initialize;
pub mod mint;
pub mod burn;
pub mod freeze_account;
pub mod thaw_account;
pub mod pause;
pub mod unpause;
pub mod update_minter;
pub mod update_roles;
pub mod transfer_authority;
pub mod add_to_blacklist;
pub mod remove_from_blacklist;
pub mod seize;
pub mod add_to_allowlist;
pub mod remove_from_allowlist;

// Re-export all Accounts context structs and param types so lib.rs can reference
// them via `use instructions::*`. The `handler` name appears in every module but
// is only ever called with a fully-qualified path (instructions::xyz::handler),
// so the glob collision is intentional and safe.
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use mint::*;
pub use burn::*;
pub use freeze_account::*;
pub use thaw_account::*;
pub use pause::*;
pub use unpause::*;
pub use update_minter::*;
pub use update_roles::*;
pub use transfer_authority::*;
pub use add_to_blacklist::*;
pub use remove_from_blacklist::*;
pub use seize::*;
pub use add_to_allowlist::*;
pub use remove_from_allowlist::*;
