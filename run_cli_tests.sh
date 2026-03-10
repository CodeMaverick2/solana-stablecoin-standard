#!/bin/bash
set -o pipefail

WD="/mnt/c/Users/ghatu/Desktop/solana-stablecoin-standard"
CLI="node $WD/sdk/core/dist/cli.js"
KP="$HOME/.config/solana/id.json"
CLUSTER="devnet"
CFG1="H8QgPMh7s9Wbt1XRD7mP6spmnR5LmnUgoZwpv1it5ADV"
CFG2="5PNfiGnWYTBTrKVhUsPJy8kpEAxm684KAq62Ecz5TR5m"
CFG3="H5dmoyi7ixmQ4pKSZC9wjhjETdX9GNaoQQ7ro5teDu22"
ADDR1="315v8xkbFkLWc6LQ28RooSHkziBhGYkX1zpoXcCSQN2y"
ADDR_BL="9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
OUT="/tmp/cli_test_results.txt"

run_cmd() {
  local NUM="$1"
  local DESC="$2"
  shift 2
  echo "=== CMD $NUM: $DESC ===" | tee -a "$OUT"
  echo "Running: $@" | tee -a "$OUT"
  timeout 90 "$@" < /dev/null 2>&1 | tee -a "$OUT"
  local EC=${PIPESTATUS[0]}
  echo "EXIT_CODE: $EC" | tee -a "$OUT"
  echo "---" | tee -a "$OUT"
}

> "$OUT"
echo "Starting CLI tests at $(date)" | tee -a "$OUT"

# 1
run_cmd 1 "--help" $CLI --help

# 2
run_cmd 2 "status SSS-1" $CLI status --config $CFG1 --cluster $CLUSTER --keypair $KP

# 3
run_cmd 3 "supply SSS-1" $CLI supply --config $CFG1 --cluster $CLUSTER --keypair $KP

# 4
run_cmd 4 "status SSS-2" $CLI status --config $CFG2 --cluster $CLUSTER --keypair $KP

# 5
run_cmd 5 "minters list SSS-1" $CLI minters list --config $CFG1 --cluster $CLUSTER --keypair $KP

# 6
run_cmd 6 "roles list SSS-1" $CLI roles list --config $CFG1 --cluster $CLUSTER --keypair $KP

# 7
run_cmd 7 "mint 500 to ADDR1" $CLI mint $ADDR1 500 --config $CFG1 --cluster $CLUSTER --keypair $KP

# 8
run_cmd 8 "supply SSS-1 (after mint)" $CLI supply --config $CFG1 --cluster $CLUSTER --keypair $KP

# 9
run_cmd 9 "burn 10" $CLI burn 10 --config $CFG1 --cluster $CLUSTER --keypair $KP

# 10
run_cmd 10 "pause SSS-1" $CLI pause --config $CFG1 --cluster $CLUSTER --keypair $KP

# 11
run_cmd 11 "unpause SSS-1" $CLI unpause --config $CFG1 --cluster $CLUSTER --keypair $KP

# 12
run_cmd 12 "freeze ADDR1" $CLI freeze $ADDR1 --config $CFG1 --cluster $CLUSTER --keypair $KP

# 13
run_cmd 13 "thaw ADDR1" $CLI thaw $ADDR1 --config $CFG1 --cluster $CLUSTER --keypair $KP

# 14
run_cmd 14 "blacklist add ADDR_BL" $CLI blacklist add $ADDR_BL --reason "OFAC match" --config $CFG2 --cluster $CLUSTER --keypair $KP

# 15
run_cmd 15 "blacklist check ADDR_BL" $CLI blacklist check $ADDR_BL --config $CFG2 --cluster $CLUSTER --keypair $KP

# 16
run_cmd 16 "blacklist remove ADDR_BL" $CLI blacklist remove $ADDR_BL --config $CFG2 --cluster $CLUSTER --keypair $KP

# 17
run_cmd 17 "blacklist check ADDR_BL (after remove)" $CLI blacklist check $ADDR_BL --config $CFG2 --cluster $CLUSTER --keypair $KP

# 18
run_cmd 18 "allowlist add ADDR1" $CLI allowlist add $ADDR1 --reason "KYC verified" --config $CFG3 --cluster $CLUSTER --keypair $KP

# 19
run_cmd 19 "allowlist check ADDR1" $CLI allowlist check $ADDR1 --config $CFG3 --cluster $CLUSTER --keypair $KP

# 20
run_cmd 20 "status SSS-3" $CLI status --config $CFG3 --cluster $CLUSTER --keypair $KP

# 21
run_cmd 21 "blacklist --help" $CLI blacklist --help

# 22
run_cmd 22 "allowlist --help" $CLI allowlist --help

# 23
run_cmd 23 "minters --help" $CLI minters --help

# 24
run_cmd 24 "roles --help" $CLI roles --help

# 25
run_cmd 25 "authority --help" $CLI authority --help

# 26
run_cmd 26 "seize --help" $CLI seize --help

echo "All tests completed at $(date)" | tee -a "$OUT"
echo "Results saved to $OUT"
