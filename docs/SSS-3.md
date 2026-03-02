# SSS-3: Private Stablecoin Standard

## Overview

SSS-3 is the private stablecoin preset in the Solana Stablecoin Standard. It extends SSS-2 with two additional capabilities: an **allowlist** that restricts token transfers to pre-approved addresses only, and the **ConfidentialTransfer** Token-2022 extension that shields token balances and transfer amounts from on-chain observers.

Where SSS-2 uses a blacklist (all addresses permitted by default; specific addresses blocked), SSS-3 inverts the model: **no address may transact unless it has been explicitly approved**. This makes SSS-3 the appropriate choice for regulated environments where the issuer needs positive confirmation of each participant's identity before they interact with the token.

**Stablecoin Program ID**: `B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`
**Transfer Hook Program ID**: `HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou`

---

## Use Cases

- **Privacy-preserving institutional settlement**: Banks and broker-dealers that must settle with each other without broadcasting balances or amounts to the general public.
- **Regulated privacy coins**: Stablecoins that must satisfy both KYC/AML requirements (allowlist gate) and financial privacy expectations (confidential amounts).
- **KYC-gated transfers**: Any instrument where every counterparty must have completed identity verification before they can send or receive tokens.
- **Central bank digital currencies (CBDC) with privacy**: Government-issued digital currency experiments that require citizen privacy while retaining full issuer control over participation.
- **Private fund tokenization**: Tokenized money market funds, hedge fund shares, or other restricted instruments where balances must not be publicly observable.

---

## Feature Matrix

| Feature | SSS-1 | SSS-2 | SSS-3 |
|---------|:-----:|:-----:|:-----:|
| Mint authority with quotas | Yes | Yes | Yes |
| Freeze authority | Yes | Yes | Yes |
| On-chain metadata (MetadataPointer) | Yes | Yes | Yes |
| Role-based access control | Yes | Yes | Yes |
| Pause / unpause | Yes | Yes | Yes |
| Two-step authority transfer | Yes | Yes | Yes |
| PermanentDelegate (seizure) | -- | Yes | Yes |
| TransferHook enforcement | -- | Yes | Yes |
| Blacklist (denylist) | -- | Yes | -- |
| **Allowlist (allowlist)** | -- | -- | **Yes** |
| **ConfidentialTransfer (shielded balances)** | -- | -- | **Yes** |
| Transfer enforcement | None | Pause + blacklist | Pause + allowlist |
| Token seizure | -- | Yes (burn + mint) | Yes (burn + mint) |
| GENIUS Act compliance ready | No | Yes | Yes |
| Participant privacy | No | No | Yes |

---

## Architecture

### Allowlist Mode vs Blacklist Mode

SSS-2 and SSS-3 both use a transfer hook, but they enforce opposite access policies:

| Dimension | SSS-2 (blacklist) | SSS-3 (allowlist) |
|-----------|:-----------------:|:-----------------:|
| Default stance | Permit | Deny |
| Enforcement | Block if PDA exists | Block if PDA absent |
| PDA name | `BlacklistEntry` | `AllowlistEntry` |
| PDA seed prefix | `"blacklist"` | `"allowlist"` |
| Who manages list | Blacklister role | Blacklister role (same role) |
| Config flag | `enable_transfer_hook` | `enable_allowlist` |

In allowlist mode, the transfer hook checks for the existence of an `AllowlistEntry` PDA for both the sender and the recipient. If either PDA is absent, the transfer is rejected with `SenderNotAllowlisted` or `RecipientNotAllowlisted`.

### Config Flags

The `StablecoinConfig` account records which preset was used at initialization:

```
enable_permanent_delegate: bool   // true for SSS-2 and SSS-3
enable_transfer_hook:      bool   // true for SSS-2 and SSS-3
enable_confidential_transfer: bool // true only for SSS-3
enable_allowlist:          bool   // true only for SSS-3
```

The program exposes two helper methods on `StablecoinConfig`:

- `is_compliance_enabled()` — returns `true` when `enable_permanent_delegate && enable_transfer_hook`
- `is_privacy_enabled()` — returns `true` when `is_compliance_enabled() && enable_allowlist`

