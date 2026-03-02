import type { PresetConfig } from "./types";

/** SSS-1: Minimal Stablecoin — mint authority + freeze authority + metadata. */
export const SSS_1: PresetConfig = {
  enablePermanentDelegate: false,
  enableTransferHook: false,
};

/** SSS-2: Compliant Stablecoin — SSS-1 + permanent delegate + transfer hook + blacklist. */
export const SSS_2: PresetConfig = {
  enablePermanentDelegate: true,
  enableTransferHook: true,
};

/**
 * SSS-3: Private Stablecoin — SSS-2 + confidential transfers + allowlist enforcement.
 *
 * Only allowlisted addresses can send/receive tokens, and balances are
 * shielded via the Token-2022 ConfidentialTransfer extension.
 */
export const SSS_3: PresetConfig = {
  enablePermanentDelegate: true,
  enableTransferHook: true,
  enableConfidentialTransfer: true,
  enableAllowlist: true,
};

export const Presets = {
  SSS_1,
  SSS_2,
  SSS_3,
} as const;
