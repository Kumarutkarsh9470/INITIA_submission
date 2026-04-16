import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { encodeFunctionData, parseUnits, formatUnits } from "viem";
import toast from "react-hot-toast";

import { useWallet } from "../hooks/useWallet";
import { useContracts } from "../hooks/useContracts";
import { ADDRESSES } from "../lib/addresses";
import {
  CollateralTokenABI,
  ResolutionCouncilABI,
  ForecasterReputationABI,
  MarketFactoryABI,
} from "../lib/abis";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Resolution {
  open: boolean;
  deadline: bigint;
  totalWeight: bigint;
  weightPerOutcome: bigint[];
  finalized: boolean;
  result: number;
}

interface MarketInfo {
  question: string;
  outcomes: string[];
  state: number;
  resType: number;
}

// ─── Constants & Helpers ──────────────────────────────────────────────────────

const SUPERMAJORITY_PCT = 67;
const RESOLVER_BOND = parseUnits("20", 18);

const OUTCOME_COLORS = [
  { bar: "bg-violet-500", text: "text-violet-400", border: "border-violet-500/50", bg: "bg-violet-500/10" },
  { bar: "bg-cyan-500", text: "text-cyan-400", border: "border-cyan-500/50", bg: "bg-cyan-500/10" },
  { bar: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/50", bg: "bg-emerald-500/10" },
  { bar: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/50", bg: "bg-amber-500/10" },
  { bar: "bg-rose-500", text: "text-rose-400", border: "border-rose-500/50", bg: "bg-rose-500/10" },
  { bar: "bg-pink-500", text: "text-pink-400", border: "border-pink-500/50", bg: "bg-pink-500/10" },
  { bar: "bg-sky-500", text: "text-sky-400", border: "border-sky-500/50", bg: "bg-sky-500/10" },
  { bar: "bg-lime-500", text: "text-lime-400", border: "border-lime-500/50", bg: "bg-lime-500/10" },
];

function fmtWeight(w: bigint): string {
  return Number(formatUnits(w, 18)).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function calcPct(weight: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((weight * 10000n) / total) / 100;
}

function blocksRemaining(deadline: bigint, current: bigint): string {
  const diff = Number(deadline - current);
  if (diff <= 0) return "Deadline passed";
  const secs = diff * 35; // MiniEVM ~35s block time
  if (secs < 120) return `~${secs}s`;
  if (secs < 7200) return `~${Math.round(secs / 60)}m`;
  if (secs < 172800) return `~${(secs / 3600).toFixed(1)}h`;
  return `~${(secs / 86400).toFixed(1)}d`;
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ resolution }: { resolution: Resolution }) {
  if (resolution.finalized)
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Finalized
      </span>
    );
  if (!resolution.open)
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-700/60 text-gray-400 border border-gray-600/40">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> Not Started
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" /> Voting Open
    </span>
  );
}

// ─── WeightChart ──────────────────────────────────────────────────────────────

