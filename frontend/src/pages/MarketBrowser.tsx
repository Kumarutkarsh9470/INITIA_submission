import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { publicClient } from "../hooks/useContracts";
import { ADDRESSES } from "../lib/addresses";
import { MarketFactoryABI, pmAMMABI } from "../lib/abis";
import {
  MARKET_STATE_LABELS,
  CATEGORY_LABELS,
  RESOLUTION_TYPE_LABELS,
} from "../lib/constants";

interface MarketData {
  id: number;
  question: string;
  creator: string;
  category: number;
  resolutionType: number;
  state: number;
  expiryBlock: bigint;
  yesProb: number;
}

const CATEGORY_BADGE: Record<number, string> = {
  0: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
  1: "bg-violet-500/10 text-violet-400 border border-violet-500/20",
  2: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
};

function probColor(p: number): string {
  if (p >= 70) return "text-emerald-400";
  if (p <= 30) return "text-red-400";
  return "text-amber-300";
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MarketBrowser() {
  const navigate = useNavigate();
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);
  const [filterState, setFilterState] = useState<number | -1>(-1);
  const [filterCat, setFilterCat] = useState<number | -1>(-1);
  const [searchQ, setSearchQ] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [block, count] = await Promise.all([
          publicClient.getBlockNumber(),
          publicClient.readContract({ address: ADDRESSES.MarketFactory, abi: MarketFactoryABI, functionName: "nextMarketId" }) as Promise<bigint>,
        ]);
        setCurrentBlock(block);

        const fetched = await Promise.all(
          Array.from({ length: Number(count) }, (_, i) => i).map(async (id) => {
            const meta = (await publicClient.readContract({ address: ADDRESSES.MarketFactory, abi: MarketFactoryABI, functionName: "getMarket", args: [BigInt(id)] })) as [string, string[], bigint, string, number, number, number, string, bigint, bigint, bigint];
            let yesProb = 50;
            try {
              const ammData = (await publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "markets", args: [BigInt(id)] })) as [bigint, bigint, bigint, bigint, bigint, bigint, boolean, number, string];
              const rY = ammData[0]; const rN = ammData[1]; const total = rY + rN;
              if (total > 0n) yesProb = Math.round(Number(rN * 100n / total));
            } catch {}
            return { id, question: meta[0], creator: meta[3], category: Number(meta[5]), resolutionType: Number(meta[4]), state: Number(meta[6]), expiryBlock: meta[2], yesProb } satisfies MarketData;
          }),
        );
        setMarkets(fetched);
      } catch (e) { console.error("MarketBrowser load error:", e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const visible = markets.filter((m) => {
    if (filterState !== -1 && m.state !== filterState) return false;
    if (filterCat !== -1 && m.category !== filterCat) return false;
    if (searchQ && !m.question.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-8 animate-fade-in">
        <input type="text" placeholder="Search markets…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
          className="input-base flex-1 max-w-xs text-sm" />

        <div className="flex items-center gap-2 ml-auto">
          {([[-1, "All"], [0, "Open"], [1, "Resolving"], [2, "Settled"]] as [number, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFilterState(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterState === v ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "text-gray-500 hover:text-gray-300 border border-transparent"}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {([[-1, "All"], [0, "Price"], [1, "Event"], [2, "Ecosystem"]] as [number, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFilterCat(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterCat === v ? "bg-white/10 text-white border border-white/10" : "text-gray-600 hover:text-gray-400 border border-transparent"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton h-48 rounded-2xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-600 gap-2">
          <p className="text-sm">No markets found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {visible.map((m) => (
            <MarketCard key={m.id} market={m} currentBlock={currentBlock} onClick={() => navigate(`/market/${m.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketCard({ market: m, currentBlock, onClick }: { market: MarketData; currentBlock: bigint; onClick: () => void }) {
  const blocksLeft = m.expiryBlock > currentBlock ? m.expiryBlock - currentBlock : 0n;
  const secsLeft = Number(blocksLeft) * 35;
  const timeHuman = m.state === 2 ? "Settled" : secsLeft < 7200 ? `${Math.round(secsLeft/60)}m` : secsLeft < 172800 ? `${(secsLeft/3600).toFixed(0)}h` : `${(secsLeft/86400).toFixed(0)}d`;
  const totalSpan = m.expiryBlock > 0n ? m.expiryBlock : 1n;
  const elapsed = totalSpan > blocksLeft ? totalSpan - blocksLeft : 0n;
  const pct = Math.min(100, Number((elapsed * 100n) / totalSpan));

  const stateDot = m.state === 0 ? "bg-emerald-400" : m.state === 1 ? "bg-amber-400" : "bg-gray-500";

  return (
    <button onClick={onClick}
      className="animate-fade-in-up group glass glass-hover rounded-2xl p-5 text-left transition-all duration-300 cursor-pointer w-full">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${CATEGORY_BADGE[m.category] ?? "bg-gray-800 text-gray-400"}`}>
          {CATEGORY_LABELS[m.category] ?? "Unknown"}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className={`w-1.5 h-1.5 rounded-full ${stateDot}`} />
          {MARKET_STATE_LABELS[m.state] ?? "Unknown"}
        </span>
      </div>

      <p className="text-sm text-gray-300 leading-snug mb-4 line-clamp-2 group-hover:text-white transition-colors min-h-[2.5rem]">
        {m.question}
      </p>

      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">YES</p>
          <p className={`text-2xl font-bold tabular-nums ${probColor(m.yesProb)}`}>{m.yesProb}%</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Time</p>
          <p className="text-sm text-gray-400 font-medium">{m.state === 2 ? "—" : timeHuman}</p>
        </div>
      </div>

      <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500/50 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </button>
  );
}
