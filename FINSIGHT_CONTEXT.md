# FinSight — Project Context & Continuation Prompt

A privacy-first personal finance tracker PWA for Indian users (₹ INR). All data is
local-first (IndexedDB) with optional encrypted Google Drive sync. There is also an
Android APK build (Capacitor) that adds SMS auto-tracking, biometric lock, and
file export. **Build target = BOTH a Capacitor Android APK and a pure-PWA web build.**

## Project location
`C:\Users\2407474\OneDrive - Cognizant\Cognizant\Claude\FinSight`
(Windows; no local Node. Web builds on Vercel, APK via GitHub Actions. NO local git
repo — I push from my own environment. Don't assume `git`/`npm` run locally.)

## Tech stack
- React 18 + Vite 5, React Router v6 (BrowserRouter)
- Tailwind (CSS-variable theming, dark/light), hand-rolled shadcn-style UI primitives
- Dexie.js (IndexedDB) + dexie-react-hooks (`useLiveQuery`)
- bcryptjs (local master password), Recharts (charts), lucide-react (icons)
- vite-plugin-pwa (manifest + service worker)
- Capacitor 6 for the APK; custom Kotlin plugins for SMS + biometrics
- @capacitor/filesystem (file export), @capacitor/app (hardware back, deep links)
- pdfjs-dist + xlsx for on-device statement parsing

## Conventions
- Path alias `@/` → `src/`.
- UI primitives in `src/components/ui/`: Button, Input/Field, Card, Modal (+ Sheet,
  ConfirmDialog), Combobox (free-typing, frequency-sorted; supports a `separator=","`
  multi-value mode for tags), Select, Avatar, Toast (`useToast()` → `.success/.error/.info`),
  Empty/Skeleton.
- Styling: utility classes `fs-card`, `fs-input`, `fs-btn-primary/secondary/ghost/danger`,
  `fs-chip`; colors via CSS vars (`bg-background`, `text-muted-fg`, `text-primary`,
  `text-success`, `text-danger`, `text-warning`, etc.). Toggles are hand-built
  `role="switch"` buttons.
- Contexts: `AuthContext`, `ProfileContext` (`activeProfileId === null`/`isMasterView` =
  "All profiles"), `ThemeContext`, **`NavContext`** (hierarchical Android back).
- Money: `src/lib/currency.js` → `formatINR`, `formatINRShort` (lakh/crore), `formatPercent`.
  Always Indian formatting.
- Utils `src/lib/utils.js`: `cn`, `freqSorted`, `tsToLocalISO`/`todayLocalISO`, `fmtDate`/
  `fmtDateTime`, `maskNumber`, `uid`, `aliasMatchesAccountNumber`, `getAccountBalance`,
  `applyTxnDeltaToBalances`, `inferInvestmentPlatform`, `txnFingerprint`.

## Data model (Dexie, current version = 5)
Tables: `users`, `profiles`, `accounts`, `categories`, `transactions`, `investments`,
`chitFunds`, `smsQueue`, `statements`, `settings` (key-value).
- **accounts**: `{ name, type: bank|card|wallet, number, aliases:[masked], color, isActive,
  profileIds:[], balances:{ [profileId]: number } }`. Per-profile balances via
  `getAccountBalance`/`applyTxnDeltaToBalances`. *(Item 4 will add `sortOrder`.)*
- **categories**: `{ name, parentId(null=top), icon, color, type: expense|income|investment|transfer }`.
  Tree. Rename-to-existing = MERGE. Seeded set includes a **Transfer** top-level category.
- **transactions**: `{ slNo, dateTime, profileId, accountId, categoryId, subCategoryId,
  amount, txnType: debit|credit, paymentMode, description, tags:[], source: manual|sms|statement,
  investmentId, splitGroupId, splitTotal, importFingerprint }`. `slNo` re-sequenced by
  `reindexSlNo()`.
- **investments**: `{ profileId, platform: MF|Stock|Gold|FD|PPF|EPF|Crypto|Chit|Other, name,
  identifier, investedAmount, startDate, maturityDate, notes }`.
  **NOTE: `units`, `currentValue`, `buyPrice`, `NAV` were REMOVED — investments record only
  WHEN/WHERE/HOW MUCH was invested.** (Old records may still carry stale `units`/`currentValue`
  fields in IndexedDB; they are ignored.)
- **chitFunds**: `{ investmentId, monthlyAmt, durationMonths, totalMembers, myBidMonth, bidAmt,
  expectedPayout, installments:[{month,date,paid,amount}] }`.
- **smsQueue = the unified Inbox** (SMS + statement pending items):
  `{ rawSms, parsedData:{amount,txnType,aliasGuess,date,description?}, status: pending|processed|
  dismissed, dateTime, linkedTxnId, nativeId, source, kind: 'sms'|'statement', accountId }`.

## CRITICAL invariant — transaction effects
All balance + invested-amount bookkeeping lives in **`src/db/txnEffects.js`**:
`applyTransactionEffects(txn, +1|-1)`, `deleteTransaction(id)`, `deleteTransactions(ids)`.
Any code that creates/edits/deletes transactions MUST route balance/invested changes
through these. Edit = reverse old (`-1`) then apply new (`+1`). For investment-linked txns
it now only adjusts the holding's `investedAmount` (no units/currentValue).

## Reconciliation / dedup
- `src/lib/reconcile.js`: multiplicity-aware, **description-free** matching keyed on
  `(account, day, signed-amount)`; split groups collapse to their total.
- `ingestStatementRows({rows, accountId, accounts})`: parse → reconcile statement rows
  against final txns (drop matches), then against pending SMS items (merge, don't dup),
  then add leftovers to the Inbox as `kind:'statement'` pending items.
- `findAlreadyInBooks(pending, txns, accounts)`: live "already in your books" flag for
  pending Inbox rows (+ a "dismiss all already-logged" action in the Inbox header).
- `txnFingerprint` (utils) is still stamped on created txns but matching no longer relies on it.

## Navigation (`src/context/NavContext.jsx`)
- `useBackHandler(active, handler)` registers a LIFO back action; integrated into `Modal`
  and `Sheet` so every overlay closes on Android hardware back. Investments
  (holding→platform→grid) and Transactions (selection mode) register their own.
- Android `App.backButton`: close top overlay → else go to logical parent (sub-page→section→
  Home) → else at Home "press back again to exit" (`CapApp.exitApp`). Web keeps native back.
- **Convention:** new overlays built on Modal/Sheet get back-to-close for free; a custom
  in-page view should call `useBackHandler`.

## Features (current)
1. **Auth**: local master (bcrypt) + Google Sign-In (identity + `drive.appdata` in one consent).
   Web uses GIS token client; Android uses Chrome Custom Tab + `com.finsight.app://oauth-success`.
2. **Profiles**: header switcher; master "All profiles" view (id=null).
3. **Home**: single **Net Worth** section — headline `(bank + invested) − liabilities`, with
   three components below: Bank/Wallets, Invested, Liabilities (card outstanding). Per-account
   cards (eye-toggle), recent txns. *(Item 5 will add charts below recents.)*
4. **Transactions**: filters drawer (Sheet), infinite scroll, tap → detail, long-press →
   multi-select + bulk-edit, delete reverses effects.
5. **Transaction entry** (`TransactionSheet.jsx`): auto-suggest comboboxes; investment
   auto-link (category type=investment → holding picker creates/links an investment, adjusting
   its investedAmount); **splits** (equal auto-split on add/toggle; names suggest profiles +
   Transfer sub-categories; each other person's txn description = `Cat - Sub - Desc`).
6. **Investments** (`Investments.jsx`): platform grid → holdings → detail. Detail shows
   **invested amount, platform, folio/ID, dates, orders (investment-linked txns) and chit
   installments only** — NO price/NAV/P&L/chart. `InvestmentForm` records invested + dates +
   notes (+ chit fields). **No live-price code anywhere** (`src/lib/pricing.js` is an empty stub).
7. **Inbox** (`src/pages/SmsQueue.jsx`, route `/inbox`; `/sms` and `/statements` redirect):
   merged SMS + Statement. Paste SMS, (APK) auto-import + live listener, "Import statement"
   modal (`StatementImportModal` in `src/pages/Statements.jsx` — asks ONLY the account).
   Pending list (SMS + statement items), convert via the main sheet, prev/next/dismiss/processed,
   full-detail modal on dismissed/processed rows, "already in your books" flags.
   SMS parser: strong-verb tiers ("credited" beats "payment"); rejects spam.
8. **Statement parsing** (`src/lib/statement/`): on-device PDF/Excel/CSV. Handles slice
   (`DD MMM 'YY` dates, leading-minus debits), Kotak (serial-prefixed rows, opening-balance
   seeding), KBL Excel (multi-sheet scan, `DD-MMM` no-year via statement period). Reconciled,
   not directly imported.
9. **Settings**: Profiles; Accounts (+ aliases, per-profile balances — decimals/negatives OK);
   Categories (tree, rename=merge); Investments (read-only list, invested amounts);
   Preferences (theme / default profile / recent count / biometric lock — **no API keys**);
   Data (export/import, encrypted Drive sync).
10. **Export/Import**: `exportToFile()` in `src/lib/backup.js` — Android writes
    `Download/finsite/finsite-backup-<ts>.json` to the **public Downloads** folder via the
    native `FileExport` plugin (MediaStore on API 29+, no runtime permission; legacy direct
    write on API <=28) so it shows in the Downloads app & Recent files; falls back to
    `@capacitor/filesystem` (`Directory.External`) if MediaStore fails. Web does a Blob
    download. JS bridge: `src/lib/fileExport.js`. Import = file input (works in the Android
    WebView too).
11. **Drive sync**: AES-256-GCM + PBKDF2-SHA256 (200k) client-side encryption → `drive.appdata`.
    Passphrase never stored; before overwriting, `verifyPassphraseAgainstRemote` decrypts the
    existing backup to catch typos; first-ever backup asks to re-type.
12. **Biometric lock** (APK): `LockGate` wraps AppShell; re-locks 30s after backgrounding.

## Android / Capacitor
- `capacitor.config.json`: appId `com.finsight.app`.
- Native sources live in `android-patches/` (NOT a committed `android/`). `apply-patches.mjs`
  runs after `npx cap add android`: copies Kotlin plugins (SmsReader, BiometricAuth,
  **FileExport**) + MainActivity, adds permissions (SMS, notifications, foreground-service,
  biometric, **WRITE/READ_EXTERNAL_STORAGE**), deep-link intent-filters, the service decl,
  kotlin-android plugin, androidx.biometric.
- JS bridges: `src/lib/smsNative.js`, `src/lib/biometric.js`, `src/lib/fileExport.js` (no-op /
  throw on web; gate on `Capacitor.getPlatform()==='android'`).

## Deployment
- Web: push to `main` → Vercel (Vite). Env: `VITE_GOOGLE_CLIENT_ID`, `VITE_OAUTH_REDIRECT_URL`.
- APK: `.github/workflows/build-apk.yml` (Node + JDK17 + Android SDK; `npm install`,
  `npx cap add android`, patch script, `cap sync`, `gradlew assembleDebug`). No npm lockfile.

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — this session's batch ("Implement in order")
═══════════════════════════════════════════════════════════════════════

### ✅ DONE
**1. Android export → `finsite/`**: `exportToFile()` (Filesystem on Android, Blob on web) +
   storage perms in the patch script + `@capacitor/filesystem` in package.json. Data.jsx toasts
   the saved path.
   ⚠️ Caveat: `Directory.External` writes to the app's external storage
   (`Android/data/com.finsight.app/files/finsite/`) — reliable & permission-free, but NOT the
   *public* Downloads folder. True public-Downloads on Android 10+ needs MediaStore (fragile);
   ask the user if they want that instead.

**2. Removed ALL price/NAV tracking**: deleted pricing API usage (`pricing.js` stubbed);
   investments no longer use units/currentValue; HoldingDetail shows invested/date/orders/
   installments only (no chart/P&L/returns); removed price field from TransactionSheet + SMS
   convert; txnEffects only adjusts investedAmount; removed Alpha Vantage key (Preferences) and
   the AMFI/NAV tip (InvestmentsSettings).

**3. Simplified Home net worth**: one section, `(bank + invested) − liabilities` headline +
   3 components (Bank/Wallets, Invested, Liabilities). Removed the separate investment card.

**4. REORDERABLE ACCOUNTS**: added `sortOrder` to accounts (sorted in JS, no Dexie index);
   `@dnd-kit/core`+`/sortable`+`/utilities` in package.json. `Accounts.jsx` list wrapped in
   dnd-kit `DndContext`+`SortableContext` (verticalListSortingStrategy) with a `GripVertical`
   handle; drag end `arrayMove`s then persists `sortOrder = index` for all rows in one
   `db.transaction('rw', …)`. New accounts append with `sortOrder = max(existing ?? id) + 1`
   (editor receives `accounts`). New `accountSort(accounts)` in `src/lib/utils.js`
   (`(a.sortOrder ?? a.id) - (b.sortOrder ?? b.id)`) applied at every listing site: Home cards,
   TransactionSheet options, Transactions top select + bulk-edit, StatementImportModal, and the
   Accounts settings list itself.

**5. HOME DASHBOARD CHARTS** (`src/components/home/HomeCharts.jsx`, mounted below Recent
   Transactions; profile-aware, Indian ₹). Helpers added to utils: `transferCategoryIds`,
   `bucketStart`/`bucketLabel` (day/week-Monday/month).
   - **Chart A — diverging cash-flow bars**: Daily/Weekly/Monthly toggle; credits UP (green),
     debits DOWN (negative, red) from `ReferenceLine y={0}`, NET labelled per bucket; Transfer
     excluded. Horizontally scrollable, newest bucket RIGHT; scroll-left lazily widens the Dexie
     window (`where('dateTime').aboveOrEqual(windowStart)`) in pages, restoring scroll via
     `useLayoutEffect`, until the earliest txn is reached.
   - **Chart B — category spend donut**: Recharts `PieChart`+`Pie innerRadius`; Monthly/Yearly
     modes with this/previous/custom (month(s)/range or year(s)/range); center total; legend
     lists each category's ₹ amount + % of total. Transfer excluded; debits only.

### ⏳ PENDING — implement next (start here in the new chat)

_(none — items 1–5 of this batch are complete.)_

### General constraints (unchanged)
- Keep auth, profiles, alias mapping, auto-suggest, merge logic, SMS-queue foundation intact.
- ₹ INR Indian-format numbering throughout.
- No local build — push to Vercel (web) / GitHub Actions (APK). Dexie migrations run on load.
