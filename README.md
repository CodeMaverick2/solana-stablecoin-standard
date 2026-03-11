# Solana Stablecoin Standard (SSS)

A modular, production-ready stablecoin framework for Solana. Build, deploy, and manage stablecoins with institutional-grade tooling using Token-2022 (SPL Token Extensions).

---

## Overview

The Solana Stablecoin Standard provides a layered architecture for creating stablecoins at varying compliance levels. It ships as two on-chain Anchor programs, a TypeScript SDK, a CLI tool, and a Docker-containerized backend -- everything needed to go from zero to a fully operational stablecoin.

| Layer | Description |
|-------|-------------|
| **Base (Layer 1)** | Token creation with mint/freeze authority, on-chain metadata, role management, minter quotas |
| **Compliance (Layer 2)** | Composable compliance module: transfer hook enforcement, PDA-based blacklist, permanent delegate seizure |
| **Privacy (Layer 2)** | Confidential transfers extension + on-chain allowlist (SSS-3) |
| **Presets (Layer 3)** | SSS-1 (Minimal), SSS-2 (Compliant), SSS-3 (Private) -- opinionated combinations of the layers above |

---

## Preset Comparison

| Feature | SSS-1 (Minimal) | SSS-2 (Compliant) | SSS-3 (Private) |
|---------|:---------------:|:------------------:|:----------------:|
| Mint Authority | Yes | Yes | Yes |
| Freeze Authority | Yes | Yes | Yes |
| On-Chain Metadata (MetadataPointer) | Yes | Yes | Yes |
| Role-Based Access Control | Yes | Yes | Yes |
| Pause / Unpause | Yes | Yes | Yes |
| Per-Minter Quotas | Yes | Yes | Yes |
| Two-Step Authority Transfer | Yes | Yes | Yes |
| Permanent Delegate | -- | Yes | Yes |
| Transfer Hook Enforcement | -- | Yes | Yes |
| PDA-Based Blacklist | -- | Yes | -- |
| Token Seizure (burn + mint) | -- | Yes | Yes |
| GENIUS Act Readiness | -- | Yes | Yes |
| Confidential Transfers | -- | -- | Yes |
| On-Chain Allowlist (PDA) | -- | -- | Yes |

---

## Architecture

```
+-------------------------------------------------------------------+
|                    Standard Presets (Layer 3)                      |
|   +------------------------+   +-----------------------------+    |
|   |    SSS-1 (Minimal)     |   |     SSS-2 (Compliant)       |    |
|   |  MetadataPointer only  |   |  MetadataPointer             |    |
|   |                        |   |  PermanentDelegate           |    |
|   |                        |   |  TransferHook                |    |
|   +------------------------+   +-----------------------------+    |
+-------------------------------------------------------------------+
|                  Composable Modules (Layer 2)                     |
|   [Compliance Module]              [Transfer Hook Program]        |
|   Blacklist, Seizure               Enforced on every transfer     |
|   PDA-based entries                Pause + blacklist checks       |
+-------------------------------------------------------------------+
|                       Base SDK (Layer 1)                          |
|   Mint / Burn / Freeze / Thaw / Pause / Unpause / Roles          |
|   Token-2022  |  PDA State  |  Event Emission  |  Minter Quotas  |
+-------------------------------------------------------------------+
|                        Solana Runtime                             |
|                   Token-2022 Program (SPL)                        |
+-------------------------------------------------------------------+
```

