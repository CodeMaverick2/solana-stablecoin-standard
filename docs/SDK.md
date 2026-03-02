# SDK Reference

This document covers the TypeScript SDK (`@stbr/sss-token`), CLI tool (`sss-token`), preset configurations, PDA derivation helpers, and usage examples.

---

## Table of Contents

1. [Installation](#installation)
2. [Preset Configurations](#preset-configurations)
3. [SDK API Reference](#sdk-api-reference)
4. [PDA Derivation Helpers](#pda-derivation-helpers)
5. [CLI Reference](#cli-reference)
6. [Code Examples](#code-examples)

---

## Installation

```bash
npm install @stbr/sss-token
```

Or from the monorepo:

```bash
cd sdk/core
npm install
npm run build
```

The package provides:
- **SDK class**: `SolanaStablecoin` -- programmatic interface for all operations.
- **CLI tool**: `sss-token` -- command-line interface for operators.
- **PDA helpers**: Functions to derive all PDA addresses.
- **Presets**: `SSS_1` and `SSS_2` configuration objects.
- **Types**: Full TypeScript interfaces for all account and parameter types.

### Exports

```typescript
import {
  SolanaStablecoin,          // Main SDK class
  Presets, SSS_1, SSS_2,     // Preset configs
  getConfigAddress,           // PDA derivation helpers
  getMinterAddress,
  getRolesAddress,
  getBlacklistAddress,
  getExtraAccountMetaListAddress,
} from "@stbr/sss-token";
```

---

## Preset Configurations

### Built-in Presets

```typescript
import { Presets } from "@stbr/sss-token";

// SSS-1: Minimal Stablecoin
// Extensions: MetadataPointer only
Presets.SSS_1 = {
  enablePermanentDelegate: false,
  enableTransferHook: false,
};

// SSS-2: Compliant Stablecoin
// Extensions: MetadataPointer + PermanentDelegate + TransferHook
Presets.SSS_2 = {
  enablePermanentDelegate: true,
  enableTransferHook: true,
};
```

### PresetConfig Interface

```typescript
interface PresetConfig {
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
}
```

### Custom Configuration via TOML

The CLI supports custom configurations defined in TOML files:

```toml
# custom-config.toml
name = "My Stablecoin"
symbol = "MSC"
decimals = 6
uri = "https://example.com/metadata.json"

[features]
enable_permanent_delegate = true
enable_transfer_hook = true
```

```bash
sss-token init --custom custom-config.toml
```

---

## SDK API Reference

### SolanaStablecoin Class

The main entry point for all SDK operations. Uses a factory pattern -- instances are created via static `create()` or `load()` methods.

#### Constructor Properties

| Property | Type | Description |
|----------|------|-------------|
| `connection` | `Connection` | Solana RPC connection |
| `provider` | `AnchorProvider` | Anchor provider with wallet |
| `program` | `Program<Stablecoin>` | Stablecoin Anchor program |
| `transferHookProgram` | `Program<TransferHook> | null` | Transfer hook program (null for SSS-1) |
| `configAddress` | `PublicKey` | Stablecoin config PDA |
| `mintAddress` | `PublicKey` | Token-2022 mint address (Keypair, not PDA) |
| `rolesAddress` | `PublicKey` | Roles PDA |

#### Factory Methods

##### `SolanaStablecoin.create()`

Creates a new stablecoin on-chain and returns an SDK instance.

```typescript
static async create(
  provider: AnchorProvider,
  stablecoinProgram: Program<Stablecoin>,
  transferHookProgram: Program<TransferHook> | null,
  params: CreateParams
): Promise<{ sdk: SolanaStablecoin; signature: string; mintKeypair: Keypair }>
```

**Parameters:**

```typescript
interface CreateParams {
  preset?: PresetConfig;              // Default: SSS_1
  name: string;                       // Token name (max 32 chars)
  symbol: string;                     // Token symbol (max 10 chars)
  uri?: string;                       // Metadata URI (max 200 chars, default: "")
  decimals?: number;                  // Decimal places (default: 6, max: 9)
  authority?: PublicKey;              // Master authority (default: wallet pubkey)
  transferHookProgramId?: PublicKey;  // Required for SSS-2
}
```

**Returns:**
- `sdk`: The `SolanaStablecoin` instance ready for operations.
- `signature`: Transaction signature of the initialize instruction.
- `mintKeypair`: The generated mint keypair (store this securely).

**Behavior:**
1. Generates a fresh `Keypair` for the mint.
2. Derives the config PDA from the mint: `["stablecoin_config", mint.key()]`.
3. Derives the roles PDA from the config: `["roles", config.key()]`.
4. Calls the `initialize` instruction with selected extensions.
5. If SSS-2, also calls `initialize_extra_account_meta_list` on the transfer hook program.
6. Calls `refresh()` to load the config into cache.

##### `SolanaStablecoin.load()`

Loads an existing stablecoin from its config address.

```typescript
static async load(
  provider: AnchorProvider,
  stablecoinProgram: Program<Stablecoin>,
  transferHookProgram: Program<TransferHook> | null,
  configAddress: PublicKey
): Promise<SolanaStablecoin>
```

Fetches the `StablecoinConfig` account, extracts the mint address, derives the roles address, and returns a ready-to-use SDK instance.

---

#### Core Operations

##### `mint()`

Mint tokens to a recipient. Requires an authorized minter with available quota.

```typescript
async mint(params: MintParams): Promise<TransactionSignature>
```

```typescript
interface MintParams {
  recipient: PublicKey;  // Wallet to receive tokens
  amount: BN;           // Amount in base units
  minter: PublicKey;     // Minter public key (must be active, with quota)
}
```

The SDK automatically creates the recipient's Associated Token Account (ATA) if it does not exist.

##### `burn()`

Burn tokens from the caller's own token account.

```typescript
async burn(amount: BN): Promise<TransactionSignature>
```

##### `freezeAccount()`

Freeze a token account. Requires the freezer role.

```typescript
async freezeAccount(targetAta: PublicKey): Promise<TransactionSignature>
```

##### `thawAccount()`

Thaw a previously frozen token account. Requires the freezer role.

```typescript
async thawAccount(targetAta: PublicKey): Promise<TransactionSignature>
```

##### `pause()`

Pause all stablecoin operations globally. Requires the pauser role.

```typescript
async pause(): Promise<TransactionSignature>
```

##### `unpause()`

Resume stablecoin operations. Requires the pauser role.

```typescript
async unpause(): Promise<TransactionSignature>
```

---

#### Role Management

##### `updateMinter()`

Create or update a minter's configuration. Requires the master authority.

```typescript
async updateMinter(
  minter: PublicKey,
  params: UpdateMinterParams
): Promise<TransactionSignature>
```

```typescript
interface UpdateMinterParams {
  quota: BN;       // Maximum amount this minter can mint
  active: boolean; // Whether the minter is active
}
```

##### `updateRoles()`

Update role assignments. Requires the master authority. Omitted fields are unchanged.

```typescript
async updateRoles(params: UpdateRolesParams): Promise<TransactionSignature>
```

```typescript
interface UpdateRolesParams {
  pauser?: PublicKey | null;
  freezer?: PublicKey | null;
  blacklister?: PublicKey | null;
  seizer?: PublicKey | null;
}
```

##### `transferAuthority()`

Initiate a two-step authority transfer. Requires the current master authority.

```typescript
async transferAuthority(newAuthority: PublicKey): Promise<TransactionSignature>
```

##### `acceptAuthority()`

Accept a pending authority transfer. Must be called by the pending authority.

```typescript
async acceptAuthority(): Promise<TransactionSignature>
```

---

#### View Functions

##### `refresh()`

Refresh the cached config from on-chain state.

```typescript
async refresh(): Promise<void>
```

##### `getConfig()`

Get the cached config. Throws if not loaded (call `refresh()` first).

```typescript
getConfig(): StablecoinConfigAccount
```

```typescript
interface StablecoinConfigAccount {
  masterAuthority: PublicKey;
  pendingAuthority: PublicKey;
  mint: PublicKey;
  decimals: number;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  isPaused: boolean;
  totalMinted: BN;
  totalBurned: BN;
  bump: number;
}
```

##### `getTotalSupply()`

Get current circulating supply (`totalMinted - totalBurned`). Refreshes from on-chain.

```typescript
async getTotalSupply(): Promise<BN>
```

##### `getTotalMinted()` / `getTotalBurned()`

```typescript
async getTotalMinted(): Promise<BN>
async getTotalBurned(): Promise<BN>
```

##### `getMinterConfig()` / `getMinters()`

```typescript
async getMinterConfig(minter: PublicKey): Promise<MinterConfigAccount | null>
async getMinters(): Promise<MinterConfigAccount[]>
```

##### `getRoles()`

```typescript
async getRoles(): Promise<RoleConfigAccount>
```

---

#### Compliance Operations (SSS-2)

All compliance operations are accessed through the `compliance` getter. They will fail with `ComplianceNotEnabled` if the stablecoin was initialized without permanent delegate and transfer hook.

```typescript
get compliance(): ComplianceOperations
```

```typescript
interface ComplianceOperations {
  blacklistAdd(address: PublicKey, reason: string): Promise<string>;
  blacklistRemove(address: PublicKey): Promise<string>;
  seize(from: PublicKey, to: PublicKey, amount: BN): Promise<string>;
  isBlacklisted(address: PublicKey): Promise<boolean>;
  getBlacklistEntry(address: PublicKey): Promise<BlacklistEntryAccount | null>;
}
```

##### `compliance.blacklistAdd()`

Add an address to the blacklist. Creates a BlacklistEntry PDA.

```typescript
await sdk.compliance.blacklistAdd(address, "OFAC SDN List match");
```

##### `compliance.blacklistRemove()`

Remove an address from the blacklist. Closes the BlacklistEntry PDA and recovers rent.

```typescript
await sdk.compliance.blacklistRemove(address);
```

##### `compliance.seize()`

Seize tokens from a source token account to a treasury token account. Uses burn + mint to bypass the transfer hook.

```typescript
await sdk.compliance.seize(fromAta, treasuryAta, new BN(1_000_000));
```

##### `compliance.isBlacklisted()`

Check if an address is blacklisted by checking if the BlacklistEntry PDA exists and has data.

```typescript
const blocked = await sdk.compliance.isBlacklisted(address); // boolean
```

##### `compliance.getBlacklistEntry()`

Fetch full blacklist entry details.

```typescript
interface BlacklistEntryAccount {
  stablecoinConfig: PublicKey;
  address: PublicKey;
  reason: string;
  blacklistedAt: BN;      // Unix timestamp
  blacklistedBy: PublicKey;
  bump: number;
}
```

---

## PDA Derivation Helpers

All PDA helpers return `[PublicKey, number]` (address and bump seed).

```typescript
import {
  getConfigAddress,
  getMinterAddress,
  getRolesAddress,
  getBlacklistAddress,
  getExtraAccountMetaListAddress,
} from "@stbr/sss-token";
```

| Function | Seeds | Program |
|----------|-------|---------|
| `getConfigAddress(programId, mint)` | `["stablecoin_config", mint]` | Stablecoin |
| `getMinterAddress(programId, config, minter)` | `["minter", config, minter]` | Stablecoin |
| `getRolesAddress(programId, config)` | `["roles", config]` | Stablecoin |
| `getBlacklistAddress(programId, config, address)` | `["blacklist", config, address]` | Stablecoin |
| `getExtraAccountMetaListAddress(hookProgramId, mint)` | `["extra-account-metas", mint]` | Transfer Hook |

### Usage Example

```typescript
import { PublicKey } from "@solana/web3.js";
import { getConfigAddress, getRolesAddress } from "@stbr/sss-token";

const PROGRAM_ID = new PublicKey("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");
const mintAddress = new PublicKey("...");

const [configAddress, configBump] = getConfigAddress(PROGRAM_ID, mintAddress);
const [rolesAddress, rolesBump] = getRolesAddress(PROGRAM_ID, configAddress);

console.log("Config PDA:", configAddress.toBase58());
console.log("Roles PDA:", rolesAddress.toBase58());
```

---

## CLI Reference

The CLI is installed as `sss-token` when installing the SDK package globally (`npm install -g @stbr/sss-token`).

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
| `--cluster <url>` | Solana cluster URL | From Solana CLI config |
| `--keypair <path>` | Path to wallet keypair file | `~/.config/solana/id.json` |
| `--program <pubkey>` | Stablecoin program ID | `B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs` |
| `--config <pubkey>` | Stablecoin config address | (required for most operations) |

### Commands

#### Initialize

```bash
# Initialize with SSS-1 preset
sss-token init --preset sss-1 --name "My Token" --symbol "MTK" --decimals 6

# Initialize with SSS-2 preset
sss-token init --preset sss-2 --name "Regulated Token" --symbol "RGT" \
  --decimals 6 --uri "https://example.com/meta.json"

# Initialize from TOML config file
sss-token init --custom config.toml
```

Output includes the config address and mint address. Save these for future operations.

#### Token Operations

```bash
sss-token mint <recipient> <amount>       # Mint tokens
sss-token burn <amount>                    # Burn tokens from your own account
sss-token freeze <token-account>           # Freeze a token account
sss-token thaw <token-account>             # Thaw a token account
```

#### Global Controls

```bash
sss-token pause                            # Pause all operations
sss-token unpause                          # Resume operations
sss-token status                           # Display stablecoin config and state
sss-token supply                           # Show supply metrics
```

#### Minter Management

```bash
sss-token minters list                     # List all minters
sss-token minters add <addr> --quota <n>   # Add/update a minter
sss-token minters remove <addr>            # Deactivate a minter
```

#### Role Management

```bash
sss-token roles list                       # List current role assignments
sss-token roles update --pauser <addr> --freezer <addr>  # Update roles
```

#### Authority Transfer

```bash
sss-token authority transfer <new-addr>    # Initiate two-step transfer
sss-token authority accept                 # Accept pending transfer
```

#### Compliance (SSS-2)

```bash
sss-token blacklist add <addr> --reason "OFAC match"  # Blacklist an address
sss-token blacklist remove <addr>                       # Remove from blacklist
sss-token blacklist check <addr>                        # Check blacklist status
sss-token seize <from-ata> --to <treasury-ata>          # Seize tokens
```

#### Information

```bash
sss-token holders [--min-balance <amount>] # List token holders
sss-token audit-log [--action <type>]      # Query audit trail
```

---

## Code Examples

### Full SSS-1 Lifecycle

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import { SolanaStablecoin, Presets } from "@stbr/sss-token";
import stablecoinIdl from "../target/idl/stablecoin.json";

// Setup
const connection = new Connection("http://localhost:8899", "confirmed");
const wallet = new Wallet(Keypair.generate());
const provider = new AnchorProvider(connection, wallet, {});
const program = new Program(stablecoinIdl, provider);

// 1. Create an SSS-1 stablecoin
const { sdk, mintKeypair } = await SolanaStablecoin.create(
  provider, program, null, {
    preset: Presets.SSS_1,
    name: "Test Dollar",
    symbol: "TSTD",
    decimals: 6,
  }
);

console.log("Config:", sdk.configAddress.toBase58());
console.log("Mint:", sdk.mintAddress.toBase58());

// 2. Add a minter with a 1,000,000 token quota
const minter = Keypair.generate();
await sdk.updateMinter(minter.publicKey, {
  quota: new BN(1_000_000_000_000), // 1M tokens * 10^6 decimals
  active: true,
});

// 3. Mint tokens to a recipient
await sdk.mint({
  recipient: wallet.publicKey,
  amount: new BN(100_000_000), // 100 tokens
  minter: minter.publicKey,
});

// 4. Check supply
const supply = await sdk.getTotalSupply();
console.log(`Supply: ${supply.toString()}`); // 100000000

// 5. Burn tokens
await sdk.burn(new BN(50_000_000)); // 50 tokens

// 6. Check updated supply
const newSupply = await sdk.getTotalSupply();
console.log(`Supply after burn: ${newSupply.toString()}`); // 50000000
```

### Full SSS-2 Compliance Flow

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";

const HOOK_PROGRAM_ID = new PublicKey("HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou");

// 1. Create an SSS-2 stablecoin
const { sdk } = await SolanaStablecoin.create(
  provider, stablecoinProgram, transferHookProgram, {
    preset: Presets.SSS_2,
    name: "Regulated Dollar",
    symbol: "REGD",
    decimals: 6,
    transferHookProgramId: HOOK_PROGRAM_ID,
  }
);

// 2. Blacklist a suspicious address
await sdk.compliance.blacklistAdd(
  suspectAddress,
  "Sanctions screening match - OFAC SDN List"
);

// 3. Verify blacklist
const isBlocked = await sdk.compliance.isBlacklisted(suspectAddress);
console.log(`Blacklisted: ${isBlocked}`); // true

// 4. Get blacklist entry details
const entry = await sdk.compliance.getBlacklistEntry(suspectAddress);
if (entry) {
  console.log(`Reason: ${entry.reason}`);
  console.log(`By: ${entry.blacklistedBy.toBase58()}`);
  console.log(`At: ${new Date(entry.blacklistedAt.toNumber() * 1000).toISOString()}`);
}

// 5. Seize tokens from the blacklisted address to treasury
await sdk.compliance.seize(suspectAta, treasuryAta, new BN(1_000_000));

// 6. Remove from blacklist after compliance review
await sdk.compliance.blacklistRemove(suspectAddress);
```

### Loading an Existing Stablecoin

```typescript
// If you already have the config address
const sdk = await SolanaStablecoin.load(
  provider,
  stablecoinProgram,
  transferHookProgram,
  configAddress
);

// Now you can use all operations
const config = sdk.getConfig();
console.log(`Paused: ${config.isPaused}`);
console.log(`Supply: ${config.totalMinted.sub(config.totalBurned).toString()}`);
```
