# Solana Stablecoin Standard (SSS) — Implementation Plan

## What Is Being Asked

Superteam Brazil wants us to build an **open-source, modular stablecoin SDK for Solana** — a production-ready toolkit that institutions and builders can fork, customize, and deploy. Think OpenZeppelin for stablecoins: the SDK is the library, the standards (SSS-1, SSS-2) are opinionated presets within it.

### Core Concept
- **Layer 1 — Base SDK**: Token creation with mint/freeze authority + metadata + role management
- **Layer 2 — Modules**: Composable compliance module (transfer hook, blacklist, permanent delegate) and privacy module (confidential transfers)
- **Layer 3 — Standard Presets**: SSS-1 (minimal) and SSS-2 (compliant) — opinionated combos of Layer 1 + Layer 2

### Two Standards
| Standard | Name | What It Is | Use Case |
|----------|------|-----------|----------|
| SSS-1 | Minimal Stablecoin | Mint authority + freeze authority + metadata | DAOs, internal tokens, ecosystem settlement |
| SSS-2 | Compliant Stablecoin | SSS-1 + permanent delegate + transfer hook + blacklist | Regulated tokens (USDC/USDT-class), GENIUS Act compliant |

### Deliverables
1. **On-chain Anchor programs** (stablecoin program + transfer hook program)
2. **TypeScript SDK** (`@stbr/sss-token`)
3. **CLI tool** (`sss-token`)
4. **Backend services** (Docker-containerized: mint/burn service, event indexer, compliance service, webhook service)
5. **Documentation** (8 docs: README, ARCHITECTURE, SDK, OPERATIONS, SSS-1, SSS-2, COMPLIANCE, API)
6. **Tests** (unit, integration per preset, fuzz via Trident)
7. **Devnet deployment proof**

### Bonus Features (up to 50% extra weight)
- SSS-3 Private Stablecoin (confidential transfers + allowlists)
- Oracle Integration Module (Switchboard feeds for non-USD pegs)
- Interactive Admin TUI
- Example Frontend

---

## Reference Architecture (from Solana Vault Standard)

We must match the SVS repo's patterns for code organization:

```
solana-stablecoin-standard/
├── programs/
│   ├── stablecoin/              # Main stablecoin program (Anchor)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── constants.rs
│   │   │   ├── error.rs
│   │   │   ├── events.rs
│   │   │   ├── state.rs
│   │   │   └── instructions/
│   │   │       ├── mod.rs
│   │   │       ├── initialize.rs
│   │   │       ├── mint.rs
│   │   │       ├── burn.rs
│   │   │       ├── freeze_account.rs
│   │   │       ├── thaw_account.rs
│   │   │       ├── pause.rs
│   │   │       ├── unpause.rs
│   │   │       ├── update_roles.rs
│   │   │       ├── transfer_authority.rs
│   │   │       ├── add_to_blacklist.rs
│   │   │       ├── remove_from_blacklist.rs
│   │   │       └── seize.rs
│   │   └── Cargo.toml
│   └── transfer-hook/           # Transfer hook program for SSS-2 blacklist enforcement
│       ├── src/
│       │   ├── lib.rs
│       │   ├── error.rs
│       │   └── state.rs
│       └── Cargo.toml
├── sdk/
│   └── core/                    # @stbr/sss-token TypeScript SDK + CLI
│       ├── src/
│       │   ├── index.ts
│       │   ├── stablecoin.ts    # SolanaStablecoin class
│       │   ├── pda.ts           # PDA derivation
│       │   ├── presets.ts       # SSS-1, SSS-2 preset configs
│       │   ├── types.ts         # TypeScript types
│       │   └── cli.ts           # Commander-based CLI
│       ├── tests/
│       ├── package.json
│       └── tsconfig.json
├── backend/
│   ├── src/
│   │   ├── main.ts
│   │   ├── services/
│   │   │   ├── mint-burn.ts
│   │   │   ├── event-listener.ts
│   │   │   ├── compliance.ts
│   │   │   └── webhook.ts
│   │   ├── routes/
│   │   └── config.ts
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   └── tsconfig.json
├── tests/                       # Integration tests
│   ├── sss-1.ts
│   ├── sss-2.ts
│   ├── full-lifecycle.ts
│   ├── compliance.ts
│   ├── roles.ts
│   └── edge-cases.ts
├── trident-tests/               # Fuzz tests
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SDK.md
│   ├── OPERATIONS.md
│   ├── SSS-1.md
│   ├── SSS-2.md
│   ├── COMPLIANCE.md
│   └── API.md
├── Anchor.toml
├── Cargo.toml                   # Rust workspace
├── package.json                 # NPM workspace
├── tsconfig.json
├── .gitignore
├── README.md
└── LICENSE
```

