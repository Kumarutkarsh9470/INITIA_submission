/**
 * useWallet — InterwovenKit-based wallet connection and transaction signing.
 *
 * Replaces MetaMask-based wallet management. Provides:
 *  - account (0x Address) for contract reads
 *  - sendTx() for sending transactions (auto-selects requestTxBlock or submitTxBlock)
 *  - autoSign management
 *  - connect/disconnect
 */

import { useCallback, useMemo } from "react";
import { useInterwovenKit } from "@initia/interwovenkit-react";
import { AccAddress } from "@initia/initia.js";
import type { Address } from "viem";

const COSMOS_CHAIN_ID = import.meta.env.VITE_COSMOS_CHAIN_ID || "signalmarket";

export interface SendTxParams {
  to: string;
  data?: `0x${string}`;
  value?: bigint;
}

interface WalletState {
  /** EVM hex address (0x...) for contract reads — null if not connected */
  account: Address | null;
  /** Initia bech32 address (init1...) — null if not connected */
  initiaAddress: string | null;
  /** Open the InterwovenKit connect modal */
  connect: () => void;
  /** Disconnect wallet */
  disconnect: () => void;
  /** Whether the wallet is loading */
  isConnecting: boolean;
  /**
   * Send a transaction to a contract.
   * Automatically uses submitTxBlock (auto-sign) when enabled,
   * or requestTxBlock (wallet popup) otherwise.
   */
  sendTx: (params: SendTxParams) => Promise<string>;
  /** Auto-sign management (enable/disable/status) */
  autoSign: {
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    isEnabled: boolean;
    isLoading: boolean;
    expiration: Date | null;
  };
  /** Open the bridge modal */
  openBridge: () => void;
  /** Open the wallet details modal */
  openWallet: () => void;
}

export function useWallet(): WalletState {
  const kit = useInterwovenKit();
  const {
    initiaAddress,
    openConnect,
    openWallet,
    openBridge,
    requestTxBlock,
    submitTxBlock,
    autoSign: kitAutoSign,
  } = kit;

  // Convert init1... address to 0x hex for EVM contract reads
  const account: Address | null = useMemo(() => {
    if (!initiaAddress) return null;
    try {
      const hex = AccAddress.toHex(initiaAddress);
      return (hex.startsWith("0x") ? hex : `0x${hex}`) as Address;
    } catch {
      return null;
    }
  }, [initiaAddress]);

  const isAutoSignEnabled = !!kitAutoSign?.isEnabledByChain?.[COSMOS_CHAIN_ID];

  const sendTx = useCallback(
    async (params: SendTxParams): Promise<string> => {
      if (!initiaAddress) throw new Error("Wallet not connected");

      const messages = [
        {
          typeUrl: "/minievm.evm.v1.MsgCall" as const,
          value: {
            sender: initiaAddress,
            contractAddr: params.to,
            input: params.data || "0x",
            value: (params.value || 0n).toString(),
            accessList: [],
            authList: [],
          },
        },
      ];

      let result: { transactionHash: string };

      if (isAutoSignEnabled && submitTxBlock) {
        // Auto-sign: sign and broadcast directly, no wallet popup
        result = await submitTxBlock({
          messages,
          fee: { gas: "500000", amount: [{ denom: "GAS", amount: "0" }] },
        } as any);
      } else {
        // Normal: show wallet popup for user confirmation
        result = await requestTxBlock({
          chainId: COSMOS_CHAIN_ID,
          messages,
        } as any);
      }

      return result.transactionHash;
    },
    [initiaAddress, isAutoSignEnabled, requestTxBlock, submitTxBlock]
  );

  const autoSign = useMemo(
    () => ({
      enable: () => kitAutoSign.enable(COSMOS_CHAIN_ID),
      disable: () => kitAutoSign.disable(COSMOS_CHAIN_ID),
      isEnabled: isAutoSignEnabled,
      isLoading: !!kitAutoSign?.isLoading,
      expiration: kitAutoSign?.expiredAtByChain?.[COSMOS_CHAIN_ID] ?? null,
    }),
    [kitAutoSign, isAutoSignEnabled]
  );

  return {
    account,
    initiaAddress: initiaAddress ?? null,
    connect: openConnect,
    disconnect: () => {
      /* InterwovenKit handles disconnect via openWallet */
    },
    isConnecting: false,
    sendTx,
    autoSign,
    openBridge,
    openWallet,
  };
}
