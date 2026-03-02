# Architecture

This document describes the technical architecture of the Solana Stablecoin Standard (SSS), including program design, PDA layout, account structures, instruction flows, and security model.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [On-Chain Programs](#on-chain-programs)
3. [PDA Layout](#pda-layout)
4. [Account Structures](#account-structures)
5. [Instruction Reference](#instruction-reference)
6. [Transfer Hook Design](#transfer-hook-design)
7. [Seize Mechanism](#seize-mechanism)
8. [Security Model](#security-model)
9. [Design Decisions](#design-decisions)
10. [Event System](#event-system)

---

## System Overview

The Solana Stablecoin Standard is built on three composable layers:

```
+-------------------------------------------------------------------+
|                    Standard Presets (Layer 3)                      |
|   SSS-1 (MetadataPointer)    SSS-2 (+ PermanentDelegate + Hook)  |
+-------------------------------------------------------------------+
|                  Composable Modules (Layer 2)                     |
|   Compliance: Blacklist, Seizure, Transfer Hook Enforcement       |
+-------------------------------------------------------------------+
|                       Base SDK (Layer 1)                          |
|   Mint / Burn / Freeze / Thaw / Pause / Roles / Minter Quotas    |
+-------------------------------------------------------------------+
|                        Solana Runtime                             |
|                   Token-2022 Program (SPL)                        |
+-------------------------------------------------------------------+
```

Two Anchor programs collaborate to deliver the full feature set:

| Program | ID | Responsibility |
|---------|------|----------------|
| **Stablecoin** | `B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs` | State management, token lifecycle, roles, compliance actions |
| **Transfer Hook** | `HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou` | Enforces blacklist and pause checks on every `transfer_checked` call |

### Program Interaction Diagram

```
                  +-----------------------+
                  |    Client / CLI / SDK  |
                  +-----------+-----------+
                              |
              +---------------+----------------+
              |                                |
   +----------v-----------+       +-----------v-----------+
   |   Stablecoin Program |       |  Transfer Hook Program |
   |  (B1zq...1pHs)       |       |  (HgSU...SaLou)       |
   |                      |       |                        |
   | - initialize         |       | - initializeExtra...   |
   | - mint_tokens        |       | - transfer_hook        |
   | - burn_tokens        |       |   (via fallback)       |
   | - freeze_account     |       |                        |
   | - thaw_account       |       | Checks:                |
   | - pause / unpause    |       |  1. is_paused?         |
   | - update_minter      |       |  2. sender blacklisted?|
   | - update_roles       |       |  3. recipient bl?      |
   | - transfer_authority |       +-----------+-----------+
   | - accept_authority   |                    ^
   | - add_to_blacklist   |                    |
   | - remove_from_bl.    |      Token-2022 CPI on every
   | - seize              |       transfer_checked call
   +----------+-----------+
              |
              v
   +----------+-----------+
   |     Token-2022       |
   |  (SPL Token Ext.)    |
   +----------------------+
```

---

## On-Chain Programs

### Stablecoin Program

The stablecoin program is the primary program. It manages:

- **Initialization**: Creates Token-2022 mint with dynamically selected extensions via raw CPI, plus config PDA and roles PDA.
- **Token Lifecycle**: Mint (with minter quotas), burn, freeze, thaw operations.
- **Operational Controls**: Global pause/unpause, per-minter quota management.
- **Role Management**: Pauser, freezer, blacklister, seizer role assignments.
- **Authority Transfer**: Two-step transfer (initiate + accept) for safety.
- **Compliance (SSS-2)**: Blacklist add/remove (PDA-based), token seizure (burn + mint pattern).

All 13 instructions are implemented as individual files under `programs/stablecoin/src/instructions/`.

### Transfer Hook Program

The transfer hook program is a separate Anchor program required by the Token-2022 Transfer Hook extension. Token-2022 CPIs into this program on every `transfer_checked` call for SSS-2 mints.

It performs three checks:
1. **Pause check** -- reads the `is_paused` byte at raw offset 107 from the stablecoin config account data.
2. **Sender blacklist check** -- checks if the sender's BlacklistEntry PDA has data (`!data_is_empty()`).
3. **Recipient blacklist check** -- checks if the recipient's BlacklistEntry PDA has data.

It also implements `assert_is_transferring()` to prevent direct invocation attacks by verifying the `transferring` flag on the source token account's `TransferHookAccount` extension.

The program implements a `fallback` handler that bridges the gap between Anchor's 8-byte discriminators and the SPL Transfer Hook interface's instruction format.

---

## PDA Layout

All PDAs are deterministically derived. The mint itself is NOT a PDA -- it is a fresh `Keypair` generated by the client at initialization time.

### Stablecoin Program PDAs

| Account | Seeds | Description |
|---------|-------|-------------|
| **StablecoinConfig** | `["stablecoin_config", mint.key()]` | Global configuration. Serves as mint authority, freeze authority, and permanent delegate. |
| **RoleConfig** | `["roles", config.key()]` | Role assignments (pauser, freezer, blacklister, seizer). |
| **MinterConfig** | `["minter", config.key(), minter.key()]` | Per-minter configuration with quota and usage tracking. |
| **BlacklistEntry** | `["blacklist", config.key(), address]` | Per-address blacklist entry (SSS-2). Existence = blacklisted. |

### Transfer Hook Program PDAs

| Account | Seeds | Description |
|---------|-------|-------------|
| **ExtraAccountMetaList** | `["extra-account-metas", mint.key()]` | Stores references to extra accounts Token-2022 must resolve on every transfer. |

### PDA Derivation Diagram

```
    mint (Keypair, generated by client)
        |
        v
    StablecoinConfig PDA = ["stablecoin_config", mint.key()]
        |
        +-- RoleConfig PDA = ["roles", config.key()]
        |
        +-- MinterConfig PDA = ["minter", config.key(), minter.key()]
        |       (one per authorized minter)
        |
        +-- BlacklistEntry PDA = ["blacklist", config.key(), address]
                (one per blacklisted address, SSS-2 only)

    ExtraAccountMetaList PDA = ["extra-account-metas", mint.key()]
        (on transfer_hook program, SSS-2 only)
```

---

## Account Structures

### StablecoinConfig

The central configuration account for a stablecoin instance. The Config PDA is the mint authority, freeze authority, and permanent delegate for the Token-2022 mint.

```rust
pub struct StablecoinConfig {
    pub master_authority: Pubkey,          // 32 bytes -- can update all roles
    pub pending_authority: Pubkey,         // 32 bytes -- for two-step transfer
    pub mint: Pubkey,                      // 32 bytes -- the Token-2022 mint
    pub decimals: u8,                      // 1 byte   -- (offset 104)
    pub enable_permanent_delegate: bool,   // 1 byte   -- SSS-2 flag (offset 105)
    pub enable_transfer_hook: bool,        // 1 byte   -- SSS-2 flag (offset 106)
    pub is_paused: bool,                   // 1 byte   -- at byte offset 107
    pub total_minted: u64,                 // 8 bytes  -- cumulative mint tracking
    pub total_burned: u64,                 // 8 bytes  -- cumulative burn tracking
    pub bump: u8,                          // 1 byte
    pub _reserved: [u8; 128],             // 128 bytes -- for future upgrades
}
// Total: 8 (discriminator) + 245 data = 253 bytes
```

Key methods:
- `is_compliance_enabled()` -- returns `true` only if both `enable_permanent_delegate` and `enable_transfer_hook` are true.
- `has_pending_transfer()` -- returns `true` if `pending_authority != Pubkey::default()`.

### RoleConfig

```rust
pub struct RoleConfig {
    pub stablecoin_config: Pubkey,  // 32 bytes -- back-reference
    pub pauser: Pubkey,             // 32 bytes -- can pause/unpause
    pub freezer: Pubkey,            // 32 bytes -- can freeze/thaw accounts
    pub blacklister: Pubkey,        // 32 bytes -- can manage blacklist (SSS-2)
    pub seizer: Pubkey,             // 32 bytes -- can seize tokens (SSS-2)
    pub bump: u8,                   // 1 byte
}
// Total: 8 (discriminator) + 161 data = 169 bytes
```

### MinterConfig

```rust
pub struct MinterConfig {
    pub minter: Pubkey,             // 32 bytes -- the minter's public key
    pub stablecoin_config: Pubkey,  // 32 bytes -- back-reference
    pub quota: u64,                 // 8 bytes  -- maximum allowed to mint
    pub minted: u64,                // 8 bytes  -- amount already minted
    pub active: bool,               // 1 byte   -- whether this minter is active
    pub bump: u8,                   // 1 byte
}
// Total: 8 (discriminator) + 82 data = 90 bytes
```

The `remaining_quota()` method returns `quota.saturating_sub(minted)`.

### BlacklistEntry (SSS-2 Only)

```rust
pub struct BlacklistEntry {
    pub stablecoin_config: Pubkey,  // 32 bytes
    pub address: Pubkey,            // 32 bytes -- the blacklisted address
    pub reason: String,             // 4 + up to 128 bytes
    pub blacklisted_at: i64,        // 8 bytes  -- Unix timestamp
    pub blacklisted_by: Pubkey,     // 32 bytes -- who performed the action
    pub bump: u8,                   // 1 byte
}
// Total: 8 (discriminator) + up to 237 data bytes
```

---

## Instruction Reference

### Stablecoin Program Instructions

| # | Instruction | Access Control | Description |
|---|-------------|---------------|-------------|
| 1 | `initialize` | `authority` (signer) | Creates mint with Token-2022 extensions, config PDA, and roles PDA |
| 2 | `mint_tokens` | Authorized minter (active, within quota) | Mints tokens to a recipient; updates minter and global tracking |
| 3 | `burn_tokens` | Any token holder | Burns tokens from the caller's own ATA; stablecoin must not be paused |
| 4 | `freeze_account` | `freezer` role | Freezes a target token account via CPI to Token-2022 |
| 5 | `thaw_account` | `freezer` role | Thaws a previously frozen token account |
| 6 | `pause` | `pauser` role | Sets `is_paused = true` |
| 7 | `unpause` | `pauser` role | Sets `is_paused = false` |
| 8 | `update_minter` | `master_authority` | Creates or updates a MinterConfig PDA (quota, active status) |
| 9 | `update_roles` | `master_authority` | Updates pauser, freezer, blacklister, seizer assignments |
| 10 | `transfer_authority` | `master_authority` | Sets `pending_authority` (first step of two-step transfer) |
| 11 | `accept_authority` | `pending_authority` | Completes authority transfer; sets new `master_authority` |
| 12 | `add_to_blacklist` | `blacklister` role (SSS-2) | Creates a BlacklistEntry PDA; requires compliance enabled |
| 13 | `remove_from_blacklist` | `blacklister` role (SSS-2) | Closes the BlacklistEntry PDA; recovers rent |
| 14 | `seize` | `seizer` role (SSS-2) | Burns from source account + mints to treasury; requires compliance |

### Transfer Hook Program Instructions

| # | Instruction | Description |
|---|-------------|-------------|
| 1 | `initialize_extra_account_meta_list` | Creates ExtraAccountMetaList PDA with references to config, program IDs, and blacklist PDAs |
| 2 | `transfer_hook` (via `fallback`) | Called by Token-2022 on every `transfer_checked`; checks pause, sender blacklist, recipient blacklist |

### Data Flow: SSS-1 Mint

```
User (minter) --> stablecoin::mint_tokens
    |
    +-- Validate: not paused, minter active, quota check
    |
    +-- CPI: token-2022::mint_to (config PDA signs as mint_authority)
    |
    +-- Update: minter.minted += amount, config.total_minted += amount
    |
    +-- Emit: TokensMinted event
```

### Data Flow: SSS-2 Transfer (with Hook)

```
User --> token-2022::transfer_checked
    |
    +-- Token-2022 resolves ExtraAccountMetas for the mint
    |
    +-- Token-2022 CPIs into transfer_hook::transfer_hook
    |       |
    |       +-- assert_is_transferring() (verify TransferHookAccount flag)
    |       +-- Check: is_paused byte at offset 107 == 0
    |       +-- Check: sender_blacklist_entry.data_is_empty()
    |       +-- Check: recipient_blacklist_entry.data_is_empty()
    |
    +-- Transfer completes (or reverts if hook rejects)
```

---

## Transfer Hook Design

### ExtraAccountMetaList Ordering

The ExtraAccountMetaList stores references to accounts that Token-2022 must resolve and pass to the transfer hook on every transfer. The ordering is critical -- no forward references (referencing an account at a higher index from a dynamic seed) are allowed.

| Index | Account | Type | Purpose |
|-------|---------|------|---------|
| 0-4 | (standard) | Transfer Hook interface | source_token, mint, destination_token, owner, extra_account_meta_list |
| 5 | Stablecoin Config | Static pubkey | Read `is_paused` state at raw byte offset 107 |
| 6 | Stablecoin Program | Static pubkey | For cross-program PDA derivation of blacklist entries |
| 7 | Sender Blacklist PDA | Dynamic (external PDA) | Seeds: `["blacklist", config_key(5), source_owner(data@0:32)]` via stablecoin program(6) |
| 8 | Recipient Blacklist PDA | Dynamic (external PDA) | Seeds: `["blacklist", config_key(5), dest_owner(data@2:32)]` via stablecoin program(6) |
| 9 | Transfer Hook Program | Static pubkey (self) | PDA derivation context |

### Dynamic PDA Resolution

The blacklist PDAs are resolved dynamically at transfer time using `ExtraAccountMeta::new_external_pda_with_seeds`:

```rust
// Sender blacklist entry PDA (index 7)
ExtraAccountMeta::new_external_pda_with_seeds(
    6, // stablecoin_program account index -- MUST come before this entry
    &[
        Seed::Literal { bytes: b"blacklist".to_vec() },
        Seed::AccountKey { index: 5 },                    // stablecoin_config
        Seed::AccountData {
            account_index: 0,   // source_token (index 0)
            data_index: 32,     // owner field offset in token account
            length: 32,         // pubkey size
        },
    ],
    false, // is_signer
    false, // is_writable
)
```

Token-2022 derives the blacklist PDA for the actual sender/recipient of each transfer and passes it to the hook. The hook then checks `data_is_empty()` on these accounts.

### Pause Check (Raw Byte Offset)

The transfer hook reads the `is_paused` field directly from raw account data rather than deserializing the full config:

```
Offset 0:   discriminator (8 bytes)
Offset 8:   master_authority (32 bytes)
Offset 40:  pending_authority (32 bytes)
Offset 72:  mint (32 bytes)
Offset 104: decimals (1 byte)
Offset 105: enable_permanent_delegate (1 byte)
Offset 106: enable_transfer_hook (1 byte)
Offset 107: is_paused (1 byte)  <-- checked here
```

This approach avoids the overhead of deserializing the entire `StablecoinConfig` struct, saving compute units in the hook execution path.

---

## Seize Mechanism

The `seize` instruction uses `burn_checked` + `mint_to` rather than `transfer_checked`. This is a critical design decision.

### The Problem

A blacklisted account's tokens cannot be moved via `transfer_checked` because the transfer hook would reject the transaction (the sender is blacklisted). The transfer hook enforces the blacklist on every transfer, including those initiated by the permanent delegate.

### The Solution

The seize instruction performs two steps:

1. **Burn**: The Config PDA, as permanent delegate, calls `burn_checked` to destroy tokens in the source account.
2. **Mint**: The Config PDA, as mint authority, calls `mint_to` to create an equivalent amount of tokens in the treasury account.

```
Source Account                      Treasury Account
     |                                    ^
     | burn_checked                       | mint_to
     | (permanent delegate = Config PDA)  | (mint authority = Config PDA)
     v                                    |
  Tokens destroyed -----[amount]-----> Tokens created
```

### Why This Works

- `burn_checked` and `mint_to` are NOT transfers -- the transfer hook is not invoked.
- Works even when the source account is frozen or blacklisted.
- Supply-neutral: the burn and mint cancel out.
- The Config PDA can sign for both operations because it is both the permanent delegate and the mint authority.

### Relevant Code

```rust
// Step 1: Burn tokens from source using permanent delegate authority
invoke_signed(
    &spl_token_2022::instruction::burn_checked(
        &spl_token_2022::ID,
        &from_token_account,
        &mint,
        &config_pda,  // permanent delegate
        &[],
        amount,
        decimals,
    )?,
    accounts,
    &[config_pda_seeds],
)?;

// Step 2: Mint equivalent tokens to treasury using mint authority
invoke_signed(
    &spl_token_2022::instruction::mint_to(
        &spl_token_2022::ID,
        &mint,
        &to_token_account,
        &config_pda,  // mint authority
        &[],
        amount,
    )?,
    accounts,
    &[config_pda_seeds],
)?;
```

---

## Security Model

### Role-Based Access Control

| Role | Assigned Via | Capabilities |
|------|-------------|-------------|
| `master_authority` | Initialization, then `accept_authority` | Update roles, manage minters, initiate authority transfer |
| `pauser` | `update_roles` | Pause/unpause all operations |
| `freezer` | `update_roles` | Freeze/thaw individual token accounts |
| `blacklister` | `update_roles` | Add/remove addresses from the blacklist (SSS-2) |
| `seizer` | `update_roles` | Seize tokens from accounts (SSS-2) |
| `minter` (per-PDA) | `update_minter` | Mint tokens up to their assigned quota |

At initialization, all roles (pauser, freezer, blacklister, seizer) default to the `authority` signer.

### Two-Step Authority Transfer

Authority transfer requires two transactions for safety:

```
1. Current master_authority calls transfer_authority(new_authority)
   --> Sets config.pending_authority = new_authority

2. The pending_authority calls accept_authority()
   --> Sets config.master_authority = pending_authority
   --> Clears config.pending_authority to Pubkey::default()
```

If the pending authority never accepts, the current authority retains full control. Only one pending transfer can exist at a time (`AuthorityTransferPending` error if one is already pending).

### Transfer Hook Security

- **`assert_is_transferring()`** verifies the `transferring` flag on the source token account's `TransferHookAccount` extension. This prevents attackers from calling the hook instruction directly (outside a token transfer context) to probe blacklist status or bypass validation.
- The ExtraAccountMetaList is initialized once per mint and stores immutable references to the accounts the hook needs.

### Compliance Gating

SSS-2-only instructions (`add_to_blacklist`, `remove_from_blacklist`, `seize`) check `config.is_compliance_enabled()`, which returns true only when both `enable_permanent_delegate` and `enable_transfer_hook` are set. Calling these on an SSS-1 stablecoin returns `ComplianceNotEnabled`.

### Arithmetic Safety

All arithmetic uses `checked_add` and `saturating_sub` to prevent overflow and underflow. The `Overflow` error is returned if any checked operation fails.

---

## Design Decisions

### Why the Mint is a Keypair (Not a PDA)

The mint is a fresh `Keypair` generated by the client at initialization time. The Config PDA is then derived from the mint key: `["stablecoin_config", mint.key()]`. This approach:

- Allows the Config PDA to serve as mint authority, freeze authority, and permanent delegate.
- Avoids circular dependency problems (config derived from mint, not the other way around).
- Matches production stablecoin patterns on Solana (USDC, EURC use keypair mints).

### Why Raw CPI for Mint Initialization

Anchor's constraint macros for Token-2022 extensions are static -- they cannot conditionally include extensions at runtime. The `initialize` instruction uses raw CPI calls (`invoke` / `invoke_signed`) to:

1. Create the mint account with calculated space for the selected extensions.
2. Initialize each extension (`MetadataPointer`, `PermanentDelegate`, `TransferHook`) conditionally based on params.
3. Initialize the mint with `initialize_mint2`.
4. Initialize token metadata on the mint account itself (requires Config PDA signature).

All other instructions use standard Anchor constraints and `anchor_spl::token_interface` CPI wrappers for safety and clarity.

### Why PDA-Based Blacklist (Not a Bitmap)

Each blacklisted address gets its own PDA account:

- **Individually closeable**: Removing from the blacklist closes the account and recovers rent.
- **Cheap existence check**: `data_is_empty()` is a single check with no deserialization needed.
- **Rich metadata**: Each entry stores reason, timestamp, and who blacklisted (critical for audit trails).
- **No size limits**: No bitmap resizing needed as the blacklist grows.
- **Deterministic derivation**: The transfer hook can derive and check the PDA without any centralized state.

### Why Two Programs (Not One)

Token-2022's Transfer Hook extension requires the hook to be a separate program. Token-2022 CPIs into the hook program on every `transfer_checked` call. The stablecoin program manages state; the transfer hook program validates transfers. Both programs share seed constants and are deployed in the same workspace.

### Why Config PDA is the Authority

A single PDA (`StablecoinConfig`) controls `mint_authority`, `freeze_authority`, and `permanent_delegate`. This simplifies the signing model -- the program signs for all token operations using the same PDA seeds: `["stablecoin_config", mint.key(), &[bump]]`. Role-based access is handled by the separate `RoleConfig` PDA, which stores authorized pubkeys per role.

---

## Event System

Every state-changing instruction emits an Anchor event via `emit!()` for audit trail purposes. Events are logged as base64-encoded program data in transaction logs.

| Event | Emitted By | Key Fields |
|-------|-----------|------------|
| `StablecoinInitialized` | `initialize` | config, mint, authority, enable_permanent_delegate, enable_transfer_hook, decimals, timestamp |
| `TokensMinted` | `mint_tokens` | config, minter, recipient, amount, timestamp |
| `TokensBurned` | `burn_tokens` | config, burner, amount, timestamp |
| `AccountFrozen` | `freeze_account` | config, account, frozen_by, timestamp |
| `AccountThawed` | `thaw_account` | config, account, thawed_by, timestamp |
| `StablecoinPaused` | `pause` | config, paused_by, timestamp |
| `StablecoinUnpaused` | `unpause` | config, unpaused_by, timestamp |
| `MinterUpdated` | `update_minter` | config, minter, quota, active, updated_by, timestamp |
| `RolesUpdated` | `update_roles` | config, updated_by, timestamp |
| `AuthorityTransferInitiated` | `transfer_authority` | config, current_authority, pending_authority, timestamp |
| `AuthorityTransferCompleted` | `accept_authority` | config, old_authority, new_authority, timestamp |
| `AddedToBlacklist` | `add_to_blacklist` | config, address, reason, blacklisted_by, timestamp |
| `RemovedFromBlacklist` | `remove_from_blacklist` | config, address, removed_by, timestamp |
| `TokensSeized` | `seize` | config, from, to, amount, seized_by, timestamp |

All events include a `timestamp` field derived from `Clock::get()?.unix_timestamp`. Events are formatted using Anchor's event discriminator: `sha256("event:<EventName>")[0..8]`.
