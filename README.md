# SignalMarket

Decentralized prediction markets on Initia. Trade outcomes, build reputation, and earn yield — all on our own MiniEVM appchain.

**Live at:** [http://207.180.203.32:8080](http://207.180.203.32:8080)

---

## Initia Hackathon Submission

- **Project Name**: SignalMarket

### Project Overview

SignalMarket lets you bet on real-world events using binary outcome tokens. Think "Will ETH hit $5K by July?" — you buy YES or NO tokens, and the market price reflects collective belief. What makes us different: your prediction track record actually matters. Good forecasters earn higher reputation scores, which unlock lower fees, governance power, and better borrowing terms in the lending vault.

We built this because existing prediction markets treat every user the same regardless of accuracy. SignalMarket fixes that by tying protocol influence directly to forecasting skill.

### Implementation Detail

- **The Custom Implementation**: We wrote 8 Solidity contracts from scratch. The core is a parimutuel AMM (pmAMM) that prices outcome tokens using an on-chain Gaussian CDF approximation — not just a simple constant-product curve. On top of that, we built a reputation system that tracks accuracy, calibration, volume, and recency to score every forecaster. Markets can be resolved three ways: via oracle, community council vote, or creator decision. There's also a lending vault where users earn yield by depositing sUSD, and borrowers put up their outcome tokens as collateral with utilization-based interest rates. 30 tests cover the full lifecycle.

- **The Native Feature**: We use **auto-signing** for `/minievm.evm.v1.MsgCall` transactions through InterwovenKit. Once you enable it on the Dashboard, you can trade without approving every single transaction in your wallet — which matters a lot in a prediction market where you need to move fast when news breaks. We also integrated the **Interwoven Bridge** so users can bring INIT from L1 directly inside the app.

### How to Run Locally

1. `git clone https://github.com/Kumarutkarsh9470/INITIA_submission.git`
2. `cd INITIA_submission/frontend && npm install`
3. `npm run dev` — opens at `http://localhost:5173`
4. Connect your wallet and click **"Get Test sUSD"** to start trading. The dev server proxies everything to our production chain, so no local node needed.

---

## Architecture

| Contract | What it does |
|---|---|
| **CollateralToken** | ERC-20 "SignalUSD" (sUSD) — the collateral token for the whole protocol |
| **GaussianMath** | On-chain Normal CDF/PDF library for AMM pricing |
| **pmAMM** | The AMM itself — mints ERC-1155 outcome tokens, handles trading |
| **ForecasterReputation** | Tracks prediction accuracy, volume, recency → reputation score |
| **MarketFactory** | Creates and resolves markets (oracle, council, or creator modes) |
| **ResolutionCouncil** | Dispute resolution via weighted votes from reputable forecasters |
| **PositionVault** | Lending pool — deposit sUSD, borrow against outcome-token collateral |
| **MockOracle** | Stub for Initia Connect Oracle (used in tests) |

---

## Running the Frontend

You don't need a blockchain node. The Vite dev server proxies all API calls to our production chain.

```bash
git clone https://github.com/Kumarutkarsh9470/INITIA_submission.git
cd INITIA_submission/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Connect your wallet, hit "Get Test sUSD", and you're good to go.

Under the hood, the dev server forwards `/evm-rpc`, `/cosmos-rpc`, `/cosmos-rest`, and `/faucet` to our Contabo VPS at `207.180.203.32:8080`. Contract addresses come from `deployed-addresses.json` — no `.env` file needed.

### Tech stack

- React 19, TypeScript, Vite 5, Tailwind CSS 4
- wagmi 2.17 + viem 2.x for EVM reads
- @initia/interwovenkit-react 2.6 for wallet + auto-sign + bridge
- react-router-dom 7

---

## Running the Tests

All 30 tests run against Hardhat's in-memory EVM — no chain needed:

```bash
# From the project root
npm install
npx hardhat test
```

---

## Redeploying Contracts

> Only needed if you're changing Solidity code.

1. Set up `.env` in the project root:
   ```
   MINIEVM_RPC_URL=http://207.180.203.32:8547
   PRIVATE_KEY=0x_YOUR_KEY_HERE
   MINIEVM_CHAIN_ID=728643862094908
   ```
2. Deploy and wire:
   ```bash
   npx hardhat run scripts/deploy.js --network minievm
   npx hardhat run scripts/wire.js --network minievm
   cp deployed-addresses.json frontend/deployed-addresses.json
   ```
3. Rebuild and deploy the frontend on the VPS.

### Contract stack

- Solidity 0.8.24 (viaIR, Paris EVM target)
- Hardhat 2.28.6, OpenZeppelin 5.x, Ethers v6

---

## Production Infrastructure

Everything runs on a Contabo VPS (`207.180.203.32`). Nginx on port 8080 handles routing:

| Route | Backend |
|---|---|
| `/` | Static frontend files |
| `/evm-rpc` | MiniEVM JSON-RPC (port 8547) |
| `/cosmos-rpc` | Tendermint RPC (port 26659) |
| `/cosmos-rest` | Cosmos LCD/REST (port 1318) |
| `/faucet` | Token faucet — sends GAS + sUSD |

Chain ID: `signalmarket` (Cosmos) / `728643862094908` (EVM). Native token: GAS.

---

## Project Layout

```
contracts/              # 8 Solidity contracts
scripts/
  deploy.js             # Deploy all contracts
  wire.js               # Wire references, seed vault
  seed.js               # Seed test data
test/
  SignalMarket.test.js  # 30-test suite
frontend/               # React + TypeScript frontend
deployed-addresses.json # Current production addresses
hardhat.config.js       # Solidity 0.8.24, Paris EVM
```
