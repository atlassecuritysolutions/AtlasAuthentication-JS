// ============================================================================
// Atlas Authentication SDK — Node.js binding
//
// Wraps Atlas.dll (built from the same C++ sources as the .lib) via koffi.
// The high-level shape mirrors the C++ namespace exactly:
//
//   const atlas = require('./vendor/atlas-auth/src');
//   atlas.setApiKey('...');
//   atlas.startup();
//   if (!atlas.login(key)) throw new Error(atlas.data.getErrorMessage());
//   console.log(atlas.data.getLicense());
//   atlas.network.checkAuthentication();
//
// Everything else — heartbeat, integrity checks, watchdog, remote kill — runs
// automatically inside the DLL from Startup() onwards. This binding is a
// transport, not a re-implementation.
//
// This module is main-process only in Electron. See the electron-example
// folder for the IPC pattern that keeps the renderer sandboxed.
// ============================================================================

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const updater = require('./updater');

// ── platform gate ───────────────────────────────────────────────────────────
// Atlas is Windows x64. Fail loudly at load-time rather than at first call.
if (process.platform !== 'win32') {
    throw new Error(
        `Atlas SDK is Windows-only. Detected platform: ${process.platform}. ` +
        `See atlassecurity.site/docs for cross-platform roadmap.`
    );
}
if (process.arch !== 'x64') {
    throw new Error(
        `Atlas SDK requires x64 Node. Detected arch: ${process.arch}. ` +
        `A 32-bit build will not run against Atlas.dll.`
    );
}

// koffi is loaded lazily and via require (not import) so the module works
// under CommonJS Electron main and any Node ≥18.
let koffi;
try { koffi = require('koffi'); }
catch (e) {
    throw new Error(
        `koffi is required to load Atlas.dll. Install it: npm install koffi\n` +
        `Original error: ${e.message}`
    );
}

// ── DLL location resolution ─────────────────────────────────────────────────
// Order of preference:
//   1. Explicit path via ATLAS_DLL_PATH env var (used in dev + tests)
//   2. Path passed to `init({ dllPath: '...' })`
//   3. Atlas.dll next to this module (installed via npm)
//   4. Atlas.dll in the current working directory (last resort for scripts)
function resolveDllPath(explicit) {
    if (explicit) return path.resolve(explicit);
    if (process.env.ATLAS_DLL_PATH) return path.resolve(process.env.ATLAS_DLL_PATH);
    // Package-relative — the DLL is shipped next to src/ in JS Integration/
    const packaged = path.resolve(__dirname, '..', 'Atlas.dll');
    return packaged;
}

// ── version contract ────────────────────────────────────────────────────────
// This binding was written against DLL surface v2.x. It refuses to run
// against a different major (breaking export ABI). Within a major we're
// add-only, so a newer DLL is fine but an older one may be missing
// exports we resolve at bind time.
const BINDING_VERSION = '2.0.1';
const REQUIRED_DLL_MAJOR = 2;

function parseSemver(s) {
    // Best-effort — accepts "1.0.0", "1.2", "1", tolerates trailing metadata.
    const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(s || ''));
    if (!m) return null;
    return { major: +m[1], minor: +(m[2] || 0), patch: +(m[3] || 0) };
}

// ── status codes (mirror AtlasExports.cpp enum) ─────────────────────────────
const Status = Object.freeze({
    OK: 0,
    NOT_STARTED: 1,
    NO_API_KEY: 2,
    LOGIN_FAILED: 3,
    NOT_AUTHED: 4,
    BAD_ARG: 5,
    BUFFER_TOO_SMALL: 6,
    SERVER: 7,
    INTERNAL: 8,
});

// Map a numeric status back to a readable name. Not localized on purpose:
// the log surface (dashboard) is the localized surface, this is for devs.
function statusName(code) {
    const abs = Math.abs(code);
    for (const [name, value] of Object.entries(Status)) {
        if (value === abs) return name;
    }
    return `UNKNOWN(${code})`;
}

class AtlasError extends Error {
    constructor(code, context) {
        super(`Atlas ${statusName(code)}${context ? `: ${context}` : ''}`);
        this.name = 'AtlasError';
        this.code = Math.abs(code);
        this.statusName = statusName(code);
    }
}

