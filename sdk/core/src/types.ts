import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/** Parameters for initializing a new stablecoin. */
export interface InitializeParams {
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
}

/** Preset configuration for SSS-1, SSS-2, or SSS-3. */
export interface PresetConfig {
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  enableConfidentialTransfer?: boolean;
  enableAllowlist?: boolean;
}

/** Combined params for creating a stablecoin with a preset. */
export interface CreateParams {
  preset?: PresetConfig;
  name: string;
  symbol: string;
  uri?: string;
  decimals?: number;
  authority?: PublicKey;
  /** For SSS-2: the transfer hook program ID. */
  transferHookProgramId?: PublicKey;
}

/** On-chain StablecoinConfig account data. */
export interface StablecoinConfigAccount {
  masterAuthority: PublicKey;
  pendingAuthority: PublicKey;
  mint: PublicKey;
  decimals: number;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  enableConfidentialTransfer: boolean;
  enableAllowlist: boolean;
  isPaused: boolean;
  totalMinted: BN;
  totalBurned: BN;
  bump: number;
}

/** On-chain MinterConfig account data. */
export interface MinterConfigAccount {
  minter: PublicKey;
  stablecoinConfig: PublicKey;
  quota: BN;
  minted: BN;
  active: boolean;
  bump: number;
}

/** On-chain RoleConfig account data. */
export interface RoleConfigAccount {
  stablecoinConfig: PublicKey;
  pauser: PublicKey;
  freezer: PublicKey;
  blacklister: PublicKey;
  seizer: PublicKey;
  bump: number;
}

/** On-chain BlacklistEntry account data. */
export interface BlacklistEntryAccount {
  stablecoinConfig: PublicKey;
  address: PublicKey;
  reason: string;
  blacklistedAt: BN;
  blacklistedBy: PublicKey;
  bump: number;
}

/** On-chain AllowlistEntry account data (SSS-3). */
export interface AllowlistEntryAccount {
  stablecoinConfig: PublicKey;
  address: PublicKey;
  reason: string;
  allowlistedAt: BN;
  allowlistedBy: PublicKey;
  bump: number;
}

/** Parameters for adding an address to the allowlist (SSS-3). */
export interface AddAllowlistParams {
  address: PublicKey;
  reason: string;
}

/** Parameters for updating a minter. */
export interface UpdateMinterParams {
  quota: BN;
  active: boolean;
}

/** Parameters for updating roles (all optional). */
export interface UpdateRolesParams {
  pauser?: PublicKey | null;
  freezer?: PublicKey | null;
  blacklister?: PublicKey | null;
  seizer?: PublicKey | null;
}

/** Mint operation parameters. */
export interface MintParams {
  recipient: PublicKey;
  amount: BN;
  minter: PublicKey;
}

/** Compliance operations namespace. */
export interface ComplianceOperations {
  blacklistAdd(address: PublicKey, reason: string): Promise<string>;
  blacklistRemove(address: PublicKey): Promise<string>;
  seize(from: PublicKey, to: PublicKey, amount: BN): Promise<string>;
  isBlacklisted(address: PublicKey): Promise<boolean>;
  getBlacklistEntry(address: PublicKey): Promise<BlacklistEntryAccount | null>;
  // SSS-3 allowlist operations
  allowlistAdd(address: PublicKey, reason: string): Promise<string>;
  allowlistRemove(address: PublicKey): Promise<string>;
  isAllowlisted(address: PublicKey): Promise<boolean>;
  getAllowlistEntry(address: PublicKey): Promise<AllowlistEntryAccount | null>;
}

/** Token holder info from getProgramAccounts. */
export interface TokenHolderInfo {
  address: PublicKey;
  owner: PublicKey;
  amount: BN;
}
