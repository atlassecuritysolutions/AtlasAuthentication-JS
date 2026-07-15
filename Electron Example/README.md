# Atlas Authentication — Electron Example

A real Electron desktop app: windowed login form → welcome screen, cold-steel design that mirrors the Atlas dashboard, Atlas in the main process with a narrow IPC surface, renderer fully sandboxed.

**For onboarding (create an Atlas account, get an API key, generate a license), see [`../README.md`](../README.md). For the Electron security model — READ IT before you ship — see [that section](../README.md#electron-security-model--read-before-you-ship) of the parent README.** This file covers only what's specific to this example.

---

## What's here

```
Electron Example/
├── README.md                            you are here
├── Atlas Auth Electron Example.js       main-process entry (Node runtime)
├── preload.js                           the IPC bridge — every renderer call is listed here
├── renderer.html                        the UI (sandboxed Chromium page)
└── package.json                         Electron-specific manifest (electron, koffi)
```

Requires the SDK sitting at [`../Atlas SDK/src`](../Atlas%20SDK/src/) and `Atlas.dll` at [`../Atlas SDK/Atlas.dll`](../Atlas%20SDK/Atlas.dll) — both are in this repo.

---

## Run

From this directory:

```
npm install       # installs electron + koffi
```

Then:

1. **Set your API key** in [`Atlas Auth Electron Example.js`](Atlas%20Auth%20Electron%20Example.js):
   ```js
   atlas.setApiKey('your-key');
   ```
2. Start the app:
   ```
   npm start
   ```

An Electron window opens (940×640). Type your license key, click **Sign in**. On success you land on a welcome screen with your session data — license (masked), HWID, expiry, IP, level, note — plus a live session uptime clock and **Sign out** / **Recheck session** buttons.

The main-process terminal (where you ran `npm start`) shows Atlas SDK output. DevTools opens automatically in dev; the renderer tab shows only the sandboxed page — it can't `require`, can't load DLLs, can't access the license directly.

---

## The three-file split

Electron is two processes: **main** (Node runtime) and **renderer** (Chromium page). Atlas must live in main, never in renderer. That's split across three files:

### `Atlas Auth Electron Example.js` — main

Loads Atlas, holds all sensitive state, exposes IPC handlers. Never sends the raw license, HWID, or session token to the renderer directly — every getter goes through an IPC handler that gates on `atlas.data.isAuthenticated()`.

Also runs the session watchdog:

```js
setInterval(() => {
    if (atlas.data.isAuthenticated() && !atlas.network.checkAuthentication()) {
        atlas.exit();   // ← NOT app.quit()
    }
}, 30_000);
```

On failure, calls `atlas.exit()` — the SDK's own kernel-level fastfail — not `app.quit()`, which is a soft signal an attacker can patch out of your JS bundle.

### `preload.js` — the bridge

The only file with access to both `ipcRenderer` and the renderer's `window`. Every call the renderer can make is whitelisted here:

```js
contextBridge.exposeInMainWorld('atlas', {
    login:   (licenseKey) => ipcRenderer.invoke('atlas:login',   licenseKey),
    status:  ()           => ipcRenderer.invoke('atlas:status'),
    signout: ()           => ipcRenderer.invoke('atlas:signout'),
    openUrl: (url)        => ipcRenderer.invoke('atlas:open-url', url),
    env:     ()           => ipcRenderer.invoke('atlas:env'),
});
```

If a call isn't in `preload.js`, the renderer can't reach it. Period.

### `renderer.html` — the UI

Runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Can only call `window.atlas.login()`, `window.atlas.status()`, etc. — the whitelisted preload surface. Cannot `require`, cannot load DLLs, cannot access Node globals.

Even if this page gets XSS'd, the attacker cannot load the DLL, cannot read the license, cannot leak the HWID, cannot bypass the authenticated-gate.

---

## URL whitelist

The example whitelists exactly one external URL for `shell.openExternal`:

```js
const ALLOWED_URLS = new Set(['https://atlassecurity.site']);
ipcMain.handle('atlas:open-url', async (_event, url) => {
    if (!ALLOWED_URLS.has(url)) return { ok: false, error: 'URL not allowed' };
    await shell.openExternal(url);
    return { ok: true };
});
```

Never pass a renderer-supplied URL directly to `shell.openExternal`. An XSS'd renderer could hand you `file://` or `javascript:`. Add every URL your app needs to open to this set explicitly.

---

## Shipping this pattern

Full [Distribution / shipping](../README.md#distribution--shipping) guide in the parent README. The Electron-specific bit:

Bundle `Atlas.dll` alongside your `.asar` via `electron-builder`'s `extraResources`:

```json
"extraResources": [
    { "from": "vendor/atlas-auth/Atlas SDK/Atlas.dll",     "to": "Atlas.dll" },
    { "from": "vendor/atlas-auth/Atlas SDK/Atlas.dll.sig", "to": "Atlas.dll.sig" }
]
```

Then point the SDK at the packaged path explicitly:

```js
const path = require('path');
const atlas = require('./vendor/atlas-auth/Atlas SDK/src');

atlas.init({
    dllPath: path.join(process.resourcesPath, 'Atlas.dll'),
});
```

Also hash your `app.asar` and register that SHA-256 in the dashboard's **Applications → Executable-hash whitelist** — from that moment, modified `.asar` copies fail auth server-side. See [The apphash](../README.md#the-apphash--pin-it-to-your-app-not-to-nodeexe) for the mechanics.

---

## Electron apps are inherently softer than native PEs

Your `app.asar` unpacks to plaintext JavaScript. Atlas will authenticate you and gate features, but **it cannot make your JS bundle itself tamper-proof** — that's a limit of Electron, not Atlas.

If you need the app *code* protected (not just gated), move the sensitive logic into a native module (C++ addon, protected with [Atlas Obfuscator](https://atlassecurity.site/obfuscator)) and call it from JS.

---

## License / legal

See [`../README.md`](../README.md#legal-notice).
