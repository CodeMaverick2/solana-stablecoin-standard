"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Navbar() {
  return (
    <nav className="border-b border-gray-800 bg-gray-950 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
          S
        </div>
        <div>
          <span className="font-semibold text-white">Solana Stablecoin Standard</span>
          <span className="ml-2 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">Devnet</span>
        </div>
      </div>
      <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !rounded-lg !text-sm !py-2 !px-4" />
    </nav>
  );
}
