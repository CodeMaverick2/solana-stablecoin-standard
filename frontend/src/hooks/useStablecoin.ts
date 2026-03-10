"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const STABLECOIN_PROGRAM_ID = new PublicKey("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");

export interface ConfigInfo {
  configAddress: string;
  mint: string;
  decimals: number;
  isPaused: boolean;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  enableConfidentialTransfer: boolean;
  enableAllowlist: boolean;
  totalMinted: string;
  totalBurned: string;
  masterAuthority: string;
  preset: "SSS-1" | "SSS-2" | "SSS-3";
}

export function useStablecoin(mintAddressStr: string) {
  const { connection } = useConnection();

  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!mintAddressStr) return;
    setLoading(true);
    setError(null);
    try {
      const mint = new PublicKey(mintAddressStr);
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stablecoin_config"), mint.toBuffer()],
        STABLECOIN_PROGRAM_ID
      );

      const accountInfo = await connection.getAccountInfo(configPda);
      if (!accountInfo) {
        setError("Config account not found for this mint.");
        setConfig(null);
        return;
      }

      // Parse raw Borsh account bytes (skip 8-byte discriminator)
      const d = accountInfo.data;
      const masterAuthority = new PublicKey(d.slice(8, 40));
      const mintPubkey = new PublicKey(d.slice(72, 104));
      const decimals = d[104];
      const enablePermanentDelegate = d[105] !== 0;
      const enableTransferHook = d[106] !== 0;
      const isPaused = d[107] !== 0;
      const totalMinted = readU64LE(d, 108);
      const totalBurned = readU64LE(d, 116);
      const enableConfidentialTransfer = d[125] !== 0;
      const enableAllowlist = d[126] !== 0;

      const preset: ConfigInfo["preset"] =
        enableAllowlist && enableConfidentialTransfer
          ? "SSS-3"
          : enablePermanentDelegate && enableTransferHook
          ? "SSS-2"
          : "SSS-1";

      setConfig({
        configAddress: configPda.toBase58(),
        mint: mintPubkey.toBase58(),
        decimals,
        isPaused,
        enablePermanentDelegate,
        enableTransferHook,
        enableConfidentialTransfer,
        enableAllowlist,
        totalMinted: formatAmount(totalMinted, decimals),
        totalBurned: formatAmount(totalBurned, decimals),
        masterAuthority: masterAuthority.toBase58(),
        preset,
      });
    } catch (e: any) {
      setError(e.message || "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, [connection, mintAddressStr]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, loading, error, refresh: fetchConfig };
}

function readU64LE(data: Buffer, offset: number): bigint {
  return (
    BigInt(data[offset]) |
    (BigInt(data[offset + 1]) << 8n) |
    (BigInt(data[offset + 2]) << 16n) |
    (BigInt(data[offset + 3]) << 24n) |
    (BigInt(data[offset + 4]) << 32n) |
    (BigInt(data[offset + 5]) << 40n) |
    (BigInt(data[offset + 6]) << 48n) |
    (BigInt(data[offset + 7]) << 56n)
  );
}

function formatAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fracStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
