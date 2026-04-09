import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { encodeFunctionData, parseUnits, formatUnits } from "viem";
import toast from "react-hot-toast";

import { useWallet } from "../hooks/useWallet";
import { useContracts } from "../hooks/useContracts";
import { ADDRESSES } from "../lib/addresses";
import {
  CollateralTokenABI,
  MarketFactoryABI,
  ForecasterReputationABI,
} from "../lib/abis";

// ─── Constants ────────────────────────────────────────────────────────────────
const RESOLUTION_TYPES = [
  { value: 0, label: "Auto Oracle", description: "Resolved by on-chain price feed" },
  { value: 1, label: "Social Council", description: "Resolved by community vote" },
  { value: 2, label: "Creator Resolve", description: "Resolved by creator (creator cannot trade)" },
];

const CATEGORIES = [
  { value: 0, label: "Price" },
  { value: 1, label: "Event" },
  { value: 2, label: "Ecosystem" },
];

const ORACLE_PAIRS = [
  { id: "BTC/USD", label: "Bitcoin / USD", decimal: 5 },
  { id: "ETH/USD", label: "Ethereum / USD", decimal: 6 },
  { id: "SOL/USD", label: "Solana / USD", decimal: 8 },
  { id: "ATOM/USD", label: "Cosmos / USD", decimal: 9 },
  { id: "TIA/USD", label: "Celestia / USD", decimal: 8 },
  { id: "USDT/USD", label: "Tether / USD", decimal: 9 },
  { id: "SUI/USD", label: "Sui / USD", decimal: 10 },
  { id: "APT/USD", label: "Aptos / USD", decimal: 9 },
  { id: "ARB/USD", label: "Arbitrum / USD", decimal: 9 },
  { id: "BNB/USD", label: "BNB / USD", decimal: 7 },
];

