# SSS Frontend

Example Next.js 14 dashboard for inspecting and managing SSS-compliant stablecoins.

## Features

- Connect Phantom or Solflare wallet
- Look up any stablecoin mint by address
- View supply stats (total minted, burned, circulating)
- View feature flags (permanent delegate, transfer hook, confidential transfers, allowlist)
- Preset detection (SSS-1 / SSS-2 / SSS-3)
- Links to Solana Explorer for all addresses

## Running

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- **Next.js 14** (App Router)
- **Tailwind CSS**
- **@solana/wallet-adapter-react** (Phantom, Solflare)
- **@coral-xyz/anchor** (program interaction)
- **@solana/spl-token** (Token-2022)

## Configuration

The frontend is pre-configured for **devnet**. To switch to mainnet, change `WalletAdapterNetwork.Devnet` to `WalletAdapterNetwork.Mainnet` in `src/components/WalletProvider.tsx`.

Program IDs are hardcoded in `src/hooks/useStablecoin.ts`:
- Stablecoin: `B1zqgaJkbVzNoMagPyAJdgveArzaTW6fkyk3JtSq1pHs`
