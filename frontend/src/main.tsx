/**
 * main.tsx — React entry point with InterwovenKit providers.
 *
 * Uses InterwovenKit for wallet connection and transaction signing,
 * replacing MetaMask-based wallet management. This solves the stale RPC
 * URL problem because InterwovenKit manages its own chain configuration.
 */

import { Buffer } from "buffer";
(window as any).Buffer = Buffer;
(window as any).process = (window as any).process || { env: { NODE_ENV: "development" } };

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { createConfig, http, WagmiProvider } from "wagmi";
import { mainnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  injectStyles,
  InterwovenKitProvider,
  TESTNET,
} from "@initia/interwovenkit-react";
import interwovenKitStyles from "@initia/interwovenkit-react/styles.js";
import { Toaster } from "react-hot-toast";

import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

// ── Wagmi config (required by InterwovenKit, dummy mainnet entry) ──
const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

// ── Custom chain definition for our MiniEVM appchain ──
const COSMOS_CHAIN_ID = import.meta.env.VITE_COSMOS_CHAIN_ID || "signalmarket";

const jsonRpcRaw = import.meta.env.VITE_JSON_RPC_URL || "http://localhost:8545";
const cosmosRpcRaw = import.meta.env.VITE_COSMOS_RPC_URL || "http://localhost:26657";
const cosmosRestRaw = import.meta.env.VITE_COSMOS_REST_URL || "http://localhost:1317";

/** Resolve relative paths (e.g. "/rpc") to absolute URLs for libraries that require protocol */
function resolveUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (typeof window !== "undefined") return window.location.origin + raw;
  return "http://127.0.0.1:8545" + raw;
}

const jsonRpcUrl = resolveUrl(jsonRpcRaw);
const cosmosRpcUrl = resolveUrl(cosmosRpcRaw);
const cosmosRestUrl = resolveUrl(cosmosRestRaw);

const customChain = {
  chain_id: COSMOS_CHAIN_ID,
  chain_name: "signalmarket",
  pretty_name: "SignalMarket Appchain",
  network_type: "testnet",
  bech32_prefix: "init",
  logo_URIs: {
    png: "https://raw.githubusercontent.com/initia-labs/initia-registry/main/testnets/initia/images/initia.png",
    svg: "https://raw.githubusercontent.com/initia-labs/initia-registry/main/testnets/initia/images/initia.svg",
  },
  apis: {
    rpc: [{ address: cosmosRpcUrl }],
    rest: [{ address: cosmosRestUrl }],
    "json-rpc": [{ address: jsonRpcUrl }],
    indexer: [{ address: cosmosRestUrl }],
  },
  fees: {
    fee_tokens: [{
      denom: "GAS",
      fixed_min_gas_price: 0,
      low_gas_price: 0,
      average_gas_price: 0,
      high_gas_price: 0,
    }],
  },
  staking: { staking_tokens: [{ denom: "GAS" }] },
  metadata: { minitia: { type: "minievm" }, is_l1: false },
  native_assets: [{
    denom: "GAS",
    name: "GAS Token",
    symbol: "GAS",
    decimals: 18,
  }],
};

function StylesInjector({ children }: { children: React.ReactNode }) {
  useEffect(() => { injectStyles(interwovenKitStyles); }, []);
  return <>{children}</>;
}

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <WagmiProvider config={wagmiConfig}>
            <StylesInjector>
              <InterwovenKitProvider
                {...TESTNET}
                defaultChainId={customChain.chain_id}
                customChain={customChain}
                enableAutoSign={{
                  [COSMOS_CHAIN_ID]: ["/minievm.evm.v1.MsgCall"],
                }}
              >
                <BrowserRouter>
                  <App />
                  <Toaster
                    position="bottom-right"
                    toastOptions={{
                      style: {
                        background: "#0f0f18",
                        color: "#e2e8f0",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "12px",
                      },
                    }}
                  />
                </BrowserRouter>
              </InterwovenKitProvider>
            </StylesInjector>
          </WagmiProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  );
} catch (err) {
  console.error("Fatal mount error:", err);
  const el = document.getElementById("boot-error");
  const msg = document.getElementById("boot-error-msg");
  if (el && msg) {
    el.style.display = "flex";
    msg.textContent = err instanceof Error ? err.message : String(err);
  }
}
