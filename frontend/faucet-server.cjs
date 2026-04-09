/**
 * Faucet server — mints test sUSD tokens AND sends native GAS to any address.
 * Runs alongside the frontend dev server.
 *
 * Usage: node faucet-server.cjs
 * Endpoint: POST /faucet { "address": "0x..." }
 */
const http = require("http");
const { execSync } = require("child_process");
const { ethers } = require("ethers");

const RPC = "http://127.0.0.1:8545";
const PORT = 3001;
const MINT_AMOUNT = ethers.parseEther("10000"); // 10,000 sUSD per request
const GAS_AMOUNT = "10000000000000000000"; // 10 GAS (in wei / base denom)

// Load deployer key and contract address
const deployed = require("../deployed-addresses.json");
const latest = deployed[deployed.length - 1].addresses;
const COLLATERAL = latest.CollateralToken;

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
if (!DEPLOYER_KEY) {
  console.error("ERROR: Set DEPLOYER_KEY or PRIVATE_KEY environment variable");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
const token = new ethers.Contract(
  COLLATERAL,
  ["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"],
  wallet,
);

/**
 * Convert an EVM hex address to bech32 init1... address.
 * Uses minitiad CLI since native bank send requires bech32.
 */
function evmToBech32(evmAddr) {
  const hex = evmAddr.replace("0x", "").toLowerCase();
  // Convert hex bytes to 5-bit groups for bech32
  const bytes = Buffer.from(hex, "hex");
  // Use bech32 encoding: we need the 20-byte address
  // Simple approach: call minitiad debug addr
  try {
    const out = execSync(
      `minitiad debug addr ${evmAddr} --home ~/.minitia 2>&1`,
      { encoding: "utf8", timeout: 5000 },
    );
    const match = out.match(/(init1[a-z0-9]+)/);
    if (match) return match[1];
  } catch (_) {}
  // Fallback: manual bech32 conversion using node
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function bech32Encode(hrp, data) {
    const values = convertBits(data, 8, 5, true);
    const checksum = createChecksum(hrp, values);
    return hrp + "1" + [...values, ...checksum].map((v) => CHARSET[v]).join("");
  }
  function convertBits(data, fromBits, toBits, pad) {
    let acc = 0, bits = 0;
    const ret = [];
    const maxv = (1 << toBits) - 1;
    for (const v of data) {
      acc = (acc << fromBits) | v;
      bits += fromBits;
      while (bits >= toBits) { bits -= toBits; ret.push((acc >> bits) & maxv); }
    }
    if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
    return ret;
  }
  function polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  }
  function hrpExpand(hrp) {
    const ret = [];
    for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
    ret.push(0);
    for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
    return ret;
  }
  function createChecksum(hrp, data) {
    const p = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
    return [0, 1, 2, 3, 4, 5].map((i) => (p >> (5 * (5 - i))) & 31);
  }
  return bech32Encode("init", [...bytes]);
}

/**
 * Send native GAS tokens via minitiad CLI bank send.
 * Returns true if successful.
 */
async function sendNativeGas(evmAddr) {
  const bech32Addr = evmToBech32(evmAddr);
  try {
    const cmd =
      `minitiad tx bank send gas-station ${bech32Addr} ${GAS_AMOUNT}GAS ` +
      `--home ~/.minitia --keyring-backend test --node tcp://localhost:26657 ` +
      `--chain-id trying --gas auto --gas-adjustment 1.5 --fees 1000GAS -y`;
    const out = execSync(cmd, { encoding: "utf8", timeout: 15000 });
    console.log("GAS send result:", out.trim().split("\n").pop());
    return true;
  } catch (err) {
    console.error("GAS send failed:", err.message);
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "POST" && req.url === "/faucet") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { address } = JSON.parse(body);
        if (!address || !ethers.isAddress(address)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid address" }));
        }

        const checksummed = ethers.getAddress(address);

        // 1. Send native GAS if user has less than 1 GAS (needed for tx fees)
        const gasBalance = await provider.getBalance(checksummed);
        let gasSent = false;
        if (gasBalance < ethers.parseEther("1")) {
          gasSent = await sendNativeGas(checksummed);
        }

        // 2. Mint sUSD tokens
        const tx = await token.mint(checksummed, MINT_AMOUNT, {
          gasLimit: 200000,
        });
        await tx.wait();

        const balance = await token.balanceOf(checksummed);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            txHash: tx.hash,
            balance: ethers.formatEther(balance),
            gasSent,
          }),
        );
      } catch (err) {
        console.error("Faucet error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "Mint failed" }));
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () =>
  console.log(`Faucet server running on http://localhost:${PORT}`),
);
