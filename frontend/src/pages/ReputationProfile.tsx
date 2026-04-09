import { useState, useEffect, useCallback } from "react";
import { formatUnits, encodeFunctionData } from "viem";
import toast from "react-hot-toast";
import { useWallet } from "../hooks/useWallet";
import { publicClient, useContracts } from "../hooks/useContracts";
import { ADDRESSES } from "../lib/addresses";
import { ForecasterReputationABI, MarketFactoryABI } from "../lib/abis";

// ── Score computation ────────────────────────────────────────────────────────

function computeBreakdown(
  totalPredictions: bigint,
  correctPredictions: bigint,
  totalVolume: bigint,
  lastActiveBlock: bigint,
  currentBlock: bigint
) {
  const total = Number(totalPredictions);
  const correct = Number(correctPredictions);
  const volume = Number(formatUnits(totalVolume, 18));

  const accuracy = total > 0 ? (correct / total) * 400 : 0;
  const calibration = (accuracy / 400) * 300;

  const volumeScore = volume > 0 ? Math.min(Math.log2(volume) * 10, 150) : 0;

  const blocksSinceLast = Number(currentBlock - lastActiveBlock);
  // Match contract: 8_640_000 blocks (~100 days at ~1 block/sec on Initia MiniEVM)
  const consistency =
    blocksSinceLast < 8_640_000 ? 150 : blocksSinceLast < 43_200_000 ? 75 : 0;

  const total_score = Math.round(
    accuracy + calibration + volumeScore + consistency
  );

  return {
    accuracy: Math.round(accuracy),
    calibration: Math.round(calibration),
    volume: Math.round(volumeScore),
    consistency,
    total: total_score,
  };
}

// ── Privilege config ─────────────────────────────────────────────────────────

const PRIVILEGES = [
  { threshold: 0, label: "Basic Market Access", icon: "◈" },
  { threshold: 400, label: "Resolution Council Voting", icon: "⬡" },
  { threshold: 600, label: "60% LTV Borrowing", icon: "◆" },
  { threshold: 800, label: "Creator Bond Waived", icon: "★" },
];

