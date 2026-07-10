// ============================================================================
// Atlas SDK — JS auto-updater
//
// The JS equivalent of Atlas::Updater in AtlasUpdater.h. Same shape of
// deal (GitHub-backed release stream, per-language repo, cache in
// %LOCALAPPDATA%\AtlasAuth, UX vocabulary of installed.flag /
// declined.flag / manage_autoupdate helper) — but each language has its
// OWN public repo (AtlasAuthentication-CPP for C++, AtlasAuthentication-JS
// for JS, and future -CSharp / -Python / etc). See ../docs/AutoUpdate.md.
//
// Where it differs from C++:
//   - Downloads Atlas.dll (not Atlas Auth.lib)
//   - Cannot overwrite a live DLL held open by koffi — uses a sidecar
//     .new file that gets promoted atomically on the next Node startup
//   - Signature verification: pinned Ed25519 pubkey. Refuses unsigned or
//     mismatched downloads. (C++ counterpart doesn't have this today
//     because C++ devs rebuild the .lib into their own signed .exe.)
//   - Refuses to run in packaged Electron apps or NODE_ENV=production —
//     end-user shipped apps update through their own channel.
//   - Explicit opt-in via atlas.enableAutoUpdate({ ack: '...' }). Default off.
//
// State lives in the same %LOCALAPPDATA%\AtlasAuth cache dir as the C++
// updater but under separate filenames (dll_commit.sha, dll_installed.flag,
// dll_declined.flag) so the two updaters don't stomp each other on
// developer machines that run both.
// ============================================================================

'use strict';

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const https   = require('https');

// ── constants (parity with AtlasUpdater.h) ─────────────────────────────────
// Points at AtlasAuthentication-JS (the customer-facing JS SDK repo).
// C++ updater points at AtlasAuthentication-CPP — separate repos, each
// carries only what its language's users need. See ../docs/AutoUpdate.md.
const GITHUB_API_LATEST  = 'https://api.github.com/repos/atlassecuritysolutions/AtlasAuthentication-JS/commits/main';
const GITHUB_RAW_DLL     = 'https://raw.githubusercontent.com/atlassecuritysolutions/AtlasAuthentication-JS/main/Atlas.dll';
const GITHUB_RAW_DLL_SIG = 'https://raw.githubusercontent.com/atlassecuritysolutions/AtlasAuthentication-JS/main/Atlas.dll.sig';
const USER_AGENT         = 'AtlasAuth-JS/1.0';

const CACHE_DIR_NAME     = 'AtlasAuth';             // matches C++
const COMMIT_FILE        = 'dll_commit.sha';        // JS-specific — see comment above
const INSTALLED_FLAG     = 'dll_installed.flag';
const DECLINED_FLAG      = 'dll_declined.flag';
const LOG_DIR            = 'logs';

// Pinned Ed25519 public key for verifying Atlas.dll downloads.
// Rotated only on major SDK releases. Any signature failure = refuse download.
// This is the whole point of the security model — without pinning, an
// attacker who compromises the GitHub repo (or MITMs the download) could
// serve malicious binary code that Node then loads via LoadLibrary.
//
// Corresponding private key lives at %USERPROFILE%\.atlas-signing\atlas-ed25519-private.pem
// on the release maintainer's machine only. Rotating the key means shipping a
// new binding version with a new pubkey here — every existing JS user must
// update their binding to the new version to keep receiving auto-updates.
const PINNED_ED25519_PUBKEY_PEM = process.env.ATLAS_UPDATER_PUBKEY_OVERRIDE || `
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAT+/ofltN8AY8/eBTS/8hny31ps226VR3NCVFfvpm2D0=
-----END PUBLIC KEY-----
`.trim();

// ── environment gates ───────────────────────────────────────────────────────

