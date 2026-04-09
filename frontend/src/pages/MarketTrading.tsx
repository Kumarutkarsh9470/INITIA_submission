import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { formatUnits, parseUnits, encodeFunctionData } from "viem";
import toast from "react-hot-toast";

import { useWallet } from "../hooks/useWallet";
import { useContracts } from "../hooks/useContracts";
import { ADDRESSES } from "../lib/addresses";
import { CollateralTokenABI, MarketFactoryABI, pmAMMABI } from "../lib/abis";
import {
  CATEGORY_LABELS,
  RESOLUTION_TYPE_LABELS,
  BLOCK_TIME_SEC,
  yesTokenId,
  noTokenId,
} from "../lib/constants";

const DECIMALS = 18;
function fmtShare(val: bigint): string { return parseFloat(formatUnits(val, DECIMALS)).toFixed(4); }
function shortAddr(addr: string): string { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }

export default function MarketTrading() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, sendTx, autoSign } = useWallet();
  const { publicClient } = useContracts();

  const marketId = BigInt(id ?? "0");
  const yesId = yesTokenId(marketId);
  const noId = noTokenId(marketId);

  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [buyAmount, setBuyAmount] = useState("");
  const [sellShares, setSellShares] = useState("");

  const [question, setQuestion] = useState("");
  const [creator, setCreator] = useState("");
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [resTypeIdx, setResTypeIdx] = useState(0);
  const [marketState, setMarketState] = useState(0);
  const [expiryBlock, setExpiryBlock] = useState(0n);
  const [oraclePairId, setOraclePairId] = useState("");
  const [settled, setSettled] = useState(false);
  const [outcome, setOutcome] = useState(0);
  const [yesBalance, setYesBalance] = useState(0n);
  const [noBalance, setNoBalance] = useState(0n);
  const [sUSDBalance, setSUSDBalance] = useState(0n);
  const [blockNumber, setBlockNumber] = useState(0n);
  const [ammTotalBlocks, setAmmTotalBlocks] = useState(0);
  const [reserveYes, setReserveYes] = useState(0n);
  const [reserveNo, setReserveNo] = useState(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [txPending, setTxPending] = useState(false);
  const [buyStep, setBuyStep] = useState<"idle" | "approving" | "buying">("idle");

  const totalReserves = reserveYes + reserveNo;
  const priceFloat = totalReserves > 0n ? Number(reserveNo) / Number(totalReserves) : 0.5;
  const yesProb = Math.round(priceFloat * 100);
  const noProb = 100 - yesProb;
  const blocksLeft = blockNumber > 0n && expiryBlock > 0n ? Number(expiryBlock) - Number(blockNumber) : null;

  const blocksToTime = (b: number) => {
    if (b <= 0) return "Expired";
    const secs = b * BLOCK_TIME_SEC;
    if (secs < 120) return `${secs}s`;
    if (secs < 7200) return `${Math.round(secs / 60)}m`;
    if (secs < 172800) return `${(secs / 3600).toFixed(0)}h`;
    return `${(secs / 86400).toFixed(0)}d`;
  };

  const buyAmountParsed = (() => { try { return parseUnits(buyAmount || "0", DECIMALS); } catch { return 0n; } })();
  const TOTAL_FEE_BPS = 80n;
  const netBuyAmount = buyAmountParsed - (buyAmountParsed * TOTAL_FEE_BPS) / 10000n;

  const estimatedSharesBuy = (() => {
    if (netBuyAmount <= 0n || (reserveYes === 0n && reserveNo === 0n)) return 0n;
    const resIn  = side === "yes" ? reserveNo  : reserveYes;
    const resOut = side === "yes" ? reserveYes : reserveNo;
    if (resIn === 0n) return 0n;
    return (resOut * netBuyAmount) / (resIn + netBuyAmount);
  })();

  const sellSharesParsed = (() => { try { return parseUnits(sellShares || "0", DECIMALS); } catch { return 0n; } })();
  const estimatedCollateralSell = (() => {
    if (sellSharesParsed <= 0n || (reserveYes === 0n && reserveNo === 0n)) return 0n;
    const resOpp = side === "yes" ? reserveNo  : reserveYes;
    const resOwn = side === "yes" ? reserveYes : reserveNo;
    if (resOwn === 0n) return 0n;
    const gross = (resOpp * sellSharesParsed) / (resOwn + sellSharesParsed);
    return gross - (gross * TOTAL_FEE_BPS) / 10000n;
  })();

  const winningBalance = settled ? (outcome === 1 ? yesBalance : noBalance) : 0n;

  const fetchData = useCallback(async () => {
    try {
      const block = await publicClient.getBlockNumber();
      setBlockNumber(block);
      const meta = (await publicClient.readContract({ address: ADDRESSES.MarketFactory, abi: MarketFactoryABI, functionName: "getMarket", args: [marketId] })) as [string, string[], bigint, string, number, number, number, string, bigint, bigint, bigint];
      setQuestion(meta[0]); setExpiryBlock(meta[2]); setCreator(meta[3]); setResTypeIdx(Number(meta[4])); setCategoryIdx(Number(meta[5])); setMarketState(Number(meta[6])); setOraclePairId(meta[7] as string);

      try {
        const ammData = (await publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "markets", args: [marketId] })) as [bigint, bigint, bigint, bigint, bigint, bigint, boolean, number, string];
        setReserveYes(ammData[0]); setReserveNo(ammData[1]); setSettled(ammData[6]); setOutcome(Number(ammData[7]));
        if (Number(ammData[4]) > 0) setAmmTotalBlocks(Number(ammData[4]));
      } catch {}

      if (account) {
        try {
          const [yesBal, noBal, susd] = await Promise.all([
            publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "balanceOf", args: [account, yesId] }) as Promise<bigint>,
            publicClient.readContract({ address: ADDRESSES.pmAMM, abi: pmAMMABI, functionName: "balanceOf", args: [account, noId] }) as Promise<bigint>,
            publicClient.readContract({ address: ADDRESSES.CollateralToken, abi: CollateralTokenABI, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
          ]);
          setYesBalance(yesBal); setNoBalance(noBal); setSUSDBalance(susd);
        } catch (e) { console.error("User balance fetch:", e); }
      }
    } catch (e) { console.error("MarketTrading fetch:", e); }
    finally { setIsLoading(false); }
  }, [publicClient, account, marketId, yesId, noId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleBuy() {
    if (!account || buyAmountParsed === 0n) return;
    setTxPending(true); setBuyStep("approving");
    try {
      toast.loading("Approving…", { id: "trade" });
      await sendTx({ to: ADDRESSES.CollateralToken, data: encodeFunctionData({ abi: CollateralTokenABI, functionName: "approve", args: [ADDRESSES.pmAMM, buyAmountParsed] }) });
      setBuyStep("buying");
      toast.loading("Buying…", { id: "trade" });
      await sendTx({ to: ADDRESSES.pmAMM, data: encodeFunctionData({ abi: pmAMMABI, functionName: "buy", args: [marketId, side === "yes", buyAmountParsed, 0n] }) });
      toast.success("Purchase confirmed!", { id: "trade" });
      setBuyAmount(""); fetchData();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed", { id: "trade" }); }
    finally { setTxPending(false); setBuyStep("idle"); }
  }

  async function handleSell() {
    if (!account || sellSharesParsed === 0n) return;
    setTxPending(true);
    try {
      toast.loading("Selling…", { id: "trade" });
      await sendTx({ to: ADDRESSES.pmAMM, data: encodeFunctionData({ abi: pmAMMABI, functionName: "sell", args: [marketId, side === "yes", sellSharesParsed, 0n] }) });
      toast.success("Sell confirmed!", { id: "trade" });
      setSellShares(""); fetchData();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed", { id: "trade" }); }
    finally { setTxPending(false); }
  }

  async function handleRedeem() {
    if (!account) return;
    setTxPending(true);
    try {
      toast.loading("Redeeming…", { id: "trade" });
      await sendTx({ to: ADDRESSES.pmAMM, data: encodeFunctionData({ abi: pmAMMABI, functionName: "redeem", args: [marketId] }) });
      toast.success("Redeemed!", { id: "trade" }); fetchData();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed", { id: "trade" }); }
    finally { setTxPending(false); }
  }

  async function handleTriggerResolution() {
    if (!account) return;
    setTxPending(true);
    try {
      toast.loading("Resolving…", { id: "resolve" });
      await sendTx({ to: ADDRESSES.MarketFactory, data: encodeFunctionData({ abi: MarketFactoryABI, functionName: "triggerResolution", args: [marketId] }) });
      toast.success("Resolution triggered!", { id: "resolve" }); fetchData();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed", { id: "resolve" }); }
    finally { setTxPending(false); }
  }

  async function handleSubmitOutcome(outcomeIdx: number) {
    if (!account) return;
    setTxPending(true);
    try {
      toast.loading("Submitting…", { id: "resolve" });
      await sendTx({ to: ADDRESSES.MarketFactory, data: encodeFunctionData({ abi: MarketFactoryABI, functionName: "submitOutcome", args: [marketId, outcomeIdx] }) });
      toast.success("Resolved!", { id: "resolve" }); fetchData();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed", { id: "resolve" }); }
    finally { setTxPending(false); }
  }

  const isBusy = txPending || buyStep !== "idle";
  const isCreatorResolve = resTypeIdx === 2;
  const isCreator = account && creator && account.toLowerCase() === creator.toLowerCase();
  const creatorBlocked = isCreatorResolve && isCreator;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="skeleton w-12 h-12 rounded-full" />
      </div>
    );
  }

  const stateColor = marketState === 0 ? "text-emerald-400" : marketState === 1 ? "text-amber-400" : "text-sky-400";
  const stateDot = marketState === 0 ? "bg-emerald-400" : marketState === 1 ? "bg-amber-400" : "bg-sky-400";
  const stateLabel = marketState === 0 ? "Open" : marketState === 1 ? "Resolving" : "Settled";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <button onClick={() => navigate(-1)} className="text-gray-600 hover:text-gray-300 transition-colors text-sm mb-4 flex items-center gap-1">
          ← Back
        </button>
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] text-gray-400 border border-white/[0.06]">{CATEGORY_LABELS[categoryIdx] ?? "Unknown"}</span>
          <span className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] text-gray-400 border border-white/[0.06]">{RESOLUTION_TYPE_LABELS[resTypeIdx] ?? "Unknown"}</span>
          <span className={`text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center gap-1.5 ${stateColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${stateDot}`} />{stateLabel}
          </span>
          {autoSign.isEnabled && (
            <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Auto-Sign
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-white leading-snug">{question}</h1>
        {creator && <p className="text-xs text-gray-600 mt-2">by {shortAddr(creator)}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: market info */}
        <div className="lg:col-span-3 space-y-4 stagger">
          {/* Probability */}
          <div className="animate-fade-in-up glass rounded-2xl p-6">
            <div className="flex items-end gap-4 mb-4">
              <span className={`text-5xl font-bold tabular-nums ${yesProb >= 50 ? "text-emerald-400" : "text-red-400"}`}>{yesProb}%</span>
              <span className="text-gray-600 text-sm mb-1.5">YES</span>
              <span className="ml-auto text-2xl font-semibold text-gray-500 tabular-nums">{noProb}%<span className="text-sm ml-1">NO</span></span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/[0.04] overflow-hidden flex">
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${yesProb}%` }} />
              <div className="h-full bg-red-500/40 flex-1" />
            </div>
          </div>

          {/* Time */}
          {blocksLeft !== null && (
            <div className="animate-fade-in-up glass rounded-2xl p-5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-gray-600 uppercase tracking-wider">Time left</span>
                <span className="text-sm font-medium text-gray-300">{blocksLeft > 0 ? blocksToTime(blocksLeft) : "Expired"}</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div className="h-full bg-amber-500/60 transition-all" style={{ width: `${Math.min(100, blocksLeft != null && blocksLeft > 0 ? ((Number(expiryBlock) - blocksLeft) / Number(expiryBlock)) * 100 : 100)}%` }} />
              </div>
            </div>
          )}

          {/* Positions */}
          {account && (
            <div className="animate-fade-in-up glass rounded-2xl p-5">
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Your positions</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.04] p-3 text-center">
                  <p className="text-[10px] text-gray-600 mb-1">sUSD</p>
                  <p className="text-sm font-semibold text-gray-300 tabular-nums">{parseFloat(formatUnits(sUSDBalance, DECIMALS)).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-emerald-500/[0.05] border border-emerald-500/10 p-3 text-center">
                  <p className="text-[10px] text-emerald-500/60 mb-1">YES</p>
                  <p className="text-sm font-semibold text-emerald-300 tabular-nums">{fmtShare(yesBalance)}</p>
                </div>
                <div className="rounded-xl bg-red-500/[0.05] border border-red-500/10 p-3 text-center">
                  <p className="text-[10px] text-red-500/60 mb-1">NO</p>
                  <p className="text-sm font-semibold text-red-300 tabular-nums">{fmtShare(noBalance)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Redeem */}
          {settled && winningBalance > 0n && account && (
            <div className="animate-fade-in-up glass rounded-2xl p-5 border-sky-500/20">
              <p className="text-sm text-sky-300 mb-3">You have <span className="font-semibold">{fmtShare(winningBalance)}</span> winning shares</p>
              <button onClick={handleRedeem} disabled={isBusy} className="btn-primary w-full py-3 text-sm">{isBusy ? "Processing…" : "Redeem Winnings"}</button>
            </div>
          )}

          {/* Trigger Resolution */}
          {blocksLeft !== null && blocksLeft <= 0 && marketState === 0 && account && (
            <div className="animate-fade-in-up glass rounded-2xl p-5 border-amber-500/20">
              <p className="text-sm text-amber-300 mb-3">Market expired — trigger resolution to settle</p>
              <button onClick={handleTriggerResolution} disabled={isBusy} className="btn-primary w-full py-3 text-sm bg-gradient-to-r from-amber-600 to-orange-600">{isBusy ? "Processing…" : "Trigger Resolution"}</button>
            </div>
          )}

          {/* Creator Resolve */}
          {marketState === 1 && resTypeIdx === 2 && isCreator && (
            <div className="animate-fade-in-up glass rounded-2xl p-5 border-purple-500/20">
              <p className="text-sm text-purple-300 mb-3">Select the winning outcome:</p>
              <div className="flex gap-3">
                <button onClick={() => handleSubmitOutcome(1)} disabled={isBusy} className="flex-1 btn-primary py-3 text-sm bg-gradient-to-r from-emerald-600 to-green-600">{isBusy ? "…" : "YES wins"}</button>
                <button onClick={() => handleSubmitOutcome(2)} disabled={isBusy} className="flex-1 btn-primary py-3 text-sm bg-gradient-to-r from-red-600 to-rose-600">{isBusy ? "…" : "NO wins"}</button>
              </div>
            </div>
          )}
        </div>

        {/* Right: trade panel */}
        <div className="lg:col-span-2">
          <div className="glass rounded-2xl overflow-hidden sticky top-20 animate-slide-in-right">
            <div className="flex border-b border-white/[0.06]">
              {(["buy", "sell"] as const).map((t) => (
                <button key={t} onClick={() => { setTab(t); setSide("yes"); }}
                  className={`flex-1 py-3 text-sm font-semibold uppercase tracking-wider transition-all ${tab === t ? "bg-white/[0.05] text-white" : "text-gray-600 hover:text-gray-400"}`}>{t}</button>
              ))}
            </div>

            <div className="p-5 space-y-4">
              {/* YES / NO toggle */}
              <div className="flex rounded-xl overflow-hidden border border-white/[0.06]">
                <button onClick={() => setSide("yes")}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-all ${side === "yes" ? "bg-emerald-600 text-white" : "bg-transparent text-gray-500 hover:text-gray-300"}`}>YES · {yesProb}%</button>
                <button onClick={() => setSide("no")}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-all ${side === "no" ? "bg-red-600 text-white" : "bg-transparent text-gray-500 hover:text-gray-300"}`}>NO · {noProb}%</button>
              </div>

              {tab === "buy" ? (
                <>
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-xs text-gray-600">Amount (sUSD)</label>
                      <button onClick={() => setBuyAmount(formatUnits(sUSDBalance, DECIMALS))} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">max: {parseFloat(formatUnits(sUSDBalance, DECIMALS)).toFixed(2)}</button>
                    </div>
                    <input type="number" min="0" placeholder="0.00" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} className="input-base w-full tabular-nums" />
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 space-y-2">
                    <div className="flex justify-between text-xs"><span className="text-gray-600">Est. shares</span><span className="text-gray-300 tabular-nums">{estimatedSharesBuy > 0n ? fmtShare(estimatedSharesBuy) : "—"}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-600">Fee</span><span className="text-gray-500">0.8%</span></div>
                  </div>
                  {creatorBlocked ? (
                    <div className="rounded-xl bg-amber-500/[0.05] border border-amber-500/20 p-3 text-center">
                      <p className="text-amber-400 text-xs font-medium">Creator cannot trade on Creator Resolve markets</p>
                    </div>
                  ) : (
                    <button onClick={handleBuy} disabled={isBusy || buyAmountParsed === 0n || marketState !== 0 || !account}
                      className={`w-full rounded-xl py-3 text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed ${side === "yes" ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-red-600 hover:bg-red-500 text-white"}`}>
                      {isBusy ? (buyStep === "approving" ? "Approving…" : "Buying…") : `Buy ${side.toUpperCase()}`}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-xs text-gray-600">Shares to sell</label>
                      <button onClick={() => setSellShares(formatUnits(side === "yes" ? yesBalance : noBalance, DECIMALS))} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">max: {fmtShare(side === "yes" ? yesBalance : noBalance)}</button>
                    </div>
                    <input type="number" min="0" placeholder="0.0000" value={sellShares} onChange={(e) => setSellShares(e.target.value)} className="input-base w-full tabular-nums" />
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 space-y-2">
                    <div className="flex justify-between text-xs"><span className="text-gray-600">Est. return</span><span className="text-gray-300 tabular-nums">{estimatedCollateralSell > 0n ? `${parseFloat(formatUnits(estimatedCollateralSell, DECIMALS)).toFixed(4)} sUSD` : "—"}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-600">Fee</span><span className="text-gray-500">0.8%</span></div>
                  </div>
                  {creatorBlocked ? (
                    <div className="rounded-xl bg-amber-500/[0.05] border border-amber-500/20 p-3 text-center">
                      <p className="text-amber-400 text-xs font-medium">Creator cannot trade</p>
                    </div>
                  ) : (
                    <button onClick={handleSell} disabled={isBusy || sellSharesParsed === 0n || marketState !== 0 || !account}
                      className={`w-full rounded-xl py-3 text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed ${side === "yes" ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-red-700 hover:bg-red-600 text-white"}`}>
                      {isBusy ? "Selling…" : `Sell ${side.toUpperCase()}`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