// ── Gauge SVG ────────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const maxScore = 1000;
  const pct = Math.min(score / maxScore, 1);

  // semicircle: arc from 180° to 0°
  const r = 80;
  const cx = 110;
  const cy = 100;
  const startAngle = Math.PI; // left
  const endAngle = 0; // right
  const sweepAngle = startAngle - endAngle; // π
  const angle = startAngle - pct * sweepAngle;

  const arcX = (a: number) => cx + r * Math.cos(a);
  const arcY = (a: number) => cy + r * Math.sin(a);

  // track path
  const trackD = `M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 0 1 ${arcX(endAngle)} ${arcY(endAngle)}`;
  // fill path
  const fillLargeArc = pct > 0.5 ? 1 : 0;
  const fillD =
    pct > 0
      ? `M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 ${fillLargeArc} 1 ${arcX(angle)} ${arcY(angle)}`
      : "";

  // needle tip
  const needleX = arcX(angle);
  const needleY = arcY(angle);

  const tier =
    score >= 800
      ? { label: "ORACLE", color: "#f59e0b" }
      : score >= 600
      ? { label: "EXPERT", color: "#a78bfa" }
      : score >= 400
      ? { label: "ANALYST", color: "#34d399" }
      : { label: "NOVICE", color: "#60a5fa" };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 120" className="w-72 select-none">
        {/* track */}
        <path
          d={trackD}
          fill="none"
          stroke="#1e293b"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* fill */}
        {pct > 0 && (
          <path
            d={fillD}
            fill="none"
            stroke={tier.color}
            strokeWidth="14"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${tier.color}88)` }}
          />
        )}
        {/* needle dot */}
        <circle
          cx={needleX}
          cy={needleY}
          r="7"
          fill={tier.color}
          style={{ filter: `drop-shadow(0 0 8px ${tier.color})` }}
        />
        {/* centre hub */}
        <circle cx={cx} cy={cy} r="5" fill="#334155" />
        {/* score */}
        <text
          x={cx}
          y={cy - 18}
          textAnchor="middle"
          fill="white"
          fontSize="28"
          fontWeight="700"
          fontFamily="'DM Mono', monospace"
        >
          {score}
        </text>
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill={tier.color}
          fontSize="9"
          fontWeight="600"
          letterSpacing="3"
          fontFamily="monospace"
        >
          {tier.label}
        </text>
        {/* min/max labels */}
        <text x="22" y="115" fill="#475569" fontSize="9" fontFamily="monospace">
          0
        </text>
        <text
          x="190"
          y="115"
          fill="#475569"
          fontSize="9"
          fontFamily="monospace"
          textAnchor="end"
        >
          1000
        </text>
      </svg>
    </div>
  );
}

// ── Score bar component ──────────────────────────────────────────────────────

function ScoreBar({
  label,
  value,
  max,
  color,
  description,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  description: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-gray-200">{label}</span>
        <span className="font-mono text-gray-400">
          <span style={{ color }} className="font-bold">
            {value}
          </span>
          /{max}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  );
}

// ── Prediction history row ───────────────────────────────────────────────────

const MAX_UINT256 = 2n ** 256n - 1n;

function PositionRow({
  marketId,
  user,
  outcomeData,
  sizeData,
  isSettled,
  onClaim,
  claiming,
}: {
  marketId: number;
  user: `0x${string}`;
  outcomeData: number | null;
  sizeData: bigint | null;
  isSettled: boolean;
  onClaim: (marketId: number) => void;
  claiming: number | null;
}) {
  if (!sizeData || sizeData === 0n) return null;

  const alreadyClaimed = sizeData === MAX_UINT256;
  const outcome = outcomeData === 1 ? "YES" : "NO";
  const size = alreadyClaimed ? "Claimed" : parseFloat(formatUnits(sizeData, 18)).toFixed(2);
  const isYes = outcome === "YES";
  const canClaim = isSettled && !alreadyClaimed;

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-800/60 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-gray-500 font-mono text-xs">#{marketId}</span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-bold ${
            isYes
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-rose-500/20 text-rose-400"
          }`}
        >
          {outcome}
        </span>
        {alreadyClaimed && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-sky-500/20 text-sky-400">
            SCORED
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-gray-300">
          {alreadyClaimed ? "" : `${size} sUSD`}
        </span>
        {canClaim && (
          <button
            onClick={() => onClaim(marketId)}
            disabled={claiming === marketId}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors"
          >
            {claiming === marketId ? "Claiming…" : "Claim Score"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface PositionData {
  outcome: number;
  size: bigint;
}

export default function ReputationProfile() {
  const { account, sendTx } = useWallet();
  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [marketIds, setMarketIds] = useState<number[]>([]);
  const [settledMarkets, setSettledMarkets] = useState<Set<number>>(new Set());
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const [forecasterData, setForecasterData] = useState<
    [bigint, bigint, bigint, bigint, bigint] | null
  >(null);
  const [isEligibleResolver, setIsEligibleResolver] = useState(false);
  const [ltv, setLtv] = useState<bigint>(0n);
  const [bondWaivedVal, setBondWaivedVal] = useState(false);
  const [positions, setPositions] = useState<Record<number, PositionData>>({});

  const fetchData = useCallback(async () => {
    if (!account) return;
    try {
      const block = await publicClient.getBlockNumber();
      setCurrentBlock(block);

      // Dynamically get market count
      const nextId = await publicClient.readContract({
        address: ADDRESSES.MarketFactory,
        abi: MarketFactoryABI,
        functionName: "nextMarketId",
      }) as bigint;
      const ids = Array.from({ length: Number(nextId) }, (_, i) => i);
      setMarketIds(ids);

      const [forecaster, eligible, ltvRaw, waived] = await Promise.all([
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "forecasters",
          args: [account],
        }),
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "isEligibleResolver",
          args: [account],
        }),
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "getLTV",
          args: [account],
        }),
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "bondWaived",
          args: [account],
        }),
      ]);

      setForecasterData(forecaster as [bigint, bigint, bigint, bigint, bigint]);
      setIsEligibleResolver(eligible as boolean);
      setLtv(ltvRaw as bigint);
      setBondWaivedVal(waived as boolean);

      // fetch positions and market states for known markets
      const posMap: Record<number, PositionData> = {};
      const settled = new Set<number>();
      for (const mid of ids) {
        try {
          const [outcome, size, marketData] = await Promise.all([
            publicClient.readContract({
              address: ADDRESSES.ForecasterReputation,
              abi: ForecasterReputationABI,
              functionName: "positionOutcome",
              args: [BigInt(mid), account],
            }),
            publicClient.readContract({
              address: ADDRESSES.ForecasterReputation,
              abi: ForecasterReputationABI,
              functionName: "positionSize",
              args: [BigInt(mid), account],
            }),
            publicClient.readContract({
              address: ADDRESSES.MarketFactory,
              abi: MarketFactoryABI,
              functionName: "getMarket",
              args: [BigInt(mid)],
            }),
          ]);
          const sizeVal = size as bigint;
          // state is index 6 in the getMarket return tuple
          const state = Number((marketData as any[])[6]);
          if (state === 2) settled.add(mid);
          if (sizeVal > 0n) {
            posMap[mid] = { outcome: Number(outcome), size: sizeVal };
          }
        } catch {
          // position doesn't exist — skip
        }
      }
      setPositions(posMap);
      setSettledMarkets(settled);
    } catch (err) {
      console.error("ReputationProfile fetch:", err);
    } finally {
      setIsLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (account) {
      fetchData();
      const id = setInterval(fetchData, 15_000);
      return () => clearInterval(id);
    }
    setIsLoading(false);
  }, [fetchData, account]);

  // ── Claim score handler ────────────────────────────────────────────────────

  async function handleClaimScore(marketId: number) {
    if (!account) return;
    setClaimingId(marketId);
    try {
      toast.loading("Claiming score…", { id: "claim" });
      await sendTx({
        to: ADDRESSES.MarketFactory,
        data: encodeFunctionData({
          abi: MarketFactoryABI,
          functionName: "claimScore",
          args: [BigInt(marketId)],
        }),
      });
      toast.success("Score updated!", { id: "claim" });
      fetchData();
    } catch (err: any) {
      const msg = err?.shortMessage ?? err?.message ?? "Claim failed";
      toast.error(
        msg.includes("reverted") ? "Already claimed or no position in this market" : msg,
        { id: "claim" }
      );
    } finally {
      setClaimingId(null);
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const breakdown =
    forecasterData && currentBlock > 0n
      ? computeBreakdown(
          forecasterData[0],
          forecasterData[1],
          forecasterData[2],
          forecasterData[3],
          currentBlock
        )
      : null;

  const score = breakdown?.total ?? Number(forecasterData?.[4] ?? 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!account) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-gray-500 text-sm">Connect wallet to view reputation</p>
      </div>
    );
  }

  return (
    <div className="text-gray-100 p-6 space-y-6 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="pt-4">
        <h1 className="text-2xl font-bold tracking-tight">
          Reputation Profile
        </h1>
        <p className="text-gray-500 font-mono text-xs mt-1 truncate">
          {account}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Score Gauge Card */}
          <div className="glass rounded-2xl p-6">
            <ScoreGauge score={score} />

            <div className="mt-2 grid grid-cols-3 gap-3 text-center text-xs font-mono text-gray-400">
              <div>
                <div className="text-gray-200 font-bold text-base">
                  {forecasterData?.[0]?.toString() ?? "0"}
                </div>
                <div>Predictions</div>
              </div>
              <div>
                <div className="text-emerald-400 font-bold text-base">
                  {forecasterData?.[1]?.toString() ?? "0"}
                </div>
                <div>Correct</div>
              </div>
              <div>
                <div className="text-violet-400 font-bold text-base">
                  {parseFloat(
                    formatUnits(forecasterData?.[2] ?? 0n, 18)
                  ).toFixed(0)}
                </div>
                <div>Vol (sUSD)</div>
              </div>
            </div>
          </div>

          {/* Score Breakdown */}
          <div className="glass rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase">
              Score Breakdown
            </h2>

            {breakdown ? (
              <>
                <ScoreBar
                  label="Accuracy"
                  value={breakdown.accuracy}
                  max={400}
                  color="#34d399"
                  description="Correct predictions ÷ total predictions × 400"
                />
                <ScoreBar
                  label="Calibration"
                  value={breakdown.calibration}
                  max={300}
                  color="#a78bfa"
                  description="How well your confidence matches your win rate"
                />
                <ScoreBar
                  label="Volume"
                  value={breakdown.volume}
                  max={150}
                  color="#60a5fa"
                  description="log₂(total volume in tokens) × 10, capped at 150"
                />
                <ScoreBar
                  label="Consistency"
                  value={breakdown.consistency}
                  max={150}
                  color="#f59e0b"
                  description="150 if active recently · 75 if semi-recent · 0 if inactive"
                />
              </>
            ) : (
              <p className="text-gray-500 text-sm">No data available yet.</p>
            )}
          </div>

          {/* Privilege Unlocks */}
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase">
              Privilege Unlocks
            </h2>

            <div className="space-y-3">
              {PRIVILEGES.map((p) => {
                const unlocked = score >= p.threshold;
                return (
                  <div
                    key={p.threshold}
                    className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                      unlocked
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-gray-800 bg-gray-800/30 opacity-50"
                    }`}
                  >
                    <span
                      className={`text-lg ${
                        unlocked ? "text-emerald-400" : "text-gray-600"
                      }`}
                    >
                      {unlocked ? "✓" : "🔒"}
                    </span>
                    <div className="flex-1">
                      <p
                        className={`text-sm font-semibold ${
                          unlocked ? "text-gray-100" : "text-gray-500"
                        }`}
                      >
                        {p.icon} {p.label}
                      </p>
                      {p.threshold > 0 && (
                        <p className="text-xs text-gray-500 font-mono">
                          Requires {p.threshold} pts
                        </p>
                      )}
                    </div>
                    {unlocked && (
                      <span className="text-xs font-mono text-emerald-500 font-bold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Extra contract-read bonuses */}
            <div className="mt-2 pt-4 border-t border-gray-800 grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-500 mb-1">Eligible Resolver</div>
                <div
                  className={
                    isEligibleResolver ? "text-emerald-400" : "text-gray-600"
                  }
                >
                  {isEligibleResolver ? "✓ Yes" : "✗ No"}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-500 mb-1">LTV Ratio</div>
                <div className="text-violet-400">
                  {ltv !== undefined ? `${Number(ltv)}%` : "—"}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-500 mb-1">Bond Waived</div>
                <div
                  className={bondWaivedVal ? "text-emerald-400" : "text-gray-600"}
                >
                  {bondWaivedVal ? "✓ Yes" : "✗ No"}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-500 mb-1">Current Score</div>
                <div className="text-amber-400 font-bold">{score}</div>
              </div>
            </div>
          </div>

          {/* Prediction History */}
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-4">
              Prediction History
            </h2>

            {account ? (
              <div>
                {marketIds.map((id) => {
                  const pos = positions[id];
                  if (!pos) return null;
                  return (
                    <PositionRow
                      key={id}
                      marketId={id}
                      user={account}
                      outcomeData={pos.outcome}
                      sizeData={pos.size}
                      isSettled={settledMarkets.has(id)}
                      onClaim={handleClaimScore}
                      claiming={claimingId}
                    />
                  );
                })}
              </div>
            ) : null}

            <p className="text-xs text-gray-600 mt-4 font-mono">
              Showing all {marketIds.length} markets. Markets with no
              position are hidden.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
