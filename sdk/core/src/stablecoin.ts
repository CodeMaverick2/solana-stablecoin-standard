import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionSignature,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import type { Stablecoin } from "./idl/stablecoin";
import type { TransferHook } from "./idl/transfer_hook";
import {
  getConfigAddress,
  getMinterAddress,
  getRolesAddress,
  getBlacklistAddress,
  getAllowlistAddress,
  getExtraAccountMetaListAddress,
} from "./pda";
import { Presets } from "./presets";
import type {
  CreateParams,
  StablecoinConfigAccount,
  MinterConfigAccount,
  RoleConfigAccount,
  BlacklistEntryAccount,
  AllowlistEntryAccount,
  UpdateMinterParams,
  UpdateRolesParams,
  MintParams,
  ComplianceOperations,
  TokenHolderInfo,
} from "./types";

/** The main SDK class for interacting with a Solana Stablecoin Standard instance. */
export class SolanaStablecoin {
  readonly connection: Connection;
  readonly provider: AnchorProvider;
  readonly program: Program<Stablecoin>;
  readonly transferHookProgram: Program<TransferHook> | null;

  /** The stablecoin config PDA. */
  readonly configAddress: PublicKey;
  /** The stablecoin mint address (Keypair, not PDA). */
  readonly mintAddress: PublicKey;
  /** The roles PDA. */
  readonly rolesAddress: PublicKey;

  private _config: StablecoinConfigAccount | null = null;

  private constructor(
    provider: AnchorProvider,
    program: Program<Stablecoin>,
    transferHookProgram: Program<TransferHook> | null,
    configAddress: PublicKey,
    mintAddress: PublicKey,
    rolesAddress: PublicKey
  ) {
    this.connection = provider.connection;
    this.provider = provider;
    this.program = program;
    this.transferHookProgram = transferHookProgram;
    this.configAddress = configAddress;
    this.mintAddress = mintAddress;
    this.rolesAddress = rolesAddress;
  }

  /** Create a new stablecoin and return the SDK instance. */
  static async create(
    provider: AnchorProvider,
    stablecoinProgram: Program<Stablecoin>,
    transferHookProgram: Program<TransferHook> | null,
    params: CreateParams
  ): Promise<{ sdk: SolanaStablecoin; signature: string; mintKeypair: Keypair }> {
    const preset = params.preset ?? Presets.SSS_1;
    const decimals = params.decimals ?? 6;
    const uri = params.uri ?? "";
    const programId = stablecoinProgram.programId;

    // Generate a fresh keypair for the mint account.
    const mintKeypair = Keypair.generate();
    const mintAddress = mintKeypair.publicKey;

    // Derive config PDA from mint.
    const [configAddress] = getConfigAddress(programId, mintAddress);
    const [rolesAddress] = getRolesAddress(programId, configAddress);

    const initParams = {
      name: params.name,
      symbol: params.symbol,
      uri,
      decimals,
      enablePermanentDelegate: preset.enablePermanentDelegate ?? false,
      enableTransferHook: preset.enableTransferHook ?? false,
      enableConfidentialTransfer: preset.enableConfidentialTransfer ?? false,
      enableAllowlist: preset.enableAllowlist ?? false,
    };

    const signature = await stablecoinProgram.methods
      .initialize(initParams)
      .accountsPartial({
        payer: provider.wallet.publicKey,
        authority: params.authority ?? provider.wallet.publicKey,
        mint: mintAddress,
        transferHookProgram:
          preset.enableTransferHook && params.transferHookProgramId
            ? params.transferHookProgramId
            : null,
      })
      .signers([mintKeypair])
      .rpc();

    // If SSS-2, initialize the extra account meta list for the transfer hook.
    if (
      preset.enableTransferHook &&
      transferHookProgram &&
      params.transferHookProgramId
    ) {
      await transferHookProgram.methods
        .initializeExtraAccountMetaList(configAddress, programId)
        .accountsPartial({
          payer: provider.wallet.publicKey,
          mint: mintAddress,
        })
        .rpc();
    }

    const sdk = new SolanaStablecoin(
      provider,
      stablecoinProgram,
      transferHookProgram,
      configAddress,
      mintAddress,
      rolesAddress
    );

    await sdk.refresh();
    return { sdk, signature, mintKeypair };
  }

