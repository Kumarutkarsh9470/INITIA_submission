const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYED_FILE = path.resolve(__dirname, "..", "deployed-addresses.json");

async function main() {
  // Load the most recent deployment
  if (!fs.existsSync(DEPLOYED_FILE)) {
    console.error("ERROR: deployed-addresses.json not found. Run deploy.js first.");
    process.exit(1);
  }
  const history = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
  const latest = history[history.length - 1];
  const ADDR = latest.addresses;

  console.log(`Wiring contracts from deployment: ${latest.network} @ ${latest.timestamp}`);

  const [deployer] = await ethers.getSigners();
  console.log("Wiring with account:", deployer.address);

  // ── Attach to deployed contracts ──
  const amm        = await ethers.getContractAt("pmAMM", ADDR.pmAMM);
  const reputation = await ethers.getContractAt("ForecasterReputation", ADDR.ForecasterReputation);
  const council    = await ethers.getContractAt("ResolutionCouncil", ADDR.ResolutionCouncil);
  const collateral = await ethers.getContractAt("CollateralToken", ADDR.CollateralToken);
  const vault      = await ethers.getContractAt("PositionVault", ADDR.PositionVault);

  // ──────── Wire Factory References ────────
  console.log("\n--- Setting factory references ---");

  try { await amm.setFactory(ADDR.MarketFactory); console.log("  pmAMM.setFactory ✓"); }
  catch { console.log("  pmAMM.setFactory (already set) ✓"); }

  try { await reputation.setFactory(ADDR.MarketFactory); console.log("  ForecasterReputation.setFactory ✓"); }
  catch { console.log("  ForecasterReputation.setFactory (already set) ✓"); }

  try { await council.setFactory(ADDR.MarketFactory); console.log("  ResolutionCouncil.setFactory ✓"); }
  catch { console.log("  ResolutionCouncil.setFactory (already set) ✓"); }

  // ──────── Approvals ────────
  console.log("\n--- Approving collateral spending ---");

  const MAX = ethers.MaxUint256;

  await collateral.approve(ADDR.MarketFactory, MAX);
  console.log("  Collateral approved for MarketFactory ✓");

  await collateral.approve(ADDR.PositionVault, MAX);
  console.log("  Collateral approved for PositionVault ✓");

  await collateral.approve(ADDR.pmAMM, MAX);
  console.log("  Collateral approved for pmAMM ✓");

  // ──────── Seed Vault ────────
  console.log("\n--- Seeding PositionVault ---");

  // Mint sUSD for deployer so they can seed the vault
  const deployerMint = ethers.parseEther("100000");
  await collateral.mint(deployer.address, deployerMint);
  console.log("  Minted 100,000 sUSD for deployer ✓");

  // Explicit approval for the vault to spend deployer's sUSD (wait for receipt)
  const approveTx = await collateral.approve(ADDR.PositionVault, MAX);
  await approveTx.wait();
  console.log("  Re-approved vault allowance ✓");

  const vaultSeed = ethers.parseEther("10000");
  const depositTx = await vault.deposit(vaultSeed);
  await depositTx.wait();
  console.log("  Vault seeded with 10,000 sUSD ✓");

  // ──────── Fund test users (local only) ────────
  const network = await ethers.provider.getNetwork();
  if (network.chainId === 31337n) {
    console.log("\n--- Funding test users with sUSD (local network) ---");
    const signers = await ethers.getSigners();
    for (let i = 1; i < Math.min(signers.length, 5); i++) {
      await collateral.mint(signers[i].address, ethers.parseEther("50000"));
      console.log(`  Funded ${signers[i].address} with 50,000 sUSD ✓`);
    }
  }

  console.log("\n=== Wiring Complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
