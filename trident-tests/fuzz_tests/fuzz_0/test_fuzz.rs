/// test_fuzz.rs
///
/// Main entry point for the `fuzz_0` Trident fuzz target.
///
/// honggfuzz drives execution: it generates raw bytes, hands them to
/// `fuzz!`, which deserializes them via `arbitrary` into a `FuzzData`
/// value, then calls `run` to execute the instruction sequence against a
/// local test validator.
///
/// To run:
///   cargo hfuzz run fuzz_0
///
/// To reproduce a crash:
///   cargo hfuzz run-debug fuzz_0 hfuzz_workspace/fuzz_0/CRASHES/<file>

use honggfuzz::fuzz;
use trident_client::fuzzing::*;

mod accounts_snapshots;
mod fuzz_instructions;

use fuzz_instructions::{FuzzData, FuzzInstruction};

fn main() {
    // honggfuzz loop: each iteration provides a fresh corpus entry.
    loop {
        fuzz!(|data: FuzzData| {
            // Set up a local validator with the stablecoin program deployed.
            // `ProgramTestContext` is provided by trident_client; it spins up
            // solana-test-validator in-process.
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(run_fuzz(data));
        });
    }
}

async fn run_fuzz(data: FuzzData) {
    // `TridentContext` wraps ProgramTestContext with helpers for account
    // creation, signing, and snapshot capture.
    let mut ctx = TridentContext::new().await;

    // Initialize the stablecoin once per fuzz iteration so that each
    // instruction sequence starts from a known baseline state.
    if let Err(_) = fuzz_instructions::initialize_baseline(&mut ctx).await {
        // If initialization itself fails (e.g., out-of-memory in the
        // test validator), abort this iteration silently.
        return;
    }

    // Execute the fuzz-generated sequence.
    for ix in &data.instruction_sequence {
        // We deliberately ignore individual instruction errors — the
        // program should return an error code, not panic.  Panics inside
        // the BPF VM would surface as a crash and be reported by honggfuzz.
        let _ = fuzz_instructions::execute_instruction(&mut ctx, ix).await;
    }

    // After the full sequence, run global invariant checks.
    fuzz_instructions::check_invariants(&mut ctx).await;
}
