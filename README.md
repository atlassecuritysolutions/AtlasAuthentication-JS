# Atlas Authentication — Node.js / Electron SDK

**Website** · [atlassecurity.site](https://atlassecurity.site) &nbsp;|&nbsp; **Docs** · [atlassecurity.site/docs](https://atlassecurity.site/docs) &nbsp;|&nbsp; **Plans** · [atlassecurity.site/plans](https://atlassecurity.site/plans) &nbsp;|&nbsp; **Discord** · [discord.gg/EG5dmpFaCF](https://discord.gg/EG5dmpFaCF) &nbsp;|&nbsp; **Email** · [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

The official Node.js / Electron SDK for [Atlas Authentication](https://atlassecurity.site) — a hardware-bound license authentication and software protection platform for Windows x64. This repo ships `Atlas.dll`, the koffi-based binding, TypeScript typings, and two runnable examples: a minimal Node console app and a real Electron desktop app.

This is the same SDK as the C++ integration. It wraps `Atlas.dll` (built from the same C++ sources that produce `Atlas Auth.lib`). Nothing is re-implemented in JavaScript — the entire protection stack runs inside the DLL. This binding is a transport, not a rewrite.

Three lines of setup — `setApiKey`, `startup`, `login` — and your Node/Electron process is authenticated, continuously protected, and killable in real time from a web dashboard.

---

## Contents

- [What Atlas is](#what-atlas-is)
- [What's in this repo](#whats-in-this-repo)
- [Prerequisites](#prerequisites)
- [Step 1 — Create your Atlas account](#step-1--create-your-atlas-account)
- [Step 2 — Register your application](#step-2--register-your-application)
- [Step 3 — Generate a license key](#step-3--generate-a-license-key)
- [Step 4 — Install the SDK](#step-4--install-the-sdk)
- [Step 5a — Run the Console example](#step-5a--run-the-console-example)
- [Step 5b — Run the Electron example](#step-5b--run-the-electron-example)
- [Step 6 — Add Atlas to *your* project](#step-6--add-atlas-to-your-project)
- [API reference](#api-reference)
- [The apphash — pin it to your app, not to `node.exe`](#the-apphash--pin-it-to-your-app-not-to-nodeexe)
- [Electron security model — read before you ship](#electron-security-model--read-before-you-ship)
- [The API key in Electron, and what you do about it](#the-api-key-in-electron-and-what-you-do-about-it)
- [What runs automatically after `login`](#what-runs-automatically-after-login)
- [Distribution / shipping](#distribution--shipping)
- [Auto-updater (opt-in)](#auto-updater-opt-in)
- [Error taxonomy](#error-taxonomy)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Legal notice](#legal-notice)

---

## What Atlas is

Atlas is a **hardware-bound license authentication and software protection platform** for Windows x64 software. Same category as KeyAuth / Auth.gg / sentinel — but done properly, with active protection that runs *during* the session, not just at login.

**Three SDK calls in — full protection stack out:**

- Heartbeat every 5 seconds with a fresh nonce and a rotating session token
- `.text` CRC and IAT integrity check every 15 seconds against a startup snapshot
- Continuous inline-hook scan on `ws2_32.recv/send/connect` before every heartbeat
- Injected-module detection, debugger detection, hardware breakpoint (`DR0–DR7`) inspection
- Mutual watchdog on two threads using hardware performance counters
- On any failure, the process ends via `__fastfail()` at kernel level — no dialog, no exception handler to catch it, no soft signal to intercept

Free tier for life, no credit card, full security stack included (limited to 3 apps · 300 licenses · 3 files per app). Premium removes all caps and starts at **$9/week** or **$19/month** ([see plans](https://atlassecurity.site/plans)).

---

## What's in this repo

```
JS Integration/
├── README.md                          you are here
├── package.json                         top-level manifest — `npm install` here first
├── shared/
│   ├── Atlas.dll                          the DLL that runs the protection stack
│   ├── Atlas.dll.sig                      Ed25519 signature for the auto-updater
│   ├── Atlas.lib / Atlas.exp              MSVC import library (unused at runtime)
│   └── src/
│       ├── index.js                       the SDK — mirrors the C++ namespace 1:1
│       ├── index.d.ts                     TypeScript typings
│       └── updater.js                     opt-in DLL auto-updater
├── Console Example/
│   └── Atlas Auth Example.js              same shape as the C++ Console example
├── Electron Example/
│   ├── Atlas Auth Electron Example.js     main-process entry point
│   ├── preload.js                         narrow IPC surface — every renderer call goes here
│   ├── renderer.html                      the actual UI (sandboxed)
│   └── package.json                       Electron-specific manifest
└── dev-tools/
    ├── test.js                            smoke suite for the binding
    └── manage_autoupdate.js               CLI for the auto-updater state
```

**Prebuilt.** `Atlas.dll` is committed. You don't rebuild the SDK to use it.

---

## Prerequisites

| Requirement | Why | How to get it |
|---|---|---|
| **Windows 10 or 11 (x64)** | Atlas is Windows-x64 only. No Linux, macOS, ARM, WSL. | — |
| **Node.js ≥ 18 (x64)** | The koffi binding needs modern Node; must be x64 (32-bit Node can't load `Atlas.dll`). | [nodejs.org](https://nodejs.org/) |
| **npm** (bundled with Node) | To install `koffi`, and `electron` for the Electron example. | — |
| **An Atlas account** | Gives you an API key and license keys to test with. | [atlassecurity.site](https://atlassecurity.site) — free |

`koffi` is the only runtime dependency. It's a modern C ABI binding for Node — no `node-gyp`, no MSVC build step, prebuilt binaries for x64 Windows.

The Electron example additionally requires `electron`. Both are installed via `npm install` in step 4.

---

## Step 1 — Create your Atlas account

1. Go to [atlassecurity.site](https://atlassecurity.site) and click **Get started**.
2. Sign up with email or Discord.
3. Verify your email (the dashboard is locked until you do).
4. You're in.

Free tier — no credit card. You get 3 applications, 300 licenses across them, and 3 file uploads per app. That's plenty to build, test, and ship a small product.

---

## Step 2 — Register your application

In the dashboard, open **Applications → New application**. Give it a name (internal, users never see it).

Atlas creates the record and shows you:

- **API key** — copy this now, you'll paste it into your code in step 5
- **Application ID** — internal, the SDK reads it via the API key
- **Executable-hash whitelist** — the SHA-256 that identifies "your app." Under Node this points at your bundle / `.asar` / entry script, not `node.exe`. See [The apphash](#the-apphash--pin-it-to-your-app-not-to-nodeexe) for the details.

The API key is a **routing identifier**, not a bearer secret. See [The API key in Electron](#the-api-key-in-electron-and-what-you-do-about-it) for the full contract — especially important if you're shipping Electron.

---

## Step 3 — Generate a license key

**Licenses → Generate.** Pick:

- **Duration** — Weekly / Monthly / Lifetime / custom days
- **Level** — `1` for basic, `2+` for tiered access
- **Note** *(optional)* — anything you want, readable via `atlas.data.getNote()`

Copy the key. It looks like `ATLAS-A9F2-K4RM-XM7K`. This is what your users will type into your app; you'll type it into the example in step 5.

---

## Step 4 — Install the SDK

Clone this repo (or vendor it into your project — see [Distribution](#distribution--shipping)), then run `npm install` at the JS Integration root:

```
cd "JS Integration"
npm install
```

That pulls `koffi` into `node_modules/`. No build step. `Atlas.dll` is already sitting in `shared/`.

To run the Electron example specifically, also install its own manifest:

```
cd "Electron Example"
npm install
```

That adds `electron` under the Electron folder's `node_modules/`.

---

## Step 5a — Run the Console example

The Node console example is a line-for-line port of the C++ Console example — same flow, same fields, same order. Read it once and you understand the whole SDK.

### 5a.1 — Paste your API key

Open [`Console Example/Atlas Auth Example.js`](Console%20Example/Atlas%20Auth%20Example.js). Near the top:

```js
atlas.setApiKey('YOUR_API_KEY');
```

Replace `'YOUR_API_KEY'` with the key you copied in step 2. Save.

### 5a.2 — Run

From the JS Integration root:

```
node "Console Example/Atlas Auth Example.js"
```

You'll see:

```
Atlas Authentication Example

Enter license:
```

Paste the license key from step 3, press Enter. On success:

```
Attempting to connect to server...

--- User Information ---
License: ATLAS-A9F2-K4RM-XM7K
Expiry: 15-08-2026 14:32:00
IP: 45.11.42.187
HWID: 4A9C...E1B2
Level: 1
Note:
Active Users: 1
Total Users: 3
```

Now open the dashboard's **Logs** tab — you should see the login entry with your IP, HWID, latency, result = `ALLOW`. Kill the session from **Sessions → Kick** and the example terminates within 5 seconds via `__fastfail`. That's the full loop.

---

## Step 5b — Run the Electron example

The Electron example is a real desktop app: a windowed login form → welcome screen, cold-steel design that mirrors the Atlas dashboard, Atlas in the main process with a narrow IPC surface, renderer fully sandboxed.

**Before you ship any Electron app using Atlas, read [Electron security model](#electron-security-model--read-before-you-ship).** It's mandatory. The Electron process boundary is where every Electron/Atlas bug hides.

### 5b.1 — Paste your API key

Open [`Electron Example/Atlas Auth Electron Example.js`](Electron%20Example/Atlas%20Auth%20Electron%20Example.js). Look for:

```js
atlas.setApiKey('YOUR_API_KEY');
```

Replace and save.

### 5b.2 — Run

From the Electron Example directory:

```
cd "Electron Example"
npm start
```

An Electron window opens (940×640). Type your license key, click **Sign in**. On success you land on a welcome screen with your session data — license, HWID, expiry, IP, level, note — plus a live session uptime clock and **Sign out** / **Recheck session** buttons.

The main-process console (open the terminal you ran `npm start` from) shows Atlas SDK output. DevTools opens automatically in dev; the renderer tab shows only the sandboxed page — it can't reach Node, can't load the DLL, can't access the license directly.

---

## Step 6 — Add Atlas to *your* project

### 6.1 — Vendor the SDK

You have two clean paths:

**Option A — git submodule (recommended for reproducible builds):**
```
git submodule add https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git vendor/atlas-auth
git submodule update --init
```

**Option B — `git clone` into a vendor folder:**
```
git clone https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git vendor/atlas-auth
```

Then require from your code:

```js
const atlas = require('./vendor/atlas-auth/shared/src');
```

**We deliberately don't publish to npm.** The `Atlas.dll` binary is committed to the repo, versioned with the JS binding — vendoring guarantees you know exactly which DLL you're loading. No lock-file games, no supply-chain surprises.

### 6.2 — `npm install koffi` in your project

If your project doesn't already depend on koffi:

```
npm install koffi
```

That's the only runtime dep.

### 6.3 — Wire your code

```js
const atlas = require('./vendor/atlas-auth/shared/src');

atlas.setApiKey(process.env.ATLAS_API_KEY);  // or from your signed config
atlas.startup();

if (!atlas.login(licenseKey)) {
    throw new Error(atlas.data.getErrorMessage());
}

// authenticated — your app runs here
```

That's the whole shape. From `startup()` onwards, the DLL's threads are running heartbeats, integrity checks, and watchdogs — you don't manage any of it.

### 6.4 — Register your bundle's hash

Once you have a shipping build, hash your `.asar` (Electron) or your entry script (Node), paste that SHA-256 into the dashboard's **Applications → Executable-hash whitelist**. From then on, modified builds are rejected server-side before the license check.

See [The apphash](#the-apphash--pin-it-to-your-app-not-to-nodeexe) for the mechanics.

---

## API reference

Every C++ namespace call has an exact JavaScript equivalent — same name, same order, same return shape. TypeScript typings ship in [`shared/src/index.d.ts`](shared/src/index.d.ts) — no separate install needed.

### Core

```js
atlas.setApiKey(key)         // → true, must be called before startup()
atlas.startup()              // → true, initialize the DLL + protection stack
atlas.login(licenseKey)      // → boolean (true=success, false=rejected)
atlas.logout()               // → true, gentle sign-out (session stays running)
atlas.exit()                 // → void, kernel-level fastfail (attacker response)
```

### Data (available after `login`)

```js
atlas.data.getLicense()          // "ATLAS-XXXX-XXXX-XXXX"
atlas.data.getHWID()             // hardware fingerprint hash
atlas.data.getIP()               // detected by the server
atlas.data.getExpiry()           // "15-08-2026 14:32:00" or "Lifetime"
atlas.data.getLevel()            // "1", "VIP", whatever you set
atlas.data.getNote()             // custom note from the dashboard
atlas.data.getUserCount()        // total registered users on this app
atlas.data.getActiveUserCount()  // currently authenticated users

atlas.data.getErrorMessage()     // last error, "" if none
atlas.data.isAuthenticated()     // logged in, session active
atlas.data.isBanned()            // this user is banned
```

### Network (server operations)

```js
atlas.network.checkAuthentication()      // → boolean, force a server round-trip
atlas.network.submitLog(text)            // → true, custom log entry
atlas.network.banUser(reason, minutes)   // → true, requires ban permission
atlas.network.download(fileId)           // → Buffer, panel-uploaded file bytes
```

### Apphash (JS-specific)

```js
atlas.setAppHash('abc...64chars')            // pin to a literal SHA-256
atlas.setAppHashFromFile('/path/to/bundle')  // hash a file and pin (recommended)
atlas.setAppHashPath('/path/to/bundle')      // DLL-side hash (rare)
atlas.getResolvedAppHash()                   // → what the DLL WILL send
```

### Metadata

```js
atlas.version()   // → DLL surface version "2.x.x"
atlas.envInfo()   // → { bindingVersion, dllVersion, node, arch, platform, ... }
                  //   safe to log; no license/HWID/PII
```

### Errors

```js
atlas.AtlasError    // constructor
atlas.Status        // { OK, NOT_STARTED, NO_API_KEY, LOGIN_FAILED,
                    //   NOT_AUTHED, BAD_ARG, BUFFER_TOO_SMALL, SERVER, INTERNAL }
```

### 1:1 C++ → JS map

| C++ | JavaScript | Returns |
|---|---|---|
| `Atlas::API_KEY = k` | `atlas.setApiKey(k)` | `true` |
| `Atlas::Startup()` | `atlas.startup()` | `true` |
| `Atlas::Login(k)` | `atlas.login(k)` | `boolean` |
| `Atlas::Logout()` | `atlas.logout()` | `true` |
| `Atlas::Data::IsAuthenticated()` | `atlas.data.isAuthenticated()` | `boolean` |
| `Atlas::Data::IsBanned()` | `atlas.data.isBanned()` | `boolean` |
| `Atlas::Data::GetLicense()` | `atlas.data.getLicense()` | `string` |
| `Atlas::Data::GetHWID()` | `atlas.data.getHWID()` | `string` |
| `Atlas::Data::GetIP()` | `atlas.data.getIP()` | `string` |
| `Atlas::Data::GetExpiry()` | `atlas.data.getExpiry()` | `string` |
| `Atlas::Data::GetLevel()` | `atlas.data.getLevel()` | `string` |
| `Atlas::Data::GetNote()` | `atlas.data.getNote()` | `string` |
| `Atlas::Data::GetUserCount()` | `atlas.data.getUserCount()` | `string` |
| `Atlas::Data::GetActiveUserCount()` | `atlas.data.getActiveUserCount()` | `string` |
| `Atlas::Data::GetErrorMessage()` | `atlas.data.getErrorMessage()` | `string` |
| `Atlas::Network::CheckAuthentication()` | `atlas.network.checkAuthentication()` | `boolean` |
| `Atlas::Network::BanUser(r, m)` | `atlas.network.banUser(r, m)` | `true` |
| `Atlas::Network::SubmitLog(t)` | `atlas.network.submitLog(t)` | `true` |
| `Atlas::Network::Download(id)` | `atlas.network.download(id)` | `Buffer` |
| `Atlas::Helper::Exit()` | `atlas.exit()` | `void` |
| *(JS-only)* | `atlas.setAppHashFromFile(path)` | `true` |
| *(JS-only)* | `atlas.setAppHash(hex64)` | `true` |
| *(JS-only)* | `atlas.getResolvedAppHash()` | `string` |
| *(JS-only)* | `atlas.envInfo()` | `object` |
| *(JS-only)* | `atlas.version()` | `string` |

---

## The apphash — pin it to your app, not to `node.exe`

Atlas's server sees a SHA-256 "apphash" on every request. In the C++ SDK that hash is your compiled `.exe`, and the dashboard's binary-hash whitelist rejects modified builds at the door.

Under Node/Electron the DLL's *default* behavior would hash `node.exe` / `Electron.exe`, which doesn't identify your app at all — every dev's Node install has a different hash, and every Electron version bump breaks the whitelist. **The JS binding fixes this properly** — it exposes a real API to pin the apphash to a file that actually represents your app.

**By default (recommended):** `startup()` auto-detects a sensible source:

- **Electron:** `<process.resourcesPath>/app.asar`
- **Node:** `require.main.filename` (your entry script)
- Falls back to the DLL default (`node.exe`) if neither exists

You get an identity-appropriate apphash with zero code. Whitelist that hash in the dashboard and modified builds fail auth exactly like they would in C++.

**Explicit override — Electron with a specific bundle path:**
```js
const path = require('path');
atlas.setAppHashFromFile(path.join(process.resourcesPath, 'app.asar'));
atlas.startup();
```

**Explicit override — build-pipeline precomputed hash:**
```js
// CI computed this at build time and injected it into your config
atlas.setAppHash('a1b2c3d4e5f6...64chars');
atlas.startup();
```

**Debug — see what the DLL will actually send:**
```js
atlas.setAppHashFromFile('./resources/app.asar');
console.log(atlas.getResolvedAppHash());   // prints the actual hex
atlas.startup();
```

### Security contract

Full threat model in [`../docs/AppHash.md`](../docs/AppHash.md). The important properties:

- **One-shot per process.** Each of `setAppHash` / `setAppHashPath` / `setAppHashFromFile` succeeds exactly once. A second call throws — no override stomping.
- **Locked after `startup()`.** Any override attempt post-startup returns `BAD_ARG`. An injected DLL cannot race the apphash mid-session.
- **Strict validation.** `setAppHash` requires exactly 64 lowercase hex chars. `""`, uppercase, or garbage is rejected.
- **Server is authoritative.** The local override is not "trusted." What this API protects is your honest apphash telemetry being useful; a malicious client can still forge locally, but the server whitelist is the real gate.

---

## Electron security model — read before you ship

Electron apps are two processes: **main** (Node runtime) and **renderer** (Chromium page). **Atlas must live in main, never in renderer.** The `Electron Example/` folder shows the exact pattern.

### The three-layer split

- **`Atlas Auth Electron Example.js`** (main) — loads Atlas, holds all sensitive state, exposes IPC handlers. Never sends the raw license, HWID, or session token to the renderer.
- **`preload.js`** — the bridge. It's the *only* file that has access to both `ipcRenderer` and the renderer's `window`. Every call the renderer can make is listed here — if it isn't in `preload.js`, the renderer can't reach it.
- **`renderer.html`** — the UI. Runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Cannot `require`, cannot load DLLs, cannot access Node globals. Can only call `window.atlas.login()`, `window.atlas.status()`, etc. — the whitelisted preload surface.

### Every sensitive IPC handler gates on `atlas.data.isAuthenticated()`

If the session drops mid-session (server kick, ban, integrity failure), the renderer can't extract data by replaying the call:

```js
ipcMain.handle('atlas:revealLicense', async () => {
    if (!atlas.data.isAuthenticated()) return { ok: false, error: 'not authenticated' };
    return { ok: true, license: atlas.data.getLicense() };
});
```

### The session watchdog runs in main, not renderer

The DLL's own 5-second heartbeat runs regardless. In `Atlas Auth Electron Example.js`:

```js
setInterval(() => {
    if (atlas.data.isAuthenticated() && !atlas.network.checkAuthentication()) {
        atlas.exit();   // ← NOT app.quit(). See below.
    }
}, 30_000);
```

**On failure, call `atlas.exit()`, not `app.quit()`.** The SDK's `exit()` routes through Atlas.dll's kernel-level fastfail. `app.quit()` is a soft signal an attacker can patch out of your JS bundle.

### `shell.openExternal` — whitelist the URLs

Never pass a renderer-supplied URL directly to `shell.openExternal` — an XSS'd renderer could hand you `file://` or `javascript:`. The example whitelists:

```js
const ALLOWED_URLS = new Set(['https://atlassecurity.site']);
ipcMain.handle('atlas:open-url', async (_event, url) => {
    if (!ALLOWED_URLS.has(url)) return { ok: false, error: 'URL not allowed' };
    await shell.openExternal(url);
    return { ok: true };
});
```

### Electron apps are inherently softer than native PEs

Your `app.asar` unpacks to plaintext JavaScript. Atlas will authenticate you and gate features, but **it cannot make your JS bundle itself tamper-proof** — that's a limit of Electron, not Atlas.

If you need the app *code* protected (not just gated), move the sensitive logic into a native module (C++ addon, protected with Atlas Obfuscator) and call it from JS.

---

## The API key in Electron, and what you do about it

Unlike a C++ user's `Atlas::API_KEY` (compiled into scrambled bytes), a JS user's `atlas.setApiKey('...')` sits plaintext in your bundle. Anyone with `asar extract` can read it.

**Mitigations, in order of best-to-worst:**

1. **Fetch the key from your own signed remote config at runtime.** Don't hardcode in `main.js`. Sign the config with a public key you ship with your app; verify on load.
2. **Treat the key as a per-app identifier, not a secret.** HMAC + HWID + license validation are what actually authenticate; the API key routes the request to your dashboard account. A leaked key does not, by itself, let an attacker impersonate a user.
3. **Rotate the key via the dashboard if you suspect exposure.** Old key is invalidated within one heartbeat cycle.

If you need something truly secret in the bundle, don't put it there. Put it on your server and expose it only after a successful `atlas.login`.

---

## What runs automatically after `login`

Everything below runs inside `Atlas.dll` on its own threads. You don't write any of it.

- **Every 5 seconds — heartbeat.** Signed, sequence-numbered, echoes the server's newest challenge nonce. Server can push messages, kick sessions, or issue a hard terminate. Client cannot resist a server kill.
- **Every 15 seconds — deep sweep.** `.text` section CRC vs the startup snapshot (catches NOP patches, code caves, jump injections). Full IAT verification (catches hook injection, manual mapping).
- **Continuous — inline-hook scan.** First bytes of `ws2_32.recv/send/connect` checked for JMP / CALL / INT3 signatures before every heartbeat. A hooked network function is the foundation of a MitM on the auth channel — Atlas kills the process before any data crosses it.
- **Continuous — injected-module detection.** Executable page map compared against the post-login snapshot. New executable pages trigger termination.
- **Continuous — debugger detection.** PEB flags, `NtQueryInformationProcess`, hardware breakpoints on `DR0–DR7`, VEH front-of-chain interception.
- **Continuous — mutual watchdog.** Two threads monitor each other using hardware performance counters. Either goes silent → both processes fastfail.

**On any failure:** `__fastfail()` from kernel. No dialog. No exception handler. No soft signal. Process just stops.

---

## Distribution / shipping

**GitHub-only.** No npm registry. Users vendor the repo directly — see [Step 6.1](#61--vendor-the-sdk).

For **Electron apps** shipping to users, bundle `Atlas.dll` alongside your `.asar` via `electron-builder`'s `extraResources`:

```json
"extraResources": [
    { "from": "vendor/atlas-auth/shared/Atlas.dll",     "to": "Atlas.dll" },
    { "from": "vendor/atlas-auth/shared/Atlas.dll.sig", "to": "Atlas.dll.sig" }
]
```

Then point the SDK at it explicitly:

```js
const path = require('path');
const atlas = require('./vendor/atlas-auth/shared/src');

atlas.init({
    dllPath: path.join(process.resourcesPath, 'Atlas.dll'),
});
```

For **Node CLI tools**, ship the DLL next to your entry script and set `ATLAS_DLL_PATH` in your launcher, or pass `init({ dllPath: ... })` explicitly.

The SDK's own platform check throws on non-Win32 at require time, so cross-platform users get a clear error immediately — not a segfault.

---

## Auto-updater (opt-in)

The JS SDK ships a GitHub-based auto-updater that mirrors the C++ SDK's MSBuild hook. **Off by default.** Opt in when you want your local `Atlas.dll` to stay current between releases.

```js
atlas.enableAutoUpdate({
    ack: 'I understand this pulls executable code from GitHub',
});
atlas.setApiKey(key);
atlas.startup();   // updater probes GitHub in the background, never blocks startup
```

**What it does:**

- Compares the local `Atlas.dll` version against `github.com/atlassecuritysolutions/AtlasAuthentication-JS`
- If newer, downloads `Atlas.dll` + `Atlas.dll.sig`, verifies signature against a pinned Ed25519 pubkey
- Writes `Atlas.dll.new` sidecar — the DLL currently loaded is locked by Windows, so the swap happens on the *next* Node process start
- Never runs in packaged Electron apps or when `NODE_ENV=production`

**CLI management:**

```
node dev-tools/manage_autoupdate.js status         # current state
node dev-tools/manage_autoupdate.js enable         # opt in
node dev-tools/manage_autoupdate.js disable        # opt out
node dev-tools/manage_autoupdate.js check          # probe now
node dev-tools/manage_autoupdate.js reset          # clear all state
node dev-tools/manage_autoupdate.js open-folder    # open %LOCALAPPDATA%\AtlasAuth
```

Full security model + threat analysis: [`../docs/AutoUpdate.md`](../docs/AutoUpdate.md).

---

## Error taxonomy

The binding throws `AtlasError` for anything that isn't a normal login rejection. The error carries a numeric `code` and a `statusName` string mapped from the DLL's status enum:

| `code` | `statusName` | Meaning |
|---:|---|---|
| `0` | `OK` | Never thrown |
| `1` | `NOT_STARTED` | Called before `startup()` |
| `2` | `NO_API_KEY` | `startup()` before `setApiKey()` |
| `3` | `LOGIN_FAILED` | Not thrown — `login()` returns `false` instead |
| `4` | `NOT_AUTHED` | Called `data.*` / `network.*` before successful login |
| `5` | `BAD_ARG` | Null or wrong-type argument |
| `6` | `BUFFER_TOO_SMALL` | Internal — shouldn't reach userland |
| `7` | `SERVER` | Transport or server-side failure |
| `8` | `INTERNAL` | Unexpected — file a bug |

`AtlasError.statusName` is stable — you can `switch` on it without worrying about string localization.

**Login rejections don't throw** — `atlas.login(key)` returns `false` and you read `atlas.data.getErrorMessage()` for the server's reason (invalid license, expired, banned, HWID mismatch, etc.). This mirrors the C++ pattern.

---

## Troubleshooting

### `Atlas SDK is Windows-only` at `require()`

Correct — Atlas is Windows x64 by product design. No WSL, no Docker, no macOS, no Linux. Use a native Windows Node install.

### `koffi: Failed to load Atlas.dll`

- Confirm `shared/Atlas.dll` exists.
- Set `ATLAS_DLL_PATH` explicitly to a fully-qualified path.
- On Windows, DLL search order matters. If Atlas.dll depends on a specific VS redistributable, install it on the target machine.
- In a packaged Electron app: check that `extraResources` copied Atlas.dll into `process.resourcesPath` and that you're passing `init({ dllPath: ... })` explicitly.

### `Atlas.dll returned unparseable version`

You're loading a much older DLL against a newer binding. Update `Atlas.dll` from this repo's `shared/` folder, or opt into the auto-updater.

### The Node process silently exits on `startup()`

The SDK's `__fastfail` kill path fired — same behavior as it would in a C++ host. Check the dashboard's **Logs** tab for the reason. Common triggers:

- API key still `'YOUR_API_KEY'`
- Debugger attached to `node.exe` (VS Code JS debugger, Chrome DevTools inspector)
- Integrity check tripped (`.text` modified, IAT hooked, injected module)

If you're developing in Electron with DevTools open, that's a form of "debugger attached." Atlas tolerates the renderer's DevTools but not the main-process inspector (`--inspect`). Ship-mode tests should run without inspectors.

### `login()` returns `false`, message says "Executable hash mismatch"

You whitelisted an apphash, then rebuilt/repacked your bundle — the new hash doesn't match. Either update the whitelist or don't whitelist during active development.

Debug what the SDK actually sends:
```js
atlas.setAppHashFromFile('./out/app.asar');
console.log(atlas.getResolvedAppHash());
```

### Electron app quits immediately on launch (packaged build)

Almost always one of:

- `Atlas.dll` isn't in `process.resourcesPath` — check your `extraResources` config
- You forgot to call `atlas.init({ dllPath: ... })` in the packaged path
- The apphash is auto-detecting `Electron.exe` (because `app.asar` isn't where the SDK expected) and the server whitelist has the *dev* hash, not the *packaged* hash

Log `atlas.envInfo()` — it tells you which DLL was loaded, which apphash resolved, and the Node/Electron version.

### Verifying the binding

`dev-tools/test.js` is a smoke suite that talks to a real `Atlas.dll` and a real server. Run it after every DLL swap to catch regressions:

```
# Preconditions only — no server hit; verifies DLL loads, version gate, error paths
node dev-tools/test.js

# Full run against your test license
ATLAS_API_KEY=sk-xxx ATLAS_TEST_LICENSE=ATLAS-XXXX-XXXX-XXXX node dev-tools/test.js
```

Exit codes: `0` = all passed, `1` = one or more failed, `2` = preconditions only (no test license supplied).

---

## Support

- **Docs** — [atlassecurity.site/docs](https://atlassecurity.site/docs) — full reference, architecture, protocol
- **Discord** — [discord.gg/EG5dmpFaCF](https://discord.gg/EG5dmpFaCF) — fastest response
- **Email** — [mail@atlassecurity.site](mailto:mail@atlassecurity.site) — for anything you'd rather not post publicly
- **Bug reports** — include `atlas.envInfo()` output, Node/Electron version, and (if relevant) the dashboard **Logs** entry that shows the failure

---

## Pricing

Free tier for life — 3 applications, 300 licenses across them, 3 file uploads per app. Full security stack, no feature gates.

**Premium** removes the caps: [Weekly $9](https://atlassecurity.site/plans) · Monthly $19 · 6-month $79 (save 31%) · Yearly $99 (save 57%). PayPal or cryptocurrency. Activates instantly.

---

## Legal notice

© 2025–2026 Atlas Security Solutions. All rights reserved. Sold by Atlas Security Solutions, Jeddah, Kingdom of Saudi Arabia.

This SDK exists for one purpose: to let developers integrate Atlas Authentication into their software. If you're a developer building an application and using this code to license and protect it through Atlas — you are exactly who this is for. Use it freely.

**The following acts are strictly prohibited without explicit written authorization** and apply to those who seek to abuse, exploit, or undermine the Atlas platform. Atlas reserves all rights to pursue legal action:

- Reverse engineering, decompiling, disassembling, or reconstructing the Atlas platform, its compiled binaries, network protocols, or server infrastructure
- Tampering with, bypassing, disabling, or circumventing any authentication check, anti-tamper control, or security mechanism within the Atlas system
- Accessing, probing, or interfering with Atlas servers, databases, or infrastructure without authorization
- Using knowledge of Atlas internals to build, assist, or contribute to competing platforms or security-bypass tools

**Applicable law and enforcement:**

- **Saudi Arabia:** Anti-Cybercrime Law (Royal Decree No. M/17, 1428H) — Articles 3 and 4
- **United States:** Computer Fraud and Abuse Act (18 U.S.C. § 1030)
- **European Union:** Directive 2013/40/EU on Attacks Against Information Systems
- **International:** WIPO Copyright Treaty and the TRIPS Agreement (180+ signatory nations)

Atlas Security Solutions actively monitors for unauthorized access, reverse-engineering attempts, and protocol analysis. Any violation will be met with immediate civil action, referral to competent national authorities, and pursuit of all available legal remedies — including injunctive relief, asset recovery, and cross-jurisdiction enforcement — without prior notice.

For permission requests or legal inquiries: [mail@atlassecurity.site](mailto:mail@atlassecurity.site) · [atlassecurity.site/legal](https://atlassecurity.site/legal)
