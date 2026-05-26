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

### Make Google Sign-In zero-setup for users (recommended)

If you're the one deploying this app, set the Google OAuth Client ID once via an
environment variable so visitors never see the "paste Client ID" screen:

- **Local dev:** create `.env.local` with `VITE_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com`
- **Vercel:** Project → Settings → Environment Variables → add `VITE_GOOGLE_CLIENT_ID` → redeploy

The Client ID isn't a secret (Google publishes them in your auth URLs anyway), so embedding it
in the build is safe and standard. After this, users tap **Continue with Google** → one consent
popup grants both sign-in and Drive backup access → done. No setup. WhatsApp-style.

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

## Android APK (auto-built in GitHub Actions)

The project includes a Capacitor wrapper for Android with a custom SMS reader plugin (read past SMS + listen for new ones, both into the same SMS Inbox UI).

You don't need Android Studio on your machine — every push to `main` triggers `.github/workflows/build-apk.yml`, which builds an APK on GitHub's Linux runners.

**Download the APK**
- Action artifact (each push): GitHub repo → Actions → click the latest run → bottom of the page → `finsight-debug-apk`
- GitHub Release (permanent URL): tag a commit `git tag v0.1.0 && git push --tags` → Releases page → download `finsight-debug.apk`

**One-time secret to set in GitHub**: repo → Settings → Secrets and variables → Actions → add `VITE_GOOGLE_CLIENT_ID` with the same Client ID you use in Vercel. Without this, the APK still builds but won't have Google Sign-In wired up.

**Install on phone**: enable "Install unknown apps" for whatever you'll download with (Chrome/Drive), tap the .apk → install. On first launch, the app asks for SMS permission so it can scan past bank SMS and watch for new ones.

## What's next

- Auto-sync on change (currently manual push/pull)
- XIRR + benchmark comparisons
- Recurring transactions
- iOS via Capacitor (would need a Mac for codesigning)
