const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYED_FILE = path.resolve(__dirname, "..", "deployed-addresses.json");

function saveDeployment(networkName, chainId, addresses) {
  let history = [];
  if (fs.existsSync(DEPLOYED_FILE)) {
    try { history = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8")); } catch { history = []; }
  }
  history.push({
    network: networkName,
    chainId: Number(chainId),
    timestamp: new Date().toISOString(),
    addresses,
  });
  fs.writeFileSync(DEPLOYED_FILE, JSON.stringify(history, null, 2));
  console.log(`\nDeployment saved to deployed-addresses.json`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // ── 0. CollateralToken ──
  const CollateralToken = await ethers.getContractFactory("CollateralToken");
  const collateral = await CollateralToken.deploy(deployer.address);
  await collateral.waitForDeployment();
  const collateralAddr = await collateral.getAddress();
  console.log("CollateralToken:", collateralAddr);

  // ── 1. MockOracle (local) or Connect Oracle (MiniEVM) ──
  const CONNECT_ORACLE = "0x031ECb63480983FD216D17BB6e1d393f3816b72F";
  const network = await ethers.provider.getNetwork();
  const isLocalNetwork = network.chainId === 31337n; // Hardhat default

  let oracleAddr;
  if (isLocalNetwork) {
    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy();
    await oracle.waitForDeployment();
    oracleAddr = await oracle.getAddress();
    await oracle.setPrice("INIT/USD", 2500000); // $2.50
    console.log("MockOracle:", oracleAddr, "(local testing)");
  } else {
    oracleAddr = CONNECT_ORACLE;
    console.log("Connect Oracle:", oracleAddr, "(Initia native)");
  }

  // ── 2. pmAMM ──
  const PmAMM = await ethers.getContractFactory("pmAMM");
  const amm = await PmAMM.deploy();
  await amm.waitForDeployment();
  const ammAddr = await amm.getAddress();
  console.log("pmAMM:", ammAddr);

  // ── 3. ForecasterReputation ──
  const Reputation = await ethers.getContractFactory("ForecasterReputation");
  const reputation = await Reputation.deploy();
  await reputation.waitForDeployment();
  const repAddr = await reputation.getAddress();
  console.log("ForecasterReputation:", repAddr);

  // ── 4. ResolutionCouncil ──
  const Council = await ethers.getContractFactory("ResolutionCouncil");
  const council = await Council.deploy(repAddr, collateralAddr);
  await council.waitForDeployment();
  const councilAddr = await council.getAddress();
  console.log("ResolutionCouncil:", councilAddr);

  // ── 5. MarketFactory ──
  const Factory = await ethers.getContractFactory("MarketFactory");
  const factory = await Factory.deploy(ammAddr, repAddr, councilAddr, collateralAddr, oracleAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("MarketFactory:", factoryAddr);

  // ── 6. PositionVault ──
  const Vault = await ethers.getContractFactory("PositionVault");
  const vault = await Vault.deploy(ammAddr, repAddr, collateralAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("PositionVault:", vaultAddr);

  console.log("\n=== Deployment Complete ===");
  const addresses = {
    CollateralToken: collateralAddr,
    Oracle: oracleAddr,
    pmAMM: ammAddr,
    ForecasterReputation: repAddr,
    ResolutionCouncil: councilAddr,
    MarketFactory: factoryAddr,
    PositionVault: vaultAddr,
  };
  console.log(addresses);

  saveDeployment(network.name, network.chainId, addresses);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
