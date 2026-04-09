/**
 * useContracts — provides a viem publicClient for reading contract state.
 *
 * Transactions are now handled by InterwovenKit (via useWallet().sendTx),
 * so this module only provides read-only access.
 */

import { useMemo } from "react";
import {
  createPublicClient,
  http,
  defineChain,
  type PublicClient,
  type Address,
} from "viem";
import { useWallet } from "./useWallet";

const rpcUrlRaw = import.meta.env.VITE_JSON_RPC_URL || "http://127.0.0.1:8545";
const chainIdNum = Number(import.meta.env.VITE_CHAIN_ID || 31337);

/** Resolve relative URLs (e.g. "/rpc") to absolute */
export function getAbsoluteRpcUrl(): string {
  if (rpcUrlRaw.startsWith("/")) {
    return (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8545") + rpcUrlRaw;
  }
  return rpcUrlRaw;
}

export const miniEvmChain = defineChain({
  id: chainIdNum,
  name: "Initia MiniEVM",
  nativeCurrency: { name: "GAS", symbol: "GAS", decimals: 18 },
  rpcUrls: {
    default: { http: [getAbsoluteRpcUrl()] },
  },
});

const rpcUrl = getAbsoluteRpcUrl();

function robustTransport() {
  return http(rpcUrl, {
    retryCount: 5,
    retryDelay: 1000,
    timeout: 30_000,
    batch: false,
  });
}

/** Standalone publicClient for use anywhere (hooks, lib, etc.) */
export const publicClient = createPublicClient({
  chain: miniEvmChain,
  transport: robustTransport(),
}) as PublicClient;

export function useContracts(): {
  publicClient: PublicClient;
  account: Address | null;
  chain: typeof miniEvmChain;
} {
  const { account } = useWallet();

  const pc = useMemo(
    () =>
      createPublicClient({
        chain: miniEvmChain,
        transport: robustTransport(),
      }) as PublicClient,
    []
  );

  return { publicClient: pc, account, chain: miniEvmChain };
}
