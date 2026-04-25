#!/usr/bin/env bash
###############################################################################
# redeploy.sh — Full contract redeployment + frontend rebuild.
#
# Steps:
#   1. Compile Solidity contracts
#   2. Deploy to MiniEVM
#   3. Wire contracts (set factory refs, seed vault, fund users)
#   4. Copy deployed-addresses.json to frontend
#   5. Rebuild frontend
#
# Usage:
#   ./scripts/redeploy.sh              # full redeploy
#   ./scripts/redeploy.sh --skip-seed  # skip vault seeding
###############################################################################
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
SKIP_SEED=false

for arg in "$@"; do
  case "$arg" in
    --skip-seed) SKIP_SEED=true ;;
  esac
done

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }

cd "$PROJECT_ROOT"

# ── Step 1: Compile ──
step "1/6 Compiling contracts"
npx hardhat compile --force || fail "Compilation failed"
ok "Contracts compiled"

# ── Step 2: Deploy ──
step "2/6 Deploying to MiniEVM"
npx hardhat run scripts/deploy.js --network minievm || fail "Deployment failed"
ok "Contracts deployed"

# ── Step 3: Wire ──
step "3/6 Wiring contracts"
npx hardhat run scripts/wire.js --network minievm || fail "Wiring failed"
ok "Contracts wired"

# ── Step 4: Seed (optional) ──
if [ "$SKIP_SEED" = false ] && [ -f scripts/seed.js ]; then
  step "3b/6 Seeding vault & funding users"
  npx hardhat run scripts/seed.js --network minievm || echo -e "${YELLOW}Warning: seed script failed (non-critical)${NC}"
  ok "Seeding complete"
fi

# ── Step 5: Copy addresses to frontend ──
step "4/6 Syncing addresses to frontend"
cp "$PROJECT_ROOT/deployed-addresses.json" "$FRONTEND_DIR/deployed-addresses.json"
ok "deployed-addresses.json synced"

# ── Step 6: Rebuild frontend ──
step "5/5 Rebuilding frontend"

cd "$FRONTEND_DIR"
npm run build || fail "Frontend build failed"
ok "Frontend built"

cd "$PROJECT_ROOT"

echo ""
echo -e "${GREEN}━━━ Redeployment complete! ━━━${NC}"
echo -e "${YELLOW}Copy the dist folder to the VPS:${NC}"
echo -e "  scp -r frontend/dist/* root@207.180.203.32:/home/signalmarket/app/frontend/dist/"
echo ""

# Print summary
latest=$(node -e "const d=require('./deployed-addresses.json'); const l=d[d.length-1]; console.log(JSON.stringify(l.addresses,null,2))")
echo -e "${CYAN}Latest deployment:${NC}"
echo "$latest"

