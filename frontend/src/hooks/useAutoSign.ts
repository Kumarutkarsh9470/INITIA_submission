/**
 * useAutoSign — Re-exports auto-sign functionality from useWallet.
 *
 * InterwovenKit handles auto-sign natively via authz/feegrant.
 * This module provides backward compatibility for pages that import from here.
 */

import { useWallet } from "./useWallet";

export interface AutoSignState {
  isSessionActive: boolean;
  sessionAccount: null;
  sessionWalletClient: null;
  sessionPublicClient: null;
  grantSession: () => null;
  revokeSession: () => void;
  sessionExpiry: Date | null;
}

export function useAutoSign(): AutoSignState {
  const { autoSign } = useWallet();

  return {
    isSessionActive: autoSign.isEnabled,
    sessionAccount: null, // not needed with InterwovenKit auto-sign
    sessionWalletClient: null,
    sessionPublicClient: null,
    grantSession: () => null,
    revokeSession: () => autoSign.disable(),
    sessionExpiry: autoSign.expiration,
  };
}
