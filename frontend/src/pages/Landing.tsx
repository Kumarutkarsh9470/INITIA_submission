import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";

export default function Landing() {
  const { account, connect, isConnecting } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    if (account) navigate("/dashboard", { replace: true });
  }, [account, navigate]);

  return (
    <div className="min-h-screen bg-[#07070d] text-white noise relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-indigo-600/[0.08] blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-200px] w-[500px] h-[500px] rounded-full bg-purple-600/[0.06] blur-[100px] pointer-events-none" />
      <div className="absolute top-[40%] right-[-150px] w-[400px] h-[400px] rounded-full bg-cyan-600/[0.04] blur-[80px] pointer-events-none" />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold shadow-lg shadow-indigo-500/20">
            S
          </div>
          <span className="text-xl font-bold tracking-tight">
            Signal<span className="text-indigo-400">Market</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:flex items-center gap-2 text-xs text-gray-500 px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Initia Testnet
          </span>
        </div>
      </header>

      {/* Hero */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-88px)] px-6 -mt-8">
        <div className="animate-fade-in-up text-center max-w-3xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-xs text-gray-400 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            Built for INITIATE Hackathon · Initia Testnet
          </div>

          {/* Title */}
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
            <span className="gradient-text">Prediction Markets</span>
            <br />
            <span className="text-gray-300">on Initia</span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-gray-500 max-w-lg mx-auto mb-12 leading-relaxed animate-fade-in delay-200">
            Trade signals, build reputation, earn yield.
            <br className="hidden sm:block" />
            Powered by MiniEVM.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in delay-300">
            <button
              onClick={connect}
              disabled={isConnecting}
              className="btn-primary text-base px-10 py-4 glow-accent"
            >
              {isConnecting ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Connecting…
                </span>
              ) : (
                "Launch App →"
              )}
            </button>
          </div>

          {/* Supported wallets */}
          <p className="text-xs text-gray-600 mt-8 animate-fade-in delay-400">
            Initia Wallet · Keplr · Leap
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full mt-20 stagger animate-fade-in delay-500">
          <FeatureCard
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
            title="Trade"
            desc="Binary outcome markets with AMM pricing"
          />
          <FeatureCard
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
            title="Reputation"
            desc="On-chain score unlocks protocol perks"
          />
          <FeatureCard
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            title="Vault"
            desc="Lend sUSD and earn yield from interest"
          />
        </div>

        {/* How It Works */}
        <div className="max-w-3xl w-full mt-24 mb-16 animate-fade-in delay-500">
          <h2 className="text-center text-sm font-semibold text-gray-500 uppercase tracking-widest mb-12">
            How It Works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <StepCard
              step={1}
              title="Create & Trade"
              desc="Anyone can create a prediction market. Buy YES or NO outcome tokens using sUSD through a constant-product AMM with Gaussian pricing."
            />
            <StepCard
              step={2}
              title="Build Reputation"
              desc="Every trade is tracked. Accurate forecasters earn higher reputation scores, unlocking lower fees, bond waivers, and governance power."
            />
            <StepCard
              step={3}
              title="Earn Yield"
              desc="Deposit sUSD in the lending Vault. Borrowers collateralize with outcome tokens — you earn interest with utilization-based APY."
            />
          </div>

          {/* Powered by */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-16 text-xs text-gray-600">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              Initia MiniEVM
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              InterwovenKit
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
              Auto-Sign + Bridge
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              8 Solidity Contracts
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="animate-fade-in-up glass glass-hover rounded-2xl p-5 text-center transition-all duration-300">
      <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
      <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function StepCard({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <div className="animate-fade-in-up glass rounded-2xl p-6 text-center relative group hover:border-indigo-500/20 transition-all duration-300">
      <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-indigo-500/20">
        {step}
      </div>
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
    </div>
  );
}