  /** Load an existing stablecoin SDK instance from its config address. */
  static async load(
    provider: AnchorProvider,
    stablecoinProgram: Program<Stablecoin>,
    transferHookProgram: Program<TransferHook> | null,
    configAddress: PublicKey
  ): Promise<SolanaStablecoin> {
    const configAccount =
      (await stablecoinProgram.account.stablecoinConfig.fetch(
        configAddress
      )) as unknown as StablecoinConfigAccount;

    const mintAddress = configAccount.mint;
    const [rolesAddress] = getRolesAddress(
      stablecoinProgram.programId,
      configAddress
    );

    const sdk = new SolanaStablecoin(
      provider,
      stablecoinProgram,
      transferHookProgram,
      configAddress,
      mintAddress,
      rolesAddress
    );
    sdk._config = configAccount;

    return sdk;
  }

  /** Refresh the cached config from on-chain. */
  async refresh(): Promise<void> {
    this._config =
      (await this.program.account.stablecoinConfig.fetch(
        this.configAddress
      )) as unknown as StablecoinConfigAccount;
  }

  /** Get the cached config (call refresh() first if stale). */
  getConfig(): StablecoinConfigAccount {
    if (!this._config) throw new Error("Config not loaded. Call refresh().");
    return this._config;
  }

  // ---- Core Operations ----

  /** Mint tokens to a recipient. */
  async mint(params: MintParams): Promise<TransactionSignature> {
    const recipientAta = getAssociatedTokenAddressSync(
      this.mintAddress,
      params.recipient,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Create ATA if needed.
    const ataInfo = await this.connection.getAccountInfo(recipientAta);
    if (!ataInfo) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        this.provider.wallet.publicKey,
        recipientAta,
        params.recipient,
        this.mintAddress,
        TOKEN_2022_PROGRAM_ID
      );
      await this.provider.sendAndConfirm(new Transaction().add(createAtaIx));
    }

