import { PublicKey } from "@solana/web3.js";

const CONFIG_SEED = Buffer.from("stablecoin_config");
const MINTER_SEED = Buffer.from("minter");
const ROLES_SEED = Buffer.from("roles");
const BLACKLIST_SEED = Buffer.from("blacklist");
const ALLOWLIST_SEED = Buffer.from("allowlist");
const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

/** Derive the StablecoinConfig PDA from the mint address. */
export function getConfigAddress(
  programId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    programId
  );
}

/** Derive a MinterConfig PDA. */
export function getMinterAddress(
  programId: PublicKey,
  config: PublicKey,
  minter: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_SEED, config.toBuffer(), minter.toBuffer()],
    programId
  );
}

/** Derive the RoleConfig PDA. */
export function getRolesAddress(
  programId: PublicKey,
  config: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLES_SEED, config.toBuffer()],
    programId
  );
}

/** Derive a BlacklistEntry PDA. */
export function getBlacklistAddress(
  programId: PublicKey,
  config: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), address.toBuffer()],
    programId
  );
}

/** Derive an AllowlistEntry PDA (SSS-3). */
export function getAllowlistAddress(
  programId: PublicKey,
  config: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ALLOWLIST_SEED, config.toBuffer(), address.toBuffer()],
    programId
  );
}

/** Derive the ExtraAccountMetaList PDA for the transfer hook. */
export function getExtraAccountMetaListAddress(
  transferHookProgramId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    transferHookProgramId
  );
}
