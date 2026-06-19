# FinSight — Claude Code guide

App architecture, data model, and conventions live in **`FINSIGHT_CONTEXT.md`** — read it
first. This file documents repo-level **operational** setup (CI, signing, secrets) that isn't
part of the application code.

## Build & deploy
- **Web:** push to `main` → Vercel (Vite). Env: `VITE_GOOGLE_CLIENT_ID`, `VITE_OAUTH_REDIRECT_URL`.
- **APK:** `.github/workflows/build-apk.yml` (Node 20 + JDK 17 + Android SDK). There is **no
  committed `package-lock.json`** (gitignored); `package.json` carries an `overrides` block that
  pins a single React 18 across the tree so the lockfile-less install stays conflict-free.
- `android/` is **not** committed — it's generated each CI run by `npx cap add android`, then
  patched by `android-patches/apply-patches.mjs` (SMS/biometric/file-export plugins, manifest
  permissions, Kotlin, **and the release signing config + version** below).

## Android APK signing — consistent signature for in-place updates
**Problem this solves:** `assembleDebug` signs each build with a freshly auto-generated debug
key, so every CI APK had a *different* signature and Android refused to install it over a
previously installed copy ("App not installed / package conflict"). Now **every build is signed
with one fixed keystore** and uses a **monotonically increasing `versionCode`**, so a new APK
installs in place over the old one and is never seen as a downgrade.

**How it works (end to end):**
1. The workflow decodes the `ANDROID_KEYSTORE_B64` secret into `android/app/release.keystore`
   (right after `npx cap add android`). The job fails fast with a clear message if the secret
   is missing.
2. `apply-patches.mjs` injects a `signingConfigs.release { … }` into `android/app/build.gradle`
   — `storeFile file("release.keystore")` with `storePassword` / `keyAlias` / `keyPassword`
   read from the **environment** — and applies it to the `release` build type (with
   `minifyEnabled false`, so no R8/Proguard stripping of the reflection-registered native
   plugins). The injection is idempotent and re-runs on every CI build because `android/` is
   regenerated each time.
3. The workflow builds `./gradlew assembleRelease -PversionCode=<run_number> -PversionName=<…>`,
   passing the keystore passwords as env vars. `build.gradle` reads those Gradle properties
   (falling back to `1` / `"1.0"` for a plain local build). **`versionCode` = the CI run number**,
   so it always increases; `versionName` is the git tag (for `v*` builds) else `1.0.<run_number>`.
4. The signed APK at `app/build/outputs/apk/release/app-release.apk` is copied to
   `out/finsight.apk` — uploaded as a workflow artifact and attached to the GitHub Release on
   `v*` tags. (If signing fails, an *unsigned* APK is produced instead and the workflow errors
   on the missing `app-release.apk`.)

### Required GitHub Actions secrets

