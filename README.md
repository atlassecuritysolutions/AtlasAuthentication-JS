# Atlas Authentication — Node.js / Electron SDK

[atlassecurity.site](https://atlassecurity.site) · [Docs](https://atlassecurity.site/docs) · [Plans](https://atlassecurity.site/plans) · [Discord](https://discord.gg/EG5dmpFaCF) · [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

Hardware-bound license authentication and software protection for Windows x64 Node.js and Electron applications. Three calls — `setApiKey`, `startup`, `login` — and your process is authenticated, continuously protected, and killable in real time from the web dashboard.

This binding wraps `Atlas.dll` (built from the same C++ sources as the static `.lib`). Nothing is re-implemented in JavaScript — the protection stack runs entirely inside the DLL. This layer is a transport.

---

## Contents

- [What ships in the box](#what-ships-in-the-box)
- [Repo layout](#repo-layout)
- [Prerequisites](#prerequisites)
- [Get an account, an app, a license](#get-an-account-an-app-a-license)
- [Install](#install)
- [Console example](#console-example)
- [Electron example](#electron-example)
- [Integrate into your project](#integrate-into-your-project)
- [API reference](#api-reference)
- [The apphash — pin it to *your* app](#the-apphash--pin-it-to-your-app)
- [Electron security model](#electron-security-model)
- [The API key in Electron](#the-api-key-in-electron)
- [Distribution](#distribution)
- [Auto-updater (opt-in)](#auto-updater-opt-in)
- [Errors](#errors)
- [Troubleshooting](#troubleshooting)
- [Pricing](#pricing)
- [Support](#support)
- [Legal](#legal)

---

## What ships in the box

- Ephemeral X25519 handshake and Ed25519-signed server reply on every connection — server impersonation is refused by construction.
- 5-second heartbeat with a rotating token, `.text` + IAT checks every 15 s, continuous inline-hook scan on `ws2_32.recv/send/connect`.
- Debugger, hardware breakpoint, injected-module, and manual-map detection.
- Mutual watchdog on two threads driven by hardware performance counters.
- On integrity failure, the process is ended via kernel `__fastfail()` — no dialog, no exception handler, nothing catchable.

Same stack as the C++ SDK; you're just calling it through JavaScript.

---

## Repo layout

```
JS Integration/
├── package.json                            top-level manifest — `npm install` here
├── shared/
│   ├── Atlas.dll                             the DLL that runs the protection stack
│   ├── Atlas.dll.sig                         Ed25519 signature for the auto-updater
│   ├── Atlas.lib / Atlas.exp                 MSVC import library (unused at runtime)
│   └── src/
│       ├── index.js                          the SDK — mirrors the C++ namespace 1:1
│       ├── index.d.ts                        TypeScript typings
│       └── updater.js                        opt-in DLL auto-updater
├── Console Example/
│   └── Atlas Auth Example.js                 same flow as the C++ Console example
├── Electron Example/
│   ├── Atlas Auth Electron Example.js        main-process entry point
│   ├── preload.js                            narrow IPC surface
│   ├── renderer.html                         the sandboxed UI
│   └── package.json                          Electron-specific manifest
└── dev-tools/
    ├── test.js                               smoke suite for the binding
    └── manage_autoupdate.js                  CLI for the auto-updater state
```

`Atlas.dll` is prebuilt and committed. You don't rebuild the SDK to use it.

---

## Prerequisites

| | |
|---|---|
| Windows 10 or 11 (x64) | Atlas is Windows-x64 only. No Linux, macOS, ARM, WSL. |
| [Node.js ≥ 18 (x64)](https://nodejs.org/) | 32-bit Node cannot load `Atlas.dll`. |
| npm | Bundled with Node; used to install `koffi` and (for Electron) `electron`. |
| An Atlas account | [atlassecurity.site](https://atlassecurity.site) — free. |

`koffi` is the only runtime dependency — a modern C ABI binding for Node with prebuilt x64 Windows binaries. No `node-gyp`, no MSVC build.

---

## Get an account, an app, a license

1. Sign up at [atlassecurity.site](https://atlassecurity.site), verify your email.
2. **Applications → New application** — name it whatever; copy the **API key**.
3. **Licenses → Generate** — pick a duration, level, optional note. Copy the key (format `ATLAS-XXXXX-XXXXX`).

Free tier is 3 applications, 300 licenses across them, 3 file uploads per app.

**One extra step for JS/Electron:** the SDK's executable-hash whitelist should point at *your app bundle*, not `node.exe` / `Electron.exe`. See [The apphash](#the-apphash--pin-it-to-your-app).

---

## Install

Clone this repo (or vendor it into your project — see [Distribution](#distribution)), then `npm install` at the JS Integration root:

```
cd "JS Integration"
npm install
```

That pulls `koffi` into `node_modules/`. `Atlas.dll` already sits in `shared/`.

For the Electron example, additionally:

```
cd "Electron Example"
npm install
```

---

## Console example

Line-for-line port of the C++ Console example.

1. Open [`Console Example/Atlas Auth Example.js`](Console%20Example/Atlas%20Auth%20Example.js). Replace `'YOUR_API_KEY'` with your key.
2. From the JS Integration root:
   ```
   node "Console Example/Atlas Auth Example.js"
   ```

Paste your license when prompted. On success:

```
--- User Information ---
License: ATLAS-A9F2K-4RMXM
Expiry:  15-08-2026 14:32:00
IP:      45.11.42.187
HWID:    Atlas-4A9C...E1B2
Level:   1
Note:
Active Users: 1
Total Users:  3
```

Open the dashboard **Logs** — your login is there. **Sessions → Kick** ends the process within 5 seconds via `__fastfail`.

---

## Electron example

A real desktop app: windowed login form → welcome screen, cold-steel design, Atlas in the main process with a narrow IPC surface, renderer fully sandboxed.

**Read [Electron security model](#electron-security-model) before you ship any Electron app using Atlas.** It's mandatory.

1. Open [`Electron Example/Atlas Auth Electron Example.js`](Electron%20Example/Atlas%20Auth%20Electron%20Example.js). Replace `'YOUR_API_KEY'`.
2. From the Electron Example directory:
   ```
   cd "Electron Example"
   npm start
   ```

A 940×640 window opens. Type your license, click **Sign in**. On success you land on a welcome screen with the full session card, session uptime, and **Sign out** / **Recheck session** buttons. The main-process terminal shows Atlas SDK output; the renderer's DevTools tab only sees the sandboxed page.

---

## Integrate into your project

### Vendor the SDK

Two clean paths — pick one.

**Submodule** (recommended for reproducible builds):
```
git submodule add https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git vendor/atlas-auth
git submodule update --init
```

**Direct clone:**
```
git clone https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git vendor/atlas-auth
```

Then require:
```js
const atlas = require('./vendor/atlas-auth/shared/src');
```

We deliberately don't publish to npm — `Atlas.dll` is committed to the repo and versioned with the JS binding. Vendoring guarantees you know exactly which DLL you're loading. No lock-file games, no supply-chain surprises.

### Install koffi

```
npm install koffi
```

Only runtime dep.

### Wire it up

```js
const atlas = require('./vendor/atlas-auth/shared/src');

atlas.setApiKey(process.env.ATLAS_API_KEY);   // or your signed remote config
atlas.startup();

if (!atlas.login(licenseKey)) {
    throw new Error(atlas.data.getErrorMessage());
}

// authenticated — your app runs here
```

From `startup()` onward, the DLL's threads run the heartbeat, integrity checks, and watchdogs. You manage none of it.

### Whitelist your bundle's hash

Once you have a shipping build, hash your `.asar` (Electron) or entry script (Node), paste the SHA-256 into **Applications → Executable-hash whitelist**. Modified builds are then rejected server-side before the license check. Mechanics: [The apphash](#the-apphash--pin-it-to-your-app).

---

## API reference

Every C++ namespace call has an exact JavaScript equivalent — same name, same order, same return shape. TypeScript typings ship in [`shared/src/index.d.ts`](shared/src/index.d.ts).

### Core

```js
atlas.setApiKey(key)         // → true; call before startup()
atlas.startup()              // → true; initialise DLL + protection stack
atlas.login(licenseKey)      // → boolean (true = success, false = rejected)
atlas.logout()               // → true; gentle sign-out
atlas.exit()                 // → void; kernel-level fastfail
```

### `atlas.data` — session state (valid after `login`)

```js
getLicense()         getHWID()         getIP()         getExpiry()      getLevel()
getNote()            getFirstSeenDate()                getLastSeenDate()
getUserCount()       getActiveUserCount()
isAuthenticated()    isBanned()
getErrorMessage()    hasError()        clearError()
```

### `atlas.network` — server operations

```js
checkAuthentication()          // → boolean; force a fresh server round-trip
submitLog(text)                // → true; custom log entry
banUser(reason, minutes)       // → true; requires ban permission
download(fileId)               // → Buffer; panel-uploaded file bytes
```

### Apphash (JS-specific)

```js
atlas.setAppHash('abc...64chars')            // pin to a literal SHA-256
atlas.setAppHashFromFile('/path/to/bundle')  // hash a file and pin (recommended)
atlas.setAppHashPath('/path/to/bundle')      // DLL-side hash (rare)
atlas.getResolvedAppHash()                   // → what the DLL WILL send
```

### Metadata & errors

```js
atlas.version()      // → DLL surface version "2.x.x"
atlas.envInfo()      // → { bindingVersion, dllVersion, node, arch, platform, ... }
                     //   safe to log; no license / HWID / PII
atlas.AtlasError     // constructor for anything that isn't a normal login rejection
atlas.Status         // { OK, NOT_STARTED, NO_API_KEY, LOGIN_FAILED, NOT_AUTHED,
                     //   BAD_ARG, BUFFER_TOO_SMALL, SERVER, INTERNAL }
```

### C++ → JS map

| C++ | JavaScript | Returns |
|---|---|---|
| `Atlas::API_KEY = k` | `atlas.setApiKey(k)` | `true` |
| `Atlas::Startup()` | `atlas.startup()` | `true` |
| `Atlas::Login(k)` | `atlas.login(k)` | `boolean` |
| `Atlas::Logout()` | `atlas.logout()` | `true` |
| `Atlas::Helper::Exit()` | `atlas.exit()` | `void` |
| `Atlas::Data::*` | `atlas.data.*` (camelCase) | same shape |
| `Atlas::Network::*` | `atlas.network.*` (camelCase) | same shape |
| *(JS-only)* | `atlas.setAppHashFromFile(path)` | `true` |
| *(JS-only)* | `atlas.setAppHash(hex64)` | `true` |
| *(JS-only)* | `atlas.getResolvedAppHash()` | `string` |
| *(JS-only)* | `atlas.envInfo()`, `atlas.version()` | object / string |

---

## The apphash — pin it to *your* app

Atlas's server sees a SHA-256 "apphash" on every request. In C++ that's the compiled `.exe`, and the dashboard whitelist rejects modified builds at the door.

Under Node/Electron the DLL's *default* would hash `node.exe` / `Electron.exe`, which doesn't identify your app at all — every dev's Node install has a different hash, and every Electron version bump breaks the whitelist. The JS binding fixes this properly.

**Default (recommended):** `startup()` auto-detects:
- **Electron** → `<process.resourcesPath>/app.asar`
- **Node** → `require.main.filename` (your entry script)
- Falls back to the DLL default (`node.exe`) if neither exists.

Whitelist that hash in the dashboard and modified builds fail auth exactly like C++.

**Explicit override — Electron with a specific bundle path:**
```js
const path = require('path');
atlas.setAppHashFromFile(path.join(process.resourcesPath, 'app.asar'));
atlas.startup();
```

**Explicit override — build-pipeline precomputed hash:**
```js
atlas.setAppHash('a1b2c3d4e5f6...64chars');   // CI computed this at build time
atlas.startup();
```

**Debug — see what the DLL will actually send:**
```js
atlas.setAppHashFromFile('./resources/app.asar');
console.log(atlas.getResolvedAppHash());
```

**Security contract** (full detail in [`../docs/AppHash.md`](../docs/AppHash.md)):

- **One-shot per process.** Each setter succeeds exactly once; a second call throws.
- **Locked after `startup()`.** Post-startup overrides return `BAD_ARG`. An injected DLL cannot race the apphash mid-session.
- **Strict validation.** `setAppHash` requires exactly 64 lowercase hex chars; anything else is rejected.
- **Server is authoritative.** The override protects honest telemetry; the whitelist is the real gate.

---

## Electron security model

Electron apps are two processes: **main** (Node runtime) and **renderer** (Chromium page). **Atlas must live in main, never in renderer.** The `Electron Example/` folder shows the exact pattern.

### Three-layer split

- **`Atlas Auth Electron Example.js`** (main) — loads Atlas, holds all sensitive state, exposes IPC handlers. Never sends the raw license, HWID, or session token to the renderer.
- **`preload.js`** — the bridge. The *only* file with access to both `ipcRenderer` and the renderer's `window`. If a call isn't listed here, the renderer can't reach it.
- **`renderer.html`** — the UI. Runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Cannot `require`, cannot load DLLs, cannot access Node globals. Can only call the whitelisted `window.atlas.*` preload surface.

### Every sensitive IPC gate checks `isAuthenticated`

If the session drops (server kick, ban, integrity failure), the renderer can't extract data by replaying the call:

```js
ipcMain.handle('atlas:revealLicense', async () => {
    if (!atlas.data.isAuthenticated()) return { ok: false, error: 'not authenticated' };
    return { ok: true, license: atlas.data.getLicense() };
});
```

### Session watchdog runs in main, not renderer

The DLL's own 5-second heartbeat runs regardless. In `Atlas Auth Electron Example.js`:

```js
setInterval(() => {
    if (atlas.data.isAuthenticated() && !atlas.network.checkAuthentication()) {
        atlas.exit();   // NOT app.quit() — see below
    }
}, 30_000);
```

**On failure, call `atlas.exit()`, not `app.quit()`.** `exit()` routes through Atlas.dll's kernel-level fastfail; `app.quit()` is a soft signal an attacker can patch out of your JS bundle.

### Whitelist URLs for `shell.openExternal`

Never pass a renderer-supplied URL straight to `shell.openExternal` — an XSS'd renderer could hand you `file://` or `javascript:`. The example does:

```js
const ALLOWED_URLS = new Set(['https://atlassecurity.site']);
ipcMain.handle('atlas:open-url', async (_event, url) => {
    if (!ALLOWED_URLS.has(url)) return { ok: false, error: 'URL not allowed' };
    await shell.openExternal(url);
    return { ok: true };
});
```

### Electron apps are inherently softer than native PEs

Your `app.asar` unpacks to plaintext JavaScript. Atlas will authenticate and gate features, but **it cannot make your JS bundle itself tamper-proof** — that's an Electron limitation, not Atlas's. For genuine code protection, move the sensitive logic into a native module (C++ addon, protected with Atlas Obfuscator) and call it from JS.

---

## The API key in Electron

Unlike a C++ user's `Atlas::API_KEY` (compiled into scrambled bytes), a JS user's `atlas.setApiKey('...')` sits plaintext in your bundle. Anyone with `asar extract` can read it.

**Mitigations, best to worst:**

1. **Fetch the key from your own signed remote config at runtime.** Don't hardcode in `main.js`. Sign the config with a public key you ship with your app; verify on load.
2. **Treat the key as a per-app identifier, not a secret.** HMAC + HWID + license validation are what actually authenticate; the API key routes the request. A leaked key does not, by itself, let an attacker impersonate a user.
3. **Rotate the key via the dashboard if you suspect exposure.** Old key is invalidated within one heartbeat cycle.

If you need something truly secret in the bundle, don't put it there — put it on your server and expose it only after a successful `atlas.login`.

---

## Distribution

**GitHub-only.** No npm registry. Users vendor the repo directly.

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

The SDK's platform check throws on non-Win32 at require time, so cross-platform users get a clear error immediately — not a segfault.

---

## Auto-updater (opt-in)

**Off by default.** The JS SDK ships a GitHub-based auto-updater that mirrors the C++ SDK's MSBuild hook. Opt in when you want your local `Atlas.dll` to stay current between releases.

```js
atlas.enableAutoUpdate({
    ack: 'I understand this pulls executable code from GitHub',
});
atlas.setApiKey(key);
atlas.startup();
```

What it does:

- Compares the local `Atlas.dll` version against `github.com/atlassecuritysolutions/AtlasAuthentication-JS`.
- If newer, downloads `Atlas.dll` + `Atlas.dll.sig`, verifies signature against a pinned Ed25519 pubkey.
- Writes `Atlas.dll.new` sidecar — the currently-loaded DLL is locked by Windows, so the swap happens on the *next* Node process start.
- Never runs in packaged Electron apps or when `NODE_ENV=production`.

CLI:

```
node dev-tools/manage_autoupdate.js status         # current state
node dev-tools/manage_autoupdate.js enable         # opt in
node dev-tools/manage_autoupdate.js disable        # opt out
node dev-tools/manage_autoupdate.js check          # probe now
node dev-tools/manage_autoupdate.js reset          # clear all state
node dev-tools/manage_autoupdate.js open-folder    # open %LOCALAPPDATA%\AtlasAuth
```

Full threat model: [`../docs/AutoUpdate.md`](../docs/AutoUpdate.md).

---

## Errors

The binding throws `AtlasError` for anything that isn't a normal login rejection. Each error carries a numeric `code` and a stable `statusName`:

| `code` | `statusName` | Meaning |
|---:|---|---|
| `1` | `NOT_STARTED` | Called before `startup()` |
| `2` | `NO_API_KEY` | `startup()` before `setApiKey()` |
| `3` | `LOGIN_FAILED` | Not thrown — `login()` returns `false` instead |
| `4` | `NOT_AUTHED` | Called `data.*` / `network.*` before successful login |
| `5` | `BAD_ARG` | Null or wrong-type argument |
| `6` | `BUFFER_TOO_SMALL` | Internal — shouldn't reach userland |
| `7` | `SERVER` | Transport or server-side failure |
| `8` | `INTERNAL` | Unexpected — file a bug |

`statusName` is stable — `switch` on it without worrying about string localization.

**Login rejections don't throw** — `atlas.login(key)` returns `false` and you read `atlas.data.getErrorMessage()` for the server's reason (invalid license, expired, banned, HWID mismatch, etc.). Mirrors the C++ pattern.

---

## Troubleshooting

**`Atlas SDK is Windows-only` at `require()`** — correct. Atlas is Windows x64 by product design. Use a native Windows Node install (no WSL, Docker, macOS, Linux).

**`koffi: Failed to load Atlas.dll`** — confirm `shared/Atlas.dll` exists; set `ATLAS_DLL_PATH` explicitly to a fully-qualified path; in a packaged Electron app, check that `extraResources` copied Atlas.dll into `process.resourcesPath` and you're passing `init({ dllPath: ... })`.

**`Atlas.dll returned unparseable version`** — you're loading an old DLL against a newer binding. Update `Atlas.dll` from this repo's `shared/` folder or opt into the auto-updater.

**Node process silently exits on `startup()`** — the SDK's `__fastfail` fired. Check dashboard **Logs**. Common: API key still `'YOUR_API_KEY'`; debugger attached to `node.exe` (VS Code JS debugger, Chrome DevTools inspector, `--inspect`); integrity check tripped. Electron renderer DevTools is fine; the *main-process* inspector is what Atlas refuses.

**`login()` returns `false`, "Executable hash mismatch"** — you whitelisted an apphash, then rebuilt. Update the whitelist or don't whitelist during active development. Debug: `console.log(atlas.getResolvedAppHash())` after `setAppHashFromFile()`.

**Packaged Electron app quits immediately** — almost always: `Atlas.dll` isn't in `process.resourcesPath` (check `extraResources`); or you forgot `atlas.init({ dllPath: ... })` on the packaged path; or the apphash is auto-detecting `Electron.exe` because `app.asar` isn't where the SDK expected. Log `atlas.envInfo()` — it tells you which DLL loaded, which apphash resolved, Node/Electron versions.

**Verify the binding** — `dev-tools/test.js` is a smoke suite that talks to a real DLL and a real server:

```
# Preconditions only (no server hit): verifies DLL loads, version gate, error paths
node dev-tools/test.js

# Full run against your test license
ATLAS_API_KEY=sk-xxx ATLAS_TEST_LICENSE=ATLAS-XXXXX-XXXXX node dev-tools/test.js
```

Exit codes: `0` all passed · `1` one or more failed · `2` preconditions only (no test license supplied).

Full FAQ: [atlassecurity.site/docs](https://atlassecurity.site/docs).

---

## Pricing

**Free forever** — 3 applications, 300 licenses across them, 3 file uploads per app. Full security stack, no feature gates.

**Auth Premium** removes the caps:

| Term | Price | Save |
|---|---|---|
| Monthly | $19 | — |
| 6 months | $99 | 13% |
| 1 year | $149 | 35% |

**Atlas Complete** — Authentication + Obfuscator premium bundled: $39/month or $299/year. PayPal or crypto, instant activation. Full plan matrix at [atlassecurity.site/plans](https://atlassecurity.site/plans).

---

## Support

- **Docs** — [atlassecurity.site/docs](https://atlassecurity.site/docs)
- **Discord** — [discord.gg/EG5dmpFaCF](https://discord.gg/EG5dmpFaCF) (fastest response)
- **Email** — [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

Bug reports: include `atlas.envInfo()` output, Node/Electron version, and (if relevant) the dashboard **Logs** entry that shows the failure.

---

## Legal

© 2025–2026 Atlas Security Solutions. All rights reserved. Sold by Atlas Security Solutions, Jeddah, Kingdom of Saudi Arabia.

This SDK exists so developers can integrate Atlas Authentication into their software. If that's you, use it freely.

**Prohibited without explicit written authorization:** reverse engineering, decompiling, disassembling, or reconstructing Atlas binaries, protocols, or server infrastructure; tampering with, bypassing, or disabling any authentication or anti-tamper control; probing or interfering with Atlas servers or databases; using knowledge of Atlas internals to build competing platforms or bypass tools.

Enforcement: Saudi Arabia Anti-Cybercrime Law (Royal Decree M/17, 1428H, Articles 3–4); U.S. Computer Fraud and Abuse Act (18 U.S.C. § 1030); EU Directive 2013/40/EU; WIPO / TRIPS (180+ signatory nations).

Atlas monitors for unauthorized access, reverse engineering, and protocol analysis. Violations are met with civil action, referral to competent authorities, and pursuit of all available remedies — injunctive relief, asset recovery, and cross-jurisdiction enforcement — without prior notice.

Permission requests and legal inquiries: [mail@atlassecurity.site](mailto:mail@atlassecurity.site) · [atlassecurity.site/legal](https://atlassecurity.site/legal)