const ORACLE_ABI = [
  {
    inputs: [{ name: "pair_id", type: "string" }],
    name: "get_price",
    outputs: [
      {
        components: [
          { name: "price", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "height", type: "uint64" },
          { name: "nonce", type: "uint64" },
          { name: "decimal", type: "uint64" },
          { name: "id", type: "uint64" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const DECIMALS = 18;
const MIN_LIQUIDITY = 50;
const MIN_EXPIRY_OFFSET = 15;

const fmt = (val: bigint) =>
  parseFloat(formatUnits(val, DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// ─── Component ────────────────────────────────────────────────────────────────
export default function CreateMarket() {
  const navigate = useNavigate();
  const { account, sendTx } = useWallet();
  const { publicClient } = useContracts();

  const [question, setQuestion] = useState("");
  const [outcomes, setOutcomes] = useState<string[]>(["YES", "NO"]);
  const [expiryOffset, setExpiryOffset] = useState(100);
  const [initialLiquidity, setInitialLiquidity] = useState(50);
  const [resType, setResType] = useState(2);
  const [category, setCategory] = useState(0);
  const [oraclePairId, setOraclePairId] = useState("");
  const [oracleThreshold, setOracleThreshold] = useState("");
  const [oraclePrice, setOraclePrice] = useState<string | null>(null);

  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint>(0n);
  const [creatorBond, setCreatorBond] = useState<bigint>(0n);
  const [bondWaived, setBondWaived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  const bondAmount = bondWaived ? 0n : creatorBond;
  const liquidityBig = parseUnits(String(initialLiquidity), DECIMALS);
  const totalCost = liquidityBig + bondAmount;
  const expiryBlock = currentBlock + BigInt(expiryOffset);

  // Fetch current oracle price when pair changes
  useEffect(() => {
    if (!oraclePairId || resType !== 0) { setOraclePrice(null); return; }
    const pair = ORACLE_PAIRS.find((p) => p.id === oraclePairId);
    if (!pair) { setOraclePrice(null); return; }
    (async () => {
      try {
        const result = await publicClient.readContract({
          address: ADDRESSES.Oracle as `0x${string}`,
          abi: ORACLE_ABI,
          functionName: "get_price",
          args: [oraclePairId],
        }) as { price: bigint; decimal: bigint };
        const price = Number(result.price) / 10 ** pair.decimal;
        setOraclePrice(price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
      } catch {
        setOraclePrice("unavailable");
      }
    })();
  }, [oraclePairId, resType, publicClient]);

  useEffect(() => {
    if (!account) return;
    const load = async () => {
      setDataLoading(true);
      try {
        const [block, bal, bond, waived] = await Promise.all([
          publicClient.getBlockNumber(),
          publicClient.readContract({
            address: ADDRESSES.CollateralToken,
            abi: CollateralTokenABI,
            functionName: "balanceOf",
            args: [account],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.MarketFactory,
            abi: MarketFactoryABI,
            functionName: "CREATOR_BOND",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.ForecasterReputation,
            abi: ForecasterReputationABI,
            functionName: "bondWaived",
            args: [account],
          }) as Promise<boolean>,
        ]);
        setCurrentBlock(block);
        setBalance(bal);
        setCreatorBond(bond);
        setBondWaived(waived);
      } catch (e) {
        console.error("Failed to load chain data:", e);
        toast.error("Failed to load wallet data");
      } finally {
        setDataLoading(false);
      }
    };
    load();
  }, [account, publicClient]);

  const addOutcome = () => {
    if (outcomes.length < 8) setOutcomes([...outcomes, ""]);
  };
  const removeOutcome = (i: number) => {
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter((_, idx) => idx !== i));
  };
  const updateOutcome = (i: number, val: string) => {
    const next = [...outcomes];
    next[i] = val;
    setOutcomes(next);
  };

  const handleCreate = async () => {
    if (!account) return toast.error("Wallet not connected");
    if (!question.trim()) return toast.error("Question is required");
    if (outcomes.some((o) => !o.trim())) return toast.error("All outcomes must be filled");
    if (initialLiquidity < MIN_LIQUIDITY) return toast.error(`Minimum liquidity is ${MIN_LIQUIDITY} sUSD`);
    if (expiryOffset < MIN_EXPIRY_OFFSET) return toast.error(`Expiry must be at least ${MIN_EXPIRY_OFFSET} blocks ahead`);
    if (resType === 0 && (!oraclePairId.trim() || !oracleThreshold.trim()))
      return toast.error("Oracle Pair ID and Threshold required for Auto Oracle");
    if (totalCost > balance) return toast.error("Insufficient sUSD balance");

    // Read nextMarketId before creating so we know the new market ID
    let expectedMarketId: string | null = null;
    try {
      const nextId = (await publicClient.readContract({
        address: ADDRESSES.MarketFactory,
        abi: MarketFactoryABI,
        functionName: "nextMarketId",
      })) as bigint;
      expectedMarketId = nextId.toString();
    } catch { /* will navigate to dashboard if this fails */ }

    setLoading(true);
    try {
      toast.loading("Step 1/2 — Approving sUSD…", { id: "create" });
      await sendTx({
        to: ADDRESSES.CollateralToken,
        data: encodeFunctionData({
          abi: CollateralTokenABI,
          functionName: "approve",
          args: [ADDRESSES.MarketFactory, totalCost],
        }),
      });

      toast.loading("Step 2/2 — Creating market…", { id: "create" });
      const oraclePairStr = resType === 0 ? oraclePairId : "";
      const pair = ORACLE_PAIRS.find((p) => p.id === oraclePairId);
      const oracleThresholdBig =
        resType === 0 && oracleThreshold && pair
          ? BigInt(Math.round(parseFloat(oracleThreshold) * 10 ** pair.decimal))
          : 0n;

      await sendTx({
        to: ADDRESSES.MarketFactory,
        data: encodeFunctionData({
          abi: MarketFactoryABI,
          functionName: "createMarket",
          args: [
            question.trim(),
            outcomes.map((o) => o.trim()),
            expiryBlock,
            liquidityBig,
            liquidityBig * 2n,
            resType,
            category,
            oraclePairStr,
            oracleThresholdBig,
          ],
        }),
      });

      toast.success("Market created!", { id: "create" });
      navigate(expectedMarketId ? `/market/${expectedMarketId}` : "/dashboard");
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Transaction failed";
      toast.error(
        msg.includes("expiry too soon") ? "Expiry too soon — set at least 15 blocks ahead"
          : msg.includes("insufficient liquidity") ? "Insufficient liquidity — minimum 50 sUSD"
          : msg.includes("insufficient allowance") ? "Allowance error — approval may have failed"
          : msg.includes("reverted") ? "Transaction reverted on-chain — check balance and parameters"
          : msg,
        { id: "create" },
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold text-white">Create Market</h1>
        <div className="flex items-center gap-2 glass rounded-xl px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-semibold text-white tabular-nums">{dataLoading ? "—" : `${fmt(balance)} sUSD`}</span>
        </div>
      </div>

      <div className="space-y-5 stagger">
        <Section title="Market Question" icon="❓">
          <label className="text-xs text-gray-400 mb-1 block">What are you predicting?</label>
          <textarea
            rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder='e.g. "Will INIT exceed $5 by June 2025?"'
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
          <p className="text-xs text-gray-600 mt-1">{question.length}/200 characters</p>
        </Section>

        <Section title="Outcomes" icon="🎯">
          <div className="space-y-2">
            {outcomes.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 text-xs text-gray-500 text-right">{i + 1}.</span>
                <input type="text" value={o} onChange={(e) => updateOutcome(i, e.target.value)} placeholder={`Outcome ${i + 1}`}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                <button onClick={() => removeOutcome(i)} disabled={outcomes.length <= 2}
                  className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {outcomes.length < 8 && (
            <button onClick={addOutcome} className="mt-3 flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors group">
              <span className="w-6 h-6 rounded-full border border-blue-500/40 group-hover:border-blue-400 flex items-center justify-center text-sm transition-colors">+</span>
              Add outcome ({outcomes.length}/8)
            </button>
          )}
        </Section>

        <Section title="Market Settings" icon="⚙️">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Expiry Offset (blocks)</label>
              <input type="number" min={MIN_EXPIRY_OFFSET} value={expiryOffset} onChange={(e) => setExpiryOffset(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
              <p className="text-xs text-gray-600 mt-1">Current: #{currentBlock.toString()} → Expiry: #{expiryBlock.toString()} (~{(() => { const s = expiryOffset * 35; if (s < 7200) return Math.round(s/60) + 'm'; if (s < 172800) return (s/3600).toFixed(1) + 'h'; return (s/86400).toFixed(1) + 'd'; })()})</p>
            </div>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">Category</label>
              <select value={category} onChange={(e) => setCategory(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer">
                {CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Resolution Type</label>
              <select value={resType} onChange={(e) => setResType(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer">
                {RESOLUTION_TYPES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
              </select>
              <p className="text-xs text-gray-600 mt-1">{RESOLUTION_TYPES[resType].description}</p>
            </div>
          </div>
          {resType === 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-blue-950/30 border border-blue-500/20 rounded-xl">
              <div className="col-span-2 flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-blue-300">Oracle Configuration</span>
                <span className="text-xs text-gray-500">— Initia Connect Oracle price pair</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Oracle Price Pair</label>
                <select value={oraclePairId} onChange={(e) => setOraclePairId(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer">
                  <option value="">Select a price pair…</option>
                  {ORACLE_PAIRS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label} ({p.id})</option>
                  ))}
                </select>
                {oraclePrice && oraclePrice !== "unavailable" && (
                  <p className="text-xs text-emerald-400 mt-1">Current price: ${oraclePrice}</p>
                )}
                {oraclePrice === "unavailable" && (
                  <p className="text-xs text-yellow-400 mt-1">Price temporarily unavailable</p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Price Threshold (USD)</label>
                <input type="number" value={oracleThreshold} onChange={(e) => setOracleThreshold(e.target.value)} placeholder="e.g. 100000"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                <p className="text-xs text-gray-600 mt-1">If price ≥ threshold at expiry → YES wins</p>
              </div>
              <p className="col-span-2 text-xs text-yellow-400/70">Tip: For event/ecosystem predictions, use <b>Social Council</b> or <b>Creator Resolve</b> instead.</p>
            </div>
          )}
        </Section>

        <Section title="Initial Liquidity" icon="💧">
          <label className="text-xs text-gray-400 mb-1 block">Amount (sUSD) — minimum {MIN_LIQUIDITY}</label>
          <div className="flex items-center gap-3">
            <input type="number" min={MIN_LIQUIDITY} step={10} value={initialLiquidity} onChange={(e) => setInitialLiquidity(Number(e.target.value))}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
            <div className="flex gap-2">
              {[50, 100, 500].map((v) => (
                <button key={v} onClick={() => setInitialLiquidity(v)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${initialLiquidity === v ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          {initialLiquidity < MIN_LIQUIDITY && <p className="text-xs text-red-400 mt-1">Minimum is {MIN_LIQUIDITY} sUSD</p>}
        </Section>

        <Section title="Cost Summary" icon="🧾">
          <div className="space-y-3">
            <CostRow label="Initial Liquidity" value={`${initialLiquidity.toLocaleString()} sUSD`} />
            <CostRow label="Creator Bond" value={dataLoading ? "—" : bondWaived ? "Waived (score >= 800)" : `${fmt(creatorBond)} sUSD`} accent={bondWaived ? "text-emerald-400" : "text-gray-100"} />
            <div className="border-t border-gray-700 pt-3">
              <CostRow label="Total Cost" value={dataLoading ? "—" : `${fmt(totalCost)} sUSD`} bold />
            </div>
            {!dataLoading && totalCost > balance && (
              <div className="flex items-center gap-2 bg-red-950/50 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-300">
                <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                Insufficient balance. You need {fmt(totalCost)} sUSD but only have {fmt(balance)}.
              </div>
            )}
            {!dataLoading && totalCost <= balance && balance > 0n && (
              <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs text-emerald-300">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Balance sufficient. {fmt(balance - totalCost)} sUSD remaining after creation.
              </div>
            )}
          </div>
        </Section>

        <button onClick={handleCreate} disabled={loading || !account || dataLoading}
          className="btn-primary w-full py-4 text-sm">
          {loading ? "Processing…" : !account ? "Connect Wallet" : "Create Market"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-3 animate-fade-in-up">
      <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2"><span>{icon}</span>{title}</h2>
      {children}
    </div>
  );
}

function CostRow({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? "font-semibold text-white" : "text-gray-400"}`}>{label}</span>
      <span className={`text-sm font-medium tabular-nums ${accent ?? (bold ? "text-blue-300" : "text-gray-100")}`}>{value}</span>
    </div>
  );
}