---

## Detailed Implementation Plan

### Phase 1: Project Scaffolding

**1.1 Initialize Anchor workspace**
- `Cargo.toml` (workspace root): members = `["programs/*"]`, resolver = "2", overflow-checks in release
- `Anchor.toml`: programs for stablecoin + transfer-hook, devnet provider, test runner config
- `.gitignore`: Rust/Node/Anchor patterns

**1.2 Initialize NPM workspace**
- Root `package.json`: workspaces = `["sdk/core", "backend"]`, shared dev deps
- Root `tsconfig.json`: ES2022 target, strict mode

**1.3 SDK package setup**
- `sdk/core/package.json`: name `@stbr/sss-token`, bin `sss-token`, deps on `@coral-xyz/anchor ^0.30.1`, `@solana/spl-token`, `@solana/web3.js`, `commander`
- `sdk/core/tsconfig.json`: extends root, outDir dist

**1.4 Backend package setup**
- `backend/package.json`: Express/Fastify, dotenv, structured logging (pino)
- `backend/Dockerfile` + `docker-compose.yml`

---

### Phase 2: On-Chain Program — Stablecoin Core (`programs/stablecoin/`)

**2.1 State Design (`state.rs`)**

```rust
#[account]
pub struct StablecoinConfig {
    // Authorities
    pub master_authority: Pubkey,     // Can update all roles
    pub pending_authority: Pubkey,    // Two-step authority transfer
    // Token
    pub mint: Pubkey,                 // The stablecoin mint
    pub decimals: u8,
    // Feature flags (set at initialization, immutable)
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
    // Operational state
    pub is_paused: bool,
    pub total_minted: u64,            // Cumulative mint tracking
    pub total_burned: u64,            // Cumulative burn tracking
    // Bump
    pub bump: u8,
    pub mint_bump: u8,
    // Reserved for future use
    pub _reserved: [u8; 128],
}

#[account]
pub struct MinterConfig {
    pub minter: Pubkey,
    pub stablecoin_config: Pubkey,
    pub quota: u64,                   // Per-minter quota
    pub minted: u64,                  // Amount minted by this minter
    pub active: bool,
    pub bump: u8,
}

#[account]
pub struct RoleConfig {
    pub stablecoin_config: Pubkey,
    pub pauser: Pubkey,
    pub freezer: Pubkey,
    pub blacklister: Pubkey,          // Only used if SSS-2
    pub seizer: Pubkey,               // Only used if SSS-2
    pub bump: u8,
}

// SSS-2 only
#[account]
pub struct BlacklistEntry {
    pub stablecoin_config: Pubkey,
    pub address: Pubkey,
    pub reason: String,               // Max 128 chars
    pub blacklisted_at: i64,
    pub blacklisted_by: Pubkey,
    pub bump: u8,
}
```

**PDA Seeds:**
- Config: `["stablecoin_config", mint.key()]`
- Mint: `["stablecoin_mint", config_id.to_le_bytes()]` (config_id is a u64 counter or a unique name hash)
- MinterConfig: `["minter", stablecoin_config.key(), minter.key()]`
- RoleConfig: `["roles", stablecoin_config.key()]`
- BlacklistEntry: `["blacklist", stablecoin_config.key(), address.key()]`