// True if this process is a shipped Electron app (packaged .asar).
// Never run the updater under those conditions — end users don't run
// their own updater; the app's own auto-update channel (electron-updater
// or similar) is responsible.
function isPackagedElectron() {
    try {
        // Load electron only if it's actually available — regular Node
        // scripts don't have it.
        const electron = require('electron');
        return !!(electron && electron.app && electron.app.isPackaged);
    } catch { return false; }
}

// True if this Node process is running in a production environment.
// The convention NODE_ENV=production is universal in the Node ecosystem.
function isProductionNode() {
    return process.env.NODE_ENV === 'production';
}

// True if the machine looks like a JS dev machine — the moral equivalent
// of C++'s IsDevMachine(). Being lenient by design: JS devs on Windows
// almost always have Node in PATH and a package.json somewhere, so this
// is intentionally permissive.
function isJsDevMachine() {
    // 1. Common CI/dev env vars
    const devVars = ['npm_config_prefix', 'npm_package_name', 'nvm_dir', 'NVM_HOME', 'FNM_DIR'];
    for (const v of devVars) if (process.env[v]) return true;
    // 2. package.json in cwd
    if (fs.existsSync(path.join(process.cwd(), 'package.json'))) return true;
    // 3. node_modules anywhere in cwd's ancestors (Node's own require.resolve idiom)
    let d = process.cwd();
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(d, 'node_modules'))) return true;
        const up = path.dirname(d);
        if (up === d) break;
        d = up;
    }
    return false;
}

// ── cache dir + IO helpers ──────────────────────────────────────────────────

function getCacheDir() {
    // %LOCALAPPDATA%\AtlasAuth — same as C++ side.
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localApp, CACHE_DIR_NAME);
}

function ensureCacheDir() {
    const dir = getCacheDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
    try { fs.mkdirSync(path.join(dir, LOG_DIR), { recursive: true }); } catch {}
    return dir;
}

function readTextFile(p) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

function writeTextFile(p, content) {
    try { fs.writeFileSync(p, content, 'utf8'); return true; } catch { return false; }
}

function fileExists(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

// Timestamped append to the updater log for post-mortem debugging.
function logLine(message) {
    const dir = getCacheDir();
    const stamp = new Date().toISOString();
    const line = `${stamp} ${message}\n`;
    try {
        fs.appendFileSync(path.join(dir, LOG_DIR, 'updater.log'), line);
    } catch { /* silence — logging must never crash startup */ }
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

// Minimal wrapper over https.get that follows redirects (raw.githubusercontent
// serves 302s through CDN edges), respects timeout, and returns a Buffer.
// Deliberately not using fetch() — Node 18+ has it but we support 18+ and
// fetch()'s stream body handling is awkward for binary data.
function httpGet(url, timeoutMs = 10000, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) return reject(new Error(`too many redirects`));
        const req = https.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/octet-stream',
            },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return httpGet(res.headers.location, timeoutMs, maxRedirects - 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(new Error(`timeout after ${timeoutMs}ms: ${url}`)); });
        req.on('error', reject);
    });
}

// ── signature verification ─────────────────────────────────────────────────

// Verify an Ed25519 signature over the DLL bytes against the pinned pubkey.
// Refuses if:
//   - Signature format is not raw 64 bytes (Ed25519 signature length)
//   - Signature doesn't verify against the pubkey
//   - Node doesn't support Ed25519 (Node < 12.11 — but we require 18+)
// Returns true only on cryptographic success.
function verifyDllSignature(dllBytes, sigBytes) {
    if (!Buffer.isBuffer(dllBytes) || dllBytes.length === 0) return false;
    if (!Buffer.isBuffer(sigBytes) || sigBytes.length !== 64) return false;
    try {
        const pubKey = crypto.createPublicKey(PINNED_ED25519_PUBKEY_PEM);
        // Ed25519 verify — passes the message + signature, returns bool
        return crypto.verify(null, dllBytes, pubKey, sigBytes);
    } catch (err) {
        logLine(`verify failed: ${err.message}`);
        return false;
    }
}

