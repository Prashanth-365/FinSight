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
- @dnd-kit/core + /sortable + /utilities (drag-to-reorder accounts)
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
  `fmtDateTime`, `maskNumber`, `uid`, `aliasMatchesAccountNumber`, `computeAccountEffects`/
  `deriveAccountBalance` (derived balances — see invariant below; `getAccountBalance` remains
  only as the legacy reader), `inferInvestmentPlatform`, `txnFingerprint`, `accountSort`,
  `transferCategoryIds`, `bucketStart`/`bucketLabel` (day/week-Monday/month).

## Data model (Dexie, current version = 5)
Tables: `users`, `profiles`, `accounts`, `categories`, `transactions`, `investments`,
`chitFunds`, `smsQueue`, `statements`, `settings` (key-value).
- **accounts**: `{ name, type: bank|card|wallet|cash, number, aliases:[masked], color, isActive,
  profileIds:[], openingBalances:{ [profileId]: number }, sortOrder }`. Per-profile balances
  are **DERIVED** (`openingBalance + Σ txn effects`), never stored as a running total — see the
  invariant below. **Opening balance is entered PER PROFILE** in the add/edit-account form (one
  input per selected profile; a read-only total shows when >1). (`balances`/`balance` are legacy
  fields, migrated to `openingBalances` on load by `ensureOpeningBalances`; old backups are
  backfilled on restore.) Removing a profile that still has transactions on the account is blocked.
  `sortOrder` (added v0.2.5) drives drag-to-reorder; sorted in JS via `accountSort` (no Dexie
  index). **`type:'cash'`** is just another account type — an asset like bank/wallet (grouped under
  Bank/Cash/Wallets in net worth); for cash the account number + SMS aliases are hidden in the form.
  (No auto-created Cash account; the user adds one if they want it.)
- **categories**: `{ name, parentId(null=top), icon, color, type: expense|income|investment|transfer }`.
  Tree. Rename-to-existing = MERGE. Seeded set includes a **Transfer** top-level category.
- **transactions**: `{ slNo, dateTime, profileId, accountId, categoryId, subCategoryId,
  amount, txnType: debit|credit, paymentMode, description, tags:[], source: manual|sms|statement,
  investmentId, splitGroupId, splitTotal, importFingerprint,
  transferType: 'self'|'person'|null, counterpartAccountId }`. `slNo` re-sequenced by `reindexSlNo()`.
  The two transfer fields are **UNINDEXED properties** (no schema bump) — see the **Transfers**
  section below.
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

## CRITICAL invariant — balances are DERIVED (single source of truth)
**Account balances are computed live from the transactions table, never stored.** An account's
current balance for a profile = `openingBalances[profileId] + Σ effects` where a credit adds and
a debit subtracts (`utils.computeAccountEffects(txns)` → `Map<accountId,{[pid]:delta}>`, then
`utils.deriveAccountBalance(account, accountEffects, profileId|null)`; `profileId == null` sums
all profiles for the master view). Every screen reads this via `useLiveQuery(db.transactions…)` +
a `useMemo`, so balances + net worth recompute on **any** DB change — no matter which path (single
add/edit/delete, bulk edit incl. profile change, bulk delete, SMS convert, import/restore) caused
it. There is no per-path balance adjustment to forget. (This replaced a stored running-balance
model where the multiselect bulk-edit and delete paths bypassed the recalc and left balances stale.)

`src/db/txnEffects.js` now owns only what can't be purely derived:
- `applyTransactionEffects(txn, +1|-1)` — adjusts a linked **investment's `investedAmount`** only
  (a hybrid: also set by hand in `InvestmentForm`, so not derivable). Edit = reverse old (`-1`)
  then apply new (`+1`).
- `deleteTransaction(id)` / `deleteTransactions(ids)` — reverse effects, delete, reindex.
- `updateTransactions(ids, patch|fn)` — the bulk-edit service: per row, reverse old effect →
  write patch → apply new effect (keeps investment amounts right; balances re-derive for free).