The `add_to_allowlist` and `remove_from_allowlist` instructions require `is_privacy_enabled() == true`. Calling them on an SSS-1 or SSS-2 stablecoin returns `AllowlistNotEnabled`.

---

## Token-2022 ConfidentialTransfer Extension

### What It Does

The `ConfidentialTransferMint` extension enables **ElGamal-encrypted balances**. When configured, token accounts hold two balance representations:

1. **Pending encrypted balance** — new incoming amounts, not yet applied.
2. **Available encrypted balance** — the account's spendable balance, encrypted under the owner's ElGamal public key.

Only the account owner (who holds the ElGamal private key) can decrypt their own balance. The on-chain ledger stores only ciphertexts. Third-party observers can verify that a transfer is valid (via zero-knowledge proofs) but cannot learn the amount or the resulting balance.

### Initialization

The `ConfidentialTransferMint` extension is configured on the mint during `initialize`. The config PDA is set as the confidential transfer authority, allowing the issuer to:

- Enable or disable confidential transfers globally.
- Approve individual token accounts to use confidential transfers (if auto-approve is off).
- Audit balances using the auditor ElGamal key.

### Auditor Key

The mint's `ConfidentialTransferMint` extension optionally stores an **auditor ElGamal public key**. When set, every confidential transfer also encrypts the amount under the auditor key. This allows the issuer (holding the auditor private key) to decrypt any transfer amount, providing a regulatory audit capability while preserving privacy from other observers.

### Token-2022 Extension Initialization Order for SSS-3

```
1. create_account            -- allocate space for all four extensions
2. initialize_metadata_pointer
3. initialize_permanent_delegate  -- config PDA as permanent delegate
4. initialize_transfer_hook       -- set transfer hook program
5. initialize_confidential_transfer_mint -- set CT authority + auditor key
6. initialize_mint2               -- mint authority + freeze authority = config PDA
7. initialize_token_metadata      -- write name, symbol, URI
```

---

## Allowlist Lifecycle

```
                add_to_allowlist(address, reason)
                        |
                        v
              +------------------------+
              | AllowlistEntry PDA     |
              | Seeds: ["allowlist",   |
              |  config, address]      |
              | Fields: address,       |
              |  reason, timestamp,    |
              |  allowlisted_by        |
              +------------------------+
                        |
              Address can now send and receive tokens
              (transfer hook verifies PDA existence)
                        |
                        v
              +------------------------+
              | Token transfers flow   |
              | normally through hook  |
              +------------------------+
                        |
              remove_from_allowlist(address)
                        |
                        v
              AllowlistEntry PDA closed (rent returned)
              Address is immediately blocked from transfers
```

### Adding an Address

1. The blacklister calls `add_to_allowlist(address, reason)`.
2. The program verifies the stablecoin has `enable_allowlist = true`.
3. The `AllowlistEntry` PDA is initialized with the address, reason, timestamp, and the blacklister's pubkey.
4. An `AddedToAllowlist` event is emitted.
5. The transfer hook will now accept transfers involving this address (subject to other checks).

### Transacting

Token transfers go through the transfer hook as in SSS-2. The hook performs:

1. Pause check (same as SSS-2).
2. Sender allowlist check: `AllowlistEntry` PDA for the sender must exist and have data.
3. Recipient allowlist check: `AllowlistEntry` PDA for the recipient must exist and have data.

If either check fails, the transfer reverts.

### Removing an Address

1. The blacklister calls `remove_from_allowlist(address)`.
2. The `AllowlistEntry` PDA is closed and rent is returned to the payer.
3. A `RemovedFromAllowlist` event is emitted.
4. The transfer hook immediately begins rejecting transfers involving this address.

---

## Transfer Hook Behavior: Allowlist Mode vs Blacklist Mode

```
SSS-2 transfer hook (blacklist mode):
  1. assert_is_transferring()
  2. Is stablecoin paused?          --> Reject if yes
  3. Does sender BlacklistEntry exist?   --> Reject if yes
  4. Does recipient BlacklistEntry exist? --> Reject if yes
  5. Pass

SSS-3 transfer hook (allowlist mode):
  1. assert_is_transferring()
  2. Is stablecoin paused?          --> Reject if yes
  3. Does sender AllowlistEntry exist?   --> Reject if NO (not on allowlist)
  4. Does recipient AllowlistEntry exist? --> Reject if NO (not on allowlist)
  5. Pass
```