**Why these exist (plain English).** To produce an installable `.apk`, the CI workflow must
*digitally sign* it. The signature comes from a private key kept in a small binary file called a
**keystore**. GitHub can't safely hold a binary file or your passwords inside the repo, so you
hand them to the workflow as four encrypted **repository secrets**. The workflow reads them only
at build time (`build-apk.yml` → "Decode signing keystore" + "Build signed release APK"); they're
never printed and never live in the code. You add them **once** — after that every APK is signed
with the same key, so new versions install over old ones (no "App not installed / package
conflict").

| Secret name (type it EXACTLY) | What to put in it | Where the value comes from |
| --- | --- | --- |
| `ANDROID_KEYSTORE_B64` | The keystore file converted to one long line of base64 **text** | the `release.keystore.b64` you make in Step 2 |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore (store) password | the `-storepass` you choose in Step 1 |
| `ANDROID_KEY_ALIAS` | The key's alias (its name inside the keystore) | the `-alias` from Step 1 (e.g. `finsight`) |
| `ANDROID_KEY_PASSWORD` | The key password — for PKCS12 keystores this is the **same** as the store password | set equal to `ANDROID_KEYSTORE_PASSWORD` |

Plus two more secrets used for Google Drive sign-in (they're compiled into the web bundle that
ships inside the APK): `VITE_GOOGLE_CLIENT_ID` and `VITE_OAUTH_REDIRECT_URL`. If you don't use
Drive sync yet, you can set them to any placeholder string — the APK still builds.

#### Quick run — all commands in order (Windows PowerShell)
Replace `<PW>` with one password you choose (the SAME value is used for store + key, per the
PKCS12 rule below). Adjust the `keytool.exe` path / repo path to your machine.
```powershell
# 1) Go to your repo (a writable folder — NOT C:\WINDOWS\system32)
cd "C:\Users\2407474\OneDrive - Cognizant\Cognizant\Claude\FinSight"

# 2) Create the keystore (PKCS12 → omit -keypass; store password is reused as the key password)
& "C:\Program Files\Android\openjdk\jdk-21.0.8\bin\keytool.exe" -genkeypair -v `
  -keystore release.keystore -alias finsight `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass "<PW>" `
  -dname "CN=FinSight, O=FinSight, C=IN"

# 3) Base64-encode it (sync .NET's working dir to PowerShell's first)
[Environment]::CurrentDirectory = $PWD.Path
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) |
  Out-File -NoNewline -Encoding ASCII release.keystore.b64

# 4) Sanity check — both files exist; .b64 should be a few thousand chars
Get-Item release.keystore, release.keystore.b64 | Select-Object Name, Length

# 5) Copy the base64 TEXT to the clipboard, then Ctrl+V into the ANDROID_KEYSTORE_B64 secret box
Get-Content release.keystore.b64 -Raw | Set-Clipboard
```
Then add the secrets (Step 3 below): `ANDROID_KEYSTORE_B64` = paste, `ANDROID_KEYSTORE_PASSWORD`
= `<PW>`, `ANDROID_KEY_ALIAS` = `finsight`, `ANDROID_KEY_PASSWORD` = `<PW>`. The annotated
step-by-step versions of each command follow.

#### Step 1 — create the keystore (do this ONCE, then keep the file forever)
`keytool` ships with the Java JDK (any modern JDK works just to *create* the keystore — the
format is JDK-version-independent; CI still builds with JDK 17). It lives in the JDK's `bin`
folder.

> **"keytool : The term 'keytool' is not recognized…"** means the JDK isn't on your PATH (not
> that it's missing). On Windows the Android tooling bundles one — find it with:
> ```powershell
> Get-ChildItem "C:\Program Files\Android" -Recurse -Filter keytool.exe -ErrorAction SilentlyContinue | Select FullName
> ```
> e.g. `C:\Program Files\Android\openjdk\jdk-21.0.8\bin\keytool.exe`. Then either call it by full
> path (`& "<that path>" -genkeypair …`) or add its folder to PATH for the session first:
> `$env:Path = "C:\Program Files\Android\openjdk\jdk-21.0.8\bin;$env:Path"`.

Choose your own two passwords and run:

> **Run this from a folder you can write to** (your repo root), NOT `C:\WINDOWS\system32` — a
> system folder is read-only for normal users and `keytool` fails with
> `java.io.FileNotFoundException: release.keystore (Access is denied)`. `cd` first:
> `cd "C:\Users\<you>\…\FinSight"`. The file is gitignored (`*.keystore`), so it's safe to write
> it inside the repo; move it to a backup afterward.

> **PKCS12 keystores require the store and key password to be the SAME.** Modern `keytool`
> creates PKCS12 and prints *"Different store and key passwords not supported for PKCS12
> KeyStores. Ignoring user-specified -keypass value."* — harmless. Just omit `-keypass` (below)
> and set the secret **`ANDROID_KEY_PASSWORD` equal to `ANDROID_KEYSTORE_PASSWORD`**.

Windows (PowerShell — backtick `` ` `` is the line-continuation; use the full path to
`keytool.exe` if it isn't on PATH):
```powershell
cd "C:\Users\<you>\…\FinSight"
keytool -genkeypair -v `
  -keystore release.keystore -alias finsight `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass "<PW>" `
  -dname "CN=FinSight, O=FinSight, C=IN"