- `ensureOpeningBalances()` — idempotent migration: any account lacking `openingBalances` gets
  `opening = currentStoredBalance − Σ effects`, preserving its displayed total exactly
  (`derived = opening + effects = current`). Runs on app load (`seed.js`) and after import
  (`backup.js`). Settings → Accounts edits the **current** balance and stores `opening = entered − effects`.
The Settings → Accounts editor, Home (cards + net worth), and the TransactionSheet account picker
all read balances through `deriveAccountBalance`. Transfer legs are ordinary transactions, so they
flow through this same derived-balance path with no special handling.

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
3. **Home**: single **Net Worth** section — headline `(bank/cash + invested) − liabilities`, with
   three components below: Bank/Cash/Wallets (assets incl. cash), Invested, Liabilities (card
   outstanding). Per-account cards (eye-toggle, drag-ordered via `accountSort`; **tap a card →
   Transactions filtered to that account**), recent txns, then **dashboard charts**
   (`HomeCharts.jsx`): diverging cash-flow bars + category-spend donut whose **legend rows are
   tappable → Transactions filtered to that category over the donut's active date range** (see v0.2.5
   + v0.2.6 entries). Both charts EXCLUDE the **Transfer** category (so internal money movement
   doesn't distort spend/income).
4. **Transactions**: filters drawer (Sheet), infinite scroll, tap → detail, long-press →
   multi-select + bulk-edit, delete. Balances re-derive automatically (no per-path recalc).
   **Active-filter chips** above the list show every applied filter and clear individually (+
   "Clear all"). Initializes its filter state from inbound `location.state.filters` (set by the
   Home card / donut-legend taps), applies it immediately, then clears the history state.
5. **Transaction entry** (`TransactionSheet.jsx`): auto-suggest comboboxes; investment
   auto-link (category type=investment → holding picker creates/links an investment, adjusting
   its investedAmount); **splits** (equal auto-split on add/toggle; names suggest profiles +
   Transfer sub-categories; each other person's txn description = `Cat - Sub - Desc`).
   **Transfers** live in this same popup, driven by category — see the Transfers section below.
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

## Opening balances, Transfers & Cash

**Per-account / per-profile opening balances.** An account belongs to ≥1 profiles; the add/edit
form shows one opening-balance input per selected profile (`openingBalances[profileId]`), plus a
read-only total when >1. Balances are derived + profile-aware:
`balance(account, profile) = opening(account, profile) + Σ(credits − debits by that profile)`;
account total = Σ across profiles. **Master view** shows each account's total; a **profile view**
shows only that profile's balance and only accounts that include the profile. The editor edits the
**current** balance per profile and back-solves opening (`opening = entered − Σ effects`); adding a
profile defaults its opening to 0; removing a profile that has transactions on the account is
blocked. Card accounts: opening = starting outstanding; cards stay liabilities.

**Transfers — entirely inside the add-transaction popup (`TransactionSheet.jsx`), driven by
category.** No separate transfer form, no contact ledger. When the category is **"Transfer"**, two
buttons appear — **Self | Person** — and the choice is stored as `transferType` on the row:
- **PERSON** → the sub-category is a free-typed name with autosuggest, exactly like a normal
  transaction. Saves a single row. No mirror, no prompt.
- **SELF** → the sub-category becomes a **dropdown of all accounts except the one already chosen**
  (the counterpart). The chosen account's name is stored as the sub-category, and its id as
  `counterpartAccountId` (unindexed, for robust edit/repopulate). On save, a confirm prompt asks
  *"Also log this in <counterpart>?  <flipped type> ₹<amount>"*:
    - **Yes** → auto-creates the **mirror** row: `txnType` flipped (debit↔credit), `accountId` =
      counterpart, sub-category = the original account's name, same amount/profile/date/description,
      category Transfer, `transferType:'self'`, `counterpartAccountId` = the original account.
    - **No / Cancel** → only the entered row is saved.
  Example: `{debit, 5000, KBL, sub HDFC}` → mirror `{credit, 5000, HDFC, sub KBL}`. Cash moves are
  just self transfers where one side is the Cash account (e.g. `{debit, 1000, Cash, sub HDFC}` →
  `{credit, 1000, HDFC, sub Cash}` = cash deposited to HDFC).
The two legs are **independent rows** (no shared transferId) — delete/edit each on its own.
**Converting** an existing row to Transfer › Self runs the same flow: edit it, set category Transfer
+ Self + counterpart, save → the same mirror prompt fires (it does NOT re-prompt when re-editing a
row that was already a self transfer, to avoid duplicate mirrors). Helpers: `isTransferCategory`,
`createMirror`, and the `pendingMirror` ConfirmDialog in `TransactionSheet.jsx`.

**Charts** exclude the **Transfer** category from spend/income (unchanged — `transferCategoryIds`
in `HomeCharts.jsx`), so transfers never distort the cash-flow bars or spend donut.

**Cash.** `accounts.type:'cash'` is just another account type — an asset like bank/wallet (its
number + SMS aliases are hidden in the editor). It shows in the account picker, in the SELF
counterpart dropdown, and as a Home card. A plain cash spend/income is a NORMAL transaction on the
Cash account (counts in charts); moving cash to/from a bank is simply a SELF transfer. There is no
auto-created Cash account, no withdraw/deposit shortcut, and no reconcile flow — the user just adds
a Cash account and uses normal transactions + transfers.

## Android / Capacitor
- `capacitor.config.json`: appId `com.finsight.app`.
- Native sources live in `android-patches/` (NOT a committed `android/`). `apply-patches.mjs`
  runs after `npx cap add android`: copies Kotlin plugins (SmsReader, BiometricAuth,
  **FileExport**) + MainActivity, adds permissions (SMS, notifications, foreground-service,
  biometric, **WRITE/READ_EXTERNAL_STORAGE**), deep-link intent-filters, the service decl,
  kotlin-android plugin, androidx.biometric, **and a fixed release `signingConfig` +
  CI-driven `versionCode`/`versionName`** (so every APK shares one signature and installs
  in-place — see CLAUDE.md → Android signing).
- JS bridges: `src/lib/smsNative.js`, `src/lib/biometric.js`, `src/lib/fileExport.js` (no-op /
  throw on web; gate on `Capacitor.getPlatform()==='android'`).

## Deployment
- Web: push to `main` → Vercel (Vite). Env: `VITE_GOOGLE_CLIENT_ID`, `VITE_OAUTH_REDIRECT_URL`.
- APK: `.github/workflows/build-apk.yml` (Node + JDK17 + Android SDK; `npm install`,
  `npx cap add android`, decode keystore → patch script → `cap sync` → `gradlew assembleRelease`,
  signed with one fixed keystore so updates install in-place, `versionCode` = CI run number).
  Output `out/finsight.apk`. Requires the `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` /
  `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` secrets — see CLAUDE.md → Android signing. No npm
  lockfile (`package-lock.json` is gitignored; CI installs fresh).
- **Dependency toolchain (pinned to React 18 / Vite 5).** Because there's no committed lockfile,
  `package.json` has an `overrides` block (`"react": "$react"`, `"react-dom": "$react-dom"`) that
  forces a single React 18 across the whole transitive tree — without it a fresh `npm install`
  could hoist a stray React 19 and throw `ERESOLVE`. Do **not** bump `@vitejs/plugin-react` to v6+
  (its peer is `vite@^8`) or `vite`/`tailwind`/`react` to their next majors without a deliberate
  framework migration — that's the conflict behind "couldn't update — conflicts in packages". See
  the v0.2.6 entry.

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — transfers (in-popup, category-driven) + cash type
═══════════════════════════════════════════════════════════════════════

### ✅ DONE — validated locally (`npm run build` clean + Vite preview e2e)

Deliberately **simple**: transfers live entirely inside the existing add-transaction popup, driven
by category + sub-category. **No separate transfer form, no contact ledger, no cash
deposit/withdraw shortcuts, no reconcile, no Dexie schema bump** (an earlier, more elaborate
version with a `contacts` table / People page / `TransferSheet` was reverted to this).

**Schema.** No version change (still v5). `transactions` carry two **unindexed** properties —
`transferType: 'self'|'person'|null` and `counterpartAccountId`. `accounts.type` gains `'cash'`.

**1. Opening balances (per account, per profile).** Unchanged storage (`openingBalances`); the
editor now also shows a read-only total across profiles and blocks removing a profile that still
has transactions on the account.

**2. Transfers in `TransactionSheet.jsx`.** Category "Transfer" → **Self | Person** buttons
(`transferType`). Person = today's name sub-category, single row. Self = sub-category becomes an
account dropdown (all accounts except the current); on save a ConfirmDialog offers to create the
**mirror** in the counterpart (flipped type, swapped sub-category) — Yes creates it, No saves only
the entered row. The two legs are independent (no shared id). Converting an existing row to
Transfer › Self runs the same prompt. Charts still exclude the Transfer category (`HomeCharts.jsx`
unchanged).

**3. Cash.** `'cash'` is just another account type (`Accounts.jsx` — number/aliases hidden); it
appears in pickers, the self-counterpart dropdown, and as a Home card. Cash spends are normal
transactions; cash↔bank moves are self transfers. No special cash handling beyond the type.

**E2E verified** in the Vite preview (fresh v5 DB): seeded KBL ₹10k / HDFC ₹5k / Cash ₹2k →
net worth ₹17k. SELF `{debit 5000, KBL, sub HDFC}` + **Yes** → mirror `{credit 5000, HDFC, sub KBL}`
(KBL ₹5k, HDFC ₹10k, net worth unchanged). SELF `{debit 1000, Cash, sub HDFC}` + **Cancel** → only
the Cash row, no mirror. PERSON `{debit 500, KBL, sub Ravi}` → single row, no prompt. Donut excludes
transfers. No console errors.

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — this session's batch ("Implement in order")
═══════════════════════════════════════════════════════════════════════

### ✅ DONE
_(Items 1–3 shipped in **v0.2.4**; items 4–5 shipped in **v0.2.5** — both pushed to `origin/main` and tagged. See per-release entries below for the condensed summaries.)_

**1. Android export → `finsite/`**: `exportToFile()` (Filesystem on Android, Blob on web) +
   storage perms in the patch script + `@capacitor/filesystem` in package.json. Data.jsx toasts
   the saved path.
   ✅ UPDATE (v0.2.4): now writes to the **public** `Download/finsite/` folder via the native
   `FileExport` plugin (MediaStore on API 29+, legacy direct write on API ≤28) so exports show
   in the Downloads app & Recent files; falls back to `Directory.External` if MediaStore fails.
   See the v0.2.4 session entry below.

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

_(none — items 1–5 of this batch are complete; items 4–5 pushed to `origin/main`, tagged `v0.2.5`.)_

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — app icon refresh (new FinSight lens/trend icon)
═══════════════════════════════════════════════════════════════════════

Replaced the default/old icon with the new FinSight mark (white lens + upward
trend line on a `#2563EB`→`#06B6D4` blue→cyan gradient) across the APK and PWA.

- **New committed source images in `assets/`** (read by `@capacitor/assets`):
  `icon-only.png`, `icon-foreground.png`, `icon-background.png` (all 1024×1024).
- **`@capacitor/assets` ^3.0.5** added to `package.json` devDependencies.
- **APK icons are generated in CI, not committed.** `android/` is regenerated each
  run, so `.github/workflows/build-apk.yml` gained a **"Generate launcher icons
  (Android)"** step (`npx @capacitor/assets generate --android`) that runs after the
  patch script and before `cap sync`. It regenerates `ic_launcher`,
  `ic_launcher_round`, the adaptive foreground/background, and every `mipmap-*`
  density, so the old icon is fully replaced on install. (Only icon assets are
  provided — no splash — so the tool generates icons and skips splash.)
- **PWA:** `public/finsight-insight-512.png` (512, purpose `any`) +
  `public/finsight-insight-maskable-1024.png` (1024, purpose `maskable`) now back the
  `vite.config.js` `VitePWA` manifest `icons` (the old `/icon-192.svg` + `/icon-512.svg`
  entries and files were removed). `public/favicon.svg` was replaced with the new vector
  mark (browser tab). **Cache bumped** via `workbox.cacheId: 'finsight-v2'` so installed
  PWAs (registerType `autoUpdate`) fetch the new icon instead of the cached old one.

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — v0.2.6 (derived balances + dep fix + click-to-filter)
═══════════════════════════════════════════════════════════════════════

### ✅ DONE — validated locally (clean `npm install` + `npm run build` + Vite preview e2e)

**1. Dependency conflict ("couldn't update — conflicts in packages").** The hard `ERESOLVE` was
`@vitejs/plugin-react@6` (what "update to latest" pulls) peer-requiring `vite@^8` while the project
is pinned to `vite@^5`. Because there's no committed lockfile, a fresh `npm install` could also
hoist a transitive `react@19` (the `ERESOLVE overriding peer dependency` churn from dnd-kit /
react-router / recharts). **Fix (root cause, not `--force`):** kept the toolchain aligned on the
supported **React 18 / Vite 5** line (a jump to Vite 8 / React 19 / Tailwind 4 is an unrequested,
breaking framework migration), and added an **`overrides`** block (`"react": "$react"`,
`"react-dom": "$react-dom"`) so the lockfile-less CI/Vercel install resolves a single React 18
deterministically. Bumped `@vitejs/plugin-react` to `^4.3.4` (still v4). `package-lock.json` added
to `.gitignore`. Verified: `rm -rf node_modules package-lock.json && npm install` (no ERESOLVE),
`npm run build` (ok), `npm update` (exit 0).

**2. Balances are now a DERIVED single source of truth** (fixes "balances not updating on bulk-edit
and delete"). Root cause: the old model stored a running balance and mutated it per-path; the
multiselect **bulk-edit** wrote `db.transactions.update` directly and the delete paths reversed a
possibly-never-applied effect, so balances drifted. Rebuilt per the invariant section above:
- `utils.js`: new `computeAccountEffects` + `deriveAccountBalance`; removed `applyTxnDeltaToBalances`.
- `txnEffects.js`: dropped the account-balance mutation (kept investment `investedAmount`); added
  `updateTransactions` (bulk-edit service: reverse→patch→apply) and `ensureOpeningBalances`
  (idempotent `opening = current − Σeffects` migration; preserves displayed totals exactly).
- New accounts store `openingBalances`; the Settings → Accounts editor reads/writes the **current**
  balance and back-solves opening. Home (net worth + cards), the TransactionSheet picker and the
  Accounts list all read `deriveAccountBalance` off a live `useMemo(computeAccountEffects(txns))`.
- Migration wired into `seed.seedIfEmpty` (app load) and `backup.restoreAll` (after import).
- **Audited every mutation path** — single add/edit (TransactionSheet), single+bulk delete, bulk
  edit (incl. profile change), SMS→txn convert, import/restore: all now stay consistent because the
  balance is recomputed from the transactions table on every change.

**3. Additional bug found & fixed.** The old bulk-edit also bypassed investment bookkeeping, so a
bulk `txnType` flip on an investment-linked row left `investedAmount` wrong — now routed through
`updateTransactions` (reverse+apply). Verified consistent (no change needed): donut + cash-flow bars
both exclude `categoryId ∈ transferCategoryIds`; category merge/rename and import/restore already
propagate via `useLiveQuery` (no cached aggregates remain besides the now-derived balance).

**4 & 5. Click-to-filter navigation.** Tapping a donut **legend row** (`HomeCharts.jsx`) navigates
to `/transactions` with `{ state: { filters: { categoryId, from, to } } }` (the donut's active
period → concrete `from`/`to` dates). Tapping a Home **account card** navigates with
`{ filters: { accountId } }`. `Transactions.jsx` initializes its filter state from
`location.state.filters` (replacing the whole set over `EMPTY_FILTERS`), applies it immediately,
clears the history state, and renders a new clearable **active-filter chip bar** (`ActiveFilters`).

**E2E verified** in the Vite preview: master ₹1,050 / Alice ₹550 / Bob ₹500 derived correctly;
bulk-moving Alice's txns→Bob updated both live (Alice→₹1,000, Bob→₹50); delete updated live
(Bob→₹350); account-card and donut-legend taps applied the right filters + chips; a seeded legacy
account (`balances`, no `openingBalances`) migrated to `openingBalances` while its displayed total
stayed identical.

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — v0.2.5 (reorderable accounts + Home dashboard charts)
═══════════════════════════════════════════════════════════════════════

### ✅ DONE — pushed to `origin/main`, tagged `v0.2.5`
Implements batch items **4 (reorderable accounts)** and **5 (Home dashboard charts)**.
Commit `3c3303f` — 9 files changed (8 modified + 1 new), +653 / −78.

**Reorderable accounts (drag-and-drop).**
- **`package.json`**: added `@dnd-kit/core` ^6.1.0, `@dnd-kit/sortable` ^8.0.0,
  `@dnd-kit/utilities` ^3.2.2 (resolved by CI/Vercel `npm install`; no local node_modules).
- **`src/lib/utils.js`**: new `accountSort(accounts)` →
  `(a.sortOrder ?? a.id) - (b.sortOrder ?? b.id)` (stable, no Dexie index).
- **`src/pages/Settings/Accounts.jsx`**: list wrapped in dnd-kit `DndContext` +
  `SortableContext` (verticalListSortingStrategy); `SortableAccountRow` with a `GripVertical`
  activator handle (`setActivatorNodeRef`); Pointer/Touch/Keyboard sensors (small activation
  distance so Edit/Delete still tap). `onDragEnd` `arrayMove`s an optimistic local order then
  persists `sortOrder = index` for all rows in one `db.transaction('rw', db.accounts, …)`. New
  accounts append with `sortOrder = max(existing sortOrder ?? id) + 1` (editor now receives
  `accounts`).
- **`accountSort` applied at every listing site**: Home cards (`filteredAccounts`),
  `TransactionSheet` options, `Transactions` top filter select + `BulkEditModal` select,
  `StatementImportModal` select, and the Accounts settings list itself.

**Home dashboard charts (`src/components/home/HomeCharts.jsx`, new).** Mounted below Recent
Transactions in `src/pages/Home.jsx`; profile-aware (ProfileContext), Indian ₹. Helpers added
to `src/lib/utils.js`: `transferCategoryIds(categories)` (top-level "Transfer" + children id
set) and `bucketStart`/`bucketLabel` (day / week-from-Monday / month).
- **Chart A — diverging cash-flow bars**: Daily/Weekly/Monthly toggle; credits UP (green),
  debits DOWN (stored negative, red) from Recharts `ReferenceLine y={0}`; NET labelled per
  bucket via a custom `LabelList`. Transfer excluded. Horizontally scrollable, newest bucket on
  the RIGHT; scroll-left lazily widens the Dexie window
  (`where('dateTime').aboveOrEqual(windowStart)`) in pages, restoring scroll position via
  `useLayoutEffect`, until the earliest (profile-aware) txn is reached.
- **Chart B — category spend donut**: Recharts `PieChart` + `Pie innerRadius`; Monthly/Yearly
  modes with this / previous / custom (month(s)/range or year(s)/range); center shows total
  spend; legend lists each category's ₹ amount + % of total. Transfer excluded; debits only.
- ⚠️ Validated via the language service (`get_errors`) only — there is no local Node/`npm`, so
  the full Vite build runs on Vercel; the new `@dnd-kit/*` deps install there.

═══════════════════════════════════════════════════════════════════════
## CHANGE LOG — v0.2.4 (export to public Downloads)
═══════════════════════════════════════════════════════════════════════

### ✅ DONE — pushed to `origin/main`, tagged `v0.2.4`
**Public-Downloads export (fixes "export not in Recent files").** The old export used
`@capacitor/filesystem` `Directory.External`, which lands in the app's *private* external
storage (`Android/data/com.finsight.app/files/finsite/`) — hidden from the Downloads app and
media index. Now exports go to the **public** `Download/finsite/` folder.
- **New `android-patches/FileExportPlugin.kt`** (`@CapacitorPlugin(name="FileExport")`) with
  `saveToDownloads({ fileName, data, subDir, mimeType })`: MediaStore Downloads collection on
  API 29+ (no runtime permission, indexed immediately, `IS_PENDING` flip); legacy
  `Environment.DIRECTORY_DOWNLOADS` write on API ≤28.
- **New `src/lib/fileExport.js`** JS bridge (`registerPlugin('FileExport', …)`; web stub
  throws so callers fall back to Blob download).
- **`src/lib/backup.js`** `exportToFile()` tries `saveToDownloads(...)` first (→
  `Download/finsite/finsite-backup-<ts>.json`) and **falls back** to the old `Directory.External`
  write if MediaStore throws (export never hard-fails).
- **`android-patches/MainActivity.java`** registers `FileExportPlugin`.
- **`android-patches/apply-patches.mjs`** copies `FileExportPlugin.kt` into the package folder
  (added to the plugin-sources loop). No new permissions needed (existing
  `WRITE_EXTERNAL_STORAGE maxSdkVersion=28` covers legacy; API 29+ needs none for MediaStore).
- **`src/pages/Settings/Data.jsx`** toast now reads `Saved to Downloads → …`.
- **`.gitignore`** now ignores `.vs/` (Visual Studio folder).
- ⚠️ Kotlin plugin only runs in the APK (built by GitHub Actions) — verify on a device that the
  file appears in **Downloads → finsite** and Recent files.

### ⚠️ KNOWN ISSUE / SETUP — Drive sign-in needs `VITE_OAUTH_REDIRECT_URL`
Symptom: signing in for Drive sync errors with *"OAuth redirect URL not configured. Set
`VITE_OAUTH_REDIRECT_URL` to your Vercel URL + /oauth-redirect.html."* This is **config, not a
code bug** — `nativeRequestToken()` in `src/lib/googleAuth.js` requires `ENV_REDIRECT_URL`.
- The Android OAuth flow (Chrome Custom Tab → `oauth-redirect.html` → deep link
  `com.finsight.app://oauth-success#access_token=…`) needs a **publicly hosted**
  `oauth-redirect.html` (the file lives at `public/oauth-redirect.html`, served by Vercel).
- **Fix:** set env var `VITE_OAUTH_REDIRECT_URL = https://<your-vercel-host>/oauth-redirect.html`
  for BOTH the Vercel web build and the GitHub Actions APK build (it's compiled into the bundle
  at build time, so the APK must be rebuilt after setting it). Also set `VITE_GOOGLE_CLIENT_ID`.
- In Google Cloud Console, add that exact redirect URL to the OAuth Client's authorized redirect
  URIs and enable the Drive API.
- Web fallback: if unset, `googleAuth.js` defaults to `${window.location.origin}/oauth-redirect.html`
  (works for the web build, but the APK has no web origin, hence the explicit env var requirement).

### General constraints (unchanged)
- Keep auth, profiles, alias mapping, auto-suggest, merge logic, SMS-queue foundation intact.
- ₹ INR Indian-format numbering throughout.
- No local build — push to Vercel (web) / GitHub Actions (APK). Dexie migrations run on load.