function WeightChart({ resolution, outcomes, userVote }: { resolution: Resolution; outcomes: string[]; userVote: number | null }) {
  const total = resolution.totalWeight;
  const weights = resolution.weightPerOutcome.slice(0, outcomes.length);
  const leadingIdx = weights.reduce((best, w, i) => (w > (weights[best] ?? 0n) ? i : best), 0);
  const leadingPct = calcPct(weights[leadingIdx] ?? 0n, total);
  const hasMajority = leadingPct >= SUPERMAJORITY_PCT;

  return (
    <div className="space-y-4">
      {outcomes.map((label, i) => {
        const pct = calcPct(weights[i] ?? 0n, total);
        const c = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
        const isLeader = i === leadingIdx && total > 0n;
        const isVoted = userVote === i;
        return (
          <div key={i} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-semibold ${c.text}`}>{label}</span>
                {isLeader && hasMajority && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">Supermajority</span>
                )}
                {isLeader && !hasMajority && total > 0n && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-400 font-medium">Leading</span>
                )}
                {isVoted && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 font-medium">Your vote</span>
                )}
              </div>
              <span className="text-gray-400 font-mono text-xs tabular-nums">{pct.toFixed(1)}% · {fmtWeight(weights[i] ?? 0n)} wt</span>
            </div>
            <div className="relative h-8 rounded-lg bg-gray-800/80 border border-gray-700/40 overflow-hidden">
              <div className={`h-full rounded-lg transition-all duration-700 ease-out ${c.bar} opacity-75`} style={{ width: `${pct}%` }} />
              <div className="absolute inset-y-0 w-px bg-white/20" style={{ left: "67%" }} />
              <div className="absolute top-0.5 text-[10px] text-white/30 font-mono" style={{ left: "calc(67% + 4px)" }}>67%</div>
            </div>
          </div>
        );
      })}
      {total === 0n && <p className="text-center text-gray-500 text-sm py-3 italic">No votes cast yet</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResolutionPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, sendTx: walletSendTx } = useWallet();
  const { publicClient } = useContracts();

  const mid = id ? BigInt(id) : 0n;

  const [market, setMarket] = useState<MarketInfo | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);
  const [userScore, setUserScore] = useState<bigint>(0n);
  const [isEligible, setIsEligible] = useState(false);
  const [resolverBond, setResolverBond] = useState<bigint>(0n);
  const [rawUserVote, setRawUserVote] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [pending, setPending] = useState<"register" | "vote" | "finalize" | "claim" | null>(null);

  const isRegistered = resolverBond > 0n;
  const userVote = rawUserVote > 0n ? Number(rawUserVote) - 1 : null;
  const hasVoted = userVote !== null;
  const deadlinePassed = resolution ? currentBlock >= resolution.deadline : false;
  const totalWeight = resolution?.totalWeight ?? 0n;
  const outcomeWeights = resolution ? resolution.weightPerOutcome.slice(0, market?.outcomes.length ?? 0) : [];
  const leadingWeight = outcomeWeights.reduce((m, w) => (w > m ? w : m), 0n);
  const hasSuperMajority = totalWeight > 0n && calcPct(leadingWeight, totalWeight) >= SUPERMAJORITY_PCT;
  const canFinalize = resolution?.open && !resolution?.finalized && (deadlinePassed || hasSuperMajority);
  const winningOutcome = resolution?.finalized && market ? market.outcomes[resolution.result] ?? `Outcome ${resolution.result}` : null;
  const userWon = resolution?.finalized && hasVoted && userVote === resolution.result;

  const fetchData = useCallback(async () => {
    try {
      const block = await publicClient.getBlockNumber();
      setCurrentBlock(block);

      const [mktRaw, resRaw] = await Promise.all([
        publicClient.readContract({ address: ADDRESSES.MarketFactory, abi: MarketFactoryABI, functionName: "getMarket", args: [mid] }),
        publicClient.readContract({ address: ADDRESSES.ResolutionCouncil, abi: ResolutionCouncilABI, functionName: "getResolution", args: [mid] }),
      ]);

      // getMarket returns: [question, outcomes, expiryBlock, creator, resType, category, state, ...]
      const mktArr = mktRaw as [string, string[], bigint, string, number, number, number, string, bigint, bigint, bigint];
      setMarket({ question: mktArr[0], outcomes: mktArr[1], state: Number(mktArr[6]), resType: Number(mktArr[4]) });

      // getResolution returns: [open, deadline, totalWeight, weightPerOutcome[8], finalized, result]
      const resArr = resRaw as [boolean, bigint, bigint, readonly bigint[], boolean, number];
      setResolution({
        open: resArr[0],
        deadline: resArr[1],
        totalWeight: resArr[2],
        weightPerOutcome: [...resArr[3]],
        finalized: resArr[4],
        result: Number(resArr[5]),
      });

      if (account) {
        try {
          const [score, eligible, bond, vote] = await Promise.all([
            publicClient.readContract({ address: ADDRESSES.ForecasterReputation, abi: ForecasterReputationABI, functionName: "getScore", args: [account] }),
            publicClient.readContract({ address: ADDRESSES.ForecasterReputation, abi: ForecasterReputationABI, functionName: "isEligibleResolver", args: [account] }),
            publicClient.readContract({ address: ADDRESSES.ResolutionCouncil, abi: ResolutionCouncilABI, functionName: "resolverBonds", args: [mid, account] }),
            publicClient.readContract({ address: ADDRESSES.ResolutionCouncil, abi: ResolutionCouncilABI, functionName: "resolverVotes", args: [mid, account] }),
          ]);
          setUserScore(score as bigint);
          setIsEligible(eligible as boolean);
          setResolverBond(bond as bigint);
          setRawUserVote(vote as bigint);
        } catch (e) {
          console.error("User-specific reads failed:", e);
        }
      }
    } catch (err) {
      console.error("ResolutionPanel fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [publicClient, mid, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function sendTxHelper(txId: "register" | "vote" | "finalize" | "claim", loadingMsg: string, successMsg: string, data: `0x${string}`, to: `0x${string}`) {
    if (!account) return;
    setPending(txId);
    try {
      toast.loading(loadingMsg, { id: txId });
      await walletSendTx({ to, data });
      toast.success(successMsg, { id: txId });
      fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : `${txId} failed`, { id: txId });
    } finally {
      setPending(null);
    }
  }

  async function handleRegister() {
    if (!account) return;
    setPending("register");
    try {
      toast.loading("Approving bond…", { id: "register" });
      await walletSendTx({
        to: ADDRESSES.CollateralToken,
        data: encodeFunctionData({ abi: CollateralTokenABI, functionName: "approve", args: [ADDRESSES.ResolutionCouncil, RESOLVER_BOND] }),
      });

      toast.loading("Registering…", { id: "register" });
      await walletSendTx({
        to: ADDRESSES.ResolutionCouncil,
        data: encodeFunctionData({ abi: ResolutionCouncilABI, functionName: "registerAsResolver", args: [mid] }),
      });
      toast.success("Registered as resolver!", { id: "register" });
      fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Registration failed", { id: "register" });
    } finally {
      setPending(null);
    }
  }

  const handleVote = () => sendTxHelper("vote", "Submitting vote…", `Voted for "${market?.outcomes[selectedOutcome]}"`,
    encodeFunctionData({ abi: ResolutionCouncilABI, functionName: "submitVote", args: [mid, selectedOutcome] }), ADDRESSES.ResolutionCouncil);

  const handleFinalize = () => sendTxHelper("finalize", "Finalizing…", "Resolution finalized!",
    encodeFunctionData({ abi: ResolutionCouncilABI, functionName: "finalizeResolution", args: [mid] }), ADDRESSES.ResolutionCouncil);

  const handleClaim = () => sendTxHelper("claim", "Claiming bond…", "Bond claimed — 20 sUSD returned!",
    encodeFunctionData({ abi: ResolutionCouncilABI, functionName: "claimBond", args: [mid] }), ADDRESSES.ResolutionCouncil);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="skeleton w-12 h-12 rounded-full" />
      </div>
    );
  }

  if (!market || !resolution) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-xl text-gray-300 font-semibold">Market not found</p>
          <button onClick={() => navigate("/dashboard")} className="text-sm text-violet-400 hover:text-violet-300 underline">← Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5 animate-fade-in">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Header Card */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest">Resolution Council · Market #{id}</p>
              <h1 className="text-xl font-bold text-white leading-snug break-words">{market.question}</h1>
            </div>
            <StatusBadge resolution={resolution} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 px-4 py-3 space-y-0.5">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">Deadline</p>
              <p className="text-sm font-bold text-gray-200 font-mono">{resolution.deadline.toString()}</p>
              <p className={`text-[11px] font-medium ${deadlinePassed ? "text-rose-400" : "text-gray-500"}`}>{blocksRemaining(resolution.deadline, currentBlock)}</p>
            </div>
            <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 px-4 py-3 space-y-0.5">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">Total Weight</p>
              <p className="text-sm font-bold text-gray-200">{fmtWeight(totalWeight)}</p>
              <p className="text-[11px] text-gray-500">{hasSuperMajority ? "Majority reached" : "cast so far"}</p>
            </div>
            <div className="rounded-xl bg-gray-800/60 border border-gray-700/40 px-4 py-3 space-y-0.5">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">Your Score</p>
              <p className={`text-sm font-bold ${isEligible ? "text-emerald-400" : "text-amber-400"}`}>{userScore.toString()}</p>
              <p className="text-[11px] text-gray-500">{isEligible ? "eligible resolver" : "need >= 400"}</p>
            </div>
          </div>
        </div>

        {/* Finalized banner */}
        {resolution.finalized && winningOutcome && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-6 py-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Market Resolved</p>
              <p className="text-xl font-bold text-white mt-0.5">{winningOutcome}</p>
            </div>
          </div>
        )}

        {/* Vote Weight Chart */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Vote Distribution</h2>
            <span className="text-xs text-gray-500">Supermajority: 67%</span>
          </div>
          <WeightChart resolution={resolution} outcomes={market.outcomes} userVote={userVote} />
        </div>

        {/* Actions (open + not finalized) */}
        {resolution.open && !resolution.finalized && (
          <div className="space-y-4">
            {/* Register panel */}
            {!isRegistered && (
              <div className="glass rounded-2xl p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-200">Register as Resolver</h3>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Post a 20 sUSD bond to vote. Bond is returned if you vote with the winning majority.</p>
                  </div>
                </div>
                {!isEligible ? (
                  <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3">
                    <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    <p className="text-xs text-amber-300">Your score is <span className="font-bold">{userScore.toString()}</span> — you need {'>='} 400 to register.</p>
                  </div>
                ) : (
                  <button onClick={handleRegister} disabled={pending === "register"}
                    className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                    {pending === "register" ? (<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Registering…</>) : "Register · Post 20 sUSD Bond"}
                  </button>
                )}
              </div>
            )}

            {/* Vote form (registered) */}
            {isRegistered && (
              <div className="glass rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2.5 text-sm">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="font-semibold text-emerald-400">Registered</span>
                  <span className="text-gray-500 text-xs">Bond: {formatUnits(resolverBond, 18)} sUSD · Weight: {userScore.toString()}</span>
                </div>
                {!hasVoted ? (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-300">Cast Your Vote</h3>
                    <div className="grid gap-2.5">
                      {market.outcomes.map((label, i) => {
                        const c = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
                        const isSelected = selectedOutcome === i;
                        return (
                          <button key={i} onClick={() => setSelectedOutcome(i)}
                            className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border text-sm font-medium text-left transition-all ${isSelected ? `${c.border} ${c.bg} ${c.text}` : "border-gray-700/50 text-gray-400 hover:border-gray-600 hover:text-gray-300 hover:bg-gray-800/40"}`}>
                            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${isSelected ? "border-current" : "border-gray-600"}`}>
                              {isSelected && <div className={`w-2 h-2 rounded-full ${c.bar}`} />}
                            </div>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={handleVote} disabled={pending === "vote"}
                      className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                      {pending === "vote" ? (<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Submitting…</>) : `Vote for "${market.outcomes[selectedOutcome]}"`}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl bg-gray-800/60 border border-violet-500/20 px-4 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-300 font-medium">Voted for <span className="text-violet-400 font-semibold">{market.outcomes[userVote!]}</span></p>
                      <p className="text-xs text-gray-500">Weight {userScore.toString()} applied · Awaiting outcome</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Finalize */}
            <div className="glass rounded-2xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">Finalize Resolution</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{canFinalize ? (hasSuperMajority ? "Supermajority reached — ready to finalize." : "Deadline has passed — ready to finalize.") : "Available once deadline passes or supermajority (67%) is reached."}</p>
                </div>
              </div>
              {hasSuperMajority && (
                <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-2.5">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-xs text-emerald-300 font-medium">Supermajority reached at {calcPct(leadingWeight, totalWeight).toFixed(1)}%</p>
                </div>
              )}
              <button onClick={handleFinalize} disabled={!canFinalize || pending === "finalize"}
                className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:border disabled:border-gray-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                {pending === "finalize" ? (<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Finalizing…</>) : "Finalize Resolution"}
              </button>
            </div>
          </div>
        )}

        {/* Claim Bond (won) */}
        {resolution.finalized && isRegistered && userWon && (
          <div className="glass rounded-2xl border-emerald-500/40 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-emerald-400">Claim Your Bond</h3>
                <p className="text-xs text-gray-400 mt-0.5">You voted with the majority. Reclaim your 20 sUSD bond.</p>
              </div>
            </div>
            <button onClick={handleClaim} disabled={pending === "claim"}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
              {pending === "claim" ? (<><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Claiming…</>) : "Claim 20 sUSD Bond"}
            </button>
          </div>
        )}

        {/* Bond Forfeited (lost) */}
        {resolution.finalized && isRegistered && hasVoted && !userWon && (
          <div className="flex items-center gap-3 glass rounded-2xl border-rose-500/20 px-5 py-4">
            <div className="w-8 h-8 rounded-full bg-rose-500/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-rose-300 font-semibold">Bond Forfeited</p>
              <p className="text-xs text-gray-500">You voted for a minority outcome.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
