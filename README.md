# SignalMarket — Prediction Market Protocol on Initia MiniEVM

A decentralized prediction market protocol built on **Initia MiniEVM** with parimutuel AMM pricing (pmAMM), reputation-weighted governance, and a lending vault.

**Live Site:** [http://207.180.203.32:8080](http://207.180.203.32:8080)

---

## Initia Hackathon Submission

- **Project Name**: SignalMarket

### Project Overview

SignalMarket is a decentralized prediction market protocol where users trade binary outcome tokens, build on-chain reputation through forecasting accuracy, and earn yield by lending to the Position Vault. It solves the problem of credible, decentralized event resolution by combining parimutuel AMM pricing with reputation-weighted governance — giving accurate forecasters more protocol influence, lower fees, and higher borrowing power.

### Implementation Detail

- **The Custom Implementation**: 8 interconnected Solidity contracts implementing a full prediction market protocol — pmAMM with on-chain Gaussian CDF pricing (Abramowitz & Stegun approximation) and effective liquidity decay over time, ForecasterReputation with multi-factor scoring (accuracy, calibration, log-weighted volume, recency), ResolutionCouncil with weighted supermajority voting and bond slashing, PositionVault for lending against ERC-1155 outcome-token collateral with utilization-based interest rates, and MarketFactory supporting three resolution modes (Oracle, Council, Creator). 30 end-to-end tests verify the complete lifecycle.
- **The Native Feature**: **Auto-signing** is enabled for `/minievm.evm.v1.MsgCall` transactions via InterwovenKit. Users approve a session once on the Dashboard, then trade rapidly without repeated wallet popups — essential for a prediction market where speed matters during breaking events. The **Interwoven Bridge** is also integrated via InterwovenKit, allowing users to bridge INIT from L1 directly within the app.

### How to Run Locally

1. Clone: `git clone https://github.com/Kumarutkarsh9470/INITIA_submission.git`
2. Install: `cd INITIA_submission/frontend && npm install`
3. Run: `npm run dev` — opens at `http://localhost:5173`
4. The dev server auto-proxies to the production chain. Connect your wallet and click **"Get Test sUSD"** to start trading.

---

## Architecture

| Contract | Description |
|---|---|
| **CollateralToken** | ERC-20 "SignalUSD" (sUSD) used as collateral across the protocol |
| **GaussianMath** | Library providing Normal CDF/PDF for pmAMM pricing |
| **pmAMM** | Parimutuel AMM with ERC-1155 outcome tokens, constant-product trading + LMSR price display |
| **ForecasterReputation** | Tracks user prediction accuracy, volume, and recency to compute reputation scores |
| **MarketFactory** | Creates/resolves markets (AUTO_ORACLE, SOCIAL_COUNCIL, CREATOR_RESOLVE) |
| **ResolutionCouncil** | Weighted-vote dispute resolution by reputable forecasters |
| **PositionVault** | Lending pool where users borrow against outcome-token collateral |
| **MockOracle** | Test stub for Initia Connect Oracle |

---

## For Contributors — Frontend Development

> **You do NOT need your own blockchain node.** The Vite dev server automatically proxies
> API calls to the production chain running on our Contabo VPS.

### Setup (3 commands)

```bash
git clone https://github.com/Kumarutkarsh9470/INITIA_submission.git
cd INITIA_submission/frontend
npm install
npm run dev
```

That's it. Open `http://localhost:5173` in your browser.

### What happens under the hood

- The Vite dev server proxies `/evm-rpc`, `/cosmos-rpc`, `/cosmos-rest`, `/faucet` to the production server at `207.180.203.32:8080`
- Contract addresses are bundled from `deployed-addresses.json` (already in the repo)
- No `.env` file needed — defaults work out of the box

### Getting test tokens

1. Connect your wallet (InterwovenKit / Initia Wallet)
2. Click **"Get Test sUSD"** on the Dashboard — this sends you both native GAS (for tx fees) and 10,000 sUSD

### Frontend tech stack

- React 19 + TypeScript
- Vite 5 + Tailwind CSS 4
- wagmi 2.17.2 + viem 2.x
- @initia/interwovenkit-react 2.6.0
- react-router-dom 7

### Key files

```
frontend/
  src/
    main.tsx              # App entry, InterwovenKit providers, chain config
    App.tsx               # Router
    pages/                # All page components
    hooks/
      useContracts.ts     # viem publicClient for contract reads
      useWallet.tsx       # InterwovenKit wallet hook (sendTx)
      useMarket.ts        # Market data fetching
      useReputation.ts    # Reputation score fetching
    lib/
      addresses.ts        # Reads deployed-addresses.json
      abis/               # Contract ABIs (JSON)
    components/
      Layout.tsx          # Navbar + page layout
      ErrorBoundary.tsx   # Crash boundary
  deployed-addresses.json # Production contract addresses (auto-imported)
  .env.production         # Production env vars (relative paths for nginx)
  vite.config.ts          # Dev proxy → production server
```

---

## For Contributors — Smart Contract Development

> **Only needed if you're modifying Solidity contracts.** Frontend-only contributors can skip this section.

### Running tests locally (no chain needed)

```bash
# From the project root
npm install
npx hardhat test
```

All 30 tests run against Hardhat's in-memory EVM — no external chain required.

### Deploying to a local Hardhat node

```bash
# Terminal 1: Start local node
npx hardhat node

# Terminal 2: Deploy + wire
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/wire.js --network localhost
```

### Deploying to the production chain

> ⚠️ **Only do this if you need to redeploy contracts.** This overwrites production.

1. Get the deployer private key from the team lead
2. Create a `.env` file in the project root:
   ```
   MINIEVM_RPC_URL=http://207.180.203.32:8547
   PRIVATE_KEY=0x_YOUR_KEY_HERE
   MINIEVM_CHAIN_ID=728643862094908
   ```
3. Deploy:
   ```bash
   npx hardhat run scripts/deploy.js --network minievm
   npx hardhat run scripts/wire.js --network minievm
   ```
4. Copy addresses to frontend:
   ```bash
   cp deployed-addresses.json frontend/deployed-addresses.json
   ```
5. Rebuild frontend on the VPS (SSH into Contabo, or ask the team lead)

### Contract tech stack

- Solidity 0.8.24 (viaIR enabled, Paris EVM target)
- Hardhat 2.28.6
- OpenZeppelin Contracts 5.x
- Ethers.js v6

---

## Production Deployment

The production instance runs on a Contabo VPS at `207.180.203.32`:

| Service | Port | Description |
|---|---|---|
| nginx | 8080 | Frontend + API reverse proxy |
| minitiad (EVM RPC) | 8547 | MiniEVM JSON-RPC |
| minitiad (Cosmos RPC) | 26659 | Tendermint RPC |
| minitiad (REST) | 1318 | Cosmos LCD/REST API |
| faucet | 3002 | Token faucet (GAS + sUSD) |

Nginx routes on port 8080:
- `/` → static frontend files
- `/evm-rpc` → EVM JSON-RPC
- `/cosmos-rpc` → Cosmos RPC
- `/cosmos-rest` → Cosmos REST
- `/faucet` → faucet server

### Chain details

| Property | Value |
|---|---|
| Cosmos chain ID | `signalmarket` |
| EVM chain ID | `728643862094908` |
| Native token | GAS |
| Block time | ~1s |

---

## Project Structure

```
contracts/              # Solidity source files (8 contracts)
scripts/
  deploy.js             # Deploys all contracts, saves addresses
  wire.js               # Sets factory references, approvals, seeds vault
  seed.js               # Seeds test data
test/
  SignalMarket.test.js  # 30-test suite
frontend/               # React frontend
deployed-addresses.json # Production contract addresses
hardhat.config.js       # Hardhat config (Solidity 0.8.24, Paris EVM)
```