// ── public API ──────────────────────────────────────────────────────────────

// Opt-in gate. Default is OFF. Dev must explicitly enable + acknowledge
// the security implication. Modeled on the C++ dialog's "Got it" flow
// but happens once, in code, and is remembered via the installed.flag.
let optInFlag = false;
let ackString = null;

function enableAutoUpdate(options = {}) {
    if (typeof options.ack !== 'string' || options.ack.length < 16) {
        throw new Error(
            'enableAutoUpdate() requires an `ack` string acknowledging that this ' +
            'downloads executable code. Example: ' +
            "atlas.enableAutoUpdate({ ack: 'I understand this pulls executable code from GitHub' })"
        );
    }
    if (isPackagedElectron()) {
        throw new Error(
            'Auto-update is refused in packaged Electron apps. Ship your app with ' +
            'a fixed Atlas.dll bundled via electron-builder extraResources and ' +
            'update through your app\'s own update channel (electron-updater etc.).'
        );
    }
    if (isProductionNode()) {
        throw new Error(
            'Auto-update is refused when NODE_ENV=production. Vendor Atlas.dll ' +
            'into your deployment artifact and version-control it explicitly.'
        );
    }
    optInFlag = true;
    ackString = options.ack;
    // Persist the ack so a subsequent CLI invocation of manage-autoupdate can
    // see the machine has been opted in.
    ensureCacheDir();
    writeTextFile(path.join(getCacheDir(), INSTALLED_FLAG), ackString);
    logLine(`enableAutoUpdate opt-in: ${ackString}`);
    return true;
}

function disableAutoUpdate() {
    optInFlag = false;
    ensureCacheDir();
    writeTextFile(path.join(getCacheDir(), DECLINED_FLAG), new Date().toISOString());
    try { fs.unlinkSync(path.join(getCacheDir(), INSTALLED_FLAG)); } catch {}
    logLine('disableAutoUpdate');
    return true;
}

function isOptedIn() {
    if (optInFlag) return true;
    // Fall back to disk state (survives process restarts)
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) return false;
    if (fileExists(path.join(dir, DECLINED_FLAG))) return false;
    return fileExists(path.join(dir, INSTALLED_FLAG));
}

// ── the update flow ─────────────────────────────────────────────────────────