// ── DLL binding state ───────────────────────────────────────────────────────
let lib = null;                 // koffi library handle
let fns = null;                 // resolved function handles
let didStartup = false;         // startup() called at least once (successfully)
let dllVersion = null;          // discovered on first bind
let didSetQuiet = false;        // ensure quiet mode is set at most once per process
let apiKeyIsSet = false;        // setApiKey succeeded — startup preflight uses this

// Bind every export lazily on first use. Doing this at require-time would
// force the DLL to load even for tools that just want to check `Atlas.Status`.
function ensureBound(options) {
    if (fns) return;
    const dllPath = resolveDllPath(options && options.dllPath);
    // If a sidecar Atlas.dll.new was placed by a previous session's
    // updater run, promote it BEFORE koffi loads. Once koffi has the DLL
    // open, Windows locks the file and we can't swap it. This is the
    // moral equivalent of the C++ updater's MSBuild pre-compile step.
    // Never throws — worst case the sidecar sticks around for a future try.
    try { updater.promotePendingSidecar(dllPath); } catch { /* best effort */ }
    try {
        lib = koffi.load(dllPath);
    } catch (e) {
        throw new Error(
            `Failed to load Atlas.dll from ${dllPath}\n` +
            `Set ATLAS_DLL_PATH or pass { dllPath: '...' } to init().\n` +
            `Original error: ${e.message}`
        );
    }

    // Every declaration below mirrors the extern "C" signatures in
    // AtlasExports.cpp verbatim. Any drift will fail on first call, not silently.
    try {
        fns = {
            SetApiKey:           lib.func('int __cdecl Atlas_SetApiKey(const char*)'),
            SetQuiet:            lib.func('int __cdecl Atlas_SetQuiet(int)'),
            SetAppHashPath:      lib.func('int __cdecl Atlas_SetAppHashPath(const char*)'),
            SetAppHash:          lib.func('int __cdecl Atlas_SetAppHash(const char*)'),
            GetResolvedAppHash:  lib.func('int __cdecl Atlas_GetResolvedAppHash(_Out_ char*, size_t)'),
            Startup:             lib.func('int __cdecl Atlas_Startup()'),
            Login:               lib.func('int __cdecl Atlas_Login(const char*)'),
            IsAuthenticated:     lib.func('int __cdecl Atlas_IsAuthenticated()'),
            IsBanned:            lib.func('int __cdecl Atlas_IsBanned()'),
            IsDllHost:           lib.func('int __cdecl Atlas_IsDllHost()'),
            Exit:                lib.func('void __cdecl Atlas_Exit()'),
            CheckAuthentication: lib.func('int __cdecl Atlas_CheckAuthentication()'),
            BanUser:             lib.func('int __cdecl Atlas_BanUser(const char*, int)'),
            SubmitLog:           lib.func('int __cdecl Atlas_SubmitLog(const char*)'),
            Download:            lib.func('int __cdecl Atlas_Download(int, _Out_ uint8_t*, size_t)'),
            GetLicense:          lib.func('int __cdecl Atlas_GetLicense(_Out_ char*, size_t)'),
            GetHWID:             lib.func('int __cdecl Atlas_GetHWID(_Out_ char*, size_t)'),
            GetIP:               lib.func('int __cdecl Atlas_GetIP(_Out_ char*, size_t)'),
            GetExpiry:           lib.func('int __cdecl Atlas_GetExpiry(_Out_ char*, size_t)'),
            GetLevel:            lib.func('int __cdecl Atlas_GetLevel(_Out_ char*, size_t)'),
            GetNote:             lib.func('int __cdecl Atlas_GetNote(_Out_ char*, size_t)'),
            GetUserCount:        lib.func('int __cdecl Atlas_GetUserCount(_Out_ char*, size_t)'),
            GetActiveUserCount:  lib.func('int __cdecl Atlas_GetActiveUserCount(_Out_ char*, size_t)'),
            GetErrorMessage:     lib.func('int __cdecl Atlas_GetErrorMessage(_Out_ char*, size_t)'),
            Version:             lib.func('int __cdecl Atlas_Version(_Out_ char*, size_t)'),
        };
    } catch (e) {
        // Any missing export means the loaded DLL is older than this binding
        // (or drifted from AtlasExports.cpp). Fail with a specific message —
        // "unresolved import Atlas_SetQuiet" beats "koffi crash" for triage.
        throw new Error(
            `Atlas.dll at ${dllPath} is missing a required export. ` +
            `This binding requires DLL surface >= ${BINDING_VERSION}. ` +
            `Original error: ${e.message}`
        );
    }

    // Version discovery + hard gate on major mismatch. Reading the version
    // is safe pre-Startup; Atlas_Version() is a pure metadata accessor.
    dllVersion = readString(fns.Version);
    const semver = parseSemver(dllVersion);
    if (!semver) {
        throw new Error(
            `Atlas.dll returned unparseable version: ${JSON.stringify(dllVersion)}. ` +
            `Expected semver like "1.0.0".`
        );
    }
    if (semver.major !== REQUIRED_DLL_MAJOR) {
        throw new Error(
            `Atlas.dll version ${dllVersion} is incompatible with binding ` +
            `${BINDING_VERSION}. This binding requires DLL major version ` +
            `${REQUIRED_DLL_MAJOR}. Upgrade the binding or downgrade the DLL.`
        );
    }

    // Opt into headless mode by default. Node/Electron hosts don't want the
    // SDK popping modal MessageBoxes on startup failure; they want a return
    // code they can display in their own UI. A user who explicitly wants
    // modals can call `atlas.setQuiet(false)` before startup().
    if (!didSetQuiet) {
        try { fns.SetQuiet(1); didSetQuiet = true; } catch { /* older DLL — best effort */ }
    }
}