    return this.program.methods
      .mintTokens(params.amount)
      .accountsPartial({
        minter: params.minter,
        mint: this.mintAddress,
        recipientTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /** Burn tokens from the caller's own token account. */
  async burn(amount: BN): Promise<TransactionSignature> {
    const burner = this.provider.wallet.publicKey;
    const burnerAta = getAssociatedTokenAddressSync(
      this.mintAddress,
      burner,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    return this.program.methods
      .burnTokens(amount)
      .accountsPartial({
        burner,
        mint: this.mintAddress,
        burnerTokenAccount: burnerAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /** Freeze a token account. Requires freezer role. */
  async freezeAccount(targetAta: PublicKey): Promise<TransactionSignature> {
    return this.program.methods
      .freezeAccount()
      .accountsPartial({
        freezer: this.provider.wallet.publicKey,
        mint: this.mintAddress,
        targetTokenAccount: targetAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /** Thaw a frozen token account. Requires freezer role. */
  async thawAccount(targetAta: PublicKey): Promise<TransactionSignature> {
    return this.program.methods
      .thawAccount()
      .accountsPartial({
        freezer: this.provider.wallet.publicKey,
        mint: this.mintAddress,
        targetTokenAccount: targetAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  }

  /** Pause all stablecoin operations. Requires pauser role. */
  async pause(): Promise<TransactionSignature> {
    return this.program.methods
      .pause()
      .accountsPartial({
        pauser: this.provider.wallet.publicKey,
        config: this.configAddress,
      })
      .rpc();
  }

  /** Unpause stablecoin operations. Requires pauser role. */
  async unpause(): Promise<TransactionSignature> {
    return this.program.methods
      .unpause()
      .accountsPartial({
        pauser: this.provider.wallet.publicKey,
        config: this.configAddress,
      })
      .rpc();
  }

  // ---- Role Management ----

  /** Create or update a minter's configuration. Requires master authority. */
  async updateMinter(
    minter: PublicKey,
    params: UpdateMinterParams
  ): Promise<TransactionSignature> {
    return this.program.methods
      .updateMinter(minter, { quota: params.quota, active: params.active })
      .accountsPartial({
        payer: this.provider.wallet.publicKey,
        authority: this.provider.wallet.publicKey,
        config: this.configAddress,
      })
      .rpc();
  }

  /** Update role assignments. Requires master authority. */
  async updateRoles(params: UpdateRolesParams): Promise<TransactionSignature> {
    return this.program.methods
      .updateRoles({
        pauser: params.pauser ?? null,
        freezer: params.freezer ?? null,
        blacklister: params.blacklister ?? null,
        seizer: params.seizer ?? null,
      })
      .accountsPartial({
        authority: this.provider.wallet.publicKey,
        config: this.configAddress,
      })
      .rpc();
  }

  /** Initiate a two-step authority transfer. Requires master authority. */
  async transferAuthority(
    newAuthority: PublicKey
  ): Promise<TransactionSignature> {
    return this.program.methods
      .transferAuthority(newAuthority)
      .accountsPartial({
        authority: this.provider.wallet.publicKey,
        config: this.configAddress,
      })
      .rpc();
  }

  /** Accept a pending authority transfer. Must be called by the pending authority. */
  async acceptAuthority(): Promise<TransactionSignature> {
    return this.program.methods
      .acceptAuthority()
      .accountsPartial({
        newAuthority: this.provider.wallet.publicKey,
      })
      .rpc();
  }

  // ---- View Functions ----

  /** Get total supply (minted - burned) from on-chain config. */
  async getTotalSupply(): Promise<BN> {
    await this.refresh();
    const config = this.getConfig();
    return config.totalMinted.sub(config.totalBurned);
  }

  async getTotalMinted(): Promise<BN> {
    await this.refresh();
    return this.getConfig().totalMinted;
  }

  async getTotalBurned(): Promise<BN> {
    await this.refresh();
    return this.getConfig().totalBurned;
  }

  /** Fetch the minter config for a given minter pubkey. */
  async getMinterConfig(minter: PublicKey): Promise<MinterConfigAccount | null> {
    const [minterConfig] = getMinterAddress(
      this.program.programId,
      this.configAddress,
      minter
    );
    try {
      return (await this.program.account.minterConfig.fetch(
        minterConfig
      )) as unknown as MinterConfigAccount;
    } catch {
      return null;
    }
  }

  /** Fetch all minter configs for this stablecoin. */
  async getMinters(): Promise<MinterConfigAccount[]> {
    const accounts = await this.program.account.minterConfig.all([
      {
        memcmp: {
          offset: 8 + 32, // after discriminator + minter pubkey
          bytes: this.configAddress.toBase58(),
        },
      },
    ]);
    return accounts.map(
      (a) => a.account as unknown as MinterConfigAccount
    );
  }

  /** Fetch the role configuration. */
  async getRoles(): Promise<RoleConfigAccount> {
    return (await this.program.account.roleConfig.fetch(
      this.rolesAddress
    )) as unknown as RoleConfigAccount;
  }

  /** Fetch token holders with balances. */
  async getHolders(minBalance?: BN): Promise<TokenHolderInfo[]> {
    const largest = await this.connection.getTokenLargestAccounts(this.mintAddress);
    const holders: TokenHolderInfo[] = [];

    for (const ta of largest.value) {
      const balance = new BN(ta.amount);
      if (minBalance && balance.lt(minBalance)) continue;
      if (balance.isZero()) continue;

      // Fetch the parsed account to get the owner
      const accountInfo = await this.connection.getParsedAccountInfo(ta.address);
      let owner = ta.address; // fallback
      if (accountInfo.value && "parsed" in accountInfo.value.data) {
        const parsed = accountInfo.value.data.parsed;
        if (parsed?.info?.owner) {
          owner = new PublicKey(parsed.info.owner);
        }
      }

      holders.push({
        address: ta.address,
        owner,
        amount: balance,
      });
    }

    return holders;
  }

  // ---- Compliance (SSS-2) ----

  /** SSS-2 compliance operations. Throws if compliance is not enabled. */
  get compliance(): ComplianceOperations {
    const self = this;

    return {
      async blacklistAdd(
        address: PublicKey,
        reason: string
      ): Promise<string> {
        return self.program.methods
          .addToBlacklist(address, reason)
          .accountsPartial({
            payer: self.provider.wallet.publicKey,
            blacklister: self.provider.wallet.publicKey,
            config: self.configAddress,
          })
          .rpc();
      },

      async blacklistRemove(address: PublicKey): Promise<string> {
        return self.program.methods
          .removeFromBlacklist(address)
          .accountsPartial({
            payer: self.provider.wallet.publicKey,
            blacklister: self.provider.wallet.publicKey,
            config: self.configAddress,
          })
          .rpc();
      },

      async seize(
        from: PublicKey,
        to: PublicKey,
        amount: BN
      ): Promise<string> {
        return self.program.methods
          .seize(amount)
          .accountsPartial({
            seizer: self.provider.wallet.publicKey,
            mint: self.mintAddress,
            fromTokenAccount: from,
            toTokenAccount: to,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
      },

      async isBlacklisted(address: PublicKey): Promise<boolean> {
        const [blacklistEntry] = getBlacklistAddress(
          self.program.programId,
          self.configAddress,
          address
        );
        const info = await self.connection.getAccountInfo(blacklistEntry);
        return info !== null && info.data.length > 0;
      },

      async getBlacklistEntry(
        address: PublicKey
      ): Promise<BlacklistEntryAccount | null> {
        const [blacklistEntry] = getBlacklistAddress(
          self.program.programId,
          self.configAddress,
          address
        );
        try {
          return (await self.program.account.blacklistEntry.fetch(
            blacklistEntry
          )) as unknown as BlacklistEntryAccount;
        } catch {
          return null;
        }
      },

      // ---- Allowlist (SSS-3) ----

      async allowlistAdd(
        address: PublicKey,
        reason: string
      ): Promise<TransactionSignature> {
        const [allowlistEntry] = getAllowlistAddress(
          self.program.programId,
          self.configAddress,
          address
        );
        const [roles] = getRolesAddress(
          self.program.programId,
          self.configAddress
        );
        return self.program.methods
          .addToAllowlist(address, reason)
          .accountsPartial({
            payer: self.provider.wallet.publicKey,
            blacklister: self.provider.wallet.publicKey,
            roles,
            config: self.configAddress,
            allowlistEntry,
          })
          .rpc();
      },

      async allowlistRemove(
        address: PublicKey
      ): Promise<TransactionSignature> {
        const [allowlistEntry] = getAllowlistAddress(
          self.program.programId,
          self.configAddress,
          address
        );
        const [roles] = getRolesAddress(
          self.program.programId,
          self.configAddress
        );
        return self.program.methods
          .removeFromAllowlist(address)
          .accountsPartial({
            payer: self.provider.wallet.publicKey,
            blacklister: self.provider.wallet.publicKey,
            roles,
            config: self.configAddress,
            allowlistEntry,
          })
          .rpc();
      },

      async isAllowlisted(address: PublicKey): Promise<boolean> {
        const [allowlistEntry] = getAllowlistAddress(
          self.program.programId,
          self.configAddress,
          address
        );
        const info = await self.connection.getAccountInfo(allowlistEntry);
        return info !== null && info.data.length > 0;
      },

      async getAllowlistEntry(
        address: PublicKey
      ): Promise<AllowlistEntryAccount | null> {
        const [allowlistEntry] = getAllowlistAddress(
          self.program.programId,
          self.configAddress,
          address
        );
        try {
          return (await (self.program.account as any).allowlistEntry.fetch(
            allowlistEntry
          )) as AllowlistEntryAccount;
        } catch {
          return null;
        }
      },
    };
  }
}