### Program Interaction

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
   | - update_roles        |       |  3. recipient bl?     |
   | - transfer_authority  |       +-----------+-----------+
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

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.75+)
- [Solana CLI](https://docs.solanalabs.com/cli/install) (1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (0.31.1)
- [Node.js](https://nodejs.org/) (18+)

### Install

```bash
git clone https://github.com/CodeMaverick2/solana-stablecoin-standard.git
cd solana-stablecoin-standard
npm install
npm run build:sdk

# Make the sss-token CLI available in your shell
export PATH="$PATH:$(pwd)/node_modules/.bin"
```

> Add the export to your `~/.bashrc` or `~/.zshrc` to make it permanent.

### Build (on-chain programs)

```bash
anchor build
```

### Deploy (Devnet)

```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

### Run Backend Services

```bash
cd backend
cp .env.example .env        # fill in STABLECOIN_MINT if you have one
docker compose up           # starts Express API on :3001 + Redis on :6379
```

The API will be available at `http://localhost:3001`. See [docs/API.md](docs/API.md) for all endpoints.

> **Note:** The backend runs on port **3001** by default so it does not conflict with the Next.js frontend on port 3000.

### Initialize a Stablecoin (CLI)

```bash
# SSS-1: Minimal stablecoin
sss-token init --preset sss-1 --name "My Token" --symbol "MTK" --decimals 6

# SSS-2: Compliant stablecoin with blacklist enforcement
sss-token init --preset sss-2 --name "My Regulated Token" --symbol "MRT" --decimals 6

# SSS-3: Private stablecoin with confidential transfers and allowlist
sss-token init --preset sss-3 --name "My Private Token" --symbol "PVTX" --decimals 6

# Custom configuration via TOML
sss-token init --custom config.toml
```

### TypeScript SDK

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

// provider = AnchorProvider, programs = Program<Stablecoin/TransferHook>
const { sdk, mintKeypair } = await SolanaStablecoin.create(
  provider,           // AnchorProvider
  stablecoinProgram,  // Program<Stablecoin>
  transferHookProgram, // Program<TransferHook> | null
  {
    preset: Presets.SSS_2,
    name: "USD Stablecoin",
    symbol: "USDX",
    decimals: 6,
  }
);

// Mint tokens (requires an authorized minter with quota)
await sdk.mint({
  recipient: userWallet,
  amount: new BN(1_000_000),
  minter: minterKeypair,
});

// SSS-2 compliance operations
const isBlacklisted = await sdk.compliance.isBlacklisted(suspectAddress);
await sdk.compliance.blacklistAdd(suspectAddress, "OFAC match");
await sdk.compliance.seize(frozenAccount, treasuryAccount, new BN(1_000_000));
```

---

## Program IDs (Devnet)

Both programs are deployed and verified on Solana Devnet.

| Program | Address | Deployment Signature |
|---------|---------|---------------------|
| Stablecoin | [`B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`](https://explorer.solana.com/address/B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs?cluster=devnet) | [`4KzeeBZN…RiwRJE`](https://explorer.solana.com/tx/4KzeeBZNZxL3pjwnrTZNauFBKoeHWCgNNbs1AVRvQ4TCQLwcgwk6eYKu9S1Pf7pWD4osK6CNhTp4BBkaEvRiwRJE?cluster=devnet) |
| Transfer Hook | [`HgSUZDiL…SaLou`](https://explorer.solana.com/address/HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou?cluster=devnet) | [`5tTgyAtJ…CVyKX`](https://explorer.solana.com/tx/5tTgyAtJv7QybppZmJ4A1fFDCQGbTPqxYZ1MxLwDBbSRs689ihpuajvTH1ivqirMThAjsSrpCC7nZSsEKDLCVyKX?cluster=devnet) |

**Verification:** Both program IDs are live on devnet. You can verify with:

```bash
solana program show B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs --url devnet
solana program show HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou --url devnet
```

---

## Live Devnet Demo Tokens

Three stablecoins are deployed and funded on devnet. You can inspect them immediately without deploying anything:

| Token | Preset | Mint Address | Config PDA | Supply |
|-------|--------|-------------|-----------|--------|
| **DUSD** | SSS-1 (Minimal) | [`5qLVX2bZ…TnD7`](https://explorer.solana.com/address/5qLVX2bZBeCF3XLkvKKb4VJM4dvu6nNqboChT6q4TnD7?cluster=devnet) | `H8QgPMh7s9Wbt1XRD7mP6spmnR5LmnUgoZwpv1it5ADV` | 1 000 000 |
| **RUSD** | SSS-2 (Compliant) | [`B3RPAUgY…JLAz`](https://explorer.solana.com/address/B3RPAUgYoLqgvdwJX7ryPemj8wtzfNamuCvfC2DbJLAz?cluster=devnet) | `5PNfiGnWYTBTrKVhUsPJy8kpEAxm684KAq62Ecz5TR5m` | 5 000 000 |
| **PUSD** | SSS-3 (Private) | [`8kHKH3CG…WD3`](https://explorer.solana.com/address/8kHKH3CGBsEaPjxQisrSCd1EpXF2XG8dDe4PQFcK8WD3?cluster=devnet) | `H5dmoyi7ixmQ4pKSZC9wjhjETdX9GNaoQQ7ro5teDu22` | 2 500 000 |

**Reviewer quick-check (no deploy required):**

```bash
# Install and build (once)
npm install && npm run build:sdk
export PATH="$PATH:$(pwd)/node_modules/.bin"

# Inspect each live stablecoin
sss-token status --config H8QgPMh7s9Wbt1XRD7mP6spmnR5LmnUgoZwpv1it5ADV --keypair ~/.config/solana/id.json
sss-token status --config 5PNfiGnWYTBTrKVhUsPJy8kpEAxm684KAq62Ecz5TR5m --keypair ~/.config/solana/id.json
sss-token status --config H5dmoyi7ixmQ4pKSZC9wjhjETdX9GNaoQQ7ro5teDu22 --keypair ~/.config/solana/id.json

# Supply stats
sss-token supply --config H8QgPMh7s9Wbt1XRD7mP6spmnR5LmnUgoZwpv1it5ADV --keypair ~/.config/solana/id.json

# SSS-2: check a blacklisted address
sss-token blacklist check 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin --config 5PNfiGnWYTBTrKVhUsPJy8kpEAxm684KAq62Ecz5TR5m --keypair ~/.config/solana/id.json

# SSS-3: check allowlist
sss-token allowlist check 315v8xkbFkLWc6LQ28RooSHkziBhGYkX1zpoXcCSQN2y --config H5dmoyi7ixmQ4pKSZC9wjhjETdX9GNaoQQ7ro5teDu22 --keypair ~/.config/solana/id.json
```

Or paste any mint address directly into the [frontend dashboard](http://localhost:3000) to see preset detection, supply stats, and feature flags in the UI.

---

## CLI Reference

The `sss-token` CLI provides full operational control over a stablecoin instance.

| Command | Description |
|---------|-------------|
| `sss-token init` | Initialize a new stablecoin with a preset or custom config |
| `sss-token mint <recipient> <amount>` | Mint tokens to a recipient |
| `sss-token burn <amount>` | Burn tokens from your own account |
| `sss-token freeze <address>` | Freeze a token account |
| `sss-token thaw <address>` | Thaw a frozen token account |
| `sss-token pause` | Pause all stablecoin operations globally |
| `sss-token unpause` | Resume stablecoin operations |
| `sss-token status` | Display stablecoin configuration and state |
| `sss-token supply` | Show total minted, burned, and circulating supply |
| `sss-token blacklist add <address>` | Add an address to the blacklist (SSS-2) |
| `sss-token blacklist remove <address>` | Remove an address from the blacklist (SSS-2) |
| `sss-token blacklist check <address>` | Check if an address is blacklisted (SSS-2) |
| `sss-token seize <from> --to <treasury>` | Seize tokens from an account (SSS-2) |
| `sss-token allowlist add <address>` | Add an address to the allowlist (SSS-3) |
| `sss-token allowlist remove <address>` | Remove an address from the allowlist (SSS-3) |
| `sss-token allowlist check <address>` | Check if an address is on the allowlist (SSS-3) |
| `sss-token minters list` | List all configured minters |
| `sss-token minters add` | Add or update a minter |
| `sss-token minters remove` | Deactivate a minter |
| `sss-token roles list` | List current role assignments |
| `sss-token roles update` | Update role assignments |
| `sss-token authority transfer <new>` | Initiate two-step authority transfer |
| `sss-token authority accept` | Accept a pending authority transfer |
| `sss-token holders` | List token holders with balances (requires RPC with secondary index support) |
| `sss-token audit-log` | Query the on-chain audit trail |

---

## Testing

**120 tests passing across 8 test files — all green.**

```bash
# Run all 120 tests (builds programs, starts local validator, runs all suites)
anchor test

# Run individual suites (skip rebuild — uses previously built programs)
npm run test:sss1          # SSS-1 preset lifecycle tests
npm run test:sss2          # SSS-2 preset lifecycle tests
npm run test:sss3          # SSS-3 private stablecoin tests
npm run test:lifecycle     # Full end-to-end lifecycle
npm run test:compliance    # Blacklist and seizure tests
npm run test:roles         # Role-based access control tests
npm run test:edge          # Edge cases and error conditions
npm run test:token-extensions  # Token-2022 extension verification (mint authorities, account sizes)
```

**Devnet smoke-test against live tokens (CLI):**

```bash
# Runs 26 CLI commands against the deployed devnet instances — no local validator needed
bash run_cli_tests.sh
```

### Test Coverage

| Suite | File | What It Tests |
|-------|------|---------------|
| SSS-1 | `tests/sss-1.ts` | Full SSS-1 lifecycle: init, mint, transfer, freeze, thaw, burn |
| SSS-2 | `tests/sss-2.ts` | Full SSS-2 lifecycle: init, mint, transfer, blacklist, freeze, seize, burn |
| SSS-3 | `tests/sss-3.ts` | Private stablecoin: allowlist enforcement, CT extension size verification, seize bypass proof, allowlist independence |
| Lifecycle | `tests/full-lifecycle.ts` | End-to-end flows for both presets |
| Compliance | `tests/compliance.ts` | Blacklist enforcement, transfer hook rejection, seizure |
| Roles | `tests/roles.ts` | Minter quotas, pauser, freezer, blacklister, seizer access control |
| Edge Cases | `tests/edge-cases.ts` | Zero amounts, self-transfers, double-blacklist, unauthorized callers, paused operations |
| Token-2022 Extensions | `tests/token-extensions.ts` | Verifies Token-2022 extension configuration on-chain for all three presets: mint authorities are PDAs, extension account sizes grow correctly per preset, SSS-3 CT extension bytes confirmed |

---

## Project Structure

```
solana-stablecoin-standard/
+-- programs/
|   +-- stablecoin/                 # Main stablecoin Anchor program
|   |   +-- src/
|   |       +-- lib.rs              # Program entry point, instruction dispatch
|   |       +-- constants.rs        # PDA seeds, length limits
|   |       +-- error.rs            # Custom error codes
|   |       +-- events.rs           # Anchor events for audit trail
|   |       +-- state.rs            # Account structs (Config, Minter, Roles, Blacklist, Allowlist)
|   |       +-- instructions/       # One file per instruction
|   |           +-- initialize.rs   # Mint creation with dynamic Token-2022 extensions
|   |           +-- mint.rs         # Minting with quota enforcement
|   |           +-- burn.rs         # Self-burn by token holders
|   |           +-- freeze_account.rs
|   |           +-- thaw_account.rs
|   |           +-- pause.rs
|   |           +-- unpause.rs
|   |           +-- update_minter.rs
|   |           +-- update_roles.rs
|   |           +-- transfer_authority.rs  # Two-step transfer + accept
|   |           +-- add_to_blacklist.rs    # SSS-2 only
|   |           +-- remove_from_blacklist.rs
|   |           +-- seize.rs               # burn_checked + mint_to pattern
|   |           +-- add_to_allowlist.rs    # SSS-3 only
|   |           +-- remove_from_allowlist.rs
+-- programs/
|   +-- transfer-hook/              # Transfer hook program (SSS-2 blacklist / SSS-3 allowlist)
|       +-- src/
|           +-- lib.rs              # Dual-mode hook: blacklist or allowlist based on config flag
|           +-- error.rs            # Hook-specific errors
|           +-- state.rs            # StablecoinConfigRef (layout mirror)
+-- sdk/
|   +-- core/                       # @stbr/sss-token TypeScript SDK + CLI
|       +-- src/
|           +-- index.ts            # Public exports
|           +-- stablecoin.ts       # SolanaStablecoin class (factory: create/load)
|           +-- pda.ts              # PDA derivation helpers
|           +-- presets.ts          # SSS_1, SSS_2, SSS_3 preset configs
|           +-- types.ts            # TypeScript interfaces
|           +-- cli.ts              # Commander-based CLI (sss-token)
|           +-- oracle.ts           # Oracle module: Switchboard V2 + Pyth price parsing
|           +-- tui.ts              # Interactive admin TUI (readline/ANSI, no deps)
+-- backend/                        # Docker-containerized backend services
|   +-- src/
|   |   +-- main.ts                 # Express app bootstrap, graceful shutdown
|   |   +-- services/
|   |   |   +-- mint-burn.ts        # Mint/burn service with raw instruction building
|   |   |   +-- event-listener.ts   # WebSocket log subscription, event decoding
|   |   |   +-- compliance.ts       # Blacklist management, seizure, audit log
|   |   |   +-- webhook.ts          # Webhook dispatch with HMAC + exponential backoff
|   |   +-- routes/
|   |       +-- index.ts            # REST API route definitions
|   +-- Dockerfile                  # Multi-stage production build
|   +-- docker-compose.yml          # Backend + Redis stack
|   +-- .env.example                # Environment variable template
+-- frontend/                       # Example Next.js 14 dashboard
|   +-- src/
|   |   +-- app/page.tsx            # Stablecoin inspector: supply, flags, preset detection
|   |   +-- components/             # Navbar, StatCard, WalletProvider, AdminPanel
|   |   +-- hooks/useStablecoin.ts  # On-chain config parsing
|   |   +-- hooks/useAdminActions.ts # Anchor write operations (mint, pause, blacklist)
|   |   +-- idl/stablecoin.json     # Bundled IDL for client-side tx building
|   +-- package.json
+-- tests/                          # Integration tests (ts-mocha, 120 tests)
|   +-- sss-1.ts                    # SSS-1 lifecycle
|   +-- sss-2.ts                    # SSS-2 lifecycle
|   +-- sss-3.ts                    # SSS-3 private stablecoin + allowlist + CT extension
|   +-- full-lifecycle.ts
|   +-- compliance.ts
|   +-- roles.ts
|   +-- edge-cases.ts
|   +-- token-extensions.ts         # Token-2022 extension verification (mint authorities, sizes)
+-- trident-tests/                  # Fuzz tests (honggfuzz via Trident)
|   +-- fuzz_tests/fuzz_0/          # Supply, pause, and quota invariant checks
+-- docs/                           # Documentation (9 files)
+-- Anchor.toml
+-- Cargo.toml                      # Rust workspace
+-- Trident.toml                    # Fuzz test configuration
+-- package.json                    # NPM workspace
+-- tsconfig.json
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | PDA layout, program interactions, security model, design decisions |
| [SDK Reference](docs/SDK.md) | TypeScript SDK API, CLI commands, preset configs, PDA helpers |
| [Operations Guide](docs/OPERATIONS.md) | Operator runbook: how to deploy, mint, freeze, seize, manage roles |
| [SSS-1 Specification](docs/SSS-1.md) | Minimal Stablecoin Standard specification |
| [SSS-2 Specification](docs/SSS-2.md) | Compliant Stablecoin Standard specification |
| [SSS-3 Specification](docs/SSS-3.md) | Private Stablecoin Standard specification (confidential transfers + allowlist) |
| [Compliance](docs/COMPLIANCE.md) | Regulatory considerations, GENIUS Act mapping, audit trail |
| [API Reference](docs/API.md) | Backend REST API reference |
| [Oracle Integration](docs/ORACLE.md) | Switchboard V2 + Pyth price feed integration guide |

---

## Bonus Features

### SSS-3: Private Stablecoin

SSS-3 extends SSS-2 with Token-2022 `ConfidentialTransferMint` (ElGamal-based encrypted balances) and an on-chain PDA allowlist — the inverse of the blacklist. Only explicitly allowlisted addresses may send or receive tokens. See [docs/SSS-3.md](docs/SSS-3.md).

```bash
sss-token init --preset sss-3 --name "Private USD" --symbol "PUSD" --decimals 6
sss-token allowlist add <address>    # grant transfer permission
sss-token allowlist remove <address> # revoke transfer permission
```

### Oracle Integration Module

`sdk/core/src/oracle.ts` — reads Switchboard V2 aggregator and Pyth price accounts via raw on-chain byte parsing. Zero oracle-SDK dependencies; only `@solana/web3.js` is required. Use it to gate mint/redeem operations on peg deviation:

```typescript
import { OracleModule } from "@stbr/sss-token";
const oracle = new OracleModule(connection);
const price = await oracle.getSwitchboardPrice(feedPubkey);
if (!oracle.checkPegDeviation(price.price, 1.0, 50)) throw new Error("peg deviation > 50 bps");
```

See [docs/ORACLE.md](docs/ORACLE.md).

### Interactive Admin TUI

`sdk/core/src/tui.ts` — terminal UI for real-time monitoring and operations. Uses only Node.js `readline` and ANSI escape codes (zero external UI dependencies).

```bash
sss-token tui --config <config-address> --keypair ~/.config/solana/id.json
```

**TUI screenshot:**

```
╔══════════════════════════════════════════════╗
║   Solana Stablecoin Standard — Admin TUI     ║
╚══════════════════════════════════════════════╝
  Mint:   B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs
  Config: 9XyRa7Pu...

─────────────────────────────────────────────────
  Main Menu
─────────────────────────────────────────────────
  [1]  View Status
  [2]  Mint Tokens
  [3]  Burn Tokens
  [4]  Pause / Unpause
  [5]  Freeze / Thaw Account
  [6]  Manage Blacklist
  [7]  Manage Allowlist
  [8]  Manage Minters
  [9]  View Holders
  [10] Roles (view / update)
  [0]  Exit
─────────────────────────────────────────────────
Select an option:
```

All ten menu actions are fully interactive — each prompts for required inputs and shows the transaction signature on success.

### Example Frontend

`frontend/` — Next.js 14 admin dashboard. Connects via Phantom or Solflare to inspect and operate any SSS stablecoin.

**Features:**
- Config lookup by mint address — preset detection (SSS-1/2/3), supply stats, feature flags
- **Admin Panel** (wallet connected): Mint tokens, Pause/Unpause, Blacklist management
- Solana Explorer links for all accounts and transactions

```bash
cd frontend && npm install && npm run dev
# open http://localhost:3000
```

**Frontend Walkthrough (for demo/video):**

1. **Start** — open `http://localhost:3000`
2. **Connect wallet** — click "Select Wallet" (top-right), choose Phantom or Solflare set to **Devnet**
3. **Look up a stablecoin** — paste any SSS mint address in the search box and click "Load". The dashboard shows:
   - Preset badge (SSS-1 / SSS-2 / SSS-3)
   - Total minted, burned, circulating supply
   - Active extension flags (transfer hook, permanent delegate, confidential transfer, allowlist)
   - Config PDA address with Solana Explorer link
4. **Admin Panel** (only visible when wallet is connected):
   - **Mint Tokens tab** — enter recipient wallet address + amount, click "Mint". Requires your wallet to be an authorized minter with quota remaining. Shows the tx signature on success.
   - **Pause / Unpause tab** — shows current status (red = paused, green = active). Click the button to toggle. Requires pauser role.
   - **Blacklist tab** — toggle Add/Remove, enter target address (+ reason for Add), click submit. Requires blacklister role.
5. **Transaction links** — every successful write operation shows a Solana Explorer devnet link you can click to verify on-chain.

> **Prerequisites for write operations:** Your connected wallet must hold the relevant role (minter/pauser/blacklister). When you initialize a stablecoin with `sss-token init`, the deployer wallet is set as master authority and default role holder.

### Fuzz Tests

`trident-tests/` — property-based fuzz tests using Trident + honggfuzz. Checks three invariants after any reachable execution sequence:
1. `total_minted − total_burned == on-chain Token-2022 supply`
2. No mint instruction succeeds while `is_paused == true`
3. `minter.minted <= minter.quota` for every MinterConfig PDA

---

## Technology Stack

| Component | Technologies |
|-----------|-------------|
| On-Chain Programs | Anchor 0.31.1, Token-2022 (SPL Token Extensions), `spl-transfer-hook-interface` |
| SDK | TypeScript, `@coral-xyz/anchor`, `@solana/spl-token`, `@solana/web3.js` |
| CLI | Commander.js, TOML config support |
| Backend | Express.js, Redis (ioredis), Pino logger, Docker |
| Testing | ts-mocha, Chai, 120 integration tests across 8 files |

### Dependency Versions

```toml
# Rust (Cargo.toml workspace)
anchor-lang = "0.31.1"
anchor-spl = "0.31.1"
spl-token-2022 = "6.0.0"
spl-transfer-hook-interface = "0.9.0"
spl-tlv-account-resolution = "0.9.0"
```

```json
// TypeScript (package.json)
"@coral-xyz/anchor": "^0.31.1",
"@solana/spl-token": "^0.4.10",
"@solana/web3.js": "^1.98.0",
"commander": "^12.1.0"
```

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change. Ensure all tests pass before submitting a pull request.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
