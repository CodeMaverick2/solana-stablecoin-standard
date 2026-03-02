# Compliance

This document covers the regulatory compliance capabilities of the Solana Stablecoin Standard, focusing on SSS-2 features, the GENIUS Act, on-chain audit trails, sanctions screening integration, and token seizure procedures.

---

## Regulatory Context

### The GENIUS Act

The Guiding and Establishing National Innovation for U.S. Stablecoins (GENIUS) Act establishes a federal framework for payment stablecoin issuers. Key requirements and how SSS-2 addresses them:

| GENIUS Act Requirement | SSS-2 Implementation |
|------------------------|---------------------|
| Ability to freeze assets | Freeze authority via config PDA (`freeze_account` instruction) |
| Ability to seize/recover assets | Permanent delegate extension with burn + mint seizure pattern |
| Sanctions compliance | Transfer hook enforces PDA-based blacklist on every `transfer_checked` |
| Audit trail | On-chain Anchor events emitted for every state change |
| Role separation | Six distinct operational roles with separation of duties |
| Controlled issuance | Per-minter quotas tracked in individual PDA accounts |

SSS-2 provides the on-chain technical infrastructure to meet these requirements. Issuers must also implement off-chain compliance processes (KYC/AML, sanctions screening, reporting) that integrate with the on-chain tooling.

### Sanctions Compliance

SSS-2 enforces sanctions compliance at the protocol level through the transfer hook program (`HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou`). Every `transfer_checked` call on an SSS-2 mint is validated against the on-chain blacklist:

- Blacklisted addresses **cannot send** tokens (transfer hook checks sender).
- Blacklisted addresses **cannot receive** tokens via transfer (transfer hook checks recipient).
- Enforcement is automatic and cannot be bypassed by any party.
- The blacklist is transparent and auditable on-chain.

**Note**: Minting to a blacklisted address is still possible because `mint_to` does not invoke the transfer hook. To fully restrict an address, freeze their token account in addition to blacklisting.

---

## On-Chain Audit Trail

### Event-Based Auditing

Every compliance-relevant action emits an Anchor program log event. These events are permanently recorded in Solana's ledger (subject to validator retention policies) and can be indexed, queried, and exported.

Events are base64-encoded in transaction logs and prefixed with the Anchor event discriminator (8-byte SHA256 hash of `event:<EventName>`).

### Compliance Event Catalog

| Event | Trigger | Compliance Significance |
|-------|---------|------------------------|
| `StablecoinInitialized` | New stablecoin created | Records initial configuration, authority, and feature flags |
| `TokensMinted` | Tokens issued | Tracks issuance with minter identity and amount |
| `TokensBurned` | Tokens destroyed | Tracks redemption/destruction with burner identity |
| `AccountFrozen` | Account restricted | Records freeze action, target account, and operator |
| `AccountThawed` | Account unrestricted | Records thaw action, target account, and operator |
| `StablecoinPaused` | Global pause activated | Emergency action record with operator identity |
| `StablecoinUnpaused` | Global pause lifted | Resume action record with operator identity |
| `MinterUpdated` | Minter config changed | Tracks issuance authority changes (quota, activation) |
| `RolesUpdated` | Role assignment changed | Tracks operational authority changes |
| `AuthorityTransferInitiated` | Authority transfer started | Governance change initiation with both parties |
| `AuthorityTransferCompleted` | Authority transfer accepted | Governance change completion with both parties |
| `AddedToBlacklist` | Address blacklisted | Sanctions action with reason string |
| `RemovedFromBlacklist` | Address unblacklisted | Sanctions clearance with operator identity |
| `TokensSeized` | Tokens confiscated | Enforcement action with source, destination, amount, and operator |

### Event Field Reference

Each event includes a `timestamp` field (Unix timestamp from `Clock::get()`) and a `config` field (the stablecoin config PDA address). Additional fields vary by event type. See the full event definitions in [SSS-1.md](SSS-1.md) and [SSS-2.md](SSS-2.md).

### Event Format

Anchor events are emitted as base64-encoded program log entries. When decoded, they follow this structure:

```json
{
  "event": "AddedToBlacklist",
  "data": {
    "config": "B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs",
    "address": "SuspectAddr11111111111111111111111111111111",
    "reason": "OFAC SDN List match - Entity XYZ",
    "blacklistedBy": "ComplianceOp111111111111111111111111111111",
    "timestamp": 1708819200
  }
}
```

### Event Export Methods

Events can be captured and exported in several ways:

1. **Backend Event Listener**: The included backend service subscribes to program logs via WebSocket (`logsSubscribe`) and stores decoded events in Redis sorted sets (by slot and by timestamp). Events can be queried via the REST API at `/api/audit-log`.

2. **Direct RPC Query**: Use `getSignaturesForAddress` on the stablecoin program ID (`B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`), then `getTransaction` for each signature to extract and decode log events.

3. **Block Explorers**: Solscan, SolanaFM, and Solana Explorer can display Anchor events in a human-readable format for individual transactions.

