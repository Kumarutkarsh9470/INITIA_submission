/**
 * Protocol constants used across the frontend.
 * These match the values hardcoded in the Solidity contracts.
 */

// ── Resolution Types (MarketFactory.ResolutionType) ──
export const RESOLUTION_TYPES = {
  AUTO_ORACLE: 0,
  SOCIAL_COUNCIL: 1,
  CREATOR_RESOLVE: 2,
} as const;

export const RESOLUTION_TYPE_LABELS: Record<number, string> = {
  0: "Auto Oracle",
  1: "Social Council",
  2: "Creator Resolve",
};

// ── Market States (MarketFactory.MarketState) ──
export const MARKET_STATES = {
  OPEN: 0,
  RESOLVING: 1,
  SETTLED: 2,
} as const;

export const MARKET_STATE_LABELS: Record<number, string> = {
  0: "Open",
  1: "Resolving",
  2: "Settled",
};

export const MARKET_STATE_COLORS: Record<number, string> = {
  0: "text-green-400",
  1: "text-yellow-400",
  2: "text-gray-400",
};

// ── Categories (MarketFactory.Category) ──
export const CATEGORIES = {
  PRICE: 0,
  EVENT: 1,
  ECOSYSTEM: 2,
} as const;

export const CATEGORY_LABELS: Record<number, string> = {
  0: "Price",
  1: "Event",
  2: "Ecosystem",
};

// ── Reputation Thresholds ──
export const REPUTATION_THRESHOLDS = [
  { score: 0, label: "Basic market access", icon: "🔓" },
  { score: 400, label: "Resolution Council voting", icon: "🗳️" },
  { score: 600, label: "60% LTV (up from 50%)", icon: "📈" },
  { score: 800, label: "Creator bond waived", icon: "💎" },
] as const;

// ── Protocol Constants ──
export const BLOCK_TIME_SEC = 35; // MiniEVM average block time in seconds
export const BLOCKS_PER_YEAR = 901_645n; // 31,557,600s / 35s
export const CREATOR_BOND = 100n * 10n ** 18n; // 100 sUSD
export const RESOLVER_BOND = 20n * 10n ** 18n; // 20 sUSD
export const MIN_LIQUIDITY = 50n * 10n ** 18n; // 50 sUSD
export const PROTOCOL_FEE_BPS = 50; // 0.5%
export const LP_FEE_BPS = 30; // 0.3%
export const SUPERMAJORITY_BPS = 6700; // 67%
export const LIQ_THRESHOLD = 85; // 85% debt/collateral

// ── Token ID helpers (ERC-1155 in pmAMM) ──
export function yesTokenId(marketId: bigint): bigint {
  return marketId * 2n;
}

export function noTokenId(marketId: bigint): bigint {
  return marketId * 2n + 1n;
}

// ── Transaction receipt helper (optional — requestTxBlock already blocks) ──
import type { PublicClient } from "viem";

export async function waitForSuccess(
  publicClient: PublicClient,
  hash: `0x${string}`,
) {
  const receipt = await (publicClient as any).waitForTransactionReceipt({
    hash,
    pollingInterval: 4_000,
    retryCount: 30,
    timeout: 180_000,
  });
  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted on-chain");
  }
  return receipt;
}