**2.2 Constants (`constants.rs`)**
```rust
pub const CONFIG_SEED: &[u8] = b"stablecoin_config";
pub const MINT_SEED: &[u8] = b"stablecoin_mint";
pub const MINTER_SEED: &[u8] = b"minter";
pub const ROLES_SEED: &[u8] = b"roles";
pub const BLACKLIST_SEED: &[u8] = b"blacklist";
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_REASON_LEN: usize = 128;
pub const DEFAULT_DECIMALS: u8 = 6;
```

**2.3 Errors (`error.rs`)**
```rust
#[error_code]
pub enum StablecoinError {
    Unauthorized,
    Paused,
    NotPaused,
    InvalidAmount,
    MinterQuotaExceeded,
    MinterNotActive,
    AlreadyBlacklisted,
    NotBlacklisted,
    ComplianceNotEnabled,
    TransferHookNotEnabled,
    AccountFrozen,
    InvalidDecimals,
    NameTooLong,
    SymbolTooLong,
    UriTooLong,
    ReasonTooLong,
    AuthorityTransferPending,
    NoAuthorityTransferPending,
}
```

**2.4 Events (`events.rs`)**
```rust
#[event] StablecoinInitialized { config, mint, preset, authority, timestamp }
#[event] TokensMinted { config, minter, recipient, amount, timestamp }
#[event] TokensBurned { config, burner, amount, timestamp }
#[event] AccountFrozen { config, account, frozen_by, timestamp }
#[event] AccountThawed { config, account, thawed_by, timestamp }
#[event] Paused { config, paused_by, timestamp }
#[event] Unpaused { config, unpaused_by, timestamp }
#[event] MinterUpdated { config, minter, quota, active, timestamp }
#[event] RolesUpdated { config, updated_by, timestamp }
#[event] AuthorityTransferInitiated { config, current, pending, timestamp }
#[event] AuthorityTransferCompleted { config, old, new, timestamp }
// SSS-2 only
#[event] AddedToBlacklist { config, address, reason, blacklisted_by, timestamp }
#[event] RemovedFromBlacklist { config, address, removed_by, timestamp }
#[event] TokensSeized { config, from, to, amount, seized_by, timestamp }
```

**2.5 Instructions**

| Instruction | Accounts | Logic |
|-------------|----------|-------|
| `initialize` | payer, config (init PDA), mint (init PDA with Token-2022), metadata, roles (init PDA), token_program, system_program | Creates mint with extensions based on config params. If SSS-2: add PermanentDelegate + TransferHook extensions. Sets metadata via metadata pointer. Initializes role config. |
| `mint` | minter_signer, minter_config, config, mint, recipient_ata, token_program | Checks: not paused, minter active, quota not exceeded. CPIs `mint_to` with PDA signer. Updates minter.minted and config.total_minted. |
| `burn` | burner_signer, config, mint, burner_ata, token_program | Burns from caller's own ATA. Updates config.total_burned. |
| `freeze_account` | freezer_signer, roles, config, mint, target_ata, token_program | Checks freezer role. CPIs `freeze_account`. |
| `thaw_account` | freezer_signer, roles, config, mint, target_ata, token_program | Checks freezer role. CPIs `thaw_account`. |
| `pause` | pauser_signer, roles, config | Sets config.is_paused = true. |
| `unpause` | pauser_signer, roles, config | Sets config.is_paused = false. |
| `update_minter` | master_authority, config, minter_config (init_if_needed), minter_pubkey | Creates/updates MinterConfig with quota and active status. |
| `update_roles` | master_authority, config, roles | Updates pauser/freezer/blacklister/seizer pubkeys. |
| `transfer_authority` | master_authority, config | Two-step: first call sets pending_authority, second call by pending confirms. |
| `accept_authority` | pending_authority, config | Completes the two-step authority transfer. |
| `add_to_blacklist` | blacklister_signer, roles, config, blacklist_entry (init PDA) | SSS-2 only. Checks compliance enabled. Creates BlacklistEntry PDA. |
| `remove_from_blacklist` | blacklister_signer, roles, config, blacklist_entry (close) | SSS-2 only. Closes BlacklistEntry PDA. |
| `seize` | seizer_signer, roles, config, mint, from_ata, to_ata, token_program | SSS-2 only. Uses permanent delegate authority (PDA) to transfer tokens from frozen/blacklisted account to treasury. |

