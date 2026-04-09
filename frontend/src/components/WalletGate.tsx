/**
 * WalletGate — guards routes that require a connected wallet.
 * If no wallet is connected, redirects to the Landing page.
 *
 * Usage in App.tsx:
 *   <Route path="/dashboard" element={<WalletGate><Dashboard /></WalletGate>} />
 */

import { Navigate } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";

interface WalletGateProps {
  children: React.ReactNode;
}

export default function WalletGate({ children }: WalletGateProps) {
  const { account, isConnecting } = useWallet();

  if (isConnecting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="animate-pulse text-gray-400 text-lg">
          Connecting wallet...
        </div>
      </div>
    );
  }

  if (!account) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
