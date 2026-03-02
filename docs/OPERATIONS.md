# Operations Guide

This document serves as an operator runbook for managing a Solana Stablecoin Standard (SSS) stablecoin. It covers initialization, day-to-day operations, compliance procedures, monitoring, and emergency response.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initializing a Stablecoin](#initializing-a-stablecoin)
3. [Minting Tokens](#minting-tokens)
4. [Burning Tokens](#burning-tokens)
5. [Freezing and Thawing Accounts](#freezing-and-thawing-accounts)
6. [Pausing and Unpausing](#pausing-and-unpausing)
7. [Managing Roles](#managing-roles)
8. [Transferring Authority](#transferring-authority)
9. [Blacklist Management (SSS-2)](#blacklist-management-sss-2)
10. [Seizing Tokens (SSS-2)](#seizing-tokens-sss-2)
11. [Monitoring and Audit](#monitoring-and-audit)
12. [Backend Deployment](#backend-deployment)
13. [Emergency Procedures](#emergency-procedures)

---

## Prerequisites

Before performing any operations, ensure:

1. **Solana CLI** is configured with the correct cluster and wallet.
2. **Anchor** is installed (v0.31.1).
3. **Programs are deployed** to the target cluster.
4. The operator wallet has **sufficient SOL** for transaction fees and rent.

```bash
# Verify setup
solana config get
solana balance
anchor --version
```

---

## Initializing a Stablecoin

### SSS-1 (Minimal)

```bash
sss-token init \
  --preset sss-1 \
  --name "My Stablecoin" \
  --symbol "MSC" \
  --decimals 6 \
  --uri "https://example.com/metadata.json"
```

This will:
1. Generate a fresh `Keypair` for the Token-2022 mint.
2. Create the `StablecoinConfig` PDA (seeds: `["stablecoin_config", mint.key()]`).
3. Create the Token-2022 mint with `MetadataPointer` extension.
4. Initialize on-chain metadata (name, symbol, URI) on the mint account.
5. Create the `RoleConfig` PDA (all roles assigned to the initializing wallet).
6. Emit a `StablecoinInitialized` event.

### SSS-2 (Compliant)

```bash
sss-token init \
  --preset sss-2 \
  --name "Regulated Stablecoin" \
  --symbol "RSC" \
  --decimals 6 \
  --uri "https://example.com/metadata.json"
```

This additionally:
1. Adds `PermanentDelegate` extension (delegate = config PDA).
2. Adds `TransferHook` extension (hook program = transfer hook program).
3. Initializes the `ExtraAccountMetaList` PDA on the transfer hook program.

The ExtraAccountMetaList must be initialized before any transfers can succeed. The SDK and CLI handle this automatically.

### Post-Initialization Checklist

- [ ] Record the **config address** and **mint address** from the output
- [ ] Verify on-chain state with `sss-token status`
- [ ] Assign roles to dedicated operational keypairs (not the master authority)
- [ ] Configure at least one minter with an appropriate quota
- [ ] Test a small mint and burn cycle
- [ ] For SSS-2: verify the transfer hook is working by testing a transfer

---

## Minting Tokens

### Configure a Minter

Only the master authority can create or update minters.

```bash
# Add a new minter with a 10,000,000 token quota (assumes 6 decimals)
sss-token minters add <minter-address> --quota 10000000000000

# Update an existing minter's quota
sss-token minters add <minter-address> --quota 50000000000000

# Deactivate a minter (preserves history, prevents further minting)
sss-token minters remove <minter-address>
```

### Mint Tokens

The minter keypair must sign the transaction.

```bash
# Mint 1,000 tokens (6 decimals = 1,000,000,000 base units)
sss-token mint <recipient-address> 1000000000
```

**Checks performed by the program:**
- Stablecoin must not be paused (`StablecoinError::Paused`)
- Minter must be active (`StablecoinError::MinterNotActive`)
- Amount must not exceed remaining quota (`StablecoinError::MinterQuotaExceeded`)
- Amount must be greater than zero (`StablecoinError::InvalidAmount`)

### Monitor Minter Usage

```bash
sss-token minters list
```

Example output:
```
Minter                                       Quota          Minted         Remaining      Active
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAs 10,000,000.00  2,500,000.00   7,500,000.00   Yes
BrLHN4YKNq26rBzY3g5EwTJi7gfPLmPHE5Fh9bFNhNs  5,000,000.00  5,000,000.00           0.00   Yes
```

---

## Burning Tokens

Any token holder can burn their own tokens. No special role is required.

```bash
# Burn 500 tokens from your own token account
sss-token burn 500000000
```

The stablecoin must not be paused for burns to succeed.

---

## Freezing and Thawing Accounts

### Freeze an Account

Requires the **freezer** role. Operates on the Token-2022 token account (ATA), not the wallet address.

```bash
sss-token freeze <token-account-address>
```

A frozen account cannot send or receive tokens. The freeze is enforced by Token-2022 at the token account level.

### Thaw an Account

```bash
sss-token thaw <token-account-address>
```

Restores normal functionality to a previously frozen account.

---

## Pausing and Unpausing

### Pause

Requires the **pauser** role.

```bash
sss-token pause
```

**Effects of pausing:**
- `mint_tokens` reverts with `StablecoinError::Paused`
- `burn_tokens` reverts with `StablecoinError::Paused`
- SSS-2 transfers revert with `TransferHookError::StablecoinPaused` (the hook reads `is_paused` at byte offset 107)
- SSS-1 transfers are NOT affected (no transfer hook)
- Freeze, thaw, blacklist, role management, and authority transfer operations still work

### Unpause

```bash
sss-token unpause
```

---

## Managing Roles

### View Current Roles

```bash
sss-token roles list
```

Example output:
```
Role         Address
Master       9aE476sH92Vz7DMPyq5WLPkrKWivxeuTKEFKd2sZZcjj
Pauser       3Fh7bHNKEQp9Mrz1C3f7NpFuAKJdJDE8CwGwCAXkxbjR
Freezer      3Fh7bHNKEQp9Mrz1C3f7NpFuAKJdJDE8CwGwCAXkxbjR
Blacklister  5xot9PVkphiX2adznghwrAuxGs2bHqQHCiNJ5THoTxF7
Seizer       5xot9PVkphiX2adznghwrAuxGs2bHqQHCiNJ5THoTxF7
```

### Update Roles

Requires the **master authority**.

```bash
sss-token roles update \
  --pauser <new-pauser-address> \
  --freezer <new-freezer-address> \
  --blacklister <new-blacklister-address> \
  --seizer <new-seizer-address>
```

You can update one or more roles in a single transaction. Omitted roles remain unchanged.

**Best practices:**
- Assign each role to a different keypair for separation of duties.
- The master authority should be stored in a hardware wallet or multisig.
- Use the master authority only for role management and minter configuration.

---

## Transferring Authority

Authority transfer is a two-step process to prevent accidental loss of control.

### Step 1: Initiate Transfer

The current master authority initiates:

```bash
sss-token authority transfer <new-authority-address>
```

This sets `pending_authority` in the config. The current authority retains full control. Only one pending transfer can exist at a time.

### Step 2: Accept Transfer

The new authority accepts:

```bash
sss-token authority accept
```

This sets `master_authority = pending_authority` and clears `pending_authority`.

### Cancel a Pending Transfer

There is no explicit cancel instruction. The current authority can:
- Call `transfer_authority` with a different address (overwrites the pending).
- Call `transfer_authority` with their own address to effectively cancel.

---

## Blacklist Management (SSS-2)

### Add to Blacklist

Requires the **blacklister** role. The stablecoin must have compliance enabled.

```bash
sss-token blacklist add <wallet-address> --reason "OFAC SDN List match"
```

This creates a `BlacklistEntry` PDA. Once blacklisted:
- The transfer hook rejects any `transfer_checked` involving this address (sender or recipient).
- Minting to this address is still possible (minting does not invoke the transfer hook).
- To fully restrict an address, also freeze their token account.

### Remove from Blacklist

```bash
sss-token blacklist remove <wallet-address>
```

This closes the `BlacklistEntry` PDA, returns rent to the payer, and immediately removes the transfer restriction.

### Check Blacklist Status

```bash
sss-token blacklist check <wallet-address>
```

---

## Seizing Tokens (SSS-2)

Requires the **seizer** role and `enable_permanent_delegate = true`.

### Seize Procedure

```bash
# 1. Blacklist the address (creates audit trail)
sss-token blacklist add <address> --reason "Court order #12345"

# 2. Freeze the token account (prevents further activity)
sss-token freeze <token-account-address>

# 3. Seize tokens to treasury
sss-token seize <token-account-address> --to <treasury-token-account>
```

### How Seize Works

The `seize` instruction uses `burn_checked` (via permanent delegate) + `mint_to` (via mint authority) instead of `transfer_checked`. This design:

- Bypasses the transfer hook (which would block transfers involving blacklisted accounts).
- Works on frozen accounts (burn via permanent delegate ignores the freeze state).
- Is supply-neutral (burn and mint cancel out).

### Recommended Seizure Workflow

1. Document the legal basis for seizure.
2. Blacklist the address (creates on-chain `AddedToBlacklist` event).
3. Freeze the account (creates on-chain `AccountFrozen` event).
4. Seize the tokens to a designated treasury (creates on-chain `TokensSeized` event).
5. Record all transaction signatures for compliance records.
6. Report to relevant authorities as required.

---

## Monitoring and Audit

### On-Chain Events

Every state change emits a program log event. These can be captured by:

1. **Solana CLI**: `solana logs B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`
2. **Backend Event Listener**: The included backend service subscribes to program logs via WebSocket.
3. **Block explorers**: Solscan, Solana Explorer, or SolanaFM.

### Event Catalog

| Event | Emitted When |
|-------|-------------|
| `StablecoinInitialized` | New stablecoin created |
| `TokensMinted` | Tokens minted to a recipient |
| `TokensBurned` | Tokens burned by a holder |
| `AccountFrozen` | Token account frozen |
| `AccountThawed` | Token account thawed |
| `StablecoinPaused` | All operations paused |
| `StablecoinUnpaused` | Operations resumed |
| `MinterUpdated` | Minter created/updated/deactivated |
| `RolesUpdated` | Role assignments changed |
| `AuthorityTransferInitiated` | Two-step transfer started |
| `AuthorityTransferCompleted` | Two-step transfer accepted |
| `AddedToBlacklist` | Address blacklisted (SSS-2) |
| `RemovedFromBlacklist` | Address unblacklisted (SSS-2) |
| `TokensSeized` | Tokens seized (SSS-2) |

### Status Checks

```bash
sss-token status
```

Expected output:
```
Config:     9aE476sH92Vz7DMPyq5WLPkrKWivxeuTKEFKd2sZZcjj
Mint:       3Fh7bHNKEQp9Mrz1C3f7NpFuAKJdJDE8CwGwCAXkxbjR
Decimals:   6
Paused:     No
Compliance: Enabled (SSS-2)
Supply:     1,000,000.000000
Minted:     1,500,000.000000
Burned:       500,000.000000
Minters:    2 active / 3 total
```

### Supply Reconciliation

```bash
sss-token supply
```

Verify that `total_minted - total_burned` equals the expected circulating supply. The backend service can automate this check via the `/api/supply` endpoint.

### Audit Log

```bash
# All events
sss-token audit-log

# Filter by action type
sss-token audit-log --action AddedToBlacklist

# Via the backend API
curl http://localhost:3000/api/audit-log?action=TokensSeized
```

---

## Backend Deployment

### Docker Compose

```bash
cd backend
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

The backend provides:
- **REST API**: Mint, burn, blacklist, seize, audit log, webhooks.
- **Event Listener**: Real-time indexing of on-chain events via WebSocket.
- **Redis**: Caching for blacklist lookups and event storage.
- **Webhooks**: Configurable event notifications with HMAC signatures and exponential backoff retry.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (default: 3000) | HTTP server port |
| `SOLANA_RPC_URL` | Yes | Solana RPC endpoint URL |
| `SOLANA_WS_URL` | No | WebSocket endpoint (derived from RPC if not set) |
| `STABLECOIN_MINT` | Yes | Stablecoin mint address |
| `STABLECOIN_PROGRAM_ID` | Yes | Stablecoin program ID |
| `TRANSFER_HOOK_PROGRAM_ID` | No | Transfer hook program ID (SSS-2) |
| `REDIS_URL` | No (default: `redis://localhost:6379`) | Redis connection URL |
| `LOG_LEVEL` | No (default: `info`) | Logging level |

### Health Checks

```bash
# Liveness
curl http://localhost:3000/health

# Readiness (checks Solana RPC, Redis, event listener)
curl http://localhost:3000/health/ready
```

---

## Emergency Procedures

### Emergency Pause

If suspicious activity is detected, immediately pause all operations:

```bash
sss-token pause
```

This will:
- Block all new mints.
- Block all new burns.
- Block all SSS-2 transfers (via transfer hook).
- Leave role management, blacklist, and freeze operations available.

### Emergency Role Rotation

If a role keypair is compromised:

```bash
# Generate new keypair
solana-keygen new -o new-role.json

# Update the compromised role immediately
sss-token roles update --<role> $(solana-keygen pubkey new-role.json)
```

### Minter Deactivation

If a minter keypair is compromised:

```bash
sss-token minters remove <compromised-minter-address>
```

This sets `active = false` on the minter's PDA, immediately preventing further minting.

### Lost Master Authority

If the master authority keypair is lost and no pending transfer exists, the stablecoin's governance is permanently locked. To prevent this:

- Always back up the master authority keypair securely.
- Consider pre-configuring a pending authority transfer for disaster recovery.
- Consider using a multisig (e.g., Squads) as the master authority.
- Store the mint keypair separately -- while it cannot control the stablecoin, it is needed for reference.
