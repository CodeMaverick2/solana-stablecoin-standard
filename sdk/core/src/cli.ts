#!/usr/bin/env node

import { Command } from "commander";
import {
  Connection,
  PublicKey,
  Keypair,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { AnchorProvider, Program, BN, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as toml from "toml";

import { SolanaStablecoin } from "./stablecoin";
import { StablecoinTUI } from "./tui";
import {
  getConfigAddress,
  getRolesAddress,
  getBlacklistAddress,
  getAllowlistAddress,
  getMinterAddress,
} from "./pda";
import { Presets, SSS_1, SSS_2, SSS_3 } from "./presets";
import type {
  CreateParams,
  PresetConfig,
  StablecoinConfigAccount,
  MinterConfigAccount,
  RoleConfigAccount,
  BlacklistEntryAccount,
  AllowlistEntryAccount,
  TokenHolderInfo,
} from "./types";

import type { Stablecoin } from "./idl/stablecoin";
import type { TransferHook } from "./idl/transfer_hook";
import stablecoinIdl from "./idl/stablecoin.json";
import transferHookIdl from "./idl/transfer_hook.json";

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------

const STABLECOIN_PROGRAM_ID = new PublicKey(
  "B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs"
);
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a keypair from a filesystem path.
 * Supports the standard Solana CLI JSON format (array of bytes).
 */
function loadKeypair(path: string): Keypair {
  const raw = fs.readFileSync(path, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Resolve the default Solana keypair path (~/.config/solana/id.json).
 */
function defaultKeypairPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return `${home}/.config/solana/id.json`;
}

/**
 * Resolve cluster URL from common aliases or a raw URL.
 */
function resolveCluster(cluster: string): string {
  switch (cluster) {
    case "devnet":
      return clusterApiUrl("devnet");
    case "testnet":
      return clusterApiUrl("testnet");
    case "mainnet":
    case "mainnet-beta":
      return clusterApiUrl("mainnet-beta");
    case "localnet":
    case "localhost":
      return "http://127.0.0.1:8899";
    default:
      // Assume it is already a URL
      return cluster;
  }
}

/**
 * Build an AnchorProvider from CLI global options.
 */
function buildProvider(opts: {
  cluster?: string;
  keypair?: string;
}): AnchorProvider {
  const clusterUrl = resolveCluster(opts.cluster ?? "devnet");
  const connection = new Connection(clusterUrl, "confirmed");

  const keypairPath = opts.keypair ?? defaultKeypairPath();
  if (!fs.existsSync(keypairPath)) {
    console.error(
      `Error: Keypair file not found at ${keypairPath}\n` +
        `Generate one with: solana-keygen new --outfile ${keypairPath}`
    );
    process.exit(1);
  }

  const payer = loadKeypair(keypairPath);
  const wallet = new Wallet(payer);
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

/**
 * Build the Anchor programs from IDL.
 */
function buildPrograms(provider: AnchorProvider): {
  stablecoinProgram: Program<Stablecoin>;
  transferHookProgram: Program<TransferHook>;
} {
  const stablecoinProgram = new Program<Stablecoin>(
    stablecoinIdl as unknown as Stablecoin,
    provider
  );
  const transferHookProgram = new Program<TransferHook>(
    transferHookIdl as unknown as TransferHook,
    provider
  );
  return { stablecoinProgram, transferHookProgram };
}

/**
 * Load an existing SolanaStablecoin SDK instance.
 * Determines the config address from --config global option.
 */
async function loadSdk(opts: {
  config?: string;
  cluster?: string;
  keypair?: string;
}): Promise<SolanaStablecoin> {
  if (!opts.config) {
    console.error(
      "Error: --config <address> is required for this command.\n" +
        "Provide the stablecoin config account address."
    );
    process.exit(1);
  }

  let configAddress: PublicKey;
  try {
    configAddress = new PublicKey(opts.config);
  } catch {
    console.error(`Error: Invalid config address "${opts.config}".`);
    process.exit(1);
  }

  const provider = buildProvider(opts);
  const { stablecoinProgram, transferHookProgram } = buildPrograms(provider);

  return SolanaStablecoin.load(
    provider,
    stablecoinProgram,
    transferHookProgram,
    configAddress
  );
}

/**
 * Format a BN amount with the token decimals (display only).
 */
function formatAmount(amount: BN, decimals: number): string {
  const raw = amount.toString(10);
  if (decimals === 0) return raw;

  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  // Trim trailing zeros in fractional part
  const trimmed = fracPart.replace(/0+$/, "");
  return trimmed.length > 0 ? `${intPart}.${trimmed}` : intPart;
}

/**
 * Parse an amount string to BN, applying token decimals.
 */
function parseAmount(amountStr: string, decimals: number): BN {
  if (amountStr.includes(".")) {
    const [intPart, fracPart = ""] = amountStr.split(".");
    if (fracPart.length > decimals) {
      console.error(
        `Error: Too many decimal places. Token supports ${decimals} decimals.`
      );
      process.exit(1);
    }
    const paddedFrac = fracPart.padEnd(decimals, "0");
    const combined = `${intPart}${paddedFrac}`;
    return new BN(combined);
  }
  // Whole number — multiply by 10^decimals
  return new BN(amountStr).mul(new BN(10).pow(new BN(decimals)));
}

/**
 * Print a horizontal divider.
 */
function divider(): void {
  console.log("─".repeat(60));
}

/**
 * Print a labelled key-value pair.
 */
function printField(label: string, value: string): void {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

// ---------------------------------------------------------------------------
// CLI Definition
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("sss-token")
  .description(
    "CLI for the Solana Stablecoin Standard (SSS) — create and manage stablecoins on Solana."
  )
  .version("0.1.0")
  .option(
    "--config <address>",
    "Stablecoin config account address (required for most commands)"
  )
  .option(
    "--cluster <url>",
    "Solana cluster URL or alias (devnet, testnet, mainnet, localnet)",
    "devnet"
  )
  .option("--keypair <path>", "Path to wallet keypair JSON file");

// ───────────────────────────── init ─────────────────────────────

program
  .command("init")
  .description("Initialize a new stablecoin")
  .option("--preset <preset>", "Standard preset: sss-1, sss-2, or sss-3")
  .option("--custom <path>", "Path to a custom TOML config file")
  .option("--name <name>", "Token name", "My Stablecoin")
  .option("--symbol <symbol>", "Token symbol", "STBL")
  .option("--decimals <number>", "Token decimals", "6")
  .option("--uri <uri>", "Metadata URI", "")
  .action(async (opts) => {
    try {
      const globalOpts = program.opts();
      const provider = buildProvider(globalOpts);
      const { stablecoinProgram, transferHookProgram } =
        buildPrograms(provider);

      let preset: PresetConfig;
      let name = opts.name;
      let symbol = opts.symbol;
      let decimals = parseInt(opts.decimals, 10);
      let uri = opts.uri;
      let transferHookProgramId: PublicKey | undefined;

      if (opts.custom) {
        // Load custom config from TOML
        if (!fs.existsSync(opts.custom)) {
          console.error(`Error: Config file not found at ${opts.custom}`);
          process.exit(1);
        }
        const raw = fs.readFileSync(opts.custom, "utf-8");
        const config = toml.parse(raw);

        name = config.name ?? name;
        symbol = config.symbol ?? symbol;
        decimals = config.decimals ?? decimals;
        uri = config.uri ?? uri;

        preset = {
          enablePermanentDelegate: config.enable_permanent_delegate ?? false,
          enableTransferHook: config.enable_transfer_hook ?? false,
        };

        if (config.transfer_hook_program_id) {
          transferHookProgramId = new PublicKey(
            config.transfer_hook_program_id
          );
        }
      } else {
        // Use preset
        const presetName = (opts.preset ?? "sss-1").toLowerCase();
        switch (presetName) {
          case "sss-1":
            preset = SSS_1;
            break;
          case "sss-2":
            preset = SSS_2;
            transferHookProgramId = TRANSFER_HOOK_PROGRAM_ID;
            break;
          case "sss-3":
            preset = SSS_3;
            transferHookProgramId = TRANSFER_HOOK_PROGRAM_ID;
            break;
          default:
            console.error(
              `Error: Unknown preset "${opts.preset}". Use sss-1, sss-2, or sss-3.`
            );
            process.exit(1);
        }
      }

      // Default transfer hook program for SSS-2 when not explicitly set
      if (preset.enableTransferHook && !transferHookProgramId) {
        transferHookProgramId = TRANSFER_HOOK_PROGRAM_ID;
      }

      const createParams: CreateParams = {
        preset,
        name,
        symbol,
        uri,
        decimals,
        transferHookProgramId,
      };

      console.log("\nInitializing stablecoin...\n");
      divider();
      printField("Name:", name);
      printField("Symbol:", symbol);
      printField("Decimals:", String(decimals));
      printField("URI:", uri || "(none)");
      printField(
        "Preset:",
        preset.enableAllowlist
          ? "SSS-3 (Private)"
          : preset.enableTransferHook
          ? "SSS-2 (Compliant)"
          : "SSS-1 (Minimal)"
      );
      printField(
        "Permanent Delegate:",
        preset.enablePermanentDelegate ? "Enabled" : "Disabled"
      );
      printField(
        "Transfer Hook:",
        preset.enableTransferHook ? "Enabled" : "Disabled"
      );
      divider();

      const { sdk, signature } = await SolanaStablecoin.create(
        provider,
        stablecoinProgram,
        transferHookProgram,
        createParams
      );

      console.log("\nStablecoin initialized successfully!\n");
      divider();
      printField("Config Address:", sdk.configAddress.toBase58());
      printField("Mint Address:", sdk.mintAddress.toBase58());
      printField("Roles Address:", sdk.rolesAddress.toBase58());
      printField("Authority:", provider.wallet.publicKey.toBase58());
      printField("Transaction:", signature);
      divider();
      console.log(
        "\nSave the config address above. Use it with --config for subsequent commands.\n"
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError initializing stablecoin: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── mint ─────────────────────────────

program
  .command("mint <recipient> <amount>")
  .description("Mint tokens to a recipient address")
  .action(async (recipientStr: string, amountStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let recipient: PublicKey;
      try {
        recipient = new PublicKey(recipientStr);
      } catch {
        console.error(`Error: Invalid recipient address "${recipientStr}".`);
        process.exit(1);
      }

      await sdk.refresh();
      const config = sdk.getConfig();
      const amount = parseAmount(amountStr, config.decimals);

      console.log(`\nMinting ${amountStr} tokens to ${recipientStr}...\n`);

      const signature = await sdk.mint({
        recipient,
        amount,
        minter: sdk.provider.wallet.publicKey,
      });

      divider();
      printField("Recipient:", recipientStr);
      printField("Amount:", amountStr);
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError minting tokens: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── burn ─────────────────────────────

program
  .command("burn <amount>")
  .description("Burn tokens from your own token account")
  .action(async (amountStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      await sdk.refresh();
      const config = sdk.getConfig();
      const amount = parseAmount(amountStr, config.decimals);

      console.log(`\nBurning ${amountStr} tokens...\n`);

      const signature = await sdk.burn(amount);

      divider();
      printField("Burned:", amountStr);
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError burning tokens: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── freeze ─────────────────────────────

program
  .command("freeze <address>")
  .description("Freeze a token account (requires freezer role)")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let target: PublicKey;
      try {
        target = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      // Derive the target's associated token account
      const targetAta = getAssociatedTokenAddressSync(
        sdk.mintAddress,
        target,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      console.log(`\nFreezing token account for ${addressStr}...\n`);

      const signature = await sdk.freezeAccount(targetAta);

      divider();
      printField("Target:", addressStr);
      printField("Token Account:", targetAta.toBase58());
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError freezing account: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── thaw ─────────────────────────────

program
  .command("thaw <address>")
  .description("Thaw a frozen token account (requires freezer role)")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let target: PublicKey;
      try {
        target = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      const targetAta = getAssociatedTokenAddressSync(
        sdk.mintAddress,
        target,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      console.log(`\nThawing token account for ${addressStr}...\n`);

      const signature = await sdk.thawAccount(targetAta);

      divider();
      printField("Target:", addressStr);
      printField("Token Account:", targetAta.toBase58());
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError thawing account: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── pause ─────────────────────────────

program
  .command("pause")
  .description("Pause all stablecoin operations (requires pauser role)")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      console.log("\nPausing stablecoin...\n");

      const signature = await sdk.pause();

      divider();
      printField("Status:", "PAUSED");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError pausing stablecoin: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── unpause ─────────────────────────────

program
  .command("unpause")
  .description("Unpause stablecoin operations (requires pauser role)")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      console.log("\nUnpausing stablecoin...\n");

      const signature = await sdk.unpause();

      divider();
      printField("Status:", "ACTIVE");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError unpausing stablecoin: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── status ─────────────────────────────

program
  .command("status")
  .description("Display stablecoin status and configuration")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);
      await sdk.refresh();
      const config = sdk.getConfig();

      const supply = config.totalMinted.sub(config.totalBurned);

      console.log("\n  Stablecoin Status\n");
      divider();
      printField("Config:", sdk.configAddress.toBase58());
      printField("Mint:", sdk.mintAddress.toBase58());
      printField("Authority:", config.masterAuthority.toBase58());
      printField(
        "Pending Authority:",
        config.pendingAuthority.equals(PublicKey.default)
          ? "(none)"
          : config.pendingAuthority.toBase58()
      );
      printField("Decimals:", String(config.decimals));
      printField("Status:", config.isPaused ? "PAUSED" : "ACTIVE");
      divider();
      printField(
        "Total Supply:",
        formatAmount(supply, config.decimals)
      );
      printField(
        "Total Minted:",
        formatAmount(config.totalMinted, config.decimals)
      );
      printField(
        "Total Burned:",
        formatAmount(config.totalBurned, config.decimals)
      );
      divider();
      printField(
        "Permanent Delegate:",
        config.enablePermanentDelegate ? "Enabled" : "Disabled"
      );
      printField(
        "Transfer Hook:",
        config.enableTransferHook ? "Enabled" : "Disabled"
      );
      printField(
        "Standard:",
        config.enableAllowlist
          ? "SSS-3 (Private)"
          : config.enableTransferHook
          ? "SSS-2 (Compliant)"
          : "SSS-1 (Minimal)"
      );
      divider();

      // Fetch roles
      try {
        const roles = await sdk.getRoles();
        console.log("\n  Role Assignments\n");
        divider();
        printField("Pauser:", roles.pauser.toBase58());
        printField("Freezer:", roles.freezer.toBase58());
        printField("Blacklister:", roles.blacklister.toBase58());
        printField("Seizer:", roles.seizer.toBase58());
        divider();
      } catch {
        // Roles may not be fetchable if the account does not exist yet
      }

      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError fetching status: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── supply ─────────────────────────────

program
  .command("supply")
  .description("Display current token supply")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);
      await sdk.refresh();
      const config = sdk.getConfig();

      const supply = config.totalMinted.sub(config.totalBurned);

      console.log("\n  Token Supply\n");
      divider();
      printField("Mint:", sdk.mintAddress.toBase58());
      printField(
        "Current Supply:",
        formatAmount(supply, config.decimals)
      );
      printField(
        "Total Minted:",
        formatAmount(config.totalMinted, config.decimals)
      );
      printField(
        "Total Burned:",
        formatAmount(config.totalBurned, config.decimals)
      );
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError fetching supply: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── blacklist ─────────────────────────────

const blacklistCmd = program
  .command("blacklist")
  .description("Manage the blacklist (SSS-2 only)");

blacklistCmd
  .command("add <address>")
  .description("Add an address to the blacklist")
  .requiredOption("--reason <reason>", "Reason for blacklisting")
  .action(async (addressStr: string, opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let address: PublicKey;
      try {
        address = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nAdding ${addressStr} to blacklist...\n`
      );

      const signature = await sdk.compliance.blacklistAdd(
        address,
        opts.reason
      );

      divider();
      printField("Address:", addressStr);
      printField("Reason:", opts.reason);
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError adding to blacklist: ${message}\n`);
      process.exit(1);
    }
  });

blacklistCmd
  .command("remove <address>")
  .description("Remove an address from the blacklist")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let address: PublicKey;
      try {
        address = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nRemoving ${addressStr} from blacklist...\n`
      );

      const signature = await sdk.compliance.blacklistRemove(address);

      divider();
      printField("Address:", addressStr);
      printField("Status:", "Removed from blacklist");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError removing from blacklist: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── seize ─────────────────────────────

program
  .command("seize <address>")
  .description(
    "Seize tokens from an address using permanent delegate (SSS-2 only)"
  )
  .requiredOption("--to <treasury>", "Treasury address to receive seized tokens")
  .action(async (addressStr: string, opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let fromOwner: PublicKey;
      try {
        fromOwner = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid source address "${addressStr}".`);
        process.exit(1);
      }

      let toOwner: PublicKey;
      try {
        toOwner = new PublicKey(opts.to);
      } catch {
        console.error(`Error: Invalid treasury address "${opts.to}".`);
        process.exit(1);
      }

      // Derive associated token accounts
      const fromAta = getAssociatedTokenAddressSync(
        sdk.mintAddress,
        fromOwner,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const toAta = getAssociatedTokenAddressSync(
        sdk.mintAddress,
        toOwner,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Read the balance to seize the full amount
      const fromAccountInfo = await sdk.connection.getTokenAccountBalance(
        fromAta
      );
      const seizeAmount = new BN(fromAccountInfo.value.amount);

      if (seizeAmount.isZero()) {
        console.error(
          "\nError: Target account has zero balance. Nothing to seize.\n"
        );
        process.exit(1);
      }

      await sdk.refresh();
      const config = sdk.getConfig();

      console.log(`\nSeizing tokens from ${addressStr}...\n`);

      const signature = await sdk.compliance.seize(fromAta, toAta, seizeAmount);

      divider();
      printField("From:", addressStr);
      printField("To:", opts.to);
      printField(
        "Amount Seized:",
        formatAmount(seizeAmount, config.decimals)
      );
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError seizing tokens: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── minters ─────────────────────────────

const mintersCmd = program
  .command("minters")
  .description("Manage minters");

mintersCmd
  .command("list")
  .description("List all minters for this stablecoin")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);
      await sdk.refresh();
      const config = sdk.getConfig();

      const minters = await sdk.getMinters();

      console.log("\n  Minters\n");
      divider();

      if (minters.length === 0) {
        console.log("  No minters configured.");
      } else {
        for (const m of minters) {
          printField("Minter:", m.minter.toBase58());
          printField("Active:", m.active ? "Yes" : "No");
          printField(
            "Quota:",
            formatAmount(m.quota, config.decimals)
          );
          printField(
            "Minted:",
            formatAmount(m.minted, config.decimals)
          );
          printField(
            "Remaining:",
            formatAmount(m.quota.sub(m.minted), config.decimals)
          );
          console.log();
        }
      }

      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError listing minters: ${message}\n`);
      process.exit(1);
    }
  });

mintersCmd
  .command("add <address>")
  .description("Add or update a minter (requires master authority)")
  .requiredOption("--quota <amount>", "Minting quota")
  .action(async (addressStr: string, opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let minter: PublicKey;
      try {
        minter = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid minter address "${addressStr}".`);
        process.exit(1);
      }

      await sdk.refresh();
      const config = sdk.getConfig();
      const quota = parseAmount(opts.quota, config.decimals);

      console.log(`\nAdding minter ${addressStr}...\n`);

      const signature = await sdk.updateMinter(minter, {
        quota,
        active: true,
      });

      divider();
      printField("Minter:", addressStr);
      printField("Quota:", opts.quota);
      printField("Status:", "Active");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError adding minter: ${message}\n`);
      process.exit(1);
    }
  });

mintersCmd
  .command("remove <address>")
  .description("Deactivate a minter (requires master authority)")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let minter: PublicKey;
      try {
        minter = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid minter address "${addressStr}".`);
        process.exit(1);
      }

      // Fetch existing minter config to preserve quota
      const existing = await sdk.getMinterConfig(minter);
      const quota = existing?.quota ?? new BN(0);

      console.log(`\nDeactivating minter ${addressStr}...\n`);

      const signature = await sdk.updateMinter(minter, {
        quota,
        active: false,
      });

      divider();
      printField("Minter:", addressStr);
      printField("Status:", "Deactivated");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError removing minter: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── holders ─────────────────────────────

program
  .command("holders")
  .description("List token holders")
  .option("--min-balance <amount>", "Minimum balance filter")
  .action(async (opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);
      await sdk.refresh();
      const config = sdk.getConfig();

      console.log("\n  Token Holders\n");
      divider();

      // Use getProgramAccounts to find all token accounts for this mint
      const accounts = await sdk.connection.getParsedProgramAccounts(
        TOKEN_2022_PROGRAM_ID,
        {
          filters: [
            { dataSize: 182 }, // Token-2022 account size (base)
            {
              memcmp: {
                offset: 0,
                bytes: sdk.mintAddress.toBase58(),
              },
            },
          ],
        }
      );

      // Also try the parsed version for better data
      const tokenAccounts =
        await sdk.connection.getTokenLargestAccounts(sdk.mintAddress);

      let minBalanceRaw: BN | null = null;
      if (opts.minBalance) {
        minBalanceRaw = parseAmount(opts.minBalance, config.decimals);
      }

      if (tokenAccounts.value.length === 0) {
        console.log("  No token holders found.");
      } else {
        let count = 0;
        for (const ta of tokenAccounts.value) {
          const balance = new BN(ta.amount);
          if (minBalanceRaw && balance.lt(minBalanceRaw)) continue;

          count++;
          printField("Account:", ta.address.toBase58());
          printField(
            "Balance:",
            formatAmount(balance, config.decimals)
          );
          console.log();
        }

        if (count === 0) {
          console.log("  No holders match the minimum balance filter.");
        } else {
          console.log(`  Total: ${count} holder(s)`);
        }
      }

      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError fetching holders: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── audit-log ─────────────────────────────

program
  .command("audit-log")
  .description("View recent audit log events from on-chain transactions")
  .option("--action <type>", "Filter by action type (e.g., mint, burn, freeze)")
  .option("--limit <number>", "Number of recent transactions to scan", "50")
  .action(async (opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      const limit = parseInt(opts.limit, 10);
      const actionFilter = opts.action?.toLowerCase();

      console.log("\n  Audit Log\n");
      divider();

      // Fetch recent transaction signatures for the config address
      const signatures = await sdk.connection.getSignaturesForAddress(
        sdk.configAddress,
        { limit }
      );

      if (signatures.length === 0) {
        console.log("  No transactions found.");
        divider();
        console.log();
        return;
      }

      // Known event names from the stablecoin program
      const EVENT_NAMES = [
        "StablecoinInitialized",
        "TokensMinted",
        "TokensBurned",
        "AccountFrozen",
        "AccountThawed",
        "Paused",
        "Unpaused",
        "MinterUpdated",
        "RolesUpdated",
        "AuthorityTransferInitiated",
        "AuthorityTransferCompleted",
        "AddedToBlacklist",
        "RemovedFromBlacklist",
        "TokensSeized",
      ];

      // Map action filter names to event names
      const ACTION_MAP: Record<string, string[]> = {
        init: ["StablecoinInitialized"],
        initialize: ["StablecoinInitialized"],
        mint: ["TokensMinted"],
        burn: ["TokensBurned"],
        freeze: ["AccountFrozen"],
        thaw: ["AccountThawed"],
        pause: ["Paused"],
        unpause: ["Unpaused"],
        minter: ["MinterUpdated"],
        roles: ["RolesUpdated"],
        authority: [
          "AuthorityTransferInitiated",
          "AuthorityTransferCompleted",
        ],
        blacklist: ["AddedToBlacklist", "RemovedFromBlacklist"],
        seize: ["TokensSeized"],
      };

      const filteredEventNames = actionFilter
        ? ACTION_MAP[actionFilter] ?? []
        : EVENT_NAMES;

      if (actionFilter && filteredEventNames.length === 0) {
        console.log(
          `  Unknown action filter "${actionFilter}".`
        );
        console.log(
          `  Available actions: ${Object.keys(ACTION_MAP).join(", ")}`
        );
        divider();
        console.log();
        return;
      }

      let eventCount = 0;

      // Process transactions in batches to avoid rate limiting
      const batchSize = 10;
      for (let i = 0; i < signatures.length; i += batchSize) {
        const batch = signatures.slice(i, i + batchSize);
        const txSignatures = batch.map((s) => s.signature);

        const transactions = await sdk.connection.getTransactions(
          txSignatures,
          {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          }
        );

        for (let j = 0; j < transactions.length; j++) {
          const tx = transactions[j];
          if (!tx?.meta?.logMessages) continue;

          const sig = txSignatures[j];
          const timestamp = batch[j].blockTime
            ? new Date(batch[j].blockTime! * 1000).toISOString()
            : "unknown";

          // Parse program logs for event emissions
          for (const log of tx.meta.logMessages) {
            // Anchor emits events as base64-encoded data after "Program data: "
            // We also look for human-readable log messages
            for (const eventName of filteredEventNames) {
              if (log.includes(eventName) || log.includes(`Program log: ${eventName}`)) {
                eventCount++;
                printField("Event:", eventName);
                printField("Time:", timestamp);
                printField("Signature:", sig);
                printField("Status:", tx.meta.err ? "Failed" : "Success");
                console.log();
                break;
              }
            }

            // Also detect Anchor event data prefix
            if (log.startsWith("Program data: ")) {
              // Anchor events are base64-encoded after "Program data: "
              // The first 8 bytes are the event discriminator
              // We note the raw data for completeness
              const hasMatchingEvent = filteredEventNames.some((name) =>
                tx.meta!.logMessages!.some(
                  (l) => l.includes(name) || l.includes(`Program log: ${name}`)
                )
              );
              // Only show "Program data" events if we haven't already matched by name
              if (!hasMatchingEvent && !actionFilter) {
                // Skip raw data entries when no filter — they are already matched above
              }
            }
          }
        }
      }

      if (eventCount === 0) {
        console.log(
          actionFilter
            ? `  No "${actionFilter}" events found in the last ${limit} transactions.`
            : `  No events found in the last ${limit} transactions.`
        );
      } else {
        console.log(`  Total: ${eventCount} event(s)`);
      }

      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError fetching audit log: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── roles ─────────────────────────────

const rolesCmd = program
  .command("roles")
  .description("Manage role assignments");

rolesCmd
  .command("list")
  .description("List current role assignments")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      const roles = await sdk.getRoles();

      console.log("\n  Role Assignments\n");
      divider();
      printField("Pauser:", roles.pauser.toBase58());
      printField("Freezer:", roles.freezer.toBase58());
      printField("Blacklister:", roles.blacklister.toBase58());
      printField("Seizer:", roles.seizer.toBase58());
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError fetching roles: ${message}\n`);
      process.exit(1);
    }
  });

rolesCmd
  .command("update")
  .description("Update role assignments (requires master authority)")
  .option("--pauser <address>", "New pauser address")
  .option("--freezer <address>", "New freezer address")
  .option("--blacklister <address>", "New blacklister address")
  .option("--seizer <address>", "New seizer address")
  .action(async (opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      const params: {
        pauser?: PublicKey | null;
        freezer?: PublicKey | null;
        blacklister?: PublicKey | null;
        seizer?: PublicKey | null;
      } = {};

      if (opts.pauser) {
        try {
          params.pauser = new PublicKey(opts.pauser);
        } catch {
          console.error(
            `Error: Invalid pauser address "${opts.pauser}".`
          );
          process.exit(1);
        }
      }

      if (opts.freezer) {
        try {
          params.freezer = new PublicKey(opts.freezer);
        } catch {
          console.error(
            `Error: Invalid freezer address "${opts.freezer}".`
          );
          process.exit(1);
        }
      }

      if (opts.blacklister) {
        try {
          params.blacklister = new PublicKey(opts.blacklister);
        } catch {
          console.error(
            `Error: Invalid blacklister address "${opts.blacklister}".`
          );
          process.exit(1);
        }
      }

      if (opts.seizer) {
        try {
          params.seizer = new PublicKey(opts.seizer);
        } catch {
          console.error(
            `Error: Invalid seizer address "${opts.seizer}".`
          );
          process.exit(1);
        }
      }

      if (
        !params.pauser &&
        !params.freezer &&
        !params.blacklister &&
        !params.seizer
      ) {
        console.error(
          "\nError: At least one role must be specified.\n" +
            "Options: --pauser, --freezer, --blacklister, --seizer"
        );
        process.exit(1);
      }

      console.log("\nUpdating roles...\n");

      const signature = await sdk.updateRoles(params);

      divider();
      if (params.pauser) printField("Pauser:", params.pauser.toBase58());
      if (params.freezer) printField("Freezer:", params.freezer.toBase58());
      if (params.blacklister)
        printField("Blacklister:", params.blacklister.toBase58());
      if (params.seizer) printField("Seizer:", params.seizer.toBase58());
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError updating roles: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── authority ─────────────────────────────

const authorityCmd = program
  .command("authority")
  .description("Manage authority transfers");

authorityCmd
  .command("transfer <address>")
  .description("Initiate a two-step authority transfer to a new address")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let newAuthority: PublicKey;
      try {
        newAuthority = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nInitiating authority transfer to ${addressStr}...\n`
      );

      const signature = await sdk.transferAuthority(newAuthority);

      divider();
      printField("Pending Authority:", addressStr);
      printField("Transaction:", signature);
      divider();
      console.log(
        "\nThe new authority must call `authority accept` to complete the transfer.\n"
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError transferring authority: ${message}\n`);
      process.exit(1);
    }
  });

authorityCmd
  .command("accept")
  .description("Accept a pending authority transfer")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      console.log("\nAccepting authority transfer...\n");

      const signature = await sdk.acceptAuthority();

      divider();
      printField("Status:", "Authority transfer accepted");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError accepting authority: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── blacklist check ─────────────────────────────

blacklistCmd
  .command("check <address>")
  .description("Check if an address is blacklisted")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let address: PublicKey;
      try {
        address = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nChecking blacklist status for ${addressStr}...\n`
      );

      const blacklisted = await sdk.compliance.isBlacklisted(address);

      divider();
      printField("Address:", addressStr);
      printField("Blacklisted:", blacklisted ? "Yes" : "No");

      if (blacklisted) {
        const entry = await sdk.compliance.getBlacklistEntry(address);
        if (entry) {
          printField("Reason:", entry.reason);
          printField("Blacklisted By:", entry.blacklistedBy.toBase58());
          printField(
            "Timestamp:",
            new Date(entry.blacklistedAt.toNumber() * 1000).toISOString()
          );
        }
      }

      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError checking blacklist: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── allowlist ─────────────────────────────

const allowlistCmd = program
  .command("allowlist")
  .description("Manage the allowlist (SSS-3 only)");

allowlistCmd
  .command("add <address>")
  .description("Add an address to the allowlist")
  .requiredOption("--reason <reason>", "Reason for allowlisting")
  .action(async (addressStr: string, opts) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let address: PublicKey;
      try {
        address = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nAdding ${addressStr} to allowlist...\n`
      );

      const signature = await sdk.compliance.allowlistAdd(
        address,
        opts.reason
      );

      divider();
      printField("Address:", addressStr);
      printField("Reason:", opts.reason);
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError adding to allowlist: ${message}\n`);
      process.exit(1);
    }
  });

allowlistCmd
  .command("remove <address>")
  .description("Remove an address from the allowlist")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let address: PublicKey;
      try {
        address = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nRemoving ${addressStr} from allowlist...\n`
      );

      const signature = await sdk.compliance.allowlistRemove(address);

      divider();
      printField("Address:", addressStr);
      printField("Status:", "Removed from allowlist");
      printField("Transaction:", signature);
      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError removing from allowlist: ${message}\n`);
      process.exit(1);
    }
  });

allowlistCmd
  .command("check <address>")
  .description("Check if an address is on the allowlist")
  .action(async (addressStr: string) => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);

      let address: PublicKey;
      try {
        address = new PublicKey(addressStr);
      } catch {
        console.error(`Error: Invalid address "${addressStr}".`);
        process.exit(1);
      }

      console.log(
        `\nChecking allowlist status for ${addressStr}...\n`
      );

      const allowlisted = await sdk.compliance.isAllowlisted(address);

      divider();
      printField("Address:", addressStr);
      printField("Allowlisted:", allowlisted ? "Yes" : "No");

      if (allowlisted) {
        const entry = await sdk.compliance.getAllowlistEntry(address);
        if (entry) {
          printField("Reason:", entry.reason);
          printField("Allowlisted By:", entry.allowlistedBy.toBase58());
          printField(
            "Timestamp:",
            new Date(entry.allowlistedAt.toNumber() * 1000).toISOString()
          );
        }
      }

      divider();
      console.log();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError checking allowlist: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── tui ─────────────────────────────

program
  .command("tui")
  .description("Launch the interactive admin TUI (requires --config)")
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const sdk = await loadSdk(globalOpts);
      const tui = new StablecoinTUI(sdk);
      await tui.run();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError launching TUI: ${message}\n`);
      process.exit(1);
    }
  });

// ───────────────────────────── Parse & Run ─────────────────────────────

program.parseAsync(process.argv)
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nUnexpected error: ${message}\n`);
    process.exit(1);
  });