// ── size-query buffer pattern helper ────────────────────────────────────────
// The DLL uses the standard C pattern: pass NULL/0 to get bytes-needed, then
// allocate and call again. Wrapping this once here means the entire API below
// is one-liners.
function readString(fn) {
    // Do NOT ensureBound here — this is called from ensureBound itself for
    // the version probe, so it must be safe pre-bind. Callers outside
    // ensureBound must ensure fns is set.
    const needed = fn(null, 0);
    if (needed <= 0) {
        // Negative return = negated status code; empty string on 0.
        if (needed === 0) return '';
        throw new AtlasError(needed);
    }
    const buf = Buffer.alloc(needed);
    const written = fn(buf, needed);
    if (written < 0) throw new AtlasError(written);
    // Strip the trailing NUL that copy_out() wrote.
    return buf.slice(0, written - 1).toString('utf8');
}

// ── input validation helpers ────────────────────────────────────────────────
// Repeated shape across the API — extract for consistency + a single place
// to change if we start accepting more permissive input.
function requireNonEmptyString(name, value) {
    if (typeof value !== 'string') {
        throw new AtlasError(Status.BAD_ARG, `${name} must be a string, got ${typeof value}`);
    }
    if (value.length === 0) {
        throw new AtlasError(Status.BAD_ARG, `${name} must be non-empty`);
    }
    // The DLL's own limits will reject overlong strings server-side, but a
    // JS-side sanity cap catches obvious bugs (someone accidentally passing
    // a file buffer as a string) before they hit the wire.
    if (value.length > 65536) {
        throw new AtlasError(Status.BAD_ARG, `${name} exceeds 64KB — probably a bug`);
    }
}

