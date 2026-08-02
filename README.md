# Atlas Authentication — Node / Electron SDK

![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white) ![Language](https://img.shields.io/badge/language-Node.js-339933?logo=nodedotjs&logoColor=white) ![License](https://img.shields.io/badge/license-proprietary-lightgrey)

[atlassecurity.site](https://atlassecurity.site) · [Dashboard](https://atlassecurity.site/dashboard) · [Docs](https://atlassecurity.site/docs) · [Discord](https://discord.gg/EG5dmpFaCF) · [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

Most auth libraries stop caring once login succeeds — the client is trusted for the rest of the session. Atlas doesn't. After `Login` returns, the SDK keeps proving to the server that the process is still the one that logged in: same binary, same memory, same network stack, still alive. If any of that stops being true, the process dies. Built for teams whose licensing keeps getting bypassed and whose binaries keep getting cracked.

Two calls get you there:

```js
atlas.Startup();
atlas.License.Login(key);
```

---

## Contents

- [Repo layout](#repo-layout)
- [Prerequisites](#prerequisites)
- [Get an account, an app, a license](#get-an-account-an-app-a-license)
- [Console example](#console-example)
- [Electron example](#electron-example)
- [Integrate into your project](#integrate-into-your-project)
- [API reference](#api-reference)
  - [Session lifecycle](#session-lifecycle)
  - [`atlas.License`](#atlaslicense)
  - [`atlas.Account`](#atlasaccount)
  - [`atlas.Data`](#atlasdata)
  - [`atlas.Network`](#atlasnetwork)
  - [`atlas.Variables`](#atlasvariables)
  - [`atlas.Webhook`](#atlaswebhook)
- [What Login starts](#what-login-starts)
- [The API-key model](#the-api-key-model)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Legal](#legal)

---

## Repo layout

```
JS Integration/
├── Atlas SDK/
│   ├── Atlas.dll                      the DLL that runs the protection stack
│   ├── Atlas.dll.sig                  Ed25519 release signature
│   ├── Atlas.h                        the C API header (reference)
│   ├── Atlas.lib                      import library
│   ├── package.json                   declares `koffi`
│   └── src/
│       ├── index.js                   the binding — mirrors the C++ namespace 1:1
│       └── index.d.ts                 TypeScript typings
├── Console Example/                   Node CLI — license, account, and register paths
├── Electron Example/                  main / preload / renderer
└── dev-tools/
    └── test.js                        smoke suite for the binding
```

`Atlas.dll` is prebuilt and versioned with the release. You don't rebuild the SDK to use it.

---

## Prerequisites

| | |
|---|---|
| Windows 10 or 11 (x64) | Atlas is Windows-x64 only. |
| [Node.js ≥ 18 (x64)](https://nodejs.org/) | 32-bit Node cannot load `Atlas.dll`. |
| npm | Bundled with Node — installs `koffi` and (for Electron) `electron`. |
| An Atlas account | [atlassecurity.site](https://atlassecurity.site) — free. |

`koffi` is the only runtime dependency — a modern C ABI binding for Node with prebuilt x64 Windows binaries. No `node-gyp`, no MSVC build.

---

## Get an account, an app, a license

1. Sign up at [atlassecurity.site](https://atlassecurity.site), verify your email.
2. **Applications → New application** — name it whatever; users never see it. Copy the **API key** it hands you.
3. **Licenses → Generate** — pick a duration (Weekly / Monthly / Lifetime / custom), a level (`1` for basic, `2+` for tiered), and optionally a note. Copy the key.
4. *(Optional, for the account flow)* **Applications → Account policy** — choose when verification codes fire (never / first login / every N / once per day / new HWID / new HWID or IP / always). Toggle "email required at registration" if you want to force email addresses.

Free tier: 3 applications, 300 licenses across them, 3 file uploads per app.

---

## Console example

Covers all three auth paths.

```
cd "JS Integration"
npm install
```

1. Open [`Console Example/Atlas Auth Example.js`](Console%20Example/Atlas%20Auth%20Example.js). Replace `'YOUR_API_KEY'` with your key. Save.
2. Run it:
   ```
   node "Console Example/Atlas Auth Example.js"
   ```

The example asks which auth path to try:

```
Atlas Authentication Example

Choose an auth path:
  [1] License key       (classic license authentication)
  [2] Account sign-in   (username + password + email verification)
  [3] Register account  (creates a new account, optional email)

Choice [1/2/3]:
```

Pick `[1]`, paste your license key. On success:

```
--- User Information ---
License:      ATLAS-A9F2K-4RMXM
Expiry:       15-08-2026 14:32:00
IP:           45.11.42.187
HWID:         Atlas-4A9C...E1B2
Level:        1
Note:         None
Active Users: 1
Total Users:  3
```

Open the dashboard **Logs** tab — the login is there with IP, HWID, latency, and result `ALLOW`. From **Sessions → Kick**, terminate the session; the example exits within about five seconds.

Pick `[2]` for the account flow — if the server asks for verification, an 8-digit code arrives by email and the example prompts for it inline. Pick `[3]` to register a new account.

Full source: [`Console Example/Atlas Auth Example.js`](Console%20Example/Atlas%20Auth%20Example.js).

---

## Electron example

Same SDK, running from an Electron main process. The renderer is sandboxed — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Atlas lives in main; the renderer only sees the narrow IPC surface in `preload.js`.

```
cd "Electron Example"
npm install
npm start
```

The DLL is loaded once at main-process startup. Credentials cross the IPC boundary only when the renderer explicitly submits them; every sensitive handler checks `atlas.Data.IsAuthenticated()` before doing anything.

To package as a distributable Windows app:

```
npm run build:exe
```

The build script uses `electron-packager` and copies `Atlas.dll` into the resources folder alongside the exe.

---

## Integrate into your project

1. Copy the [`Atlas SDK/`](Atlas%20SDK/) folder into your project (a `vendor/atlas/` folder is conventional).
2. Install `koffi` — from the SDK folder, or add it to your top-level `package.json`:
   ```
   npm install koffi
   ```
3. Set your API key from your own code before `Startup()`, or leave it inline in `Atlas SDK/src/index.js`:
   ```js
   const atlas = require('./vendor/atlas/Atlas SDK/src');
   atlas.API_KEY = process.env.ATLAS_KEY;
   atlas.Startup();
   ```
4. Wire it up:
   ```js
   const atlas = require('./vendor/atlas/Atlas SDK/src');

   atlas.API_KEY = 'YOUR_API_KEY';
   atlas.Startup();

   const key = promptUserForLicense();
   if (!atlas.License.Login(key)) {
       console.log(atlas.Data.GetErrorMessage());
       process.exit(1);
   }

   runMyApplication();  // authenticated
   ```

Once you have a shipping build, compute its SHA-256 and paste it into **Applications → Executable-hash whitelist**. Modified copies are then rejected server-side before the license is even checked. You can whitelist one hash per release and revoke old ones from the same panel.

For packaged Electron apps, whitelist the hash of your final `.exe` (the one from `electron-packager`), not `node.exe` / `Electron.exe`. Load the DLL from `process.resourcesPath` in production:

```js
process.env.ATLAS_DLL_PATH = require('path').join(process.resourcesPath, 'Atlas.dll');
const atlas = require('atlas-authentication');
```

The binding ships with TypeScript typings (`src/index.d.ts`) — full types for `atlas.Account`, `AccountLoginResult`, and every namespace. No `@types` package needed.

---

## API reference

Full API surface in [`Atlas SDK/src/index.js`](Atlas%20SDK/src/index.js) (typed in [`Atlas SDK/src/index.d.ts`](Atlas%20SDK/src/index.d.ts)).

### Session lifecycle

Every integration touches these four calls, regardless of auth path.

```js
atlas.API_KEY = 'YOUR_API_KEY';    // set before Startup, or leave inline in index.js
atlas.Startup();                   // call once at the top of main()
atlas.Logout();                    // end the session, clear all state
atlas.Exit();                      // kill the process the hardest way Windows allows
```

### `atlas.License`

License-key sign-in: single-user, hardware-bound, no email or verification code.

```js
atlas.License.Login(license_key);                   // key only, HWID-bound
atlas.License.LoginUser(username, password);        // for a license bound to one user
atlas.License.Register(license_key,                 // bind an existing license to
                       username, password);         // a new user (does NOT sign in)
```

**`Login` return value and side effects**

| | |
|---|---|
| Returns `true` | License valid, HWID accepted (or first-seen and now bound), session established. |
| Returns `false` | See `atlas.Data.GetErrorMessage()` — invalid key, expired, banned, HWID mismatch, executable-hash mismatch, or server unreachable. |
| On success | Starts the heartbeat and integrity threads (see [What Login starts](#what-login-starts)); populates `atlas.Data`. |
| On failure | No threads started; no partial session state left behind. |

### `atlas.Account`

Username, password, and email accounts, with 8-digit email verification, password reset, and license redemption. Whether a verification code is required on a given sign-in is controlled per-app in the dashboard.

```js
// Inspect r.status to drive your flow.
const r = atlas.Account.Login(username, password);
atlas.Account.Register(username, password, email);   // email optional; needed for reset
atlas.Account.SubmitVerification(code);              // 8-digit sign-in code
atlas.Account.ResendVerification();                  // 60 s cooldown
atlas.Account.ConfirmEmail(code);                    // for a pending registration
atlas.Account.HasPendingEmailConfirm();
atlas.Account.Redeem(license_key);                   // add a license to the signed-in account
atlas.Account.RequestPasswordReset(identifier);      // always returns true (anti-enumeration)
atlas.Account.CompletePasswordReset(code, new_pass);
```

`atlas.Account.Status` is one of `Ok`, `WrongCredentials`, `NeedsVerification`, `Banned`, `AccountPaused`, `ServerUnreachable`, `Error`.

- On `Ok` — `r.expiry`, `r.level`, `r.note` are populated.
- On `NeedsVerification` — the server emailed an 8-digit code; pass it to `SubmitVerification`. `r.masked_email`, `r.sign_in_ip`, `r.sign_in_country` are populated so you can render something like "we sent a code to a•••@example.com from Riyadh."

### `atlas.Data`

Session state, valid once `Login` succeeds.

```js
// Identity
GetLicense()  GetUsername()  GetEmail()  GetIP()  GetHWID()  GetDevice()
GetNote()  GetUserId()  GetLevel()
GetFirstSeenDate()  GetLastSeenDate()

// Expiry
GetExpiry()  GetDaysRemaining()  IsLifetime()  IsExpiringSoon(days = 7)

// Status
IsAuthenticated()  IsBanned()

// App-wide counts
GetActiveUserCount()  GetUserCount()

// Errors
GetErrorMessage()  HasError()  ClearError()
```

### `atlas.Network`

Server operations that act on the current session.

```js
CheckAuthentication();                        // force a fresh server round-trip
BanUser(reason, duration_minutes);            // duration = 0 → permanent
SubmitLog(text);                              // ≤ 512 chars, appears in dashboard Logs
ChangePassword(old_password, new_password);   // account flow only
Ping();                                       // round-trip ms to the auth server, -1 if unreachable
```

### `atlas.Variables`

Configuration values set from the dashboard and read at runtime — change them without a rebuild.

```js
atlas.Variables.Fetch('welcome_msg');         // '' if the key doesn't exist
atlas.Variables.FetchBool('beta_feature');    // 'true' / '1' / 'yes' → true; else false
atlas.Variables.FetchInt('max_items');        // 0 if missing or unparseable
```

### `atlas.Webhook`

Fire-and-forget HTTP POSTs, unrelated to authentication — a convenience for shipping Discord notifications and generic webhooks from your app.

```js
atlas.Webhook.SendDiscord(webhook_url, message);
atlas.Webhook.SendDiscordEmbed(webhook_url, title, description, color);  // color = 0xRRGGBB
atlas.Webhook.Send(url, json_payload);
```

---

## What Login starts

On success, `Login` starts background threads inside `Atlas.dll`. You don't manage any of them directly — they run until `Logout()`, `Exit()`, or a failed check terminates the process.

- **Every 5 seconds** — a heartbeat signed with a per-session HMAC key, sequence-numbered, echoing the server's newest challenge nonce. The server can push messages, kick the session, or terminate the process in its reply.
- **Every 15 seconds** — a deep sweep: `.text` CRC compared against the startup snapshot, full IAT check against the resolved-imports snapshot.
- **Before every heartbeat** — the first bytes of `ws2_32.recv` / `send` / `connect` are inspected for hook signatures. A hooked network function is the standard foundation for a man-in-the-middle on the auth channel, so the SDK terminates before any data crosses it.
- **Continuously** — the executable's page map is compared against the post-login snapshot; PEB, `NtQueryInformationProcess`, `DR0`–`DR7`, and VEH debugger checks run; two independent threads verify each other's liveness through hardware performance counters.

Any failure terminates the process at kernel level. There is no dialog, no exception you can catch, no signal you can hook.

---

## The API-key model

The API key is a **routing identifier** — it tells the server which dashboard account a request belongs to. It is not what authenticates a request. That rests on:

1. An X25519 handshake, deriving a fresh HMAC key per session.
2. The Ed25519 signature the server places on its handshake reply, verified against three keys pinned inside `Atlas.dll` (primary, backup, emergency). A nulled server can't produce these signatures.
3. HWID binding — the session key is derived with the HWID mixed in, so a stolen session token doesn't work from a different machine.
4. A per-request nonce — replays are dropped.
5. The executable-hash whitelist, if you've configured one.

> [!IMPORTANT]
> A leaked API key alone doesn't let an attacker impersonate a user — but treat it as sensitive. Rotate it on suspected exposure (**Settings → Reset API Key**) and keep it out of public source.

In Electron and packaged Node apps, never hardcode the API key in the renderer. Set it in the main process from a signed remote config, or from an env var the packaged exe reads at startup.

---

## Troubleshooting

**`koffi: Failed to load Atlas.dll`** — confirm `Atlas SDK/Atlas.dll` exists; set `ATLAS_DLL_PATH` explicitly to a fully-qualified path; in a packaged Electron app, check that `extraResources` copied `Atlas.dll` into `process.resourcesPath`.

**Node process silently exits on `Startup()`** — an integrity check tripped the kill path. Dashboard **Logs** shows the reason. Common causes: API key still `'YOUR_API_KEY'`; API key belongs to a deleted app; a debugger is attached (VS Code JS debugger, Chrome DevTools inspector, `--inspect`) — Electron renderer DevTools is fine, the main-process inspector is what Atlas refuses.

**`Login()` returns `false`, "Executable hash mismatch"** — you whitelisted a hash and then rebuilt. Update the whitelist, or don't whitelist during active development.

**`Login()` returns `false`, "License banned" / "HWID banned"** — check **Bans** in the dashboard.

**Packaged Electron app quits immediately** — almost always: `Atlas.dll` isn't in `process.resourcesPath` (check `extraResources`), or the apphash is auto-detecting `Electron.exe` because `app.asar` isn't where the SDK expected. Log the resolved DLL path and apphash on startup for a quick diagnosis.

**`Atlas SDK is Windows-only` at `require()`** — correct. Atlas is Windows x64 by product design. Use a native Windows Node install (no WSL, Docker, macOS, Linux).

Full FAQ: [atlassecurity.site/docs](https://atlassecurity.site/docs).

---

## Support

- **Docs** — [atlassecurity.site/docs](https://atlassecurity.site/docs)
- **Discord** — [discord.gg/EG5dmpFaCF](https://discord.gg/EG5dmpFaCF) (fastest response)
- **Email** — [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

Bug reports: include your OS version, Node.js version, the failing SDK call, and the dashboard **Logs** entry if there is one.

`dev-tools/test.js` is a smoke suite that talks to a real DLL and a real server — run it after a DLL upgrade to catch binding-vs-DLL regressions.

The DLL's source isn't distributed with this repo. If you need a custom build or believe you've found a bug in `Atlas.dll` itself, contact support — the binding in this repo is thin; the protection stack lives in the DLL.

---

## Legal

© 2025–2026 Atlas Security Solutions. All rights reserved. Sold by Atlas Security Solutions, Jeddah, Kingdom of Saudi Arabia.

This SDK exists so developers can integrate Atlas Authentication into their software. If that's you, use it freely.

**Prohibited without explicit written authorization:**
- Reverse engineering, decompiling, disassembling, or reconstructing Atlas binaries, protocols, or server infrastructure
- Tampering with, bypassing, or disabling any authentication or anti-tamper control
- Probing or interfering with Atlas servers or databases
- Using knowledge of Atlas internals to build competing platforms or bypass tools

Enforcement: Saudi Arabia Anti-Cybercrime Law (Royal Decree M/17, 1428H, Articles 3–4); U.S. Computer Fraud and Abuse Act (18 U.S.C. § 1030); EU Directive 2013/40/EU; WIPO / TRIPS (180+ signatory nations).

Atlas monitors for unauthorized access, reverse engineering, and protocol analysis. Violations are met with civil action, referral to competent authorities, and pursuit of all available remedies — injunctive relief, asset recovery, and cross-jurisdiction enforcement — without prior notice.

Permission requests and inquiries: [mail@atlassecurity.site](mailto:mail@atlassecurity.site) · [atlassecurity.site/legal](https://atlassecurity.site/legal)