The hook reads the `enable_allowlist` flag from the `StablecoinConfig` account to determine which enforcement mode to apply. A single transfer hook program can therefore service both SSS-2 and SSS-3 mints.

### ExtraAccountMetaList for SSS-3

The extra accounts passed to the transfer hook for SSS-3 mirror SSS-2 but reference allowlist PDAs instead of blacklist PDAs:

| Index | Account | Purpose |
|-------|---------|---------|
| 5 | Stablecoin Config | Read `is_paused` and `enable_allowlist` flags |
| 6 | Stablecoin Program | Program ID for allowlist PDA derivation |
| 7 | Sender Allowlist Entry | Derived from source token owner |
| 8 | Recipient Allowlist Entry | Derived from dest token owner |
| 9 | Transfer Hook Program | Self-reference for PDA derivation context |

The allowlist entry PDAs at indices 7 and 8 are derived dynamically:
- **Seeds**: `["allowlist", config_key (from index 5), owner_pubkey (from token account data at offset 32)]`
- **Program**: stablecoin program (index 6)

---

## Account Layout

### AllowlistEntry PDA

```
Seeds:   ["allowlist", config.key(), address]
Program: Stablecoin (B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs)

Offset  Size  Field
0       8     Anchor discriminator
8       32    stablecoin_config      (Pubkey)
40      32    address                (Pubkey)  -- the allowlisted wallet
72      4+N   reason                 (String, N <= 128 bytes)
76+N    8     allowlisted_at         (i64)     -- Unix timestamp
84+N    32    allowlisted_by         (Pubkey)  -- who added this entry
116+N   1     bump                   (u8)
```

Total size is variable due to the reason string. The Anchor `init` constraint allocates space as `AllowlistEntry::LEN`, which reserves 128 bytes for the reason field (worst case).

### StablecoinConfig (SSS-3 additions)

The `StablecoinConfig` account layout is the same as SSS-1/SSS-2 with two additional bool fields in the reserved region:

```
Offset  Size  Field
...
107     1     is_paused
108     1     enable_confidential_transfer   (true for SSS-3)
109     1     enable_allowlist              (true for SSS-3)
```

---

## Instruction Reference

### add_to_allowlist

Adds an address to the allowlist. Only callable on SSS-3 stablecoins (`enable_allowlist = true`).

| Account | Type | Writable | Signer | Description |
|---------|------|:--------:|:------:|-------------|
| `payer` | Wallet | Yes | Yes | Pays rent for the AllowlistEntry PDA |
| `blacklister` | Wallet | No | Yes | Must match `roles.blacklister` |
| `roles` | RoleConfig PDA | No | No | Validates blacklister role |
| `config` | StablecoinConfig PDA | No | No | Validates allowlist is enabled |
| `allowlist_entry` | AllowlistEntry PDA | Yes | No | Created by this instruction |
| `system_program` | System | No | No | For PDA initialization |

**Arguments**:
- `address: Pubkey` — the wallet to allowlist
- `reason: String` — audit reason (max 128 characters)

**Errors**:
- `Unauthorized` — caller is not the blacklister
- `AllowlistNotEnabled` — stablecoin does not have `enable_allowlist = true`
- `ReasonTooLong` — reason exceeds 128 characters

**Events emitted**: `AddedToAllowlist { config, address, reason, allowlisted_by, timestamp }`

---

### remove_from_allowlist

Removes an address from the allowlist by closing its PDA. Immediately blocks future transfers involving the address.

| Account | Type | Writable | Signer | Description |
|---------|------|:--------:|:------:|-------------|
| `payer` | Wallet | Yes | Yes | Receives rent from closed PDA |
| `blacklister` | Wallet | No | Yes | Must match `roles.blacklister` |
| `roles` | RoleConfig PDA | No | No | Validates blacklister role |
| `config` | StablecoinConfig PDA | No | No | Validates allowlist is enabled |
| `allowlist_entry` | AllowlistEntry PDA | Yes | No | Closed by this instruction |

