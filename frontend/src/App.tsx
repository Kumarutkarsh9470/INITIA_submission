/**
 * App — main router.
 */

import { Routes, Route } from "react-router-dom";

import WalletGate from "./components/WalletGate";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import CreateMarket from "./pages/CreateMarket";
import MarketTrading from "./pages/MarketTrading";
import VaultDashboard from "./pages/VaultDashboard";
import ResolutionPanel from "./pages/ResolutionPanel";
import ReputationProfile from "./pages/ReputationProfile";
import MarketBrowser from "./pages/MarketBrowser";

function ProtectedPage({ children }: { children: React.ReactNode }) {
  return (
    <WalletGate>
      <Layout>{children}</Layout>
    </WalletGate>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
      <Route path="/create-market" element={<ProtectedPage><CreateMarket /></ProtectedPage>} />
      <Route path="/market/:id" element={<ProtectedPage><MarketTrading /></ProtectedPage>} />
      <Route path="/vault" element={<ProtectedPage><VaultDashboard /></ProtectedPage>} />
      <Route path="/resolution/:id" element={<ProtectedPage><ResolutionPanel /></ProtectedPage>} />
      <Route path="/reputation" element={<ProtectedPage><ReputationProfile /></ProtectedPage>} />
      <Route path="/markets" element={<ProtectedPage><MarketBrowser /></ProtectedPage>} />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
