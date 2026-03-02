/**
 * Interactive Admin TUI (Terminal UI)
 *
 * A readline-based interactive terminal interface for managing a Solana
 * Stablecoin Standard instance.  No external UI dependencies are required —
 * only Node.js built-ins (readline) are used.
 *
 * Usage:
 *   const tui = new StablecoinTUI(sdk);
 *   await tui.run();
 */

import * as readline from "readline";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { SolanaStablecoin } from "./stablecoin";

// ---------------------------------------------------------------------------
// ANSI colour helpers
// ---------------------------------------------------------------------------

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function green (s: string): string { return `${GREEN}${s}${RESET}`; }
function red   (s: string): string { return `${RED}${s}${RESET}`; }
function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
function cyan  (s: string): string { return `${CYAN}${s}${RESET}`; }
function bold  (s: string): string { return `${BOLD}${s}${RESET}`; }

// ---------------------------------------------------------------------------
// readline helpers
// ---------------------------------------------------------------------------

/**
 * Wrap readline.Interface in a promise-based API so we can use async/await
 * throughout the TUI without callback spaghetti.
 */
function createRl(): readline.Interface {
  return readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompt the user for a single line of text.
 * The rl interface is closed after the question is answered so that we can
 * create a fresh one for each subsequent question — this avoids event-listener
 * leaks when the TUI loops.
 */
function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(yellow(prompt), (answer) => {
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// StablecoinTUI
// ---------------------------------------------------------------------------

/** Interactive admin terminal for a deployed Solana Stablecoin Standard. */
export class StablecoinTUI {
  private readonly sdk: SolanaStablecoin;

  constructor(sdk: SolanaStablecoin) {
    this.sdk = sdk;
  }

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  /** Start the interactive session.  Loops until the user selects [0] Exit. */
  async run(): Promise<void> {
    this.printBanner();

    let running = true;
    while (running) {
      this.printMenu();

      const rl = createRl();
      const choice = await ask(rl, "Select an option: ");
      rl.close();

      switch (choice) {
        case "1":  await this.viewStatus();          break;
        case "2":  await this.mintTokens();          break;
        case "3":  await this.burnTokens();          break;
        case "4":  await this.pauseUnpause();        break;
        case "5":  await this.freezeThawAccount();   break;
        case "6":  await this.manageBlacklist();     break;
        case "7":  await this.manageAllowlist();     break;
        case "8":  await this.manageMinters();       break;
        case "9":  await this.viewHolders();         break;
        case "10": await this.manageRoles();         break;
        case "0":
          console.log(cyan("\nGoodbye.\n"));
          running = false;
          break;
        default:
          console.log(red(`\nUnknown option: "${choice}". Please try again.\n`));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Banner & Menu
  // -------------------------------------------------------------------------

  private printBanner(): void {
    console.log();
    console.log(cyan(bold("╔══════════════════════════════════════════════╗")));
    console.log(cyan(bold("║   Solana Stablecoin Standard — Admin TUI     ║")));
    console.log(cyan(bold("╚══════════════════════════════════════════════╝")));
    console.log(
      `  Mint: ${this.sdk.mintAddress.toBase58()}\n` +
      `  Config: ${this.sdk.configAddress.toBase58()}\n`
    );
  }

  private printMenu(): void {
    console.log(cyan("─────────────────────────────────────────────────"));
    console.log(bold("  Main Menu"));
    console.log(cyan("─────────────────────────────────────────────────"));
    const items = [
      "[1]  View Status",
      "[2]  Mint Tokens",
      "[3]  Burn Tokens",
      "[4]  Pause / Unpause",
      "[5]  Freeze / Thaw Account",
      "[6]  Manage Blacklist",
      "[7]  Manage Allowlist",
      "[8]  Manage Minters",
      "[9]  View Holders",
      "[10] Roles (view / update)",
      "[0]  Exit",
    ];
    items.forEach((item) => console.log("  " + item));
    console.log(cyan("─────────────────────────────────────────────────"));
  }

  // -------------------------------------------------------------------------
  // [1] View Status
  // -------------------------------------------------------------------------

  private async viewStatus(): Promise<void> {
    console.log(cyan("\n--- Status ---"));
    try {
      await this.sdk.refresh();
      const config      = this.sdk.getConfig();
      const totalSupply = await this.sdk.getTotalSupply();
      const roles       = await this.sdk.getRoles();

      console.log(`  Authority      : ${config.masterAuthority.toBase58()}`);
      if (!config.pendingAuthority.equals(PublicKey.default)) {
        console.log(`  Pending Auth   : ${config.pendingAuthority.toBase58()}`);
      }
      console.log(`  Mint           : ${config.mint.toBase58()}`);
      console.log(`  Decimals       : ${config.decimals}`);
      console.log(`  Paused         : ${config.isPaused ? red("YES") : green("no")}`);
      console.log(`  Perm. Delegate : ${config.enablePermanentDelegate ? green("yes") : "no"}`);
      console.log(`  Transfer Hook  : ${config.enableTransferHook ? green("yes") : "no"}`);
      console.log(`  Total Minted   : ${config.totalMinted.toString()}`);
      console.log(`  Total Burned   : ${config.totalBurned.toString()}`);
      console.log(`  Total Supply   : ${green(totalSupply.toString())}`);
      console.log();
      console.log(cyan("  Roles:"));
      console.log(`    Pauser       : ${roles.pauser.toBase58()}`);
      console.log(`    Freezer      : ${roles.freezer.toBase58()}`);
      console.log(`    Blacklister  : ${roles.blacklister.toBase58()}`);
      console.log(`    Seizer       : ${roles.seizer.toBase58()}`);
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}`));
    }
    console.log();
  }

  // -------------------------------------------------------------------------
  // [2] Mint Tokens
  // -------------------------------------------------------------------------

  private async mintTokens(): Promise<void> {
    console.log(cyan("\n--- Mint Tokens ---"));
    try {
      const rl1        = createRl();
      const recipientStr = await ask(rl1, "  Recipient address: ");
      rl1.close();

      const rl2        = createRl();
      const minterStr  = await ask(rl2, "  Minter address (leave blank to use wallet): ");
      rl2.close();

      const rl3        = createRl();
      const amountStr  = await ask(rl3, "  Amount (raw, no decimals): ");
      rl3.close();

      const recipient = new PublicKey(recipientStr);
      const minter    = minterStr
        ? new PublicKey(minterStr)
        : this.sdk.provider.wallet.publicKey;
      const amount    = new BN(amountStr);

      const sig = await this.sdk.mint({ recipient, minter, amount });
      console.log(green(`\n  Success! tx: ${sig}\n`));
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [3] Burn Tokens
  // -------------------------------------------------------------------------

  private async burnTokens(): Promise<void> {
    console.log(cyan("\n--- Burn Tokens ---"));
    try {
      const rl        = createRl();
      const amountStr = await ask(rl, "  Amount to burn (raw, no decimals): ");
      rl.close();

      const sig = await this.sdk.burn(new BN(amountStr));
      console.log(green(`\n  Success! tx: ${sig}\n`));
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [4] Pause / Unpause
  // -------------------------------------------------------------------------

  private async pauseUnpause(): Promise<void> {
    console.log(cyan("\n--- Pause / Unpause ---"));
    try {
      await this.sdk.refresh();
      const isPaused = this.sdk.getConfig().isPaused;
      console.log(`  Current state: ${isPaused ? red("PAUSED") : green("active")}`);

      const rl     = createRl();
      const action = await ask(
        rl,
        isPaused
          ? "  Type 'unpause' to resume operations: "
          : "  Type 'pause' to halt operations: "
      );
      rl.close();

      let sig: string;
      if (isPaused && action.toLowerCase() === "unpause") {
        sig = await this.sdk.unpause();
        console.log(green(`\n  Unpaused! tx: ${sig}\n`));
      } else if (!isPaused && action.toLowerCase() === "pause") {
        sig = await this.sdk.pause();
        console.log(green(`\n  Paused! tx: ${sig}\n`));
      } else {
        console.log(yellow("\n  Action cancelled.\n"));
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [5] Freeze / Thaw Account
  // -------------------------------------------------------------------------

  private async freezeThawAccount(): Promise<void> {
    console.log(cyan("\n--- Freeze / Thaw Account ---"));
    try {
      const rl1      = createRl();
      const ownerStr = await ask(rl1, "  Owner address of the token account: ");
      rl1.close();

      const rl2    = createRl();
      const action = await ask(rl2, "  Action [freeze / thaw]: ");
      rl2.close();

      const owner = new PublicKey(ownerStr);
      const ata   = getAssociatedTokenAddressSync(
        this.sdk.mintAddress,
        owner,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      console.log(`  Token account: ${ata.toBase58()}`);

      let sig: string;
      if (action.toLowerCase() === "freeze") {
        sig = await this.sdk.freezeAccount(ata);
        console.log(green(`\n  Frozen! tx: ${sig}\n`));
      } else if (action.toLowerCase() === "thaw") {
        sig = await this.sdk.thawAccount(ata);
        console.log(green(`\n  Thawed! tx: ${sig}\n`));
      } else {
        console.log(yellow("\n  Unknown action. Enter 'freeze' or 'thaw'.\n"));
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [6] Manage Blacklist
  // -------------------------------------------------------------------------

  private async manageBlacklist(): Promise<void> {
    console.log(cyan("\n--- Manage Blacklist ---"));
    console.log("  [a] Add to blacklist");
    console.log("  [r] Remove from blacklist");
    console.log("  [c] Check if blacklisted");
    console.log("  [b] Back");

    const rl1  = createRl();
    const sub  = await ask(rl1, "  Choice: ");
    rl1.close();

    try {
      switch (sub.toLowerCase()) {
        case "a": {
          const rl2      = createRl();
          const addrStr  = await ask(rl2, "  Address to blacklist: ");
          rl2.close();

          const rl3   = createRl();
          const reason = await ask(rl3, "  Reason: ");
          rl3.close();

          const sig = await this.sdk.compliance.blacklistAdd(
            new PublicKey(addrStr),
            reason
          );
          console.log(green(`\n  Added to blacklist! tx: ${sig}\n`));
          break;
        }
        case "r": {
          const rl2     = createRl();
          const addrStr = await ask(rl2, "  Address to remove from blacklist: ");
          rl2.close();

          const sig = await this.sdk.compliance.blacklistRemove(
            new PublicKey(addrStr)
          );
          console.log(green(`\n  Removed from blacklist! tx: ${sig}\n`));
          break;
        }
        case "c": {
          const rl2     = createRl();
          const addrStr = await ask(rl2, "  Address to check: ");
          rl2.close();

          const addr    = new PublicKey(addrStr);
          const listed  = await this.sdk.compliance.isBlacklisted(addr);
          if (listed) {
            const entry = await this.sdk.compliance.getBlacklistEntry(addr);
            console.log(red(`\n  BLACKLISTED`));
            if (entry) {
              console.log(`  Reason     : ${entry.reason}`);
              console.log(`  Blacklisted at slot: ${entry.blacklistedAt.toString()}`);
              console.log(`  By         : ${entry.blacklistedBy.toBase58()}`);
            }
          } else {
            console.log(green(`\n  Not blacklisted.\n`));
          }
          break;
        }
        case "b":
        default:
          console.log(yellow("\n  Back.\n"));
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [7] Manage Allowlist
  // -------------------------------------------------------------------------

  private async manageAllowlist(): Promise<void> {
    console.log(cyan("\n--- Manage Allowlist ---"));
    console.log("  [a] Add to allowlist");
    console.log("  [r] Remove from allowlist");
    console.log("  [b] Back");

    const rl1 = createRl();
    const sub = await ask(rl1, "  Choice: ");
    rl1.close();

    try {
      switch (sub.toLowerCase()) {
        case "a": {
          const rl2     = createRl();
          const addrStr = await ask(rl2, "  Address to allowlist: ");
          rl2.close();

          // The SDK's allowlist methods follow the same pattern as blacklist.
          // Cast through `any` to access them if they exist (SSS-3 feature).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sdkAny = this.sdk as any;
          if (typeof sdkAny.allowlistAdd !== "function") {
            console.log(
              yellow(
                "\n  Allowlist is not enabled for this stablecoin " +
                  "(requires SSS-3 preset).\n"
              )
            );
            break;
          }
          const sig = await sdkAny.allowlistAdd(new PublicKey(addrStr));
          console.log(green(`\n  Added to allowlist! tx: ${sig}\n`));
          break;
        }
        case "r": {
          const rl2     = createRl();
          const addrStr = await ask(rl2, "  Address to remove from allowlist: ");
          rl2.close();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sdkAny = this.sdk as any;
          if (typeof sdkAny.allowlistRemove !== "function") {
            console.log(
              yellow(
                "\n  Allowlist is not enabled for this stablecoin " +
                  "(requires SSS-3 preset).\n"
              )
            );
            break;
          }
          const sig = await sdkAny.allowlistRemove(new PublicKey(addrStr));
          console.log(green(`\n  Removed from allowlist! tx: ${sig}\n`));
          break;
        }
        case "b":
        default:
          console.log(yellow("\n  Back.\n"));
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [8] Manage Minters
  // -------------------------------------------------------------------------

  private async manageMinters(): Promise<void> {
    console.log(cyan("\n--- Manage Minters ---"));
    console.log("  [l] List all minters");
    console.log("  [a] Add / update minter");
    console.log("  [d] Deactivate minter");
    console.log("  [b] Back");

    const rl1 = createRl();
    const sub = await ask(rl1, "  Choice: ");
    rl1.close();

    try {
      switch (sub.toLowerCase()) {
        case "l": {
          const minters = await this.sdk.getMinters();
          if (minters.length === 0) {
            console.log(yellow("\n  No minters configured.\n"));
          } else {
            console.log(cyan(`\n  ${minters.length} minter(s):`));
            for (const m of minters) {
              const status = m.active ? green("active") : red("inactive");
              console.log(
                `  - ${m.minter.toBase58()} | quota: ${m.quota.toString()} | ` +
                  `minted: ${m.minted.toString()} | ${status}`
              );
            }
          }
          console.log();
          break;
        }
        case "a": {
          const rl2       = createRl();
          const addrStr   = await ask(rl2, "  Minter address: ");
          rl2.close();

          const rl3       = createRl();
          const quotaStr  = await ask(rl3, "  Quota (raw, no decimals): ");
          rl3.close();

          const sig = await this.sdk.updateMinter(new PublicKey(addrStr), {
            quota:  new BN(quotaStr),
            active: true,
          });
          console.log(green(`\n  Minter added/updated! tx: ${sig}\n`));
          break;
        }
        case "d": {
          const rl2     = createRl();
          const addrStr = await ask(rl2, "  Minter address to deactivate: ");
          rl2.close();

          const existing = await this.sdk.getMinterConfig(new PublicKey(addrStr));
          if (!existing) {
            console.log(red("\n  Minter not found.\n"));
            break;
          }
          const sig = await this.sdk.updateMinter(new PublicKey(addrStr), {
            quota:  existing.quota,
            active: false,
          });
          console.log(green(`\n  Minter deactivated! tx: ${sig}\n`));
          break;
        }
        case "b":
        default:
          console.log(yellow("\n  Back.\n"));
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // [9] View Holders
  // -------------------------------------------------------------------------

  private async viewHolders(): Promise<void> {
    console.log(cyan("\n--- Token Holders ---"));
    try {
      const rl      = createRl();
      const minStr  = await ask(rl, "  Min balance filter (raw, leave blank for all): ");
      rl.close();

      const minBalance = minStr ? new BN(minStr) : undefined;
      const holders    = await this.sdk.getHolders(minBalance);

      if (holders.length === 0) {
        console.log(yellow("\n  No holders found.\n"));
      } else {
        console.log(cyan(`\n  ${holders.length} holder(s):`));
        for (const h of holders) {
          console.log(
            `  - owner: ${h.owner.toBase58()} | ata: ${h.address.toBase58()} | ` +
              `balance: ${green(h.amount.toString())}`
          );
        }
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
    console.log();
  }

  // -------------------------------------------------------------------------
  // [10] Roles (view / update)
  // -------------------------------------------------------------------------

  private async manageRoles(): Promise<void> {
    console.log(cyan("\n--- Roles ---"));
    console.log("  [v] View current roles");
    console.log("  [u] Update roles");
    console.log("  [t] Transfer authority");
    console.log("  [b] Back");

    const rl1 = createRl();
    const sub = await ask(rl1, "  Choice: ");
    rl1.close();

    try {
      switch (sub.toLowerCase()) {
        case "v": {
          const roles = await this.sdk.getRoles();
          console.log(cyan("\n  Current roles:"));
          console.log(`    Pauser      : ${roles.pauser.toBase58()}`);
          console.log(`    Freezer     : ${roles.freezer.toBase58()}`);
          console.log(`    Blacklister : ${roles.blacklister.toBase58()}`);
          console.log(`    Seizer      : ${roles.seizer.toBase58()}`);
          console.log();
          break;
        }
        case "u": {
          console.log(
            yellow("  Enter new addresses (leave blank to keep current):")
          );

          const rl2       = createRl();
          const pauserStr = await ask(rl2, "  Pauser: ");
          rl2.close();

          const rl3        = createRl();
          const freezerStr = await ask(rl3, "  Freezer: ");
          rl3.close();

          const rl4            = createRl();
          const blacklisterStr = await ask(rl4, "  Blacklister: ");
          rl4.close();

          const rl5       = createRl();
          const seizerStr = await ask(rl5, "  Seizer: ");
          rl5.close();

          const params: {
            pauser?: PublicKey;
            freezer?: PublicKey;
            blacklister?: PublicKey;
            seizer?: PublicKey;
          } = {};
          if (pauserStr)      params.pauser      = new PublicKey(pauserStr);
          if (freezerStr)     params.freezer     = new PublicKey(freezerStr);
          if (blacklisterStr) params.blacklister = new PublicKey(blacklisterStr);
          if (seizerStr)      params.seizer      = new PublicKey(seizerStr);

          const sig = await this.sdk.updateRoles(params);
          console.log(green(`\n  Roles updated! tx: ${sig}\n`));
          break;
        }
        case "t": {
          const rl2    = createRl();
          const newAuth = await ask(rl2, "  New authority address: ");
          rl2.close();

          const sig = await this.sdk.transferAuthority(new PublicKey(newAuth));
          console.log(
            green(
              `\n  Authority transfer initiated! tx: ${sig}\n` +
                `  The new authority must call acceptAuthority() to complete the transfer.\n`
            )
          );
          break;
        }
        case "b":
        default:
          console.log(yellow("\n  Back.\n"));
      }
    } catch (err) {
      console.error(red(`\n  Error: ${(err as Error).message}\n`));
    }
  }
}
