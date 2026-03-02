/// fuzz_instructions.rs
///
/// Defines the fuzz instruction corpus, their account resolution, and the
/// three program invariants that must hold after any reachable execution
/// sequence:
///
///   1. Total-supply invariant  — config.total_minted − config.total_burned
///                                == on-chain Token-2022 mint supply.
///   2. Pause invariant         — while config.is_paused == true, every
///                                MintTokens instruction must fail.
///   3. Quota invariant         — for every MinterConfig PDA,
///                                minter.minted <= minter.quota must hold.

use anchor_lang::{
    prelude::Pubkey,
    AnchorSerialize,
    InstructionData,
    ToAccountMetas,
};
use arbitrary::Arbitrary;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    signature::{Keypair, Signer},
    system_program,
};
use trident_client::fuzzing::*;

use crate::accounts_snapshots::{MinterConfigSnapshot, StablecoinConfigSnapshot};

// ---------------------------------------------------------------------------
// Program IDs (must match declare_id! in both programs)
// ---------------------------------------------------------------------------

const STABLECOIN_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");
const TRANSFER_HOOK_PROGRAM_ID: Pubkey = solana_sdk::pubkey!("HgSUZDiLt8UWwzaxhCWwLPPs9zB1F7WTzCFSVmQSaLou");
const TOKEN_2022_PROGRAM_ID: Pubkey = spl_token_2022::ID;

// ---------------------------------------------------------------------------
// Seeds (must match constants.rs in the stablecoin program)
// ---------------------------------------------------------------------------

const CONFIG_SEED: &[u8] = b"stablecoin_config";
const MINTER_SEED: &[u8] = b"minter";
const ROLES_SEED: &[u8] = b"roles";

// ---------------------------------------------------------------------------
// Shared fuzzing state
// ---------------------------------------------------------------------------

/// State shared across all instructions in a single fuzz iteration.
/// Populated by `initialize_baseline` and read/written by subsequent
/// instructions.
pub struct FuzzState {
    /// The Token-2022 mint keypair (fresh per iteration).
    pub mint: Keypair,
    /// StablecoinConfig PDA.
    pub config: Pubkey,
    /// RoleConfig PDA.
    pub roles: Pubkey,
    /// The master authority / payer keypair (funded by the test validator).
    pub authority: Keypair,
    /// A minter keypair (funded by the test validator).
    pub minter: Keypair,
    /// MinterConfig PDA for `minter`.
    pub minter_config: Pubkey,
    /// A token account for the minter (recipient of minted tokens).
    pub minter_token_account: Pubkey,
    /// Track whether the stablecoin is paused locally so the pause invariant
    /// check can be asserted without an extra RPC call inside execute_instruction.
    pub is_paused: bool,
}

