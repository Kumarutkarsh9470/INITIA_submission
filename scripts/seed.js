const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const hist = JSON.parse(fs.readFileSync("deployed-addresses.json", "utf8"));
  const ADDR = hist[hist.length - 1].addresses;
  const [deployer] = await ethers.getSigners();

  const collateral = await ethers.getContractAt("CollateralToken", ADDR.CollateralToken);
  const vault = await ethers.getContractAt("PositionVault", ADDR.PositionVault);

  // Approve and wait
  const approveTx = await collateral.approve(ADDR.PositionVault, ethers.MaxUint256);
  await approveTx.wait();
  console.log("Vault approval confirmed");

  // Deposit
  const depositTx = await vault.deposit(ethers.parseEther("10000"));
  await depositTx.wait();
  console.log("Vault seeded with 10,000 sUSD");

  // Fund user wallet
  const USER = "0x68DD61B572a60Ae290E3BE0f237c896D648A77c6";
  const mintTx = await collateral.mint(USER, ethers.parseEther("50000"));
  await mintTx.wait();
  console.log("Minted 50,000 sUSD for user");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
