# Atlas Authentication — Node.js Console Example

Minimal Atlas integration for Node. Prompts for a license, authenticates against the Atlas server, and prints the resulting session data. Line-for-line port of the [C++ Console example](../../C++%20Integration/Console%20Example/) — same flow, same fields, same order.

**For onboarding (create an Atlas account, get an API key, generate a license), see [`../README.md`](../README.md).** This file covers only what's specific to this example.

---

## What's here

```
Console Example/
├── README.md                    you are here
└── Atlas Auth Example.js        the whole example — ~60 lines
```

Requires the SDK sitting at [`../shared/src`](../shared/src/) and `Atlas.dll` at [`../shared/Atlas.dll`](../shared/Atlas.dll) — both are in this repo.

---

## Run

From the JS Integration root (one level up):

```
npm install           # installs koffi
```

Then:

1. **Set your API key** in [`Atlas Auth Example.js`](Atlas%20Auth%20Example.js):
   ```js
   atlas.setApiKey('your-key');
   ```
2. Run it:
   ```
   node "Console Example/Atlas Auth Example.js"
   ```

You'll see:

```
Atlas Authentication Example

Enter license:
```

Paste your test license key, press Enter. On success:

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

Now check the dashboard's **Logs** tab — the login is there with IP, HWID, latency, result = `ALLOW`. Kick the session from **Sessions → Kick** and the Node process terminates within 5 seconds via `__fastfail`. Full loop verified.

---

## What the code does

Just the three moves:

1. **`atlas.setApiKey(key)`** — must be called before `startup()`. Sets `Atlas::API_KEY`.
2. **`atlas.startup()`** — initializes the DLL, snapshots executable pages, starts watchdog threads.
3. **`atlas.login(license)`** — authenticates against the server. Returns `true` / `false`.

That's the shape. Full API surface in [`../shared/src/index.js`](../shared/src/index.js); reference table in [`../README.md`](../README.md#api-reference).

---

## Prefer a real desktop app?

If you want a windowed Electron app instead of a console prompt, use [`../Electron Example/`](../Electron%20Example/) — same Atlas SDK, real Chromium UI, sandboxed renderer, narrow IPC surface.

---

## License / legal

See [`../README.md`](../README.md#legal-notice).
