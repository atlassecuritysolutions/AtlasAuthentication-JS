# Atlas SDK — Node / Electron

License authentication and continuous binary protection for Windows x64 Node.js and Electron applications. The most complete authentication stack shipping for the JS ecosystem today — verifiable in the header, the DLL, and this repo.

Three calls — `atlas.API_KEY = 'your-key'`, `atlas.Startup()`, `atlas.License.Login(key)` — and your process authenticates, keeps verifying itself while it runs, and can be killed live from the dashboard.

---

Most JS auth libraries stop caring after `login()` resolves. Atlas doesn't. Login is the easy part; everything after it is what you're actually paying for.

- **Continuous integrity.** A per-session HMAC frame every 5 seconds, a `.text` + IAT recheck every 15, an inline-hook scan on `ws2_32.recv/send/connect` before every frame, and two independent threads checking each other with hardware performance counters. Any failure kills the process through a path with no user-mode handler to catch.
- **Hardware identity from 16 sources.** Firmware serials, TPM key hashes, PCI instance paths, per-device EDIDs — each a separate keyed hash. Spoof one, the other fifteen still ban.
- **Cascade bans.** Ban a license and the engine follows the HWID and IP unions across every account the fingerprint has ever touched, and bans the whole set.
- **Rules engine.** Per-app geofence, two-source anti-VPN (ip-api + proxycheck, cached 6 h), executable-hash whitelist. Cheapest checks first; first catch wins. All of it runs before the license table is opened.
- **Real email layer, built in.** 8-digit codes on new-device sign-ins, registration confirmation, password reset. Seller-branded, with IP / city / country / device on every code. No SMTP to configure.
- **Live control.** Kick sessions, ban HWIDs, push runtime variables without a rebuild. Every login lands in your dashboard **Logs** tab with IP, HWID, latency, and result.
- **First-class TypeScript.** `index.d.ts` ships alongside the binding — full types for `Atlas.Account`, `AccountLoginResult`, every namespace. No `@types` package needed.

