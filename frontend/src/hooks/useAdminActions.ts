"use client";

import { useCallback, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import type { Idl } from "@coral-xyz/anchor";
import StablecoinIDL from "@/idl/stablecoin.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROGRAM_ID = new PublicKey("B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs");
const ROLES_SEED = "roles";
const MINTER_SEED = "minter";
const BLACKLIST_SEED = "blacklist";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface AdminActionResult {
  signature: string;
}

export function useAdminActions() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Build an Anchor Program instance from the connected wallet. */
  function getProgram(): Program {
    if (!wallet) throw new Error("Wallet not connected");
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return new Program(StablecoinIDL as Idl, provider);
  }

  /** Pause the stablecoin (requires pauser role). */
  const pause = useCallback(
    async (configAddress: PublicKey): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet) throw new Error("Wallet not connected");
        const program = getProgram();
        const [rolesPda] = PublicKey.findProgramAddressSync(
          [Buffer.from(ROLES_SEED), configAddress.toBuffer()],
          PROGRAM_ID
        );
        const sig = await program.methods
          .pause()
          .accounts({
            pauser: wallet.publicKey,
            roles: rolesPda,
            config: configAddress,
          })
          .rpc();
        return sig;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallet, connection]
  );

  /** Unpause the stablecoin (requires pauser role). */
  const unpause = useCallback(
    async (configAddress: PublicKey): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet) throw new Error("Wallet not connected");
        const program = getProgram();
        const [rolesPda] = PublicKey.findProgramAddressSync(
          [Buffer.from(ROLES_SEED), configAddress.toBuffer()],
          PROGRAM_ID
        );
        const sig = await program.methods
          .unpause()
          .accounts({
            pauser: wallet.publicKey,
            roles: rolesPda,
            config: configAddress,
          })
          .rpc();
        return sig;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallet, connection]
  );

  /**
   * Mint tokens to a recipient (requires minter role).
   * The connected wallet must be a registered minter for this stablecoin.
   */
  const mintTokens = useCallback(
    async (
      configAddress: PublicKey,
      mintPubkey: PublicKey,
      recipientAddress: PublicKey,
      humanAmount: number,
      decimals: number
    ): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet) throw new Error("Wallet not connected");
        const program = getProgram();

        // Minter config PDA — the connected wallet must be registered as a minter
        const [minterConfigPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from(MINTER_SEED),
            configAddress.toBuffer(),
            wallet.publicKey.toBuffer(),
          ],
          PROGRAM_ID
        );

        // Derive recipient's Associated Token Account
        const recipientAta = getAssociatedTokenAddressSync(
          mintPubkey,
          recipientAddress,
          false,
          TOKEN_2022_PROGRAM_ID
        );

        // Create ATA if it doesn't exist yet
        const ataInfo = await connection.getAccountInfo(recipientAta);
        if (!ataInfo) {
          const createAtaTx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              recipientAta,
              recipientAddress,
              mintPubkey,
              TOKEN_2022_PROGRAM_ID
            )
          );
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash();
          createAtaTx.recentBlockhash = blockhash;
          createAtaTx.feePayer = wallet.publicKey;
          const signedTx = await wallet.signTransaction(createAtaTx);
          const rawTx = signedTx.serialize();
          const ataTxSig = await connection.sendRawTransaction(rawTx);
          await connection.confirmTransaction(
            { signature: ataTxSig, blockhash, lastValidBlockHeight },
            "confirmed"
          );
        }

        // Convert human amount to raw (e.g. 100 USDC → 100_000_000 with 6 decimals)
        const rawAmount = new BN(
          Math.round(humanAmount * Math.pow(10, decimals))
        );

        const sig = await program.methods
          .mintTokens(rawAmount)
          .accounts({
            minter: wallet.publicKey,
            minterConfig: minterConfigPda,
            config: configAddress,
            mint: mintPubkey,
            recipientTokenAccount: recipientAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        return sig;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallet, connection]
  );

  /** Add an address to the blacklist (requires blacklister role). */
  const blacklistAdd = useCallback(
    async (
      configAddress: PublicKey,
      targetAddress: PublicKey,
      reason: string
    ): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet) throw new Error("Wallet not connected");
        const program = getProgram();

        const [rolesPda] = PublicKey.findProgramAddressSync(
          [Buffer.from(ROLES_SEED), configAddress.toBuffer()],
          PROGRAM_ID
        );
        const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from(BLACKLIST_SEED),
            configAddress.toBuffer(),
            targetAddress.toBuffer(),
          ],
          PROGRAM_ID
        );

        const sig = await program.methods
          .addToBlacklist(targetAddress, reason)
          .accounts({
            payer: wallet.publicKey,
            blacklister: wallet.publicKey,
            roles: rolesPda,
            config: configAddress,
            blacklistEntry: blacklistEntryPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        return sig;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallet, connection]
  );

  /** Remove an address from the blacklist (requires blacklister role). */
  const blacklistRemove = useCallback(
    async (
      configAddress: PublicKey,
      targetAddress: PublicKey
    ): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet) throw new Error("Wallet not connected");
        const program = getProgram();

        const [rolesPda] = PublicKey.findProgramAddressSync(
          [Buffer.from(ROLES_SEED), configAddress.toBuffer()],
          PROGRAM_ID
        );
        const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from(BLACKLIST_SEED),
            configAddress.toBuffer(),
            targetAddress.toBuffer(),
          ],
          PROGRAM_ID
        );

        const sig = await program.methods
          .removeFromBlacklist(targetAddress)
          .accounts({
            payer: wallet.publicKey,
            blacklister: wallet.publicKey,
            roles: rolesPda,
            config: configAddress,
            blacklistEntry: blacklistEntryPda,
          })
          .rpc();
        return sig;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallet, connection]
  );

  return {
    loading,
    error,
    pause,
    unpause,
    mintTokens,
    blacklistAdd,
    blacklistRemove,
  };
}