4. **Custom Indexer**: Build a custom indexer using Solana's `logsSubscribe` WebSocket API or a service like Helius, Triton, or Yellowstone gRPC for production-grade event streaming.

5. **Solana CLI**: Monitor real-time events with `solana logs B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`.

### Audit Log Queries

The backend provides filtered event queries for compliance reporting:

```bash
# Get all events
curl http://localhost:3000/api/audit-log

# Filter by action type
curl "http://localhost:3000/api/audit-log?action=AddedToBlacklist"

# Filter by time range (Unix timestamps)
curl "http://localhost:3000/api/audit-log?from=1708819200&to=1708905600"

# Limit results
curl "http://localhost:3000/api/audit-log?limit=50"
```

---

## Blacklist Management

### Adding to Blacklist

**Who**: Blacklister role
**When**: Address identified through sanctions screening, law enforcement request, or internal investigation.

```bash
sss-token blacklist add <address> --reason "OFAC SDN List - Entity XYZ Corp"
```

**On-chain effects**:
- Creates a `BlacklistEntry` PDA with seeds `["blacklist", config.key(), address]`.
- Stores the reason (up to 128 characters), timestamp, and blacklister identity.
- The transfer hook immediately begins rejecting any `transfer_checked` involving this address.
- Emits an `AddedToBlacklist` event.

**SDK**:
```typescript
await sdk.compliance.blacklistAdd(address, "OFAC SDN List - Entity XYZ Corp");
```

### Removing from Blacklist

**Who**: Blacklister role
**When**: False positive confirmed, sanctions clearance received, or compliance review completed.

```bash
sss-token blacklist remove <address>
```

**On-chain effects**:
- Closes the `BlacklistEntry` PDA.
- Returns the rent deposit (approximately 0.002 SOL) to the payer.
- The transfer hook immediately stops rejecting transfers for this address.
- Emits a `RemovedFromBlacklist` event.

**SDK**:
```typescript
await sdk.compliance.blacklistRemove(address);
```

### Blacklist Verification

```bash
# Check if an address is blacklisted
sss-token blacklist check <address>
```

```typescript
// SDK
const isBlacklisted = await sdk.compliance.isBlacklisted(address);
const entry = await sdk.compliance.getBlacklistEntry(address);
// entry contains: stablecoinConfig, address, reason, blacklistedAt, blacklistedBy, bump
```

### Blacklist Enforcement Details

The blacklist is enforced by the transfer hook program, not the stablecoin program. The transfer hook reads the blacklist PDA at indices 7 (sender) and 8 (recipient) in the ExtraAccountMetaList. If the PDA account has data (`!data_is_empty()`), the address is blacklisted and the transfer is rejected.

The blacklist PDAs are derived dynamically by Token-2022 when resolving the ExtraAccountMetaList:
- **Seed derivation**: `["blacklist", config_key, owner_pubkey]`
- **Owner extraction**: The owner pubkey is read from the token account data at byte offset 32 (the `owner` field in a Token-2022 account structure).
- **Program**: Stablecoin program (`B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`)

---

## Sanctions Screening Integration

SSS-2 provides the on-chain enforcement mechanism. Sanctions screening (matching wallet addresses against OFAC, EU, UN, and other sanctions lists) must be performed off-chain by the issuer.

### Integration Architecture

```
+--------------------+      +---------------------+      +--------------------+
| Sanctions Provider |      | Compliance Service  |      | On-Chain           |
| (Chainalysis,      | ---> | (Backend or custom) | ---> | add_to_blacklist   |
|  Elliptic, TRM     |      |                     |      | freeze_account     |
|  Labs, etc.)       |      | Match evaluation    |      | seize (if needed)  |
+--------------------+      | Decision logging    |      +--------------------+
                             | Approval workflow   |
                             +---------------------+
```

### Integration Points

1. **New Account Screening**: When a new address interacts with the stablecoin (receives tokens for the first time), screen it against sanctions lists.

2. **Continuous Monitoring**: Periodically re-screen all token holders against updated sanctions lists. Use `sss-token holders` or the backend `/api/supply` endpoint to identify active holders.

3. **Inbound Transfer Screening**: Use the backend event listener to monitor `TokensMinted` events and screen new recipients.

4. **Match Response Workflow**:
   - Screening provider flags a potential match.
   - Compliance officer reviews and confirms.
   - If confirmed: `blacklist add` + `freeze` + optionally `seize`.
   - Record decision, supporting evidence, and all transaction signatures.

5. **Webhook Integration**: Register webhooks via the backend API to receive real-time notifications of on-chain events. Use these to trigger screening workflows automatically.

---

## Token Seizure

### When to Use

- Court orders requiring asset recovery.
- Law enforcement seizure requests.
- Sanctions enforcement where funds must be moved to a controlled account.
- Resolution of fraud or theft.

### How Seizure Works

The `seize` instruction uses a **burn + mint** pattern:

1. **Burn**: The config PDA, acting as the permanent delegate, burns the specified amount from the target's token account via `burn_checked`.
2. **Mint**: The config PDA, acting as the mint authority, mints an equivalent amount to the treasury token account via `mint_to`.