**Also on the same account: [Atlas Obfuscator](https://atlassecurity.site/obfuscator)** — a Windows PE protector for the binary itself. Control-flow flattening, string encryption, VM-lifted hot paths, anti-debug and anti-dump baked into the output. Sold separately; bundled with Auth in Atlas Complete.

Free forever: 3 apps, 300 licenses across them, 3 file uploads per app. Full security stack, no feature gates. [Plans](https://atlassecurity.site/plans) lifts the caps.

[atlassecurity.site](https://atlassecurity.site) · [Dashboard](https://atlassecurity.site/dashboard) · [Docs](https://atlassecurity.site/docs) · [Legal](https://atlassecurity.site/legal) · [Discord](https://discord.gg/EG5dmpFaCF) · [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

---

## What's in this folder

```
JS Integration/
├── Atlas SDK/
│   ├── Atlas.dll                      the DLL that runs the protection stack
│   ├── Atlas.dll.sig                  Ed25519 release signature
│   ├── package.json                   declares `koffi`
│   └── src/
│       ├── index.js                   the binding — mirrors the C++ namespace 1:1
│       └── index.d.ts                 TypeScript typings
├── Console Example/                   Node CLI
├── Electron Example/                  main / preload / renderer
└── dev-tools/
    └── test.js                        smoke suite for the binding
```

`Atlas.dll` is prebuilt and versioned with the release. You don't rebuild the SDK to use it.

---

## Prerequisites

- Windows 10 or 11, x64. Atlas is Windows-x64 only — no Linux, macOS, ARM, WSL.
- [Node.js ≥ 18 (x64)](https://nodejs.org/). 32-bit Node cannot load `Atlas.dll`.
- npm (bundled with Node), used to install `koffi` and (for Electron) `electron`.
- An Atlas account. Sign up at <https://atlassecurity.site>, then **Applications → New application** for an API key and **Licenses → Generate** for a test key (`ATLAS-XXXXX-XXXXX`).

`koffi` is the only runtime dependency — a modern C ABI binding for Node with prebuilt x64 Windows binaries. No `node-gyp`, no MSVC build.

---

## Run the Console example

```
cd "JS Integration"
npm install
```

1. Open `Console Example/Atlas Auth Example.js`. Replace `'YOUR_API_KEY'` with your key (or set it inline in `Atlas SDK/src/index.js`).
2. Run it:
   ```
   node "Console Example/Atlas Auth Example.js"
   ```

The example asks which auth path to try:

```
Atlas Authentication Example

Choose an auth path:
  [1] License key       (single-user, HWID-bound)
  [2] Account sign-in   (username + password + email verification)
  [3] Register account  (create a new account)
```

Pick `[1]`, paste the license. On success:

```
--- User Information ---
License:      ATLAS-A9F2K-4RMXM
Expiry:       15-08-2026 14:32:00
IP:           45.11.42.187
HWID:         Atlas-4A9C...E1B2
Level:        1
Active Users: 1
Total Users:  3
```

The login is in your dashboard **Logs** tab with IP, HWID, latency, and result `ALLOW`. From **Sessions → Kick** you can terminate the session; the example ends within about five seconds.

Whole example is in `Console Example/Atlas Auth Example.js`.

---

## Run the Electron example

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

1. Copy the `Atlas SDK/` folder into your project (a `vendor/atlas/` folder is a reasonable place).
2. Install `koffi` from the SDK folder (or add it to your top-level `package.json`):
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

   atlas.API_KEY = 'your-key';
   atlas.Startup();

   const key = promptUserForLicense();
   if (!atlas.License.Login(key)) {
       console.log(atlas.Data.GetErrorMessage());
       process.exit(1);
   }

   runMyApplication();  // authenticated
   ```

Once you have a shipping build, compute its SHA-256 and paste it into **Applications → Executable-hash whitelist**. Modified copies get rejected server-side before the license is even checked. Multiple hashes are allowed, one per release.

For packaged Electron apps, whitelist the hash of your final `.exe` (the one from `electron-packager`), not `node.exe` / `Electron.exe`. Load the DLL from `process.resourcesPath` in production:

```js
process.env.ATLAS_DLL_PATH = require('path').join(process.resourcesPath, 'Atlas.dll');
const atlas = require('atlas-authentication');
```

---

## API reference

Full surface in `Atlas SDK/src/index.js` (typed in `index.d.ts`). Summary here.

### Session

```js
atlas.API_KEY = 'your-key';    // set before Startup, or leave inline in index.js
atlas.Startup();               // call once, at the top of main()
atlas.Logout();                // end the session, clear all state
atlas.Exit();                  // kill the process the hardest way Windows allows
```

### `atlas.License` — license-key sign-in

```js
atlas.License.Login(key);                              // key only (HWID-bound)
atlas.License.LoginUser(username, password);           // for a license bound to one user
atlas.License.Register(key, username, password);       // bind — does NOT sign in
```

### `atlas.Account` — username / password / email accounts

```js
const r = atlas.Account.Login(username, password);     // inspect r.status
atlas.Account.Register(username, password, email);     // email optional; needed for reset
atlas.Account.SubmitVerification(code);                // 8-digit sign-in code
atlas.Account.ResendVerification();                    // 60s cooldown
atlas.Account.ConfirmEmail(code);                      // for a pending registration
atlas.Account.HasPendingEmailConfirm();
atlas.Account.Redeem(license_key);                     // add a license to the signed-in account
atlas.Account.RequestPasswordReset(identifier);        // always returns true (anti-enumeration)
atlas.Account.CompletePasswordReset(code, new_pass);
```

`atlas.Account.Status` is one of `Ok`, `WrongCredentials`, `NeedsVerification`, `Banned`, `AccountPaused`, `ServerUnreachable`, `Error`. On `NeedsVerification` the server emailed the user an 8-digit code — pass it back through `SubmitVerification`. On `Ok`, `r.expiry` / `r.level` / `r.note` are populated.

### `atlas.Data` — session state, valid after sign-in

```js
// Identity
GetLicense()  GetUsername()  GetEmail()  GetPassword()  GetIP()  GetHWID()  GetDevice()
GetNote()  GetFirstSeenDate()  GetLastSeenDate()  GetUserId()  GetLevel()

// Expiry
GetExpiry()  GetDaysRemaining()  IsLifetime()  IsExpiringSoon(days = 7)

// Status
IsAuthenticated()  IsBanned()

// App-wide
GetActiveUserCount()  GetUserCount()

// Errors
GetErrorMessage()  HasError()  ClearError()
```

### `atlas.Network` — server RPCs on the current session

```js
CheckAuthentication();                        // force a fresh server round-trip
BanUser(reason, duration_minutes);            // duration = 0 → permanent
SubmitLog(text);                              // ≤ 512 chars, shows in Logs
ChangePassword(old_password, new_password);
Ping();                                       // ms to auth server, -1 if unreachable
```

### `atlas.Variables` — server-set config, no rebuild required

```js
atlas.Variables.Fetch('welcome_msg');         // '' if the key doesn't exist
atlas.Variables.FetchBool('beta_feature');    // 'true' / '1' / 'yes' → true; else false
atlas.Variables.FetchInt('max_items');        // 0 if missing or unparseable
```

### `atlas.Webhook` — fire-and-forget HTTP POSTs (unrelated to Atlas auth)

```js
atlas.Webhook.SendDiscord(webhook_url, message);
atlas.Webhook.SendDiscordEmbed(webhook_url, title, description, color);   // color = 0xRRGGBB
atlas.Webhook.Send(url, json_payload);
```

---

## The API-key model

The API key is a routing identifier. It tells the server which dashboard account the request belongs to. Authentication of each request rests on five things:

1. The X25519 handshake — derives a per-session HMAC key only your app and the server know.
2. The Ed25519 signature the server places on its handshake reply — verified against three keys pinned inside `Atlas.dll` (primary, backup, emergency). A nulled server cannot produce these signatures.
3. The HWID binding — the session key is derived with the HWID mixed in; a stolen session token doesn't work from a different machine.
4. The per-request nonce — replays are dropped.
5. The executable-hash whitelist, if you configured one.

A leaked API key does not by itself let someone impersonate a user. Still, treat it as sensitive: rotate on suspected exposure (**Settings → Rotate key**), keep it out of public source.

In Electron and packaged Node apps, never hardcode the API key in the renderer. Set it in the main process from a signed remote config, or from an env var the packaged exe reads at startup.

---

## Troubleshooting

**`koffi: Failed to load Atlas.dll`.**
Confirm `Atlas SDK/Atlas.dll` exists; set `ATLAS_DLL_PATH` explicitly to a fully-qualified path; in a packaged Electron app, check that `extraResources` copied `Atlas.dll` into `process.resourcesPath`.

**Node process silently exits on `Startup()`.**
Integrity check tripped the kill path. Dashboard **Logs** shows the reason. Common: API key still `'YOUR_API_KEY'`, debugger attached (VS Code JS debugger, Chrome DevTools inspector, `--inspect`), integrity check tripped. Electron renderer DevTools is fine; the main-process inspector is what Atlas refuses.

**`Login()` returns `false`, "Executable hash mismatch".**
You whitelisted an apphash, then rebuilt. Update the whitelist, or don't whitelist during active development.

**`Login()` returns `false`, "License banned" / "HWID banned".**
Check **Bans**.

**Packaged Electron app quits immediately.**
Almost always: `Atlas.dll` isn't in `process.resourcesPath` (check `extraResources`); or the apphash is auto-detecting `Electron.exe` because `app.asar` isn't where the SDK expected. Log the resolved DLL path and apphash on startup for a quick diagnosis.

**`Atlas SDK is Windows-only` at `require()`.**
Correct. Atlas is Windows x64 by product design. Use a native Windows Node install (no WSL, Docker, macOS, Linux).

Full FAQ: <https://atlassecurity.site/docs>.

---

## Support

<https://atlassecurity.site/docs> · [Discord](https://discord.gg/EG5dmpFaCF) · [mail@atlassecurity.site](mailto:mail@atlassecurity.site)

`dev-tools/test.js` is a smoke suite that talks to a real DLL and a real server — run it after a DLL upgrade to catch binding-vs-DLL regressions.

---

## Legal

© 2025–2026 Atlas Security Solutions. All rights reserved. Sold by Atlas Security Solutions, Jeddah, Kingdom of Saudi Arabia. This SDK exists so developers can integrate Atlas Authentication into their software — if that's you, use it freely.

Prohibited without written authorization: reverse engineering, decompiling, or reconstructing Atlas binaries, protocols, or server infrastructure; tampering with, bypassing, or disabling any authentication or anti-tamper control; probing or interfering with Atlas servers; using knowledge of Atlas internals to build competing platforms or bypass tools. Atlas monitors for unauthorized access and pursues violations under Saudi Arabia Anti-Cybercrime Law (Royal Decree M/17, 1428H, Articles 3–4), the U.S. Computer Fraud and Abuse Act (18 U.S.C. § 1030), EU Directive 2013/40/EU, and WIPO / TRIPS. Remedies include civil action, injunctive relief, and cross-jurisdiction enforcement without prior notice.

Permission requests and legal inquiries: [mail@atlassecurity.site](mailto:mail@atlassecurity.site) · <https://atlassecurity.site/legal>
