#!/bin/bash
# Stopgap keeper cron: services Power Wallet upkeeps on Base Sepolia and Base
# mainnet until the CRE workflows are deployed. Installed as a crontab entry
# running every 15 minutes; sends transactions only when checkUpkeep reports work.

set -u
export PATH="/Users/carlo/.nvm/versions/node/v22.4.1/bin:/usr/local/bin:/usr/bin:/bin"

REPO="/Users/carlo/dev/powerwallet/wallet-automator"
LOG_DIR="$REPO/logs"
LOCK_DIR="$REPO/.keeper.lock"

mkdir -p "$LOG_DIR"

# Prevent overlapping runs (mkdir is atomic); stale locks expire after 30 min.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

cd "$REPO" || exit 1

run_keeper() {
  local network="$1" automator="$2" log="$3"
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') keeper run ($network) ===" >> "$log"
  AUTOMATOR_PROXY_ADDRESS="$automator" npx hardhat run scripts/runKeeper.ts --network "$network" >> "$log" 2>&1
}

run_keeper base-sepolia 0x79cec041e963526122ffC7C04F427595a132331B "$LOG_DIR/keeper-base-sepolia.log"
run_keeper base 0x05b9079458D57F80e6638cF0ABaFd31BfBa0f586 "$LOG_DIR/keeper-base.log"

# Keep logs bounded (~last 5000 lines each).
for f in "$LOG_DIR"/keeper-*.log; do
  [ -f "$f" ] || continue
  if [ "$(wc -l < "$f")" -gt 10000 ]; then
    tail -n 5000 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done