**Arguments**:
- `address: Pubkey` — the wallet to remove from the allowlist

**Errors**:
- `Unauthorized` — caller is not the blacklister
- `AllowlistNotEnabled` — stablecoin does not have `enable_allowlist = true`
- `NotOnAllowlist` — the address does not have an AllowlistEntry PDA

**Events emitted**: `RemovedFromAllowlist { config, address, removed_by, timestamp }`

---

### initialize (SSS-3 differences)

Compared to SSS-2, the SSS-3 `initialize` instruction accepts two additional fields in `InitializeParams`:

- `enable_confidential_transfer: bool` — set `true` for SSS-3
- `enable_allowlist: bool` — set `true` for SSS-3

The program also configures the `ConfidentialTransferMint` extension on the mint, which requires extra space allocation in `create_account`.

---

## SDK Usage Examples

### Creating an SSS-3 Stablecoin

```typescript
import {
  SolanaStablecoin,
  Presets,
} from "@solana-stablecoin-standard/core";

const { sdk, mintKeypair } = await SolanaStablecoin.create(
  provider,
  stablecoinProgram,
  transferHookProgram,
  {
    preset: Presets.SSS_3,
    name: "Private Settlement Token",
    symbol: "PST",
    decimals: 6,
    uri: "https://example.com/metadata.json",
    transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID,
  }
);

console.log("Mint:", mintKeypair.publicKey.toBase58());
console.log("Config:", sdk.configAddress.toBase58());
```

### Adding an Address to the Allowlist

```typescript
const { PublicKey } = require("@solana/web3.js");

const participantAddress = new PublicKey("YourParticipantPubkeyHere...");

const signature = await sdk.compliance.allowlistAdd(
  participantAddress,
  "KYC verified — customer ID #C-00441"
);

console.log("Allowlisted:", participantAddress.toBase58());
console.log("Transaction:", signature);
```

### Checking Allowlist Status

```typescript
const isAllowlisted = await sdk.compliance.isAllowlisted(participantAddress);

if (isAllowlisted) {
  const entry = await sdk.compliance.getAllowlistEntry(participantAddress);
  console.log("Reason:", entry.reason);
  console.log("Added by:", entry.allowlistedBy.toBase58());
  console.log("Timestamp:", new Date(entry.allowlistedAt.toNumber() * 1000).toISOString());
} else {
  console.log("Address is NOT on the allowlist — transfers will be blocked.");
}
```

### Removing an Address from the Allowlist

```typescript
const signature = await sdk.compliance.allowlistRemove(participantAddress);
console.log("Removed from allowlist. Transaction:", signature);

// Verify removal
const stillAllowlisted = await sdk.compliance.isAllowlisted(participantAddress);
console.log("Still allowlisted:", stillAllowlisted); // false
```

### Loading an Existing SSS-3 Instance

```typescript
const configAddress = new PublicKey("YourConfigPDAHere...");

const sdk = await SolanaStablecoin.load(
  provider,
  stablecoinProgram,
  transferHookProgram,
  configAddress
);

const config = sdk.getConfig();
console.log("Allowlist enabled:", config.enableAllowlist);
console.log("Confidential transfer enabled:", config.enableConfidentialTransfer);
```

---

## CLI Usage Examples

Initialize a new SSS-3 stablecoin:

```bash
sss-token init \
  --preset sss-3 \
  --name "Private Settlement Token" \
  --symbol "PST" \
  --decimals 6
```

Add an address to the allowlist:

```bash
sss-token allowlist add GsbwXfJraMomNxBcpR3DBN1MTFxon77J5oBHZKBgvkeM \
  --reason "KYC verified — customer ID #C-00441"
```

Remove an address from the allowlist:

```bash
sss-token allowlist remove GsbwXfJraMomNxBcpR3DBN1MTFxon77J5oBHZKBgvkeM
```

Check whether an address is allowlisted:

```bash
sss-token allowlist check GsbwXfJraMomNxBcpR3DBN1MTFxon77J5oBHZKBgvkeM
```

Seize tokens from a non-compliant participant (same as SSS-2):

