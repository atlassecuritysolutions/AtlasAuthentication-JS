# Atlas Authentication — Node.js / Electron SDK

**Website** · [atlassecurity.site](https://atlassecurity.site) &nbsp;|&nbsp; **Docs** · [atlassecurity.site/docs](https://atlassecurity.site/docs) &nbsp;|&nbsp; **Plans** · [atlassecurity.site/plans](https://atlassecurity.site/plans) &nbsp;|&nbsp; **Discord** · [discord.gg/EG5dmpFaCF](https://discord.gg/EG5dmpFaCF) &nbsp;|&nbsp; **GitHub** · [atlassecuritysolutions](https://github.com/atlassecuritysolutions) &nbsp;|&nbsp; **Email** · [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

---

This repository contains the Node.js integration for the Atlas Authentication SDK. It demonstrates a minimal Node console application and an Electron desktop app that perform a full authenticated session — license validation, hardware binding, and live session tracking — using two function calls.

This is the same SDK as the C++ example. It wraps `Atlas.dll` (built from the same C++ sources that produce `Atlas Auth.lib`). Nothing is re-implemented in JavaScript — the entire protection stack still runs inside the DLL. This binding is a transport.

[![Plans](https://atlassecurity.site/readme-plans.png)](https://atlassecurity.site/plans)

Free tier for life includes the full security stack — HWID binding, anti-debug, encrypted transport, proof-of-work — with limits of 3 apps, 300 licenses and 3 files per app. Premium removes all caps starting at $9.

---

[![Docs](https://atlassecurity.site/readme-docs.png)](https://atlassecurity.site/docs)

Full SDK reference, platform architecture, and integration guide at [atlassecurity.site/docs](https://atlassecurity.site/docs).

---

## What this example does

Prompts for a license key, connects to the Atlas server, and on success prints the session data — expiry, IP, HWID, level, note, active user count. The entire auth stack is active from that point: heartbeat, integrity checks, watchdog, remote termination, this is exactly what THIS folder is, the Atlas Node.js example.

Two runnable examples are included:

- **`example.js`** — line-for-line port of the C++ console example. Diff it against `../C++ Integration/Atlas Auth Example.cpp` — same flow, same fields, same order.
- **`electron-example/`** — a proper Electron desktop app. Atlas runs in the main process; the renderer is fully sandboxed and reaches Atlas only through a narrow IPC surface.

---

## What Atlas is

Atlas is a **hardware-bound license authentication and software protection platform**. It's the same product the C++ SDK ships — this folder is one language binding of it.

**What runs inside `Atlas.dll` (unchanged from the .lib):**

Every 5 seconds after login: executable CRC verified, import table checked, network functions scanned, watchdog threads cross-checking each other. If anything deviates from the startup snapshot — NOP patch, injected DLL, debugger attached, memory edited — the process terminates via `__fastfail()`. No dialog. No recovery path. The kernel terminates it directly.

**The authentication stack, in order:**

1. **Proof-of-work gate** — ~50ms for real users, hours for bots. Applied before any auth logic runs.
2. **Executable hash check** — your binary's SHA-256 must match the whitelist registered in the dashboard. Modified builds are rejected at the door.
3. **Hardware fingerprint** — 16+ components across firmware, storage, NIC, and platform security. The fingerprint is a keyed hash; it cannot be reconstructed without the server secret.
4. **License validation** — expiry, level, HWID binding, concurrent session limit, IP and country restrictions — all checked server-side in a single round trip.
5. **Ban vector check** — license key ban, full HWID ban, per-component ban (NIC, firmware, volume serial independently), and IP ban — applied in parallel.
6. **HMAC-signed response** — every successful auth response carries a keyed HMAC over the nonce, license key, and session ID. A nulled server cannot forge a valid reply.
7. **Session negotiation** — auth token fragmented across 4 non-adjacent memory pages with compile-time salt. Token rotates every heartbeat.

**The live enforcement stack (every 5 seconds after login):**

- Code section CRC against startup snapshot — catches all in-memory patches
- Import Address Table integrity check — catches hook injection and manual mapping
- Network function hook scan — WinSock/WinHTTP hook detection before any heartbeat data leaves
- Injection detection — unexpected loaded modules trigger immediate exit
- Hardware debug register check — `DR0–DR7` inspected before every sensitive fetch
- Watchdog mutual liveness — two threads cross-check each other; if either dies, both processes exit via `__fastfail()`

---

## Install

```bash
git clone https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git
cd AtlasAuthentication-JS
npm install koffi
```

That's it — no npm package, no build step. The `Atlas.dll` + `Atlas.dll.sig` ship in the repo. The one runtime dependency is [koffi](https://koffi.dev) for the FFI binding.

## Integration

```javascript
const atlas = require('./AtlasAuthentication-JS/src');

atlas.setApiKey('YOUR_API_KEY_HERE');
atlas.startup();
if (!atlas.login(key)) throw new Error(atlas.data.getErrorMessage());
// authenticated — full protection stack active
```

**`atlas.setApiKey(key)`** — sets `Atlas::API_KEY`. Must be called before `startup()`. Where a C++ user writes `namespace Atlas { std::string API_KEY = "..."; }`, a Node user writes this.

**Quiet mode (default: on).** The binding calls `Atlas_SetQuiet(1)` automatically on first bind, so SDK startup failures come back as an `AtlasError` you can render in your own UI instead of a modal Windows MessageBox popping up. Turn modals back on with `atlas.setQuiet(false)` before `startup()` if you actually want them.

**`atlas.startup()`** — initializes crypto primitives, snapshots the executable pages (baseline for CRC verification), starts the mutual watchdog threads, resolves all API imports via PEB walking and hash-based export matching. No readable import strings remain after this call.

**`atlas.login(key)`** — sends the license key through the encrypted transport (per-request key derivation, HMAC-signed), validates against the server, binds the hardware fingerprint, stores the session token across 4 non-adjacent memory fragments, and starts the heartbeat loop. Everything else — integrity checks, anti-debug, remote kill handling — runs automatically from this point.

That is the entire integration. Windows x64 · Node ≥ 18 · no external dependencies except [koffi](https://koffi.dev) for the FFI.

---

## Full API surface

Every C++ namespace call has an exact JavaScript equivalent — same name, same order, same return shape.

| C++ | JavaScript | Return |
|---|---|---|
| `Atlas::API_KEY = k` | `atlas.setApiKey(k)` | `true` |
| *(JS only)* | `atlas.setAppHashFromFile(path)` | `true` |
| *(JS only)* | `atlas.setAppHash(hex64)` | `true` |
| *(JS only)* | `atlas.setAppHashPath(path)` | `true` |
| *(JS only)* | `atlas.getResolvedAppHash()` | `string` |
| `Atlas::Startup()` | `atlas.startup()` | `true` |
| `Atlas::Login(k)` | `atlas.login(k)` | `boolean` |
| `Atlas::Data::IsAuthenticated()` | `atlas.data.isAuthenticated()` | `boolean` |
| `Atlas::Data::IsBanned()` | `atlas.data.isBanned()` | `boolean` |
| `Atlas::Data::Exit()` | `atlas.exit()` | `void` |
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

`TypeScript` typings ship in [`src/index.d.ts`](src/index.d.ts). No additional install required.

---

## The apphash — pin it to your app, not to node.exe

Atlas's server sees a SHA-256 "apphash" on every request. In the C++ SDK that hash is your compiled `.exe`, and the dashboard's binary-hash whitelist rejects modified builds at the door.

Under Node/Electron the DLL's default behavior would hash `node.exe` / `Electron.exe`, which doesn't identify your app at all — every dev's Node install has a different hash, and every Electron version bump breaks the whitelist. **The JS binding fixes this properly** — it hands you a real API to pin the apphash to a file that actually represents your app.

**By default (recommended):** `startup()` auto-detects a sensible source:
- **Electron:** `<process.resourcesPath>/app.asar`
- **Node:** `require.main.filename`
- Falls back to the DLL default (`node.exe`) if neither exists

You get an identity-appropriate apphash with zero code. Whitelist that hash in the dashboard and modified builds fail auth exactly like they would in C++.

**Explicit override — Electron with a specific bundle path:**
```javascript
const path = require('path');
atlas.setAppHashFromFile(path.join(process.resourcesPath, 'app.asar'));
atlas.startup();
```

**Explicit override — build-pipeline precomputed hash:**
```javascript
// Your CI computed this at build time and injected it into your config
atlas.setAppHash('a1b2c3d4e5f6...64chars');
atlas.startup();
```

**Debug — see what the DLL will actually send:**
```javascript
atlas.setAppHashFromFile('./resources/app.asar');
console.log(atlas.getResolvedAppHash());  // prints the actual hex
atlas.startup();
```

### Security contract

Read `../docs/AppHash.md` for the full threat model. The important properties:

- **One-shot per process.** Each of `setAppHash` / `setAppHashPath` / `setAppHashFromFile` succeeds exactly once. A second call throws — no override stomping.
- **Locked after `startup()`.** Any override attempt post-startup returns `BAD_ARG`. An injected DLL cannot race the apphash mid-session.
- **Strict validation.** `setAppHash` requires exactly 64 lowercase hex chars. `""`, uppercase, or garbage is rejected — no way to nullify the hash and bypass server whitelisting.
- **Server is authoritative.** The local override is not "trusted." What this API protects is your honest apphash telemetry being useful; a malicious client can still forge locally, but the server whitelist is the real gate.

### One more thing to be honest about: your API key sits in the bundle

Unlike a C++ user's `Atlas::API_KEY` (compiled into `SecureString` scrambled bytes), a JS user's `atlas.setApiKey('...')` sits plaintext in your bundle. Anyone with `asar extract` can read it.

Mitigations:
- Fetch the key from your own signed remote config at runtime — don't hardcode in `main.js`.
- Treat the key as a per-app *identifier*, not a secret. HMAC + HWID + license validation are what actually authenticate; the API key routes the request to your dashboard account.
- Rotate the key via the dashboard if you suspect exposure.

---

## Electron: read this before you ship

Electron apps are two processes: **main** (Node runtime) and **renderer** (Chromium page). **Atlas must live in main, never in renderer.** The electron-example folder shows the exact pattern:

- `main.js` loads Atlas, holds all sensitive state, and exposes a narrow IPC surface
- `preload.js` bridges only the calls the renderer is allowed to make (`login`, `status`, `revealLicense`)
- `renderer.html` runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — it cannot reach Node, cannot load the DLL, cannot access the license directly

**Sensitive IPC handlers gate on `atlas.data.isAuthenticated()`** — if the session drops, the renderer can't extract data by replaying the call. See `revealLicense` for the pattern.

**Session watchdog runs in main, not renderer.** The DLL's own 5-second heartbeat runs regardless; the extra 30-second `checkAuthentication()` in `main.js` catches server-side revocations between heartbeats. On failure it calls `atlas.exit()` — the SDK's own kernel-level kill — rather than `app.quit()`, which an attacker could patch out of the JS bundle.

**Electron apps are inherently softer than native PEs.** Your `app.asar` unpacks to plaintext JavaScript. Atlas will authenticate you and gate features, but it cannot make your JS bundle itself tamper-proof — that's a limit of Electron, not Atlas. If you need the app code protected, move the sensitive logic into a native module you call from JS.

---

## Distribution

**GitHub-only distribution — no npm registry.** Users clone the repo or vendor it into their project:

```bash
# Option 1: git clone into a vendor directory
git clone https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git vendor/atlas-auth

# Option 2: git submodule (recommended for reproducible builds)
git submodule add https://github.com/atlassecuritysolutions/AtlasAuthentication-JS.git vendor/atlas-auth
```

Then reference locally:

```javascript
const atlas = require('./vendor/atlas-auth/src');
```

The `Atlas.dll` binary is committed to the repo — no separate download step, no build required. The SDK's own platform check in `src/index.js` throws on non-Win32 at require time, so cross-platform hosts get a clear error immediately.

**For Electron apps** — bundle `Atlas.dll` alongside your app binary via electron-builder's `extraResources`:

```json
"extraResources": [
    { "from": "vendor/atlas-auth/Atlas.dll", "to": "Atlas.dll" }
]
```

Then point the SDK at it:

```javascript
const path = require('path');
const atlas = require('./vendor/atlas-auth/src');
atlas.init({ dllPath: path.join(process.resourcesPath, 'Atlas.dll') });
```

---

## Auto-update (opt-in)

The JS SDK ships a GitHub-based auto-updater that mirrors the C++ SDK's MSBuild hook. Off by default. Opt in when you want your local `Atlas.dll` to stay current between releases.

```javascript
atlas.enableAutoUpdate({
    ack: 'I understand this pulls executable code from GitHub'
});
atlas.setApiKey('sk-...');
atlas.startup();  // updater probes GitHub in the background, never blocks startup
```

**What it does:**
- Compares the local `Atlas.dll` version against `github.com/atlassecuritysolutions/AtlasAuthentication-JS`
- If newer, downloads `Atlas.dll` + `Atlas.dll.sig`, verifies signature against a pinned Ed25519 pubkey
- Writes `Atlas.dll.new` sidecar — the DLL you're currently running is locked by Windows, so the swap happens on the NEXT Node process start
- Never runs in packaged Electron apps or when `NODE_ENV=production`

**CLI management:**
```
node manage_autoupdate.js status         # what's current state
node manage_autoupdate.js enable         # opt in
node manage_autoupdate.js disable        # opt out
node manage_autoupdate.js check          # probe now
node manage_autoupdate.js reset          # clear all state
node manage_autoupdate.js open-folder    # open %LOCALAPPDATA%\AtlasAuth
```

**Full security model + threat analysis:** `../docs/AutoUpdate.md`

---

## Verifying the binding

`test.js` is a smoke suite that talks to a real `Atlas.dll` and a real server. Run it after every DLL build to catch regressions at the binding-DLL boundary.

```bash
# Preconditions-only (no server hit) — verifies DLL loads, version gate, error paths.
node test.js

# Full run against your test license.
ATLAS_API_KEY=sk-xxx ATLAS_TEST_LICENSE=ATLAS-XXXX-XXXX-XXXX node test.js
```

Exit code: `0` = all passed, `1` = one or more failed, `2` = ran preconditions only (no test license was supplied).

---

## Building the DLL from source

`Atlas.dll` is built from the same C++ sources as `Atlas Auth.lib` — one project, two configurations.

1. Open `Auth Library/Atlas Auth/Atlas Auth.sln` in Visual Studio 2022.
2. Change the active configuration to **DLL-Release · x64**.
3. Build.
4. Output lands at `Auth Example/JS Integration/Atlas.dll` — no manual copy needed.

The DLL config adds one file (`AtlasExports.cpp`, the C ABI wrapper) and defines `ATLAS_BUILD_DLL`. The existing static-library configs (`Release|x64`, `Debug|x64`) are unchanged — C++ users see zero difference.

---

## Dashboard — Bans

[![Ban management](https://atlassecurity.site/readme-bans.png)](https://atlassecurity.site)

Bans issued from the dashboard lock by license key, HWID, IP, and up to 16+ hardware component hashes simultaneously. The notification confirms the ban was recorded against all hardware components. Active immediately — Simply enter a value, server finds matching details from IP's, licenses, HWID's, and even individual identifiers, and bans all in a cascade.

**Ban vectors (applied independently):**
- **License key** — key invalidated server-side, rejected at next heartbeat
- **Full HWID** — the combined fingerprint hash is banned
- **Per-component** — ban an individual NIC MAC, firmware UUID, or volume serial; the user cannot spoof just that component without shifting the full fingerprint
- **IP address** — global across all your applications
- **Deep ban** — flags all known fingerprint variants associated with the user

All bans propagate within one heartbeat cycle (≤5 seconds of the user's next check-in).

---

## Dashboard — Logs & Analytics

[![Connection logs and analytics](https://atlassecurity.site/readme-analytics.png)](https://atlassecurity.site)

Every event is logged with timestamp, type, license, IP, location, device, and HWID. Admin actions — session termination, messages sent — appear inline. The analytics tab shows auth response time, server load, uptime, and a live geographic heatmap of active connections.

**Log fields per entry:** timestamp · event type · license key · IP address · geolocation · device name · HWID hash · result · latency

**Filter by:** result (ALLOW / DENY / BAN) · license key · IP address · date range

---

## Server architecture

The Atlas backend is a **128-worker C++ TCP server** with a 16-shard session map and a 16-connection PostgreSQL pool.

- All application data (licenses, bans, hardware serials, session state) is cached in memory with microsecond invalidation on ban
- Session map is sharded — no global lock on concurrent auth requests
- Stat increments are batched and flushed to the database every 60 seconds, not on the hot path
- Log writes are async — zero I/O latency impact on auth response time
- Auth response time under load: **≤50ms**

---

## Error handling

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

---

**Premium starts at $19/month.** Monthly ($19), 6-month ($69, save 39%), annual ($99, save 57%). PayPal and crypto. Instant activation. [See plans →](https://atlassecurity.site/plans)

---

## Legal Notice

© 2025–2026 Atlas Security Solutions. All rights reserved.

This SDK exists for one purpose: to let developers integrate Atlas Authentication into their software. If you are a developer building an application and using this code to license and protect it through Atlas — you are exactly who this is for. Use it freely.

**The following acts are strictly prohibited without explicit written authorization from the owner, and apply to those who seek to abuse, exploit or undermine the Atlas platform, Atlas reserves all rights to pursue legal action:**

- Reverse engineering, decompiling, disassembling, or reconstructing the Atlas platform, its compiled binaries, network protocols, or server infrastructure
- Tampering with, bypassing, disabling, or circumventing any authentication check, anti-tamper control, or security mechanism within the Atlas system
- Accessing, probing, or interfering with Atlas servers, databases, or infrastructure without authorization
- Using knowledge of Atlas internals to build, assist, or contribute to competing platforms or security bypass tools

**Applicable Law & Enforcement:**

These acts constitute criminal and civil offenses enforceable under:

- **Saudi Arabia:** Anti-Cybercrime Law (Royal Decree No. M/17, 1428H) — Articles 3 and 4
- **United States:** Computer Fraud and Abuse Act (18 U.S.C. § 1030)
- **European Union:** Directive 2013/40/EU on Attacks Against Information Systems — binding across all EU member states
- **International:** WIPO Copyright Treaty and the TRIPS Agreement — enforceable across 180+ signatory nations

These instruments collectively provide jurisdiction and enforcement mechanisms across all major territories worldwide.

Atlas Security Solutions actively monitors for unauthorized access, reverse engineering attempts, and protocol analysis. Any violation will be met with immediate civil action, referral to the competent national authorities in the relevant jurisdiction, and pursuit of all available legal remedies — including injunctive relief, asset recovery, and cross-jurisdiction enforcement — without any prior notice or warning.

For permission requests or legal inquiries: [mail@atlassecurity.site](mailto:mail@atlassecurity.site) · [atlassecurity.site/legal](https://atlassecurity.site/legal)