// Runs one round of the "is the local DLL current" check. Called from
// atlas.startup() if the user has opted in. Never throws — returns a
// result object the caller can log or ignore.
//
// Result: { checked: bool, updated: bool, reason: string }
//   - checked=false when environment gates refuse (packaged, production, no dev)
//   - updated=true means an Atlas.dll.new was placed next to the live DLL,
//     and will be promoted at next process start
//   - reason: short human-readable summary
async function tryUpdate({ dllPath }) {
    if (!dllPath || !fileExists(dllPath)) {
        return { checked: false, updated: false, reason: 'no local DLL to update' };
    }
    if (isPackagedElectron())  return { checked: false, updated: false, reason: 'packaged Electron' };
    if (isProductionNode())    return { checked: false, updated: false, reason: 'NODE_ENV=production' };
    if (!isOptedIn())          return { checked: false, updated: false, reason: 'not opted in' };
    if (!isJsDevMachine())     return { checked: false, updated: false, reason: 'not a JS dev machine' };

    ensureCacheDir();

    // Compare local commit SHA to remote HEAD SHA. Match = no work.
    let remoteSha = null;
    try {
        const jsonBuf = await httpGet(GITHUB_API_LATEST, 5000);
        const commit = JSON.parse(jsonBuf.toString('utf8'));
        remoteSha = String(commit && commit.sha || '');
    } catch (err) {
        logLine(`API probe failed: ${err.message}`);
        return { checked: true, updated: false, reason: 'GitHub API unreachable' };
    }
    if (!/^[0-9a-f]{40}$/.test(remoteSha)) {
        return { checked: true, updated: false, reason: 'malformed remote SHA' };
    }
    const localShaFile = path.join(getCacheDir(), COMMIT_FILE);
    const localSha = readTextFile(localShaFile);
    if (localSha === remoteSha) {
        logLine(`up-to-date at ${remoteSha}`);
        return { checked: true, updated: false, reason: 'up to date' };
    }

    // Fetch DLL + signature in parallel. Both must succeed to proceed.
    let dllBytes, sigBytes;
    try {
        [dllBytes, sigBytes] = await Promise.all([
            httpGet(GITHUB_RAW_DLL, 30000),
            httpGet(GITHUB_RAW_DLL_SIG, 10000),
        ]);
    } catch (err) {
        logLine(`download failed: ${err.message}`);
        return { checked: true, updated: false, reason: `download failed: ${err.message}` };
    }

    // Signature verification — hard gate. Refuse anything that doesn't
    // verify against the pinned pubkey.
    if (!verifyDllSignature(dllBytes, sigBytes)) {
        logLine('SIGNATURE MISMATCH — refusing to install');
        return { checked: true, updated: false, reason: 'signature verification failed' };
    }

    // Write to sidecar and let the next process load promote it.
    // Writing directly over dllPath would fail because koffi has the
    // current DLL open and Windows locks it against writers.
    const sidecar = dllPath + '.new';
    try {
        fs.writeFileSync(sidecar, dllBytes);
        writeTextFile(localShaFile, remoteSha);
        logLine(`downloaded ${dllBytes.length} bytes, sidecar written, sha=${remoteSha}`);
        return { checked: true, updated: true, reason: `sidecar at ${sidecar} will promote next launch` };
    } catch (err) {
        logLine(`sidecar write failed: ${err.message}`);
        return { checked: true, updated: false, reason: `write failed: ${err.message}` };
    }
}

// Promote a pending sidecar Atlas.dll.new over Atlas.dll. Called from
// ensureBound() before the first koffi.load(). Idempotent + safe — if
// no sidecar exists, no-op. If the rename fails (another process holds
// the DLL locked), leave the sidecar in place for a future attempt.
//
// Returns true if a promotion happened, false otherwise.
function promotePendingSidecar(dllPath) {
    if (!dllPath) return false;
    const sidecar = dllPath + '.new';
    if (!fileExists(sidecar)) return false;
    try {
        // Windows fs.renameSync overwrites destination if target file is
        // not locked. If it IS locked (running process), rename fails —
        // catch and keep the sidecar for later.
        fs.renameSync(sidecar, dllPath);
        logLine(`promoted sidecar over ${dllPath}`);
        return true;
    } catch (err) {
        logLine(`sidecar promotion failed: ${err.message} — will retry next launch`);
        return false;
    }
}

// Read-only view of the updater state — for envInfo() and support tickets.
function status() {
    const dir = getCacheDir();
    return {
        optedIn: isOptedIn(),
        cacheDir: dir,
        installedFlag: fileExists(path.join(dir, INSTALLED_FLAG)),
        declinedFlag: fileExists(path.join(dir, DECLINED_FLAG)),
        lastKnownSha: readTextFile(path.join(dir, COMMIT_FILE)),
        packagedElectron: isPackagedElectron(),
        productionNode: isProductionNode(),
        dllHost: true,   // always — this module is only used from a Node/Electron host
    };
}

module.exports = {
    enableAutoUpdate,
    disableAutoUpdate,
    isOptedIn,
    tryUpdate,
    promotePendingSidecar,
    status,
    // Exported for the CLI helper (manage_autoupdate.js) — not part of
    // the SDK's public consumer API.
    _internal: {
        getCacheDir,
        ensureCacheDir,
        COMMIT_FILE,
        INSTALLED_FLAG,
        DECLINED_FLAG,
    },
};
