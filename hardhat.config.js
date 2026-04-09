require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      evmVersion: "paris", // MiniEVM safe: no push0, mcopy, blobhash
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // Local testing network — default
    },
    minievm: {
      url: process.env.MINIEVM_RPC_URL || "http://localhost:8545",
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : [],
      chainId: Number(process.env.MINIEVM_CHAIN_ID || 728643862094908),
    },
  },
};