```bash
sss-token seize <source-address> --to <treasury-address>
```

---

## Events

In addition to all SSS-1 and SSS-2 events (see [SSS-1.md](SSS-1.md) and [SSS-2.md](SSS-2.md)):

| Event | Fields | Description |
|-------|--------|-------------|
| `AddedToAllowlist` | config, address, reason, allowlisted_by, timestamp | Emitted when an address is added to the allowlist |
| `RemovedFromAllowlist` | config, address, removed_by, timestamp | Emitted when an address is removed from the allowlist |

---

## Error Codes

### Stablecoin Program Errors (SSS-3 Specific)

In addition to all SSS-1 and SSS-2 error codes:

| Code | Name | Description |
|------|------|-------------|
| 6019 | `AllowlistNotEnabled` | Stablecoin does not have allowlist mode enabled |
| 6020 | `AlreadyOnAllowlist` | Address is already on the allowlist |
| 6021 | `NotOnAllowlist` | Address is not on the allowlist (cannot remove) |

### Transfer Hook Program Errors (SSS-3 Specific)

In addition to SSS-2 transfer hook errors:

| Code | Name | Description |
|------|------|-------------|
| 6004 | `SenderNotAllowlisted` | Sender does not have an AllowlistEntry PDA |
| 6005 | `RecipientNotAllowlisted` | Recipient does not have an AllowlistEntry PDA |

---

## Security Considerations

### Transfer Hook Cannot Be Bypassed

The same guarantee as SSS-2 applies: Token-2022 enforces the transfer hook on every `transfer_checked` call. An attacker cannot bypass the allowlist check by calling a different transfer instruction -- Token-2022 has no un-hooked transfer path for mints that have a transfer hook configured.

### Allowlist Does Not Block Minting

Minting tokens to an address that is not on the allowlist is possible, because `mint_to` does not invoke the transfer hook. However, the minted tokens will be trapped -- the recipient cannot transfer them until they are added to the allowlist. To prevent this confusion, the SDK's `mint()` method should be used only against allowlisted recipients.

### Seizure Works Regardless of Allowlist Status

The `seize` instruction uses the burn + mint pattern (identical to SSS-2) and does not invoke the transfer hook. The seizer can seize tokens from any account regardless of whether either party is on the allowlist. This ensures that seized assets can always be recovered.

### Confidential Transfer Does Not Affect Allowlist Checks

The allowlist check in the transfer hook operates on wallet owner pubkeys, not amounts. Confidential transfers still route through `transfer_checked`, which invokes the hook. The fact that amounts are encrypted has no effect on the allowlist enforcement.

### Auditor Key Custody

If an auditor ElGamal keypair is configured at mint initialization, the private key must be stored securely. Loss of the auditor private key means that historical confidential transfer amounts can no longer be decrypted. Compromise of the auditor private key means a third party can decrypt all past transfer amounts.

### Allowlist Entry Rent

Each `AllowlistEntry` PDA costs approximately 0.002 SOL in rent. For large-scale deployments with many participants, the cumulative rent cost should be budgeted. Rent is returned when an entry is closed via `remove_from_allowlist`.

### No Upgrades to Allowlist Mode

Like the SSS-1 to SSS-2 upgrade path, the allowlist flag is determined at initialization time by the Token-2022 extensions configured on the mint. An existing SSS-2 stablecoin cannot be upgraded to SSS-3 in place. A new mint must be created with the SSS-3 preset and token holders must migrate.

---

## Comparison to SSS-2

| Dimension | SSS-2 | SSS-3 |
|-----------|:-----:|:-----:|
| Default policy | Allow (deny on blacklist) | Deny (allow on whitelist) |
| Suitable for open participation | Yes | No |
| Suitable for closed / KYC-only | No | Yes |
| On-chain balance privacy | No | Yes (ElGamal encrypted) |
| Auditor key for amount decryption | No | Optional |
| List PDA seed prefix | `"blacklist"` | `"allowlist"` |
| Per-entry rent cost | ~0.002 SOL | ~0.002 SOL |
| Transfer hook program | Shared | Shared |
| Token seizure | Yes | Yes |