**Key design decision**: The mint PDA is the authority for mint_authority, freeze_authority, and permanent_delegate. The program signs for all these operations using the config PDA seeds.

Actually, better approach: the **config PDA** is the mint authority, freeze authority, and permanent delegate. This way one PDA controls everything and the program can sign for all operations.

**2.6 Initialize instruction detail**

The `initialize` instruction must:
1. Create the config PDA account
2. Create the mint account with Token-2022, calculating space for selected extensions
3. Initialize extensions in correct order:
   - `initialize_metadata_pointer` (points to mint itself)
   - If SSS-2: `initialize_permanent_delegate` (delegate = config PDA)
   - If SSS-2: `initialize_transfer_hook` (program_id = transfer_hook program)
   - `initialize_mint` (authority = config PDA, freeze_authority = config PDA, decimals)
   - `initialize_token_metadata` (name, symbol, uri)
4. Create the roles PDA account
5. Emit StablecoinInitialized event

Using Anchor Token-2022 extension constraints:
```rust
#[account(
    init,
    signer,
    payer = payer,
    mint::token_program = token_program,
    mint::decimals = params.decimals,
    mint::authority = config,
    mint::freeze_authority = config,
    extensions::metadata_pointer::authority = config,
    extensions::metadata_pointer::metadata_address = mint,
    // Conditionally: extensions::permanent_delegate::delegate = config,
    // Conditionally: extensions::transfer_hook::authority = config,
    // Conditionally: extensions::transfer_hook::program_id = transfer_hook_program,
)]
pub mint: Box<InterfaceAccount<'info, Mint>>,
```

**Problem**: Anchor constraints are static — can't conditionally add extensions. **Solution**: Two separate initialize instructions: `initialize_sss1` and `initialize_sss2`, or use raw CPI instead of Anchor constraints for mint creation so we can dynamically select extensions.

**Chosen approach**: Use raw Solana CPI for mint initialization (not Anchor constraints) so we can dynamically compute the space and select extensions based on the `StablecoinParams`. This gives us the flexibility the bounty requires (custom configs via TOML).

```rust
pub fn initialize(ctx: Context<Initialize>, params: StablecoinParams) -> Result<()> {
    // 1. Determine which extensions to enable
    let mut extensions = vec![ExtensionType::MetadataPointer];
    if params.enable_permanent_delegate {
        extensions.push(ExtensionType::PermanentDelegate);
    }
    if params.enable_transfer_hook {
        extensions.push(ExtensionType::TransferHook);
    }

    // 2. Calculate space
    let space = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&extensions)?;

    // 3. Create account via CPI to system program
    // 4. Initialize each extension via CPI to token-2022
    // 5. Initialize mint via CPI to token-2022
    // 6. Initialize metadata via CPI
    // 7. Set config state
}
```

---

### Phase 3: On-Chain Program — Transfer Hook (`programs/transfer-hook/`)

This is a separate Anchor program that enforces blacklist checks on every transfer.

**3.1 Architecture**
- Implements the `spl-transfer-hook-interface`
- Has a `fallback` instruction to handle SPL discriminator format
- The `Execute` instruction checks if sender OR recipient is blacklisted
- Uses `ExtraAccountMetaList` PDA to pass the blacklist PDA accounts

**3.2 Key Instructions**

| Instruction | Purpose |
|-------------|---------|
| `initialize_extra_account_meta_list` | Creates the ExtraAccountMetaList PDA for a given mint. Stores references to blacklist check accounts. |
| `transfer_hook` (via fallback) | Called by Token-2022 on every transfer. Checks sender and recipient against blacklist PDAs. Reverts if either is blacklisted. |

**3.3 Blacklist Check Logic**

The transfer hook needs to check if the source or destination is blacklisted. The blacklist entries are PDAs in the **stablecoin program**, not the transfer hook program.

Approach: ExtraAccountMetas includes dynamically-derived PDAs:
- PDA derived from `["blacklist", config, source_owner]` in stablecoin program
- PDA derived from `["blacklist", config, destination_owner]` in stablecoin program