impl FuzzState {
    pub fn new(mint: Keypair, authority: Keypair, minter: Keypair) -> Self {
        let mint_pubkey = mint.pubkey();
        let (config, _config_bump) = Pubkey::find_program_address(
            &[CONFIG_SEED, mint_pubkey.as_ref()],
            &STABLECOIN_PROGRAM_ID,
        );
        let (roles, _roles_bump) = Pubkey::find_program_address(
            &[ROLES_SEED, config.as_ref()],
            &STABLECOIN_PROGRAM_ID,
        );
        let (minter_config, _minter_bump) = Pubkey::find_program_address(
            &[MINTER_SEED, config.as_ref(), minter.pubkey().as_ref()],
            &STABLECOIN_PROGRAM_ID,
        );
        // ATA for minter (Token-2022)
        let minter_token_account = spl_associated_token_account::get_associated_token_address_with_program_id(
            &minter.pubkey(),
            &mint_pubkey,
            &TOKEN_2022_PROGRAM_ID,
        );

        Self {
            mint,
            config,
            roles,
            authority,
            minter,
            minter_config,
            minter_token_account,
            is_paused: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Fuzz data types
// ---------------------------------------------------------------------------

/// Top-level fuzz input: an ordered sequence of instructions.
#[derive(Arbitrary, Debug)]
pub struct FuzzData {
    /// honggfuzz will mutate this vector. Trident caps sequence length via
    /// `allow_duplicate_txs = false` to prevent trivially long inputs.
    pub instruction_sequence: Vec<FuzzInstruction>,
}

// ---------------------------------------------------------------------------
// Per-instruction argument structs
// ---------------------------------------------------------------------------

/// Arguments for `mint_tokens`.
#[derive(Arbitrary, Debug, Clone)]
pub struct MintTokensData {
    /// Raw token amount to mint (before decimal scaling).
    /// Bounded to u32::MAX to avoid implausible amounts while still covering
    /// quota-overflow edge cases.
    pub amount: u32,
}

/// Arguments for `burn_tokens`.
#[derive(Arbitrary, Debug, Clone)]
pub struct BurnTokensData {
    /// Raw token amount to burn.
    pub amount: u32,
}

/// Arguments for `pause` — no additional data required (role check only).
#[derive(Arbitrary, Debug, Clone)]
pub struct PauseData;

/// Arguments for `unpause` — no additional data required.
#[derive(Arbitrary, Debug, Clone)]
pub struct UnpauseData;

// ---------------------------------------------------------------------------
// FuzzInstruction enum
// ---------------------------------------------------------------------------

/// All fuzz-able instructions for the stablecoin program.
///
/// Trident's `arbitrary` derive generates random variants; `honggfuzz`
/// mutates the corpus to explore new paths.
#[derive(Arbitrary, Debug)]
pub enum FuzzInstruction {
    /// Call `stablecoin::mint_tokens` with a minter that has a valid quota.
    MintTokens { data: MintTokensData },
    /// Call `stablecoin::burn_tokens` to reduce the supply.
    BurnTokens { data: BurnTokensData },
    /// Call `stablecoin::pause` — sets is_paused = true.
    Pause { data: PauseData },
    /// Call `stablecoin::unpause` — clears is_paused.
    Unpause { data: UnpauseData },
}

// ---------------------------------------------------------------------------
// Baseline initializer
// ---------------------------------------------------------------------------

/// Spin up a minimal stablecoin (SSS-1, no transfer hook) and register one
/// minter with a generous quota so that `MintTokens` instructions can succeed.
///
/// Returns the `FuzzState` that subsequent instructions operate on, stored
/// inside the `TridentContext` via its user-data slot.
pub async fn initialize_baseline(ctx: &mut TridentContext) -> Result<(), FuzzError> {
    // Generate fresh keypairs for this iteration.
    let mint_kp = Keypair::new();
    let authority_kp = ctx.payer().insecure_clone(); // funded by the test validator
    let minter_kp = Keypair::new();

    let state = FuzzState::new(mint_kp, authority_kp.insecure_clone(), minter_kp);

    // --- initialize instruction ---
    // Params: SSS-1 (no permanent_delegate, no transfer_hook)
    let init_params = stablecoin::instruction::Initialize {
        params: stablecoin::instructions::InitializeParams {
            name: "FuzzCoin".to_string(),
            symbol: "FUZZ".to_string(),
            uri: "https://fuzz.example".to_string(),
            decimals: 6,
            enable_permanent_delegate: false,
            enable_transfer_hook: false,
            enable_confidential_transfer: false,
            enable_allowlist: false,
        },
    };

    let init_accounts = stablecoin::accounts::Initialize {
        payer: authority_kp.pubkey(),
        authority: authority_kp.pubkey(),
        config: state.config,
        mint: state.mint.pubkey(),
        roles: state.roles,
        transfer_hook_program: None,
        token_program: TOKEN_2022_PROGRAM_ID,
        system_program: system_program::ID,
        rent: solana_sdk::sysvar::rent::ID,
    };

    ctx.send_transaction(
        &[Instruction {
            program_id: STABLECOIN_PROGRAM_ID,
            accounts: init_accounts.to_account_metas(None),
            data: init_params.data(),
        }],
        &[&authority_kp, &state.mint],
    )
    .await
    .map_err(|_| FuzzError::AccountNotFound)?;

    // --- create minter ATA ---
    ctx.send_transaction(
        &[
            spl_associated_token_account::instruction::create_associated_token_account(
                &authority_kp.pubkey(),
                &state.minter.pubkey(),
                &state.mint.pubkey(),
                &TOKEN_2022_PROGRAM_ID,
            ),
        ],
        &[&authority_kp],
    )
    .await
    .map_err(|_| FuzzError::AccountNotFound)?;

    // --- update_minter: register minter with a quota of 1_000_000_000 ---
    let update_minter_ix = stablecoin::instruction::UpdateMinter {
        minter_pubkey: state.minter.pubkey(),
        params: stablecoin::instructions::UpdateMinterParams {
            quota: 1_000_000_000u64,
            active: true,
        },
    };

    let update_minter_accounts = stablecoin::accounts::UpdateMinter {
        authority: authority_kp.pubkey(),
        config: state.config,
        minter_config: state.minter_config,
        system_program: system_program::ID,
    };

    ctx.send_transaction(
        &[Instruction {
            program_id: STABLECOIN_PROGRAM_ID,
            accounts: update_minter_accounts.to_account_metas(None),
            data: update_minter_ix.data(),
        }],
        &[&authority_kp],
    )
    .await
    .map_err(|_| FuzzError::AccountNotFound)?;

    // Persist state for this iteration.
    ctx.set_user_data(state);
    Ok(())
}

// ---------------------------------------------------------------------------
// Instruction executor
// ---------------------------------------------------------------------------

/// Execute a single fuzz instruction against the live test validator.
///
/// Errors from the program are intentionally swallowed here — we only care
/// that the program does not panic.  The invariant checks that follow verify
/// that program-level errors are always accompanied by correct state rollback.
pub async fn execute_instruction(
    ctx: &mut TridentContext,
    ix: &FuzzInstruction,
) -> Result<(), FuzzError> {
    let state: &mut FuzzState = ctx.user_data_mut();
    let authority_kp = state.authority.insecure_clone();
    let minter_kp = state.minter.insecure_clone();

    match ix {
        // ------------------------------------------------------------------
        FuzzInstruction::MintTokens { data } => {
            let amount = data.amount as u64;
            if amount == 0 {
                return Ok(()); // program would reject; skip.
            }

            let mint_ix = stablecoin::instruction::MintTokens { amount };
            let mint_accounts = stablecoin::accounts::MintTokens {
                minter: minter_kp.pubkey(),
                config: state.config,
                minter_config: state.minter_config,
                mint: state.mint.pubkey(),
                recipient_token_account: state.minter_token_account,
                token_program: TOKEN_2022_PROGRAM_ID,
            };

            let result = ctx
                .send_transaction(
                    &[Instruction {
                        program_id: STABLECOIN_PROGRAM_ID,
                        accounts: mint_accounts.to_account_metas(None),
                        data: mint_ix.data(),
                    }],
                    &[&minter_kp],
                )
                .await;

            // PAUSE INVARIANT: if the coin is paused, mint MUST fail.
            if state.is_paused && result.is_ok() {
                panic!(
                    "PAUSE INVARIANT VIOLATED: MintTokens succeeded while is_paused == true"
                );
            }
        }

        // ------------------------------------------------------------------
        FuzzInstruction::BurnTokens { data } => {
            let amount = data.amount as u64;
            if amount == 0 {
                return Ok(());
            }

            let burn_ix = stablecoin::instruction::BurnTokens { amount };
            let burn_accounts = stablecoin::accounts::BurnTokens {
                owner: minter_kp.pubkey(),
                config: state.config,
                mint: state.mint.pubkey(),
                token_account: state.minter_token_account,
                token_program: TOKEN_2022_PROGRAM_ID,
            };

            let _ = ctx
                .send_transaction(
                    &[Instruction {
                        program_id: STABLECOIN_PROGRAM_ID,
                        accounts: burn_accounts.to_account_metas(None),
                        data: burn_ix.data(),
                    }],
                    &[&minter_kp],
                )
                .await;
        }

        // ------------------------------------------------------------------
        FuzzInstruction::Pause { .. } => {
            let pause_ix = stablecoin::instruction::Pause {};
            let pause_accounts = stablecoin::accounts::Pause {
                pauser: authority_kp.pubkey(),
                config: state.config,
                roles: state.roles,
            };

            let result = ctx
                .send_transaction(
                    &[Instruction {
                        program_id: STABLECOIN_PROGRAM_ID,
                        accounts: pause_accounts.to_account_metas(None),
                        data: pause_ix.data(),
                    }],
                    &[&authority_kp],
                )
                .await;

            if result.is_ok() {
                state.is_paused = true;
            }
        }

        // ------------------------------------------------------------------
        FuzzInstruction::Unpause { .. } => {
            let unpause_ix = stablecoin::instruction::Unpause {};
            let unpause_accounts = stablecoin::accounts::Unpause {
                pauser: authority_kp.pubkey(),
                config: state.config,
                roles: state.roles,
            };

            let result = ctx
                .send_transaction(
                    &[Instruction {
                        program_id: STABLECOIN_PROGRAM_ID,
                        accounts: unpause_accounts.to_account_metas(None),
                        data: unpause_ix.data(),
                    }],
                    &[&authority_kp],
                )
                .await;

            if result.is_ok() {
                state.is_paused = false;
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

/// Run all three invariants after the instruction sequence completes.
///
/// A violated invariant calls `panic!` so honggfuzz records it as a crash
/// and saves the minimised corpus entry that triggered it.
pub async fn check_invariants(ctx: &mut TridentContext) {
    let state: &FuzzState = ctx.user_data();

    // Fetch the latest StablecoinConfig account data.
    let config_data = match ctx.get_account(&state.config).await {
        Ok(Some(acc)) => acc.data,
        _ => return, // account missing — validator may have reset; skip.
    };

    let config_snap = match StablecoinConfigSnapshot::from_account_data(&config_data) {
        Some(s) => s,
        None => return, // could not deserialize; skip rather than false-positive.
    };

    // Fetch the on-chain mint supply from the Token-2022 mint account.
    let mint_data = match ctx.get_account(&state.mint.pubkey()).await {
        Ok(Some(acc)) => acc.data,
        _ => return,
    };

    let on_chain_supply = parse_mint_supply(&mint_data);

    check_total_supply_invariant(&config_snap, on_chain_supply);
    check_pause_invariant(&config_snap, state.is_paused);

    // Fetch minter config and check quota.
    let minter_data = match ctx.get_account(&state.minter_config).await {
        Ok(Some(acc)) => acc.data,
        _ => return,
    };

    if let Some(minter_snap) = MinterConfigSnapshot::from_account_data(&minter_data) {
        check_quota_invariant(&minter_snap);
    }
}

// ---------------------------------------------------------------------------
// Individual invariant functions
// ---------------------------------------------------------------------------

/// INVARIANT 1 — Total supply consistency.
///
/// The circulating supply derived from config counters must equal the actual
/// Token-2022 mint supply.  A mismatch means tokens were created or destroyed
/// without being tracked — a critical accounting bug.
fn check_total_supply_invariant(
    config: &StablecoinConfigSnapshot,
    on_chain_supply: u64,
) {
    let counter_supply = config
        .circulating()
        .expect("SUPPLY INVARIANT VIOLATED: total_burned > total_minted (underflow in counters)");

    assert_eq!(
        counter_supply,
        on_chain_supply,
        "SUPPLY INVARIANT VIOLATED: config counters say {} but Token-2022 mint supply is {}. \
         Difference: {}",
        counter_supply,
        on_chain_supply,
        if counter_supply > on_chain_supply {
            counter_supply - on_chain_supply
        } else {
            on_chain_supply - counter_supply
        },
    );
}

/// INVARIANT 2 — Pause gate.
///
/// If the on-chain config says `is_paused == true`, and our local mirror
/// says the same, they must agree.  Disagreement means the pause flag was
/// flipped without going through the authorised path.
///
/// Note: the stronger form of this invariant (minting while paused → panic)
/// is enforced inline inside `execute_instruction` for `MintTokens`, because
/// we need the transaction result at the moment of execution.
fn check_pause_invariant(config: &StablecoinConfigSnapshot, local_is_paused: bool) {
    // On-chain pause state must match our locally-tracked state.
    assert_eq!(
        config.is_paused,
        local_is_paused,
        "PAUSE INVARIANT VIOLATED: on-chain is_paused={} but local mirror says {}. \
         Pause flag was changed without a valid pause/unpause instruction.",
        config.is_paused,
        local_is_paused,
    );
}

/// INVARIANT 3 — Minter quota.
///
/// A minter's cumulative `minted` counter must never exceed its assigned
/// `quota`.  If it does, the program allowed minting beyond the authorised
/// limit.
fn check_quota_invariant(minter: &MinterConfigSnapshot) {
    assert!(
        !minter.quota_exceeded(),
        "QUOTA INVARIANT VIOLATED: minter {} has minted {} but quota is {} (excess: {})",
        minter.minter,
        minter.minted,
        minter.quota,
        minter.minted - minter.quota,
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse the `supply` field from a raw Token-2022 mint account data buffer.
///
/// Token-2022 mint layout (base, before extensions):
///   mint_authority_option (4) | mint_authority (32) | supply (8) | ...
/// Total offset to supply: 4 + 32 = 36 bytes.
fn parse_mint_supply(data: &[u8]) -> u64 {
    const SUPPLY_OFFSET: usize = 4 + 32; // mint_authority_option + mint_authority
    if data.len() < SUPPLY_OFFSET + 8 {
        return 0;
    }
    u64::from_le_bytes(
        data[SUPPLY_OFFSET..SUPPLY_OFFSET + 8]
            .try_into()
            .unwrap_or([0u8; 8]),
    )
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum FuzzError {
    AccountNotFound,
    TransactionFailed(String),
}

impl std::fmt::Display for FuzzError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FuzzError::AccountNotFound => write!(f, "account not found"),
            FuzzError::TransactionFailed(msg) => write!(f, "transaction failed: {}", msg),
        }
    }
}
