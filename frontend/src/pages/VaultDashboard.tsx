// src/pages/VaultDashboard.tsx
import { useState, useEffect, useCallback } from "react";
import { formatUnits, parseUnits, encodeFunctionData } from "viem";
import toast from "react-hot-toast";
import { useWallet } from "../hooks/useWallet";
import { useContracts } from "../hooks/useContracts";
import {
  CollateralTokenABI,
  PositionVaultABI,
  ForecasterReputationABI,
  pmAMMABI,
  MarketFactoryABI,
} from "../lib/abis/index";
import { ADDRESSES } from "../lib/addresses";

import { BLOCKS_PER_YEAR, yesTokenId, noTokenId } from "../lib/constants";
// ─── constants ────────────────────────────────────────────────────────────────
const BASE_RATE = 5n * 10n ** 14n;  // 5e14
const SLOPE_RATE = 2n * 10n ** 15n; // 2e15
const WAD = 10n ** 18n;

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmt(val: bigint | undefined, decimals = 18, dp = 4): string {
  if (val === undefined) return "—";
  return Number(formatUnits(val, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

function computeUtilization(deposited: bigint, borrowed: bigint): number {
  if (deposited === 0n) return 0;
  return Number((borrowed * 10_000n) / deposited) / 100;
}

function computeAPY(deposited: bigint, borrowed: bigint): number {
  if (deposited === 0n) return 0;
  const util = (borrowed * WAD) / deposited;
  const ratePerBlock = BASE_RATE + (util * SLOPE_RATE) / WAD;
  return Number((ratePerBlock * BLOCKS_PER_YEAR * 10_000n) / WAD) / 100;
}

function debtRatio(outstandingOwed: bigint, collateralValue: bigint): number {
  if (collateralValue === 0n) return 0;
  return Number((outstandingOwed * 10_000n) / collateralValue) / 100;
}

// ─── tiny reusable UI atoms ───────────────────────────────────────────────────
const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`glass rounded-2xl p-6 ${className}`}
  >
    {children}
  </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
    {children}
  </p>
);

const StatRow = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) => (
  <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
    <span className="text-sm text-gray-400">{label}</span>
    <span className={`text-sm font-mono font-semibold ${accent ?? "text-white"}`}>
      {value}
    </span>
  </div>
);

const Input = ({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  suffix?: string;
}) => (
  <div className="flex flex-col gap-1">
    <Label>{label}</Label>
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-40 transition"
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -trangray-y-1/2 text-xs text-gray-500 pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  </div>
);