function requireInt(name, value, { min, max } = {}) {
    if (!Number.isInteger(value)) {
        throw new AtlasError(Status.BAD_ARG, `${name} must be an integer, got ${typeof value === 'number' ? value : typeof value}`);
    }
    if (min != null && value < min) {
        throw new AtlasError(Status.BAD_ARG, `${name} must be >= ${min}, got ${value}`);
    }
    if (max != null && value > max) {
        throw new AtlasError(Status.BAD_ARG, `${name} must be <= ${max}, got ${value}`);
    }
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the binding with explicit options. Optional — call before
 * setApiKey() if you need to override the DLL path.
 */
function init(options) {
    ensureBound(options || {});
}

/**
 * Opt out of / into headless mode. By default the binding runs in quiet mode
 * (no modal MessageBoxes from the SDK). Pass true to re-enable modals.
 * Must be called before startup(). Idempotent.
 */
function setQuiet(quiet) {
    ensureBound();
    const rc = fns.SetQuiet(quiet ? 1 : 0);
    if (rc !== Status.OK) throw new AtlasError(rc);
    didSetQuiet = true;
    return true;
}

/**
 * Set the API key. Must be called before startup(). Matches the C++ pattern
 * where the user's code defines `Atlas::API_KEY`.
 */
function setApiKey(apiKey) {
    ensureBound();
    requireNonEmptyString('apiKey', apiKey);
    if (apiKey === 'YOUR_API_KEY_HERE') {
        throw new AtlasError(Status.BAD_ARG, 'apiKey is the placeholder string — set your real key');
    }
    const rc = fns.SetApiKey(apiKey);
    if (rc !== Status.OK) throw new AtlasError(rc);
    apiKeyIsSet = true;
    return true;
}

// ── apphash surface ────────────────────────────────────────────────────────
//
// The DLL's default apphash is SHA-256 of GetModuleFileNameA(NULL), which under
// a JS host is node.exe / Electron.exe — not what identifies YOUR app. These
// helpers let you pin the apphash to a file that actually represents your app
// (an .asar, your bundle, whatever). See docs/AppHash.md for the security
// contract.
//
// Both are one-shot AND lock after startup(). Trying to change the apphash
// after startup() is a BAD_ARG. That's not a limitation — it's the security
// property that stops injected DLLs from mid-run apphash swaps.
//
// The high-level path (recommended for most users):
//   atlas.setAppHashFromFile('./resources/app.asar');
//   atlas.startup();
//
// The low-level literal path (build-pipeline precomputed hashes):
//   atlas.setAppHash('abc123...64chars');
//
// The DLL-side path override (rare — when you want the DLL to read the file):
//   atlas.setAppHashPath('C:/path/to/app.asar');

/**
 * Hash a file with SHA-256 and pin it as the apphash. Reads the file in JS
 * (Node's crypto is right here — no DLL round-trip, no timing gap between
 * "set path" and "DLL reads path"). Recommended for Electron: point at your
 * .asar or your compiled bundle.
 *
 * Idempotent-adjacent: the DLL enforces one-shot, so a second call throws.
 */
function setAppHashFromFile(filePath) {
    ensureBound();
    requireNonEmptyString('filePath', filePath);
    let bytes;
    try {
        bytes = fs.readFileSync(filePath);
    } catch (err) {
        throw new AtlasError(Status.BAD_ARG, `failed to read apphash source ${filePath}: ${err.message}`);
    }
    if (bytes.length === 0) {
        throw new AtlasError(Status.BAD_ARG, `apphash source ${filePath} is empty`);
    }
    const hex = crypto.createHash('sha256').update(bytes).digest('hex');
    return setAppHash(hex);
}

/**
 * Pin the apphash to a precomputed hex-64 SHA-256 string. Use for values
 * produced by your build pipeline. Rejects anything that isn't strictly
 * lowercase-hex length 64 (the DLL rejects it too — this JS check is just
 * for a clearer error before the DLL round-trip).
 */
function setAppHash(hex64) {
    ensureBound();
    requireNonEmptyString('hex64', hex64);
    if (!/^[0-9a-f]{64}$/.test(hex64)) {
        throw new AtlasError(Status.BAD_ARG, 'hex64 must be exactly 64 lowercase hex chars (SHA-256)');
    }
    const rc = fns.SetAppHash(hex64);
    if (rc !== Status.OK) throw new AtlasError(rc, 'apphash already set or startup already ran');
    return true;
}

/**
 * Ask the DLL to hash a specific path itself. Prefer setAppHashFromFile()
 * unless you have a specific reason — the DLL-side path override introduces
 * a small window between set-time and read-time where the file on disk
 * could be swapped by an attacker with local write access.
 */
function setAppHashPath(filePath) {
    ensureBound();
    requireNonEmptyString('filePath', filePath);
    const rc = fns.SetAppHashPath(filePath);
    if (rc !== Status.OK) throw new AtlasError(rc, 'apphash path already set or startup already ran');
    return true;
}

/**
 * Read the apphash that WILL be sent to the server on the next request.
 * Useful for support tickets and debug logs. Returns empty string if the
 * source file couldn't be read.
 */
function getResolvedAppHash() {
    ensureBound();
    return readString(fns.GetResolvedAppHash);
}

/**
 * Try to auto-detect an appropriate apphash source for common JS hosts.
 * Returns the path used, or null if nothing sensible was found. Called
 * automatically by startup() if no apphash override was set explicitly.
 *
 * Detection order (first match wins):
 *   1. Under Electron: `<process.resourcesPath>/app.asar`
 *      This is where electron-builder puts the app, and it uniquely
 *      identifies the developer's shipped code.
 *   2. Node with an npm-launched script: `require.main.filename`
 *      The entry script — not node.exe. Same code across users = same hash.
 *   3. Neither: null → falls through to DLL default (node.exe / Electron.exe)
 *      with a warning logged (not thrown — some users genuinely want this).
 */
function autoDetectAppHashSource() {
    // 1. Electron main process
    if (process.versions && process.versions.electron && process.resourcesPath) {
        const asar = path.join(process.resourcesPath, 'app.asar');
        if (fs.existsSync(asar)) return asar;
        // Unpacked electron dev mode — resources/app/ directory. No stable
        // single-file hash; skip to next mode.
    }
    // 2. Regular Node with a main entry script
    if (require.main && require.main.filename) {
        return require.main.filename;
    }
    return null;
}

// Tracks whether the caller explicitly set an apphash. If not, startup()
// auto-picks a sensible default via autoDetectAppHashSource(). Mutated by
// each of the three set*AppHash* wrappers below the main function bodies.
let apphashSetByCaller = false;

// Wrappers over the raw setters — these are what get exported. They flip
// the "caller was explicit" flag ONLY on success, so a failed call
// (e.g. invalid hex format) doesn't accidentally suppress auto-detection.
function setAppHashPublic(hex64) {
    const rv = setAppHash(hex64);   // throws on failure
    apphashSetByCaller = true;
    return rv;
}
function setAppHashPathPublic(filePath) {
    const rv = setAppHashPath(filePath);
    apphashSetByCaller = true;
    return rv;
}
function setAppHashFromFilePublic(fp) {
    const rv = setAppHashFromFile(fp);
    apphashSetByCaller = true;
    return rv;
}

/**
 * Initialize the Atlas protection stack. Idempotent: safe to call multiple
 * times but only takes effect once.
 *
 * If no apphash override was set by the caller, tries autoDetectAppHashSource()
 * and pins to that. Under Electron this defaults to app.asar; under Node
 * to require.main.filename. If auto-detection returns null, the DLL falls
 * back to hashing node.exe / Electron.exe (documented behavior).
 */
function startup() {
    ensureBound();
    // Preflight — don't touch the apphash one-shot if we can predict Startup
    // will fail. Once the apphash is set, the DLL locks it forever; a failed
    // Startup with autodetect'd apphash leaves the caller unable to retry.
    if (!apiKeyIsSet) {
        throw new AtlasError(Status.NO_API_KEY, 'call setApiKey() before startup()');
    }
    if (!apphashSetByCaller) {
        const auto = autoDetectAppHashSource();
        if (auto) {
            // Best-effort: never let auto-detection failure block startup.
            // If the file is missing or unreadable, fall through to default.
            try {
                setAppHashFromFile(auto);
            } catch { /* fall through — DLL uses node.exe */ }
        }
    }
    const rc = fns.Startup();
    if (rc !== Status.OK) throw new AtlasError(rc);
    didStartup = true;
    // Kick off an out-of-band update check if the developer opted in.
    // Runs in the background — never blocks startup, never throws to the
    // caller. If a newer DLL is available, a sidecar Atlas.dll.new is
    // written and promoted at the next process start. Mirrors the C++
    // updater's "fires on Startup, doesn't affect this run" contract.
    if (updater.isOptedIn()) {
        const dllPath = resolveDllPath();
        Promise.resolve()
            .then(() => updater.tryUpdate({ dllPath }))
            .catch(() => {}); // updater is fail-soft; nothing to bubble
    }
    return true;
}

/**
 * Authenticate the given license key against the Atlas server. Returns
 * true on success, false on server rejection. Read `data.getErrorMessage()`
 * for the server's reason on false. Any other failure (transport, uninit,
 * bad arg) throws an AtlasError.
 */
function login(licenseKey) {
    if (!didStartup) throw new AtlasError(Status.NOT_STARTED);
    requireNonEmptyString('licenseKey', licenseKey);
    const rc = fns.Login(licenseKey);
    if (rc === Status.OK) return true;
    if (rc === Status.LOGIN_FAILED) return false;
    throw new AtlasError(rc);
}

/**
 * Verify the session is still valid server-side. Call periodically (the
 * DLL's own heartbeat runs every 5s regardless — this is for on-demand
 * checkpoints, e.g. before revealing gated UI). Returns true if still auth'd.
 */
function checkAuthentication() {
    ensureBound();
    const rc = fns.CheckAuthentication();
    if (rc === Status.OK) return true;
    if (rc === Status.SERVER) return false;
    throw new AtlasError(rc);
}

/**
 * Ban the current user. Requires an API key with ban permissions in the
 * dashboard. duration_minutes = 0 means permanent.
 */
function banUser(reason, durationMinutes) {
    ensureBound();
    requireNonEmptyString('reason', reason);
    requireInt('durationMinutes', durationMinutes, { min: 0, max: 525600 * 100 }); // ~100 years
    const rc = fns.BanUser(reason, durationMinutes);
    if (rc !== Status.OK) throw new AtlasError(rc);
    return true;
}

/**
 * Write a custom log entry to the dashboard Logs tab.
 */
function submitLog(text) {
    ensureBound();
    requireNonEmptyString('text', text);
    const rc = fns.SubmitLog(text);
    if (rc !== Status.OK) throw new AtlasError(rc);
    return true;
}

/**
 * Download a panel-uploaded file by its numeric ID. Returns a Buffer with
 * the raw bytes. Throws AtlasError on transport failure or if the file
 * doesn't exist.
 */
function download(fileId) {
    ensureBound();
    requireInt('fileId', fileId, { min: 0, max: 0x7FFFFFFF });
    // Size query — negative return = -status, positive = bytes needed.
    const needed = fns.Download(fileId, null, 0);
    if (needed < 0) throw new AtlasError(needed);
    if (needed === 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(needed);
    const written = fns.Download(fileId, buf, needed);
    if (written < 0) throw new AtlasError(written);
    return buf.slice(0, written);
}

/**
 * Terminate the process via the SDK's own kill path. Prefer this over
 * `process.exit()` for ban/tamper responses — a soft process.exit() can
 * be patched out of your JS bundle by an attacker; the SDK's Exit()
 * routes through Atlas.dll's kernel-level fastfail.
 */
function exit() {
    ensureBound();
    fns.Exit();
}

// ── Data namespace — mirrors Atlas::Data:: ─────────────────────────────────
// Every getter routes through readString(), so a call before startup() or
// before login() will throw AtlasError(NOT_AUTHED) with a clean message,
// not a segfault.
const data = {
    getLicense:         () => { ensureBound(); return readString(fns.GetLicense); },
    getHWID:            () => { ensureBound(); return readString(fns.GetHWID); },
    getIP:              () => { ensureBound(); return readString(fns.GetIP); },
    getExpiry:          () => { ensureBound(); return readString(fns.GetExpiry); },
    getLevel:           () => { ensureBound(); return readString(fns.GetLevel); },
    getNote:            () => { ensureBound(); return readString(fns.GetNote); },
    getUserCount:       () => { ensureBound(); return readString(fns.GetUserCount); },
    getActiveUserCount: () => { ensureBound(); return readString(fns.GetActiveUserCount); },
    getErrorMessage:    () => { ensureBound(); return readString(fns.GetErrorMessage); },
    isAuthenticated:    () => { ensureBound(); return fns.IsAuthenticated() === 1; },
    isBanned:           () => { ensureBound(); return fns.IsBanned() === 1; },
};

// ── Network namespace — mirrors Atlas::Network:: ────────────────────────────
const network = {
    checkAuthentication,
    banUser,
    submitLog,
    download,
};

// ── metadata ────────────────────────────────────────────────────────────────

/** DLL surface semver — reads once, caches. */
function version() {
    ensureBound();
    return dllVersion;
}

/**
 * Runtime environment snapshot — useful for support tickets. Contains only
 * host info; no license key, no HWID, no PII.
 */
function envInfo() {
    ensureBound();
    let resolvedApphash = '';
    try { resolvedApphash = getResolvedAppHash(); } catch { /* pre-init or unreadable */ }
    return {
        bindingVersion: BINDING_VERSION,
        dllVersion: dllVersion,
        dllHost: fns.IsDllHost() === 1,
        apphashSetByCaller: apphashSetByCaller,
        resolvedApphash: resolvedApphash,
        node: process.version,
        arch: process.arch,
        platform: process.platform,
        osRelease: os.release(),
    };
}

module.exports = {
    init,
    setQuiet,
    setApiKey,
    setAppHash:         setAppHashPublic,
    setAppHashPath:     setAppHashPathPublic,
    setAppHashFromFile: setAppHashFromFilePublic,
    getResolvedAppHash,
    startup,
    login,
    exit,
    data,
    network,
    version,
    envInfo,
    Status,
    AtlasError,
    // Auto-updater — opt-in only, dev machines only. See docs/AutoUpdate.md
    // for the security model. Mirrors AtlasUpdater.h's behavior for JS.
    enableAutoUpdate:  updater.enableAutoUpdate,
    disableAutoUpdate: updater.disableAutoUpdate,
    autoUpdateStatus:  updater.status,
};