This pattern is used instead of `transfer_checked` because:
- A transfer would trigger the transfer hook, which would reject the operation (the target is likely blacklisted).
- The permanent delegate's burn authority works on frozen accounts.
- The operation is supply-neutral.

### Seizure Procedure

```
1. Legal basis established (court order, sanctions match, etc.)
          |
          v
2. Compliance review and approval
          |
          v
3. Blacklist the address (creates audit trail)
   sss-token blacklist add <address> --reason "<legal-basis>"
   --> Emits AddedToBlacklist event
          |
          v
4. Freeze the token account (prevents any further activity)
   sss-token freeze <token-account>
   --> Emits AccountFrozen event
          |
          v
5. Seize tokens to designated treasury
   sss-token seize <token-account> --to <treasury-account>
   --> Emits TokensSeized event
          |
          v
6. Record all transaction signatures
   Document: blacklist tx, freeze tx, seize tx
          |
          v
7. Report to relevant authorities
```

### Seizure Audit Record

The `TokensSeized` event captures:

| Field | Type | Description |
|-------|------|-------------|
| `config` | Pubkey | Stablecoin config PDA address |
| `from` | Pubkey | Source token account (seized from) |
| `to` | Pubkey | Destination token account (treasury) |
| `amount` | u64 | Amount seized in base units |
| `seized_by` | Pubkey | Seizer's public key |
| `timestamp` | i64 | Unix timestamp |

---

## Role Separation for Compliance

SSS-2 enforces strict role separation to implement proper segregation of duties:

| Principle | Implementation |
|-----------|---------------|
| **Separation of duties** | Six distinct roles, each with limited capabilities |
| **Least privilege** | Minters can only mint; freezers can only freeze; blacklisters can only blacklist |
| **Accountability** | Every action is tied to a specific signer and logged on-chain via events |
| **Independent oversight** | Blacklister and seizer are separate roles (one identifies, another executes) |

### Recommended Role Assignment

| Role | Recommended Holder |
|------|-------------------|
| Master Authority | Hardware wallet or multisig (e.g., Squads) |
| Pauser | Operations team (emergency response) |
| Freezer | Compliance team (account restrictions) |
| Minter(s) | Treasury operations (controlled issuance) |
| Blacklister | Compliance team (sanctions screening) |
| Seizer | Senior compliance officer or legal counsel |

### Dual Control for Critical Operations

While SSS-2 does not enforce on-chain multi-signature requirements for individual roles, organizations should implement dual control through:

1. **Multisig wallets**: Use Squads Protocol or a similar Solana multisig program as the role holder. The multisig address is set as the role, and its internal approval threshold provides multi-party authorization.

2. **Off-chain approval workflows**: Require multiple approvals in your compliance management system before executing on-chain operations.

3. **Time-delayed execution**: Implement waiting periods for irreversible actions like seizure.

4. **Audit committee review**: Regular review of all compliance actions using the audit log.

---

## Event Retention and Archival

### On-Chain Retention

On-chain events are permanent in Solana's ledger as long as validators retain the transaction history. However, practical query access depends on the RPC provider's data retention policies (typically 1-2 epochs for real-time, longer for archival nodes).

### Backend Event Storage

The backend event listener stores decoded events in Redis sorted sets:
- **By slot**: For chronological ordering and replay.
- **By timestamp**: For time-range queries via the audit log API.

### Recommended Retention Strategy

1. **Hot storage (Redis)**: Recent events for fast API queries. Configure TTL based on operational needs.
2. **Warm storage (Database)**: All events for the regulatory retention period (typically 5-7 years for financial records).
3. **Cold storage (Object storage)**: Archived events exported to S3, GCS, or equivalent for long-term retention.
4. **Integrity verification**: Maintain hash-chained audit logs for tamper evidence. The transaction signatures provide cryptographic proof of event ordering.

---

## Compliance Reporting

### Supply Reconciliation

Verify that on-chain state matches expected values:

```bash
# CLI
sss-token supply

# Backend API
curl http://localhost:3000/api/supply
```

The response includes `totalMinted` and `totalBurned` from the `StablecoinConfig` PDA. Circulating supply should equal `totalMinted - totalBurned`.

### Blacklist Report

```bash
# List all blacklisted addresses
sss-token blacklist check <address>

# Backend API
curl http://localhost:3000/api/blacklist
```

### Full Audit Export

```bash
# Via backend API
curl "http://localhost:3000/api/audit-log?limit=10000" > audit-export.json
```

### Webhook Notifications

Configure webhooks to receive real-time notifications of compliance-relevant events:

```bash
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://compliance-system.example.com/webhook",
    "eventFilter": ["AddedToBlacklist", "RemovedFromBlacklist", "TokensSeized", "AccountFrozen"],
    "secret": "your-webhook-secret"
  }'
```

Webhook payloads are signed with HMAC-SHA256 using the provided secret. The signature is included in the `X-SSS-Signature` header.