const Btn = ({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) => {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold px-5 py-2.5 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary:
      "bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/20",
    secondary:
      "bg-white/10 hover:bg-white/15 text-white border border-white/10",
    danger:
      "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

// ─── spinner ──────────────────────────────────────────────────────────────────
const Spinner = () => (
  <svg
    className="animate-spin h-4 w-4"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v8z"
    />
  </svg>
);

// ─── tab pill ─────────────────────────────────────────────────────────────────
const Tab = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
      active
        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
        : "text-gray-400 hover:text-white"
    }`}
  >
    {children}
  </button>
);

// ─── main component ───────────────────────────────────────────────────────────
export default function VaultDashboard() {
  const { account, sendTx } = useWallet();
  const { publicClient } = useContracts();
  const address = account;

  const [tab, setTab] = useState<"lender" | "borrower">("lender");

  // ── vault globals ──────────────────────────────────────────────────────────
  const [totalDeposited, setTotalDeposited] = useState<bigint>(0n);
  const [totalBorrowed, setTotalBorrowed] = useState<bigint>(0n);

  // ── lender state ──────────────────────────────────────────────────────────
  const [lenderShares, setLenderShares] = useState<bigint>(0n);
  const [totalLenderShares, setTotalLenderShares] = useState<bigint>(0n);
  const [susdBalance, setSusdBalance] = useState<bigint>(0n);

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  // ── borrower state ─────────────────────────────────────────────────────────
  const [loan, setLoan] = useState<{
    principal: bigint;
    interestIndex: bigint;
    shareAmount: bigint;
    marketId: bigint;
    isYes: boolean;
    active: boolean;
  } | null>(null);
  const [outstandingOwed, setOutstandingOwed] = useState<bigint>(0n);
  const [ltv, setLtv] = useState<number>(50);
  const [collateralValue, setCollateralValue] = useState<bigint>(0n);

  const [borrowMarket, setBorrowMarket] = useState("");
  const [borrowIsYes, setBorrowIsYes] = useState<boolean>(true);
  const [borrowShares, setBorrowShares] = useState("");
  const [borrowAmt, setBorrowAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");

  // ── user share balances for borrow form ──
  const [userYesShares, setUserYesShares] = useState<bigint>(0n);
  const [userNoShares, setUserNoShares] = useState<bigint>(0n);
  const [borrowMarketPrice, setBorrowMarketPrice] = useState<bigint>(0n);
  const [borrowMarketExists, setBorrowMarketExists] = useState(false);
  const [totalMarkets, setTotalMarkets] = useState(0);

  // ── tx states ─────────────────────────────────────────────────────────────
  const [pendingDeposit, setPendingDeposit] = useState(false);
  const [pendingWithdraw, setPendingWithdraw] = useState(false);
  const [pendingBorrow, setPendingBorrow] = useState(false);
  const [pendingRepay, setPendingRepay] = useState(false);

  // ── derived ───────────────────────────────────────────────────────────────
  const utilization = computeUtilization(totalDeposited, totalBorrowed);
  const apy = computeAPY(totalDeposited, totalBorrowed);
  const availableLiquidity =
    totalDeposited > totalBorrowed ? totalDeposited - totalBorrowed : 0n;

  const estimatedShareValue =
    totalLenderShares > 0n
      ? (lenderShares * totalDeposited) / totalLenderShares
      : 0n;

  const ratio = debtRatio(outstandingOwed, collateralValue);
  const isNearLiquidation = ratio > 70;
  const isAtRisk = ratio > 85;

  // ── fetch all data ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!address) return;

    try {
      const [dep, bor, lShares, totShares, bal, loanRaw, owed, ltvRaw] =
        await Promise.all([
          publicClient.readContract({
            address: ADDRESSES.PositionVault,
            abi: PositionVaultABI,
            functionName: "totalDeposited",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.PositionVault,
            abi: PositionVaultABI,
            functionName: "totalBorrowed",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.PositionVault,
            abi: PositionVaultABI,
            functionName: "lenderShares",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.PositionVault,
            abi: PositionVaultABI,
            functionName: "totalLenderShares",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.CollateralToken,
            abi: CollateralTokenABI,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.PositionVault,
            abi: PositionVaultABI,
            functionName: "loans",
            args: [address],
          }) as Promise<[bigint, bigint, bigint, bigint, boolean, boolean]>,
          publicClient.readContract({
            address: ADDRESSES.PositionVault,
            abi: PositionVaultABI,
            functionName: "outstandingOwed",
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.ForecasterReputation,
            abi: ForecasterReputationABI,
            functionName: "getLTV",
            args: [address],
          }) as Promise<bigint>,
        ]);

      setTotalDeposited(dep);
      setTotalBorrowed(bor);
      setLenderShares(lShares);
      setTotalLenderShares(totShares);
      setSusdBalance(bal);
      setOutstandingOwed(owed);
      setLtv(Number(ltvRaw));

      const [principal, interestIndex, shareAmount, marketId, isYes, active] =
        loanRaw;
      const loanData = { principal, interestIndex, shareAmount, marketId, isYes, active };
      setLoan(loanData);

      // fetch collateral value if active loan
      if (active) {
        try {
          const price = (await publicClient.readContract({
            address: ADDRESSES.pmAMM,
            abi: pmAMMABI,
            functionName: "currentPrice",
            args: [marketId],
          })) as bigint;
          // Contract uses posPrice = isYes ? price : (WAD - price)
          const posPrice = isYes ? price : WAD - price;
          setCollateralValue((shareAmount * posPrice) / WAD);
        } catch {
          setCollateralValue(0n);
        }
      } else {
        setCollateralValue(0n);
      }

      // fetch total market count for borrower form
      try {
        const cnt = (await publicClient.readContract({
          address: ADDRESSES.MarketFactory,
          abi: MarketFactoryABI,
          functionName: "nextMarketId",
        })) as bigint;
        setTotalMarkets(Number(cnt));
      } catch {}
    } catch (err) {
      console.error("fetchData error", err);
    }
  }, [publicClient, address]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 12_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // ── fetch user share balances when borrow market ID changes ─────────────
  useEffect(() => {
    if (!address || borrowMarket === "") {
      setUserYesShares(0n);
      setUserNoShares(0n);
      setBorrowMarketPrice(0n);
      setBorrowMarketExists(false);
      return;
    }
    let cancelled = false;
    const mid = BigInt(borrowMarket);
    (async () => {
      try {
        const [yesBal, noBal, price] = await Promise.all([
          publicClient.readContract({
            address: ADDRESSES.pmAMM, abi: pmAMMABI,
            functionName: "balanceOf", args: [address, yesTokenId(mid)],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.pmAMM, abi: pmAMMABI,
            functionName: "balanceOf", args: [address, noTokenId(mid)],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: ADDRESSES.pmAMM, abi: pmAMMABI,
            functionName: "currentPrice", args: [mid],
          }) as Promise<bigint>,
        ]);
        if (!cancelled) {
          setUserYesShares(yesBal);
          setUserNoShares(noBal);
          setBorrowMarketPrice(price);
          setBorrowMarketExists(true);
        }
      } catch {
        if (!cancelled) {
          setUserYesShares(0n);
          setUserNoShares(0n);
          setBorrowMarketPrice(0n);
          setBorrowMarketExists(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [publicClient, address, borrowMarket]);

  // ── deposit ───────────────────────────────────────────────────────────────
  async function handleDeposit() {
    if (!address || !depositAmt) return;
    setPendingDeposit(true);
    try {
      const amount = parseUnits(depositAmt, 18);

      toast.loading("Approving sUSD…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.CollateralToken,
        data: encodeFunctionData({
          abi: CollateralTokenABI,
          functionName: "approve",
          args: [ADDRESSES.PositionVault, amount],
        }),
      });

      toast.loading("Depositing…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.PositionVault,
        data: encodeFunctionData({
          abi: PositionVaultABI,
          functionName: "deposit",
          args: [amount],
        }),
      });

      toast.success("Deposit successful!", { id: "vault" });
      setDepositAmt("");
      await fetchData();
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Deposit failed", { id: "vault" });
    } finally {
      setPendingDeposit(false);
    }
  }

  // ── withdraw ──────────────────────────────────────────────────────────────
  async function handleWithdraw() {
    if (!address || !withdrawAmt) return;
    setPendingWithdraw(true);
    try {
      const shares = parseUnits(withdrawAmt, 18);
      toast.loading("Withdrawing…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.PositionVault,
        data: encodeFunctionData({
          abi: PositionVaultABI,
          functionName: "withdraw",
          args: [shares],
        }),
      });
      toast.success("Withdrawal successful!", { id: "vault" });
      setWithdrawAmt("");
      await fetchData();
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Withdraw failed", { id: "vault" });
    } finally {
      setPendingWithdraw(false);
    }
  }

  // ── borrow ────────────────────────────────────────────────────────────────
  async function handleBorrow() {
    if (!address || !borrowMarket || !borrowShares || !borrowAmt)
      return;

    // Pre-validate before sending any transactions
    const marketId = BigInt(borrowMarket);
    const shareAmt = parseUnits(borrowShares, 18);
    const borrowAmount = parseUnits(borrowAmt, 18);

    const availShares = borrowIsYes ? userYesShares : userNoShares;
    if (shareAmt > availShares) {
      return toast.error(`You only have ${fmt(availShares)} ${borrowIsYes ? "YES" : "NO"} shares`);
    }
    if (borrowAmount > availableLiquidity) {
      return toast.error("Borrow amount exceeds vault liquidity");
    }
    if (!borrowMarketExists) {
      return toast.error("Market does not exist or is not initialized");
    }

    // Pre-check LTV on the client side
    if (borrowMarketPrice > 0n) {
      const posPrice = borrowIsYes ? borrowMarketPrice : WAD - borrowMarketPrice;
      const positionValue = (shareAmt * posPrice) / WAD;
      const maxBorrow = (positionValue * BigInt(ltv)) / 100n;
      if (borrowAmount > maxBorrow) {
        return toast.error(
          `Exceeds ${ltv}% LTV. Max borrow: ${fmt(maxBorrow)} sUSD for ${fmt(shareAmt)} shares`
        );
      }
    }

    setPendingBorrow(true);
    try {
      // 1. ERC-1155 approval
      toast.loading("Approving shares…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.pmAMM,
        data: encodeFunctionData({
          abi: pmAMMABI,
          functionName: "setApprovalForAll",
          args: [ADDRESSES.PositionVault, true],
        }),
      });

      // 2. borrow
      toast.loading("Borrowing sUSD…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.PositionVault,
        data: encodeFunctionData({
          abi: PositionVaultABI,
          functionName: "borrow",
          args: [marketId, borrowIsYes, shareAmt, borrowAmount],
        }),
      });

      toast.success("Borrow successful!", { id: "vault" });
      setBorrowMarket("");
      setBorrowShares("");
      setBorrowAmt("");
      await fetchData();
    } catch (err: any) {
      const msg = err?.shortMessage ?? err?.message ?? "Borrow failed";
      toast.error(
        msg.includes("reverted")
          ? "Borrow reverted — check LTV, share balance, or vault liquidity"
          : msg,
        { id: "vault" }
      );
    } finally {
      setPendingBorrow(false);
    }
  }

  // ── repay ─────────────────────────────────────────────────────────────────
  async function handleRepay() {
    if (!address || !repayAmt) return;
    setPendingRepay(true);
    try {
      const amount = parseUnits(repayAmt, 18);

      toast.loading("Approving sUSD…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.CollateralToken,
        data: encodeFunctionData({
          abi: CollateralTokenABI,
          functionName: "approve",
          args: [ADDRESSES.PositionVault, amount],
        }),
      });

      toast.loading("Repaying…", { id: "vault" });
      await sendTx({
        to: ADDRESSES.PositionVault,
        data: encodeFunctionData({
          abi: PositionVaultABI,
          functionName: "repay",
          args: [amount],
        }),
      });

      toast.success("Repayment successful!", { id: "vault" });
      setRepayAmt("");
      await fetchData();
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Repay failed", { id: "vault" });
    } finally {
      setPendingRepay(false);
    }
  }

  // ── not connected guard ────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-gray-500 text-sm">Connect wallet to access the Vault</p>
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="text-white">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
        {/* header */}
        <h1 className="text-2xl font-bold tracking-tight">
          Position <span className="gradient-text">Vault</span>
        </h1>

        {/* global stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Deposited", value: `${fmt(totalDeposited)} sUSD` },
            { label: "Total Borrowed", value: `${fmt(totalBorrowed)} sUSD` },
            {
              label: "Utilization",
              value: `${utilization.toFixed(2)}%`,
              accent:
                utilization > 80
                  ? "text-rose-400"
                  : utilization > 60
                  ? "text-amber-400"
                  : "text-emerald-400",
            },
            {
              label: "Current APY",
              value: `${apy.toFixed(4)}%`,
              accent: "text-cyan-400",
            },
          ].map(({ label, value, accent }) => (
            <Card key={label} className="flex flex-col gap-1 py-4">
              <Label>{label}</Label>
              <p
                className={`text-xl font-mono font-bold ${accent ?? "text-white"}`}
              >
                {value}
              </p>
            </Card>
          ))}
        </div>

        {/* wallet balance strip */}
        <div className="flex items-center justify-between glass rounded-xl px-5 py-3">
          <span className="text-sm text-gray-400">sUSD Balance</span>
          <span className="font-mono font-semibold text-white">
            {fmt(susdBalance)} sUSD
          </span>
        </div>

        {/* tab switcher */}
        <div className="flex gap-2 border-b border-white/[0.06] pb-4">
          <Tab active={tab === "lender"} onClick={() => setTab("lender")}>
            Lender
          </Tab>
          <Tab active={tab === "borrower"} onClick={() => setTab("borrower")}>
            Borrower
          </Tab>
        </div>

        {/* ─── LENDER PANEL ─────────────────────────────────────────────────── */}
        {tab === "lender" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* your position */}
            <Card>
              <h2 className="text-base font-semibold mb-4 text-gray-200">
                Your Lender Position
              </h2>
              <StatRow
                label="Your shares"
                value={`${fmt(lenderShares)} shares`}
              />
              <StatRow
                label="Estimated value"
                value={`${fmt(estimatedShareValue)} sUSD`}
                accent="text-cyan-400"
              />
              <StatRow
                label="Pool share"
                value={
                  totalLenderShares > 0n
                    ? `${(
                        (Number(lenderShares) / Number(totalLenderShares)) *
                        100
                      ).toFixed(4)}%`
                    : "—"
                }
              />
              <StatRow
                label="Available liquidity"
                value={`${fmt(availableLiquidity)} sUSD`}
              />
            </Card>

            {/* deposit / withdraw */}
            <div className="space-y-4">
              <Card>
                <h2 className="text-base font-semibold mb-4 text-gray-200">
                  Deposit
                </h2>
                <div className="space-y-3">
                  <Input
                    label="Amount"
                    value={depositAmt}
                    onChange={setDepositAmt}
                    placeholder="0.00"
                    type="number"
                    suffix="sUSD"
                    disabled={pendingDeposit}
                  />
                  <div className="flex justify-end">
                    <button
                      className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                      onClick={() => setDepositAmt(formatUnits(susdBalance, 18))}
                    >
                      Max
                    </button>
                  </div>
                  <Btn
                    onClick={handleDeposit}
                    disabled={!depositAmt || pendingDeposit}
                    className="w-full"
                  >
                    {pendingDeposit ? (
                      <>
                        <Spinner /> Depositing…
                      </>
                    ) : (
                      "Deposit sUSD"
                    )}
                  </Btn>
                </div>
              </Card>

              <Card>
                <h2 className="text-base font-semibold mb-4 text-gray-200">
                  Withdraw
                </h2>
                <div className="space-y-3">
                  <Input
                    label="Share amount"
                    value={withdrawAmt}
                    onChange={setWithdrawAmt}
                    placeholder="0.00"
                    type="number"
                    suffix="shares"
                    disabled={pendingWithdraw}
                  />
                  <div className="flex justify-end">
                    <button
                      className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                      onClick={() =>
                        setWithdrawAmt(formatUnits(lenderShares, 18))
                      }
                    >
                      Max shares
                    </button>
                  </div>
                  <Btn
                    variant="secondary"
                    onClick={handleWithdraw}
                    disabled={!withdrawAmt || pendingWithdraw}
                    className="w-full"
                  >
                    {pendingWithdraw ? (
                      <>
                        <Spinner /> Withdrawing…
                      </>
                    ) : (
                      "Withdraw"
                    )}
                  </Btn>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ─── BORROWER PANEL ───────────────────────────────────────────────── */}
        {tab === "borrower" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* active loan card */}
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-200">
                    Active Loan
                  </h2>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-semibold ${
                      loan?.active
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-gray-700 text-gray-400"
                    }`}
                  >
                    {loan?.active ? "ACTIVE" : "NONE"}
                  </span>
                </div>

                {loan?.active ? (
                  <>
                    <StatRow
                      label="Principal"
                      value={`${fmt(loan.principal)} sUSD`}
                    />
                    <StatRow
                      label="Total owed"
                      value={`${fmt(outstandingOwed)} sUSD`}
                      accent="text-amber-400"
                    />
                    <StatRow
                      label="Collateral shares"
                      value={`${fmt(loan.shareAmount)}`}
                    />
                    <StatRow
                      label="Market ID"
                      value={`#${loan.marketId}`}
                    />
                    <StatRow
                      label="Position"
                      value={loan.isYes ? "YES" : "NO"}
                      accent={loan.isYes ? "text-emerald-400" : "text-rose-400"}
                    />
                    <StatRow
                      label="Collateral value"
                      value={`${fmt(collateralValue)} sUSD`}
                    />

                    {/* debt/collateral ratio bar */}
                    <div className="mt-4 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">
                          Debt / Collateral ratio
                        </span>
                        <span
                          className={
                            isAtRisk
                              ? "text-rose-400 font-semibold"
                              : isNearLiquidation
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }
                        >
                          {ratio.toFixed(2)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isAtRisk
                              ? "bg-rose-500"
                              : isNearLiquidation
                              ? "bg-amber-400"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(ratio, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-600">
                        <span>0%</span>
                        <span className="text-rose-500/70">85% liquidation</span>
                        <span>100%</span>
                      </div>
                    </div>

                    {isAtRisk && (
                      <div className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300 font-medium">
                        ⚠️ Your position is at risk of liquidation. Repay now
                        to avoid losing your collateral.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-gray-500 py-2 space-y-2">
                    <p>You have no active loan.</p>
                    <p className="text-xs text-gray-600">To borrow: first buy YES or NO shares on a prediction market, then use them as collateral in the "New Borrow" form →</p>
                  </div>
                )}
              </Card>

              {/* LTV + liquidity info */}
              <Card>
                <h2 className="text-base font-semibold mb-4 text-gray-200">
                  Your Borrowing Terms
                </h2>
                <StatRow
                  label="Your LTV"
                  value={`${ltv}%`}
                  accent={ltv === 60 ? "text-cyan-400" : "text-white"}
                />
                {ltv === 60 && (
                  <p className="text-xs text-cyan-500 mt-1 mb-2">
                    ✨ Boosted LTV (reputation score ≥ 600)
                  </p>
                )}
                <StatRow
                  label="Available to borrow"
                  value={`${fmt(availableLiquidity)} sUSD`}
                />
                <div className="mt-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-xs text-gray-400">
                  🔔 Liquidation threshold is{" "}
                  <span className="text-rose-400 font-semibold">85%</span> debt
                  / collateral ratio
                </div>
              </Card>

              {/* repay card — only when loan active */}
              {loan?.active && (
                <Card>
                  <h2 className="text-base font-semibold mb-4 text-gray-200">
                    Repay Loan
                  </h2>
                  <div className="space-y-3">
                    <Input
                      label="Repay amount"
                      value={repayAmt}
                      onChange={setRepayAmt}
                      placeholder="0.00"
                      type="number"
                      suffix="sUSD"
                      disabled={pendingRepay}
                    />
                    <div className="flex justify-end">
                      <button
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                        onClick={() => {
                          // Add 1% buffer to cover interest accrued between read and tx execution
                          // The contract caps repayment at totalOwed, so overpaying is safe
                          const buffered = outstandingOwed + outstandingOwed / 100n;
                          setRepayAmt(formatUnits(buffered, 18));
                        }}
                      >
                        Repay all ({fmt(outstandingOwed)} sUSD)
                      </button>
                    </div>
                    <Btn
                      variant="danger"
                      onClick={handleRepay}
                      disabled={!repayAmt || pendingRepay}
                      className="w-full"
                    >
                      {pendingRepay ? (
                        <>
                          <Spinner /> Repaying…
                        </>
                      ) : (
                        "Repay"
                      )}
                    </Btn>
                  </div>
                </Card>
              )}
            </div>

            {/* borrow form — disabled if loan already open */}
            <Card className={loan?.active ? "opacity-50 pointer-events-none" : ""}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-200">
                  New Borrow
                </h2>
                {loan?.active && (
                  <span className="text-xs text-amber-400">
                    Repay existing loan first
                  </span>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <Input
                    label="Market ID"
                    value={borrowMarket}
                    onChange={setBorrowMarket}
                    placeholder={totalMarkets > 0 ? `0 – ${totalMarkets - 1}` : "e.g. 0"}
                    type="number"
                    disabled={pendingBorrow}
                  />
                  {borrowMarket !== "" && !borrowMarketExists && (
                    <p className="text-xs text-rose-400 mt-1">Market not found or not initialized</p>
                  )}
                </div>

                {/* YES / NO toggle */}
                <div>
                  <Label>Position</Label>
                  <div className="flex gap-2 mt-1">
                    {[true, false].map((v) => (
                      <button
                        key={String(v)}
                        onClick={() => setBorrowIsYes(v)}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all border ${
                          borrowIsYes === v
                            ? v
                              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                              : "bg-rose-500/20 border-rose-500/40 text-rose-300"
                            : "bg-white/5 border-white/10 text-gray-400"
                        }`}
                      >
                        {v ? "YES" : "NO"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Show user's available shares for selected market */}
                {borrowMarket !== "" && borrowMarketExists && (
                  <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 space-y-1">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Your Shares on Market #{borrowMarket}</p>
                    <div className="flex gap-4 text-sm">
                      <span className="text-emerald-400 font-mono">YES: {fmt(userYesShares)}</span>
                      <span className="text-rose-400 font-mono">NO: {fmt(userNoShares)}</span>
                    </div>
                    {(borrowIsYes ? userYesShares : userNoShares) === 0n && (
                      <p className="text-xs text-amber-400 mt-1">
                        You have no {borrowIsYes ? "YES" : "NO"} shares to use as collateral. Buy some first on the trading page.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <Input
                    label="Share amount (collateral)"
                    value={borrowShares}
                    onChange={setBorrowShares}
                    placeholder="0.00"
                    type="number"
                    suffix="shares"
                    disabled={pendingBorrow}
                  />
                  {borrowMarketExists && (borrowIsYes ? userYesShares : userNoShares) > 0n && (
                    <div className="flex justify-end mt-1">
                      <button className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                        onClick={() => setBorrowShares(formatUnits(borrowIsYes ? userYesShares : userNoShares, 18))}>
                        Max ({fmt(borrowIsYes ? userYesShares : userNoShares)} shares)
                      </button>
                    </div>
                  )}
                </div>

                <Input
                  label="Borrow amount"
                  value={borrowAmt}
                  onChange={setBorrowAmt}
                  placeholder="0.00"
                  type="number"
                  suffix="sUSD"
                  disabled={pendingBorrow}
                />

                {/* Max borrow estimation — computed from shares × price × LTV */}
                {borrowMarketExists && borrowShares && borrowMarketPrice > 0n && (() => {
                  const sharesWad = (() => { try { return parseUnits(borrowShares, 18); } catch { return 0n; } })();
                  if (sharesWad <= 0n) return null;
                  const posPrice = borrowIsYes ? borrowMarketPrice : WAD - borrowMarketPrice;
                  const posValue = (sharesWad * posPrice) / WAD;
                  const maxBorrow = (posValue * BigInt(ltv)) / 100n;
                  return (
                    <div className="text-xs bg-white/5 rounded-xl px-4 py-3 border border-white/10 space-y-1">
                      <div className="flex justify-between text-gray-400">
                        <span>Position value</span>
                        <span className="font-mono text-white">{fmt(posValue)} sUSD</span>
                      </div>
                      <div className="flex justify-between text-gray-400">
                        <span>Max borrow ({ltv}% LTV)</span>
                        <span className="font-mono text-cyan-400">{fmt(maxBorrow)} sUSD</span>
                      </div>
                      {borrowAmt && (() => { try { return parseUnits(borrowAmt, 18) > maxBorrow; } catch { return false; } })() && (
                        <p className="text-rose-400 font-medium mt-1">⚠️ Borrow amount exceeds max LTV — transaction will revert</p>
                      )}
                      {borrowAmt && (() => { try { return parseUnits(borrowAmt, 18) > availableLiquidity; } catch { return false; } })() && (
                        <p className="text-rose-400 font-medium mt-1">⚠️ Borrow amount exceeds available vault liquidity</p>
                      )}
                    </div>
                  );
                })()}

                <Btn
                  onClick={handleBorrow}
                  disabled={
                    !borrowMarket ||
                    !borrowShares ||
                    !borrowAmt ||
                    pendingBorrow
                  }
                  className="w-full"
                >
                  {pendingBorrow ? (
                    <>
                      <Spinner /> Borrowing…
                    </>
                  ) : (
                    "Borrow sUSD"
                  )}
                </Btn>

                <p className="text-[11px] text-gray-600 text-center">
                  Approves ERC-1155 shares then submits borrow transaction
                </p>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
