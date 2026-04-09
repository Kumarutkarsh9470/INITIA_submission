import { useState, useEffect, useCallback } from "react";
import { formatEther } from "viem";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { useWallet } from "../hooks/useWallet";
import { publicClient } from "../hooks/useContracts";
import { ADDRESSES } from "../lib/addresses";
import { CollateralTokenABI, MarketFactoryABI, pmAMMABI, ForecasterReputationABI, PositionVaultABI } from "../lib/abis";
import {
  MARKET_STATE_LABELS,
  MARKET_STATE_COLORS,
  RESOLUTION_TYPE_LABELS,
  yesTokenId,
  noTokenId,
} from "../lib/constants";

interface MarketSummary {
  id: bigint;
  question: string;
  state: number;
  resolutionType: number;
  yesPrice: string;
}

interface PositionSummary {
  marketId: bigint;
  question: string;
  yesBalance: string;
  noBalance: string;
}

export default function Dashboard() {
  const { account, sendTx, autoSign } = useWallet();

  const [balance, setBalance] = useState<string>("—");
  const [score, setScore] = useState<string>("—");
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [vaultDeposit, setVaultDeposit] = useState<string>("—");
  const [isLoading, setIsLoading] = useState(true);
  const [autoSignLoading, setAutoSignLoading] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);

  const fetchDashboard = useCallback(async () => {
    if (!account) return;
    try {
      setIsLoading(true);

      let bal = 0n;
      try {
        bal = (await publicClient.readContract({ address: ADDRESSES.CollateralToken, abi: CollateralTokenABI, functionName: "balanceOf", args: [account] })) as bigint;
      } catch (e) { console.error("balanceOf failed:", e); }
      setBalance(formatEther(bal));

      let rawScore = 0n;
      try {
        rawScore = (await publicClient.readContract({ address: ADDRESSES.ForecasterReputation, abi: ForecasterReputationABI, functionName: "getScore", args: [account] })) as bigint;
      } catch (e) { console.error("getScore failed:", e); }
      setScore(rawScore.toString());

      let lenderSh = 0n;
      try {
        lenderSh = (await publicClient.readContract({ address: ADDRESSES.PositionVault, abi: PositionVaultABI, functionName: "lenderShares", args: [account] })) as bigint;
      } catch (e) { console.error("lenderShares failed:", e); }
      setVaultDeposit(formatEther(lenderSh));

      let count = 0;
      try {
        const countRaw = (await publicClient.readContract({ address: ADDRESSES.MarketFactory, abi: MarketFactoryABI, functionName: "nextMarketId" })) as bigint;
        count = Number(countRaw);
      } catch (e) { console.error("nextMarketId failed:", e); }

      const mktSummaries: MarketSummary[] = [];
      const posSummaries: PositionSummary[] = [];

      const batchSize = 10;
      for (let start = 0; start < count; start += batchSize) {
        const end = Math.min(start + batchSize, count);
        const batch = Array.from({ length: end - start }, (_, i) => BigInt(start + i));

        const results = await Promise.all(
          batch.map(async (id) => {
            try {
              const meta = (await publicClient.readContract({ address: ADDRESSES.MarketFactory, abi: MarketFactoryABI, functionName: "getMarket", args: [id] })) as [string, string[], bigint, string, number, number, number, string, bigint, bigint, bigint];

              let priceStr = "—";
              try {
                const ammData = (await publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "markets", args: [id] })) as [bigint, bigint, bigint, bigint, bigint, bigint, boolean, number, string];
                const rY = ammData[0]; const rN = ammData[1]; const total = rY + rN;
                if (total > 0n) priceStr = (Number(rN) / Number(total)).toFixed(2);
              } catch { /* market might not be initialized */ }

              let yesBal = 0n; let noBal = 0n;
              try {
                yesBal = (await publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "balanceOf", args: [account, yesTokenId(id)] })) as bigint;
                noBal = (await publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "balanceOf", args: [account, noTokenId(id)] })) as bigint;
              } catch { /* ok */ }

              return { id, question: meta[0], state: Number(meta[6]), resolutionType: Number(meta[4]), price: priceStr, yesBal, noBal };
            } catch (e) { console.error(`getMarket(${id}) failed:`, e); return null; }
          })
        );

        for (const r of results) {
          if (!r) continue;
          mktSummaries.push({ id: r.id, question: r.question, state: r.state, resolutionType: r.resolutionType, yesPrice: r.price });
          if (r.yesBal > 0n || r.noBal > 0n) {
            posSummaries.push({ marketId: r.id, question: r.question, yesBalance: formatEther(r.yesBal), noBalance: formatEther(r.noBal) });
          }
        }
      }
      setMarkets(mktSummaries);
      setPositions(posSummaries);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      toast.error("Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [account]);

  const requestFaucet = useCallback(async () => {
    if (!account) return toast.error("Connect wallet first");
    setFaucetLoading(true);
    try {
      const faucetBase = import.meta.env.VITE_FAUCET_URL || "/faucet";
      const res = await fetch(faucetBase, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: account }) });
      const data = await res.json();
      if (data.success) { toast.success(`Received 10,000 sUSD!`); fetchDashboard(); }
      else toast.error(data.error || "Faucet failed");
    } catch { toast.error("Faucet not reachable"); }
    finally { setFaucetLoading(false); }
  }, [account, fetchDashboard]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const handleToggleAutoSign = useCallback(async () => {
    setAutoSignLoading(true);
    try {
      if (autoSign.isEnabled) { await autoSign.disable(); toast.success("Auto-sign disabled"); }
      else { await autoSign.enable(); toast.success("Auto-sign enabled"); }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setAutoSignLoading(false); }
  }, [autoSign]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <StatCard label="Balance" value={`${Number(balance).toLocaleString(undefined, { maximumFractionDigits: 0 })} sUSD`} accent="text-white" />
        <StatCard label="Reputation" value={score} accent="text-indigo-400" />
        <StatCard label="Vault Deposit" value={`${Number(vaultDeposit).toLocaleString(undefined, { maximumFractionDigits: 0 })} sUSD`} accent="text-white" />
        <StatCard label="Positions" value={String(positions.length)} accent="text-emerald-400" />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={requestFaucet} disabled={faucetLoading} className="btn-primary text-sm px-5 py-2.5">
          {faucetLoading ? "Minting…" : "Get Test sUSD"}
        </button>
        <Link to="/create-market" className="btn-primary text-sm px-5 py-2.5">+ Create Market</Link>
        <Link to="/markets" className="btn-ghost text-sm">Browse Markets</Link>

        <div className="ml-auto flex items-center gap-3">
          <button onClick={handleToggleAutoSign} disabled={autoSignLoading} className="btn-ghost text-sm flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${autoSign.isEnabled ? "bg-emerald-400" : "bg-gray-600"}`} />
            {autoSignLoading ? "…" : autoSign.isEnabled ? "Auto-Sign On" : "Auto-Sign Off"}
          </button>
          <button onClick={fetchDashboard} disabled={isLoading} className="btn-ghost text-sm">
            {isLoading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Markets table */}
      <section className="animate-fade-in">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Markets</h2>
        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12" />)}</div>
        ) : markets.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-gray-600 text-sm">No markets yet</div>
        ) : (
          <div className="glass rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-600 text-xs uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="py-3 px-4 text-left">#</th>
                  <th className="py-3 px-4 text-left">Question</th>
                  <th className="py-3 px-4 text-left">State</th>
                  <th className="py-3 px-4 text-left">Type</th>
                  <th className="py-3 px-4 text-right">YES</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.id.toString()} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-gray-600">{m.id.toString()}</td>
                    <td className="py-3 px-4">
                      <Link to={`/market/${m.id.toString()}`} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                        {m.question.length > 50 ? m.question.slice(0, 47) + "…" : m.question}
                      </Link>
                    </td>
                    <td className={`py-3 px-4 ${MARKET_STATE_COLORS[m.state] ?? ""}`}>{MARKET_STATE_LABELS[m.state] ?? "Unknown"}</td>
                    <td className="py-3 px-4 text-gray-500">{RESOLUTION_TYPE_LABELS[m.resolutionType] ?? "—"}</td>
                    <td className="py-3 px-4 text-right font-mono text-gray-300">{m.yesPrice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Positions */}
      {positions.length > 0 && (
        <section className="animate-fade-in delay-200">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Your Positions</h2>
          <div className="grid gap-3">
            {positions.map((pos) => (
              <Link key={pos.marketId.toString()} to={`/market/${pos.marketId.toString()}`}
                className="glass glass-hover rounded-2xl p-4 block transition-all duration-200">
                <p className="text-sm text-gray-300 mb-2">{pos.question.length > 70 ? pos.question.slice(0, 67) + "…" : pos.question}</p>
                <div className="flex gap-6 text-xs font-mono">
                  <span className="text-emerald-400">YES: {Number(pos.yesBalance).toFixed(2)}</span>
                  <span className="text-red-400">NO: {Number(pos.noBalance).toFixed(2)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="animate-fade-in-up glass rounded-2xl p-5">
      <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-semibold truncate ${accent}`}>{value}</p>
    </div>
  );
}
