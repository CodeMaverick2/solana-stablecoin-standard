"use client";

import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAdminActions } from "@/hooks/useAdminActions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminPanelProps {
  configAddress: string;
  mintAddress: string;
  isPaused: boolean;
  decimals: number;
  onSuccess: () => void;
}

type Tab = "mint" | "pause" | "blacklist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidPublicKey(s: string): boolean {
  try {
    new PublicKey(s);
    return s.length >= 32;
  } catch {
    return false;
  }
}

function SigLink({ sig }: { sig: string }) {
  return (
    <a
      href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
      className="text-green-400 hover:underline font-mono text-xs break-all"
    >
      {sig.slice(0, 16)}…{sig.slice(-8)} ↗
    </a>
  );
}

// ---------------------------------------------------------------------------
// AdminPanel
// ---------------------------------------------------------------------------

export function AdminPanel({
  configAddress,
  mintAddress,
  isPaused: isPausedProp,
  decimals,
  onSuccess,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("mint");
  const [lastSig, setLastSig] = useState<string | null>(null);
  // Optimistic local state so button flips immediately after tx confirms
  const [isPaused, setIsPaused] = useState(isPausedProp);
  // Sync when parent refresh completes
  useEffect(() => { setIsPaused(isPausedProp); }, [isPausedProp]);

  const { loading, error, pause, unpause, mintTokens, blacklistAdd, blacklistRemove } =
    useAdminActions();

  // --- Mint form state ---
  const [mintRecipient, setMintRecipient] = useState("");
  const [mintAmount, setMintAmount] = useState("");

  // --- Blacklist form state ---
  const [blAction, setBlAction] = useState<"add" | "remove">("add");
  const [blAddress, setBlAddress] = useState("");
  const [blReason, setBlReason] = useState("");

  const configPk = new PublicKey(configAddress);
  const mintPk = new PublicKey(mintAddress);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  async function handlePauseToggle() {
    setLastSig(null);
    try {
      const sig = isPaused
        ? await unpause(configPk)
        : await pause(configPk);
      setLastSig(sig);
      setIsPaused(!isPaused); // flip immediately so button doesn't double-fire
      onSuccess();
    } catch {
      // error state set by hook
    }
  }

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    setLastSig(null);
    if (!isValidPublicKey(mintRecipient)) return;
    const amount = parseFloat(mintAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      const sig = await mintTokens(
        configPk,
        mintPk,
        new PublicKey(mintRecipient),
        amount,
        decimals
      );
      setLastSig(sig);
      setMintRecipient("");
      setMintAmount("");
      onSuccess();
    } catch {
      // error state set by hook
    }
  }

  async function handleBlacklist(e: React.FormEvent) {
    e.preventDefault();
    setLastSig(null);
    if (!isValidPublicKey(blAddress)) return;
    const targetPk = new PublicKey(blAddress);
    try {
      const sig =
        blAction === "add"
          ? await blacklistAdd(configPk, targetPk, blReason || "No reason provided")
          : await blacklistRemove(configPk, targetPk);
      setLastSig(sig);
      setBlAddress("");
      setBlReason("");
      onSuccess();
    } catch {
      // error state set by hook
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const tabs: { id: Tab; label: string }[] = [
    { id: "mint", label: "Mint Tokens" },
    { id: "pause", label: isPaused ? "Unpause" : "Pause" },
    { id: "blacklist", label: "Blacklist" },
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-5">
        Admin Operations
      </h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setLastSig(null); }}
            className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition ${
              activeTab === tab.id
                ? "bg-purple-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Mint Tab ── */}
      {activeTab === "mint" && (
        <form onSubmit={handleMint} className="space-y-3">
          <p className="text-xs text-gray-500 mb-2">
            Connected wallet must be a registered minter for this stablecoin.
          </p>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Recipient Address</label>
            <input
              type="text"
              value={mintRecipient}
              onChange={(e) => setMintRecipient(e.target.value)}
              placeholder="Solana wallet address…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition font-mono"
            />
            {mintRecipient && !isValidPublicKey(mintRecipient) && (
              <p className="text-xs text-red-400 mt-1">Invalid public key</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Amount ({decimals} decimals)
            </label>
            <input
              type="number"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              placeholder="e.g. 100.5"
              min="0"
              step="any"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition"
            />
          </div>
          <button
            type="submit"
            disabled={
              loading ||
              !isValidPublicKey(mintRecipient) ||
              !mintAmount ||
              parseFloat(mintAmount) <= 0
            }
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-40 py-2 rounded-lg text-sm font-medium transition"
          >
            {loading ? "Sending…" : "Mint Tokens"}
          </button>
        </form>
      )}

      {/* ── Pause Tab ── */}
      {activeTab === "pause" && (
        <div className="space-y-4">
          <div
            className={`rounded-xl p-4 text-center ${
              isPaused
                ? "bg-red-500/10 border border-red-500/30"
                : "bg-green-500/10 border border-green-500/30"
            }`}
          >
            <p
              className={`text-sm font-medium ${
                isPaused ? "text-red-300" : "text-green-300"
              }`}
            >
              Status: {isPaused ? "PAUSED — all minting and seizing is halted" : "ACTIVE — operating normally"}
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Requires the <span className="text-gray-300 font-mono">pauser</span> role.
            Pausing blocks <code>mint_tokens</code> and <code>seize</code> instructions.
          </p>
          <button
            onClick={handlePauseToggle}
            disabled={loading}
            className={`w-full py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 ${
              isPaused
                ? "bg-green-600 hover:bg-green-700"
                : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {loading
              ? "Sending…"
              : isPaused
              ? "Unpause Stablecoin"
              : "Pause Stablecoin"}
          </button>
        </div>
      )}

      {/* ── Blacklist Tab ── */}
      {activeTab === "blacklist" && (
        <form onSubmit={handleBlacklist} className="space-y-3">
          <p className="text-xs text-gray-500 mb-2">
            Requires the <span className="text-gray-300 font-mono">blacklister</span> role.
            Blacklisted addresses cannot send or receive tokens.
          </p>
          {/* Add / Remove toggle */}
          <div className="flex gap-2">
            {(["add", "remove"] as const).map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => setBlAction(action)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition ${
                  blAction === action
                    ? action === "add"
                      ? "bg-red-600 text-white"
                      : "bg-green-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {action === "add" ? "Add to Blacklist" : "Remove from Blacklist"}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Target Address</label>
            <input
              type="text"
              value={blAddress}
              onChange={(e) => setBlAddress(e.target.value)}
              placeholder="Wallet address to blacklist…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition font-mono"
            />
            {blAddress && !isValidPublicKey(blAddress) && (
              <p className="text-xs text-red-400 mt-1">Invalid public key</p>
            )}
          </div>
          {blAction === "add" && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Reason <span className="text-gray-600">(e.g. OFAC match)</span>
              </label>
              <input
                type="text"
                value={blReason}
                onChange={(e) => setBlReason(e.target.value)}
                placeholder="Reason for blacklisting…"
                maxLength={128}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !isValidPublicKey(blAddress)}
            className={`w-full py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 ${
              blAction === "add"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {loading
              ? "Sending…"
              : blAction === "add"
              ? "Blacklist Address"
              : "Remove from Blacklist"}
          </button>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-4 py-2 break-all">
          {error.includes("Unauthorized")
            ? "Error: your wallet does not hold the required role for this operation."
            : error.includes("Paused")
            ? "Error: the stablecoin is paused — unpause first."
            : error}
        </div>
      )}

      {/* Success */}
      {lastSig && !error && (
        <div className="mt-4 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3">
          <p className="text-green-300 text-xs mb-1 font-medium">Transaction confirmed</p>
          <SigLink sig={lastSig} />
        </div>
      )}
    </div>
  );
}