The hook checks if these accounts exist (are initialized). If they exist → blacklisted → reject transfer.

```rust
pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // 1. Verify this is actually being called during a transfer
    assert_is_transferring(&ctx)?;

    // 2. Check sender blacklist PDA
    if !ctx.accounts.sender_blacklist.data_is_empty() {
        return err!(TransferHookError::SenderBlacklisted);
    }

    // 3. Check recipient blacklist PDA
    if !ctx.accounts.recipient_blacklist.data_is_empty() {
        return err!(TransferHookError::RecipientBlacklisted);
    }

    // 4. Check if stablecoin is paused (read config account)
    let config_data = &ctx.accounts.stablecoin_config;
    if config_data.is_paused {
        return err!(TransferHookError::StablecoinPaused);
    }

    Ok(())
}
```

**3.4 ExtraAccountMetas Setup**

The ExtraAccountMetas list must include:
1. Stablecoin config PDA (read-only) — to check pause state
2. Sender blacklist PDA (derived dynamically from source token owner) — to check sender
3. Recipient blacklist PDA (derived dynamically from dest token owner) — to check recipient
4. Stablecoin program ID (for PDA derivation context)

Using dynamic seed derivation:
```rust
let account_metas = vec![
    // Stablecoin config (static address, known at init)
    ExtraAccountMeta::new_with_pubkey(&stablecoin_config_key, false, false)?,
    // Sender blacklist entry PDA (derived from source token account's owner)
    ExtraAccountMeta::new_external_pda_with_seeds(
        6, // index of stablecoin_program in accounts
        &[
            Seed::Literal { bytes: b"blacklist".to_vec() },
            Seed::AccountKey { index: 0 }, // stablecoin_config
            Seed::AccountData { account_index: 0, data_index: 32, length: 32 }, // source token owner
        ],
        false, false,
    )?,
    // Recipient blacklist entry PDA (derived from dest token account's owner)
    ExtraAccountMeta::new_external_pda_with_seeds(
        6, // index of stablecoin_program
        &[
            Seed::Literal { bytes: b"blacklist".to_vec() },
            Seed::AccountKey { index: 0 }, // stablecoin_config
            Seed::AccountData { account_index: 2, data_index: 32, length: 32 }, // dest token owner
        ],
        false, false,
    )?,
    // Stablecoin program (for PDA derivation)
    ExtraAccountMeta::new_with_pubkey(&stablecoin_program_id, false, false)?,
];
```

---

### Phase 4: TypeScript SDK (`sdk/core/`)

**4.1 Main Class — `SolanaStablecoin`**

```typescript
export class SolanaStablecoin {
    // Static factory methods
    static async create(connection, params): Promise<SolanaStablecoin>  // New stablecoin
    static async load(connection, configAddress): Promise<SolanaStablecoin>  // Existing

    // Core operations
    async mint(params: { recipient, amount, minter }): Promise<string>
    async burn(params: { amount }): Promise<string>
    async freezeAccount(address: PublicKey): Promise<string>
    async thawAccount(address: PublicKey): Promise<string>
    async pause(): Promise<string>
    async unpause(): Promise<string>

    // Role management
    async updateMinter(params: { minter, quota, active }): Promise<string>
    async updateRoles(params): Promise<string>
    async transferAuthority(newAuthority: PublicKey): Promise<string>
    async acceptAuthority(): Promise<string>

    // SSS-2 Compliance (fails gracefully if not enabled)
    compliance: {
        blacklistAdd(address, reason): Promise<string>
        blacklistRemove(address): Promise<string>
        seize(from, to): Promise<string>
        isBlacklisted(address): Promise<boolean>
        getBlacklistEntry(address): Promise<BlacklistEntry | null>
    }

    // View functions
    async getTotalSupply(): Promise<BN>
    async getTotalMinted(): Promise<BN>
    async getTotalBurned(): Promise<BN>
    async getConfig(): Promise<StablecoinConfig>
    async getMinters(): Promise<MinterConfig[]>
    async getRoles(): Promise<RoleConfig>
    async getHolders(minBalance?): Promise<TokenAccountInfo[]>

    // State
    async refresh(): Promise<void>
}
```

