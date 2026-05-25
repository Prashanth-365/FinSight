# FinSight — Private Personal Finance for Indian Households

A privacy-first PWA personal finance tracker for Indian users (₹ INR). Built with React + Vite, Tailwind CSS, Dexie.js (IndexedDB), and Recharts. All data lives **only** in your browser.

## Highlights

- Master login (bcrypt) + zero-friction family sub-profiles (just tap an avatar in the header)
- Smart "Account" picker that combines bank/card/wallet with masked numbers
- Transactions with auto-suggest on every field, frequency-sorted
- Chronological `slNo` re-indexing on every insert/update
- Investments across MF / Stocks / Gold / FD / PPF / EPF / Crypto / Chit Fund / Other
- Live price refresh (AMFI via mfapi.in, CoinGecko, Alpha Vantage for stocks)
- SMS Inbox foundation — paste a bank/UPI SMS and convert it to a transaction
- Categories: rename = merge; duplicates auto-resolve
- Dark/light theme, installable PWA, mobile-first
- Export / Import JSON for backup

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build && npm run preview
```

## Tech

- React 18 + React Router v6
- Vite + vite-plugin-pwa (service worker, manifest)
- Tailwind CSS (custom CSS variables, shadcn-flavored components)
- Dexie.js (IndexedDB) + dexie-react-hooks
- bcryptjs (password hashing — locally only)
- Recharts (investment line charts)
- lucide-react (icons)

## Data lives on your device

Open DevTools → Application → IndexedDB → `finsight`. Everything is plain-text on
your device. Use **Settings → Data → Export** to back it up to a JSON file.

## Google Drive sync — security model

If you enable Drive sync in **Settings → Data**, FinSight will:

1. Authenticate to *your own* Google Cloud OAuth Client (you create it; you control consent).
2. Request only the `drive.appdata` scope — a hidden per-app folder that no other app can read, isn't visible in Drive's UI, and isn't searchable.
3. Encrypt the entire backup locally with **AES-256-GCM**, key derived from your passphrase via **PBKDF2-SHA256 / 200k iterations**, before any byte leaves your browser.
4. Store the access token in memory only — never in IndexedDB or localStorage. It expires in ~1 hour and is silently refreshed via FedCM / GIS.

**Forget the passphrase = backup is unrecoverable.** That's the price of true end-to-end encryption — there is no key escrow, no reset path.

Walkthrough for creating the Google OAuth Client is in the app: **Settings → Data → Google Drive sync → ⓘ icon**.

## What's next

- Auto-sync on change (currently manual push/pull)
- Native Android SMS read permission + background parsing
- XIRR + benchmark comparisons
- Recurring transactions