```
macOS / Linux:
```bash
keytool -genkeypair -v \
  -keystore release.keystore -alias finsight \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass '<PW>' \
  -dname "CN=FinSight, O=FinSight, C=IN"
```
This writes `release.keystore` in the current folder. With the values above:
`ANDROID_KEY_ALIAS = finsight`, and `ANDROID_KEYSTORE_PASSWORD = ANDROID_KEY_PASSWORD = <PW>`
(same value, because of the PKCS12 rule above).

#### Step 2 — base64-encode the keystore (turns the binary file into one line of text)
Windows (PowerShell):
```powershell
[Environment]::CurrentDirectory = $PWD.Path
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) |
  Out-File -NoNewline -Encoding ASCII release.keystore.b64
```

> **Gotcha:** raw .NET calls like `[IO.File]::ReadAllBytes` do NOT follow PowerShell's `cd` — they
> use .NET's own working directory (often still `C:\WINDOWS\system32`), so a relative path errors
> with *"Could not find file 'C:\WINDOWS\system32\release.keystore'"* even though `keytool` just
> wrote it to your repo folder. The `[Environment]::CurrentDirectory = $PWD.Path` line above syncs
> them; alternatively pass an absolute path, e.g. `…ReadAllBytes("$PWD\release.keystore")`.

macOS: `base64 -i release.keystore | tr -d '\n' > release.keystore.b64`
Linux: `base64 -w0 release.keystore > release.keystore.b64`

The entire contents of `release.keystore.b64` is the value for `ANDROID_KEYSTORE_B64`.

#### Step 3 — add the four secrets to GitHub
First copy the base64 to your clipboard (more reliable than opening the file and selecting — no
risk of a partial copy or a stray newline):
```powershell
Get-Content release.keystore.b64 -Raw | Set-Clipboard
```
(Or open it with `notepad release.keystore.b64`, then Ctrl+A → Ctrl+C. It's one long unbroken
line of letters/digits/`+`/`/` ending in maybe `=` — no spaces or line breaks.)

**Easiest — the website (no CLI needed):**
1. Go to `https://github.com/Prashanth-365/FinSight/settings/secrets/actions`
   (repo → **Settings** → **Secrets and variables** → **Actions**).
2. Click **New repository secret**.
3. **Name** = the exact secret name from the table; **Secret** = its value
   (for `ANDROID_KEYSTORE_B64`, just **Ctrl+V** the clipboard contents from above).
4. Click **Add secret**. Repeat until all four (and the two `VITE_*`) exist.

**Or with GitHub CLI** (`gh auth login` first):
```powershell
gh secret set ANDROID_KEYSTORE_B64       --body (Get-Content release.keystore.b64 -Raw)
gh secret set ANDROID_KEYSTORE_PASSWORD  --body "<PW>"
gh secret set ANDROID_KEY_ALIAS          --body "finsight"
gh secret set ANDROID_KEY_PASSWORD       --body "<PW>"   # same <PW> as the store password (PKCS12)
```

#### Step 4 — trigger a build
Push to `main`, push a `v*` tag, or go to **Actions → Build Android APK → Run workflow**. The
signed APK is uploaded as the `finsight-apk` artifact (and attached to the GitHub Release on `v*`
tags). If a secret is missing, the "Decode signing keystore" step **fails fast** with a clear
error telling you which one.

> ⚠️ **The keystore is the app's identity.** Back up `release.keystore` and its passwords
> somewhere safe — if you ever lose them you can no longer ship an update that installs over
> existing installs (users would have to uninstall first). **Never commit the keystore or its
> base64** — `*.keystore`, `*.jks`, and `*.keystore.b64` are gitignored, and the file is only
> ever written inside the CI runner.
