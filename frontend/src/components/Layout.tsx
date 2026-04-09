import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";

const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/markets", label: "Markets" },
  { path: "/create-market", label: "Create" },
  { path: "/vault", label: "Vault" },
  { path: "/reputation", label: "Reputation" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { account, openWallet, openBridge } = useWallet();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#07070d] text-white noise">
      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold">
              S
            </div>
            <span className="text-lg font-bold tracking-tight">
              Signal<span className="text-indigo-400">Market</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {account && (
              <>
                <button
                  onClick={openBridge}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all text-sm text-indigo-300 font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  Bridge
                </button>
                <button
                  onClick={openWallet}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-all text-sm"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-gray-400 font-mono text-xs">
                    {account.slice(0, 6)}…{account.slice(-4)}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Content ── */}
      <main className="pt-16 relative z-10">{children}</main>
    </div>
  );
}
