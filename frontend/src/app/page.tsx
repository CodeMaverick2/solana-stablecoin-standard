"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Navbar } from "@/components/Navbar";
import { StatCard } from "@/components/StatCard";
import { useStablecoin } from "@/hooks/useStablecoin";

const PRESET_COLORS = {
  "SSS-1": "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  "SSS-2": "bg-purple-500/20 text-purple-300 border border-purple-500/30",
  "SSS-3": "bg-green-500/20 text-green-300 border border-green-500/30",
};

const PRESET_DESCRIPTIONS = {
  "SSS-1": "Minimal — mint authority + freeze + metadata",
  "SSS-2": "Compliant — + permanent delegate + transfer hook + blacklist",
  "SSS-3": "Private — + confidential transfers + allowlist",
};

export default function Home() {
  const { connected } = useWallet();
  const [mintInput, setMintInput] = useState("");
  const [mintAddress, setMintAddress] = useState("");

  const { config, loading, error, refresh } = useStablecoin(mintAddress);

  const handleLookup = () => {
    setMintAddress(mintInput.trim());
  };

  const truncate = (s: string) =>
    s.length > 16 ? `${s.slice(0, 8)}...${s.slice(-8)}` : s;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Stablecoin Dashboard</h1>
          <p className="text-gray-400">
            Inspect and manage any SSS-compliant stablecoin on Solana.
          </p>
        </div>

        {/* Mint lookup */}
        <div className="flex gap-3 mb-10">
          <input
            type="text"
            placeholder="Enter stablecoin mint address…"
            value={mintInput}
            onChange={(e) => setMintInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition"
          />
          <button
            onClick={handleLookup}
            disabled={!mintInput.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-6 py-2.5 rounded-lg text-sm font-medium transition"
          >
            Load
          </button>
          {config && (
            <button
              onClick={refresh}
              className="bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-lg text-sm transition"
            >
              ↻
            </button>
          )}
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            Loading config…
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* Config loaded */}
        {config && !loading && (
          <div className="space-y-8">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-full ${PRESET_COLORS[config.preset]}`}
                >
                  {config.preset}
                </span>
                <span className="text-gray-400 text-sm">{PRESET_DESCRIPTIONS[config.preset]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border ${
                    config.isPaused
                      ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-green-500/20 text-green-300 border-green-500/30"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      config.isPaused ? "bg-red-400" : "bg-green-400"
                    }`}
                  />
                  {config.isPaused ? "Paused" : "Active"}
                </span>
              </div>
            </div>

            {/* Supply stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Minted"
                value={config.totalMinted}
                sub={`Decimals: ${config.decimals}`}
                color="purple"
              />
              <StatCard
                label="Total Burned"
                value={config.totalBurned}
                color="orange"
              />
              <StatCard
                label="Circulating"
                value={calcCirculating(config.totalMinted, config.totalBurned)}
                color="green"
              />
              <StatCard
                label="Decimals"
                value={config.decimals.toString()}
                color="blue"
              />
            </div>

            {/* Feature flags */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
                Feature Flags
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  ["Permanent Delegate", config.enablePermanentDelegate],
                  ["Transfer Hook",      config.enableTransferHook],
                  ["Confidential Transfers", config.enableConfidentialTransfer],
                  ["Allowlist Mode",     config.enableAllowlist],
                ].map(([label, enabled]) => (
                  <div
                    key={label as string}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                      enabled
                        ? "bg-green-500/10 text-green-300"
                        : "bg-gray-800 text-gray-500"
                    }`}
                  >
                    <span>{enabled ? "✓" : "✗"}</span>
                    <span>{label as string}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Addresses */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
                Addresses
              </h2>
              <div className="space-y-3">
                {[
                  ["Mint",              config.mint],
                  ["Master Authority", config.masterAuthority],
                ].map(([label, addr]) => (
                  <div key={label as string} className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">{label as string}</span>
                    <a
                      href={`https://explorer.solana.com/address/${addr}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-purple-400 hover:text-purple-300 text-sm font-mono transition"
                    >
                      {truncate(addr as string)} ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* Connect wallet CTA */}
            {!connected && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-5 text-center">
                <p className="text-purple-300 text-sm mb-1 font-medium">
                  Connect your wallet to perform operations
                </p>
                <p className="text-gray-500 text-xs">
                  Mint, burn, freeze, blacklist, seize — all from a single dashboard.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!config && !loading && !error && (
          <div className="border border-dashed border-gray-700 rounded-xl p-16 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-gray-300 font-medium mb-2">Enter a mint address to get started</h3>
            <p className="text-gray-600 text-sm max-w-sm mx-auto">
              Paste any SSS-1, SSS-2, or SSS-3 stablecoin mint address to inspect its
              configuration, supply stats, and feature flags.
            </p>
            <div className="mt-6 text-xs text-gray-600">
              Deployed stablecoin (devnet):{" "}
              <button
                onClick={() => {
                  setMintInput("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");
                  setMintAddress("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");
                }}
                className="text-purple-400 hover:underline"
              >
                B1zq...pHs
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function calcCirculating(minted: string, burned: string): string {
  try {
    const m = parseFloat(minted.replace(/,/g, ""));
    const b = parseFloat(burned.replace(/,/g, ""));
    if (isNaN(m) || isNaN(b)) return "—";
    return (m - b).toLocaleString();
  } catch {
    return "—";
  }
}