**4.2 Presets**

```typescript
export const Presets = {
    SSS_1: {
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
    },
    SSS_2: {
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: false,
    },
} as const;
```

**4.3 PDA derivation (`pda.ts`)**

```typescript
export function getConfigAddress(programId, mint): [PublicKey, number]
export function getMintAddress(programId, configId): [PublicKey, number]
export function getMinterAddress(programId, config, minter): [PublicKey, number]
export function getRolesAddress(programId, config): [PublicKey, number]
export function getBlacklistAddress(programId, config, address): [PublicKey, number]
export function getExtraAccountMetaListAddress(transferHookProgramId, mint): [PublicKey, number]
```

**4.4 CLI (`cli.ts`)**

Commands matching the bounty spec:
```
sss-token init --preset sss-1|sss-2 [--name] [--symbol] [--decimals] [--uri]
sss-token init --custom config.toml
sss-token mint <recipient> <amount>
sss-token burn <amount>
sss-token freeze <address>
sss-token thaw <address>
sss-token pause
sss-token unpause
sss-token status
sss-token supply
sss-token blacklist add <address> --reason "..."
sss-token blacklist remove <address>
sss-token seize <address> --to <treasury>
sss-token minters list|add|remove
sss-token holders [--min-balance <amount>]
sss-token audit-log [--action <type>]
sss-token roles list|update
```

---

### Phase 5: Backend Services (`backend/`)

**5.1 Architecture**: Express.js + TypeScript, containerized with Docker.

**5.2 Services**

| Service | Endpoints | Purpose |
|---------|-----------|---------|
| Mint/Burn Service | `POST /api/mint`, `POST /api/burn`, `GET /api/supply` | Fiat-to-stablecoin lifecycle coordination |
| Event Listener | WebSocket connection to Solana | Monitors program events, stores in DB, triggers webhooks |
| Compliance Service (SSS-2) | `POST /api/blacklist`, `GET /api/blacklist`, `POST /api/seize`, `GET /api/audit-log` | Blacklist management, sanctions screening integration point |
| Webhook Service | `POST /api/webhooks`, `GET /api/webhooks` | Configurable event notifications with retry logic |
| Health | `GET /health`, `GET /health/ready` | Liveness + readiness checks |

**5.3 Docker setup**
```yaml
services:
  backend:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [redis]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

---

### Phase 6: Tests

**6.1 Integration Tests (`tests/`)**

| File | What It Tests |
|------|--------------|
| `sss-1.ts` | Full SSS-1 lifecycle: init → mint → transfer → freeze → thaw → burn |
| `sss-2.ts` | Full SSS-2 lifecycle: init → mint → transfer → blacklist → freeze → seize → burn |
| `full-lifecycle.ts` | End-to-end flows for both presets |
| `compliance.ts` | Blacklist enforcement, transfer hook rejection, seize via permanent delegate |
| `roles.ts` | Role-based access control: minter quotas, pauser, freezer, blacklister, seizer |
| `edge-cases.ts` | Zero amounts, self-transfers, double-blacklist, unauthorized callers, paused operations |

**6.2 Unit Tests**
- Per-instruction tests in the Anchor test suite
- SDK unit tests in `sdk/core/tests/`

**6.3 Fuzz Tests (`trident-tests/`)**
- Trident framework for property-based testing
- Invariants: total_minted - total_burned = supply, blacklisted accounts can't transfer

---

### Phase 7: Documentation

| Document | Contents |
|----------|----------|
| `README.md` | Overview, quick start, preset comparison table, architecture diagram, links |
| `docs/ARCHITECTURE.md` | Three-layer model, data flows, PDA layout, program interactions, security model |
| `docs/SDK.md` | Presets, custom configs, TypeScript SDK API reference, CLI reference |
| `docs/OPERATIONS.md` | Operator runbook: how to mint, freeze, seize, pause, manage minters |
| `docs/SSS-1.md` | Minimal stablecoin standard specification |
| `docs/SSS-2.md` | Compliant stablecoin standard specification |
| `docs/COMPLIANCE.md` | Regulatory considerations (GENIUS Act), audit trail format, sanctions integration |
| `docs/API.md` | Backend REST API reference |

---

### Phase 8: Devnet Deployment

1. Build programs: `anchor build`
2. Deploy to devnet: `anchor deploy --provider.cluster devnet`
3. Run example operations and record transaction signatures
4. Document program IDs and example tx in README

---

## Technical Decisions

### Why Token-2022 (not legacy SPL Token)
- Permanent delegate for seizure (GENIUS Act requirement)
- Transfer hooks for blacklist enforcement on every transfer
- Metadata pointer for on-mint metadata (no Metaplex dependency)
- This is what production stablecoins (Paxos USDP, GMO GYEN) use

### Why raw CPI for mint initialization (not Anchor constraints)
- Anchor extension constraints are static — can't conditionally add extensions
- We need dynamic extension selection based on preset/config params
- All other instructions can use standard Anchor constraints

### Why PDA-based blacklist (not a bitmap)
- PDAs are individually closeable (remove from blacklist = close account = recover rent)
- The transfer hook can check existence via `data_is_empty()` — very cheap
- Each entry stores metadata (reason, timestamp, who blacklisted)
- No size limits (bitmap would need resizing)

### Why config PDA is the authority (not a separate authority PDA)
- Simpler — one PDA controls mint_authority, freeze_authority, permanent_delegate
- The program signs for all operations using config PDA seeds
- Role-based access is handled by the separate RoleConfig PDA which stores authorized pubkeys per role

### Why two programs (not one)
- Transfer hooks MUST be a separate program — Token-2022 CPIs into it
- The stablecoin program manages state; the transfer hook program validates transfers
- Both are in the same workspace, share types via a common crate if needed

### Anchor Version
- Using `anchor-lang 0.30.1` (matches SVS reference, stable Token-2022 support)
- `anchor-spl 0.30.1` for token interface types
- `spl-transfer-hook-interface 0.6.3` for transfer hook

### Dependency Versions
```toml
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"
spl-token-2022 = "3.0.4"
spl-transfer-hook-interface = "0.6.3"
spl-tlv-account-resolution = "0.6.3"
spl-pod = "0.2.2"
spl-type-length-value = "0.4.3"
```

---

## Implementation Order

1. **Project scaffolding** — All config files, directory structure
2. **Stablecoin program** — State, errors, events, constants, then instructions one by one
3. **Transfer hook program** — Initialize extra metas, fallback handler, blacklist check
4. **Integration tests for SSS-1** — Validates basic flow without compliance
5. **Integration tests for SSS-2** — Validates compliance flow
6. **TypeScript SDK** — Wraps program instructions, PDA helpers
7. **CLI** — Uses SDK, commander-based
8. **Backend services** — Mint/burn service, event listener, compliance, webhooks
9. **Documentation** — All 8 docs
10. **Devnet deployment** — Deploy, run examples, record proof
11. **Fuzz tests** — Trident setup

---

## Evaluation Criteria Mapping

| Criteria | Weight | Our Approach |
|----------|--------|-------------|
| SDK Design & Modularity | 20% | Three-layer architecture, configurable presets, custom config support via TOML, clean separation between base/compliance/privacy |
| Completeness | 20% | All deliverables: programs, SDK, CLI, backend, docs, tests, devnet deployment |
| Code Quality | 20% | Following SVS patterns exactly, clean Anchor code, comprehensive error handling, events on every state change |
| Security | 15% | Role-based access control, two-step authority transfer, feature gating (SSS-2 instructions fail if compliance not enabled), PDA-based ownership, `assert_is_transferring` in hook |
| Authority | 20% | Demonstrating deep understanding of Token-2022, GENIUS Act, production stablecoin patterns |
| Usability & Documentation | 5% | Intuitive CLI matching spec exactly, clear SDK API matching spec examples, 8 comprehensive docs |
| Bonus | Up to 50% | SSS-3, Oracle, TUI, Frontend |
