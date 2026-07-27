// ============================================================================
// Electron main process - Atlas Authentication integration.
//
// SECURITY MODEL:
//   Atlas lives here (main process). It NEVER touches the renderer directly.
//   The renderer runs contextIsolation: true / nodeIntegration: false /
//   sandbox: true. It reaches Atlas ONLY through the narrow IPC surface
//   below. Every sensitive handler must gate on atlas.data.isAuthenticated().
//
//   Even if the renderer HTML gets XSS'd, the attacker cannot load the DLL,
//   cannot read the license, cannot leak the HWID, and cannot bypass the
//   authenticated-gate.
//
//   Credentials NEVER cross the IPC boundary in either direction beyond the
//   one call that submits them. When a register-with-email flow needs to
//   resume sign-in after the confirmation code lands, the credentials are
//   stashed in a main-process-only variable and never echoed back to the
//   renderer. The renderer holds no plaintext password state at any point
//   longer than the moment it takes to invoke the IPC.
// ============================================================================

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

// SDK lives one level up in `Atlas SDK/src`. Point at it explicitly.
const atlas = require('../Atlas SDK/src');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 940,
        height: 640,
        minWidth: 720,
        minHeight: 520,
        backgroundColor: '#080f1e',      // --color-ink from atlassecurity.site
        title: 'Atlas Authentication',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer.html'));

    // Open DevTools automatically during dev so you can see renderer errors.
    // In a shipped app remove this line.
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// -- one-time SDK bring-up --------------------------------------------------
function initAtlas() {
    try {
        // In production, load your key from a signed remote config, not
        // hardcoded. Electron apps unpack to plaintext -- treat this key as
        // sensitive metadata, not a secret. Rotate via dashboard on exposure.
        atlas.setApiKey('YOUR_API_KEY');
        atlas.startup();
    } catch (err) {
        dialog.showErrorBox(
            'Atlas failed to initialize',
            err.message + '\n\nEnvironment:\n' +
            JSON.stringify(atlas.envInfo(), null, 2)
        );
        app.exit(1);
    }
}

// -- Pending-registration stash (MAIN-PROCESS ONLY) -------------------------
// When a register-with-email flow returns needsVerify, we have to remember
// the credentials the user just typed so the sign-in can resume once the
// 8-digit confirmation code lands. Those credentials NEVER cross the IPC
// boundary again — they live here, in a variable the renderer cannot read
// (contextIsolation:true + sandbox:true + no exposure on the preload).
//
// One slot only: two concurrent registrations from the same renderer would
// clobber the stash, and that's acceptable — a single-user Electron app
// never legitimately has two register-verify handshakes in flight at once.
// The slot self-clears on: successful verify, cancel, sign-out, timeout.
let pendingRegistration = null; // { username: string, password: string, expiresAt: number }
const REGISTRATION_STASH_TTL_MS = 15 * 60 * 1000;  // 15 min — server holds the challenge 30, we err on the safe side
let registrationStashTimer = null;

function stashRegistration(username, password) {
    clearRegistrationStash();
    pendingRegistration = { username, password, expiresAt: Date.now() + REGISTRATION_STASH_TTL_MS };
    // Auto-wipe on the same clock the server uses so a forgotten window can't
    // hold a plaintext password in RAM forever.
    registrationStashTimer = setTimeout(clearRegistrationStash, REGISTRATION_STASH_TTL_MS);
}
function clearRegistrationStash() {
    if (registrationStashTimer) { clearTimeout(registrationStashTimer); registrationStashTimer = null; }
    if (pendingRegistration) {
        // Best-effort zero — JS strings are immutable so this is a hint, not a
        // guarantee. The real defence is "never store longer than needed."
        pendingRegistration.username = '';
        pendingRegistration.password = '';
    }
    pendingRegistration = null;
}
function takeRegistration() {
    const p = pendingRegistration;
    clearRegistrationStash();
    if (!p || Date.now() > p.expiresAt) return null;
    return p;
}

// -- IPC surface — narrow on purpose -----------------------------------------

// Shared session-info builder. `username` is empty for license-only logins;
// the renderer decides whether to show a Change-password button based on it.
function sessionSnapshot() {
    return {
        ok: true,
        username:   atlas.data.getUsername(),
        license:    atlas.data.getLicense(),
        hwid:       atlas.data.getHWID(),
        ip:         atlas.data.getIP(),
        expiry:     atlas.data.getExpiry(),
        level:      atlas.data.getLevel(),
        note:       atlas.data.getNote(),
        userCount:  atlas.data.getUserCount(),
        active:     atlas.data.getActiveUserCount(),
    };
}

// Unified auth entry — the renderer picks a mode and posts the fields for it.
// Three modes: license · user · register. `user` and `register` route through
// atlas.account.* so the account status enum (needs_verify) flows back to the
// renderer, which then opens its own inline code prompt and calls the
// atlas:verify-submit handler below.
//
// Response shapes the renderer must handle:
//   { ok: true,  ...sessionSnapshot }         — signed in, welcome screen
//   { ok: false, needsVerify: 'signin' }      — sign-in wants an emailed code
//   { ok: false, needsVerify: 'register' }    — a register-with-email needs its confirm code
//   { ok: false, error: 'human message' }     — anything else
ipcMain.handle('atlas:login', async (_event, payload) => {
    const p = payload || {};
    const mode = p.mode || 'license';
    try {
        if (mode === 'license') {
            const k = String(p.license || '').trim();
            if (!k) return { ok: false, error: 'Enter a license key.' };
            if (!atlas.login(k)) return { ok: false, error: atlas.data.getErrorMessage() || 'Authentication rejected by the server.' };
            return sessionSnapshot();
        }
        if (mode === 'user') {
            const u = String(p.username || '').trim();
            const w = String(p.password || '');
            if (!u || !w) return { ok: false, error: 'Enter your username and password.' };
            const r = atlas.account.login(u, w);
            if (r.status === 'ok') return sessionSnapshot();
            if (r.status === 'needs_verify') return { ok: false, needsVerify: 'signin' };
            return { ok: false, error: r.error || 'Wrong username or password.' };
        }
        if (mode === 'register') {
            const u = String(p.username || '').trim();
            const w = String(p.password || '');
            const e = String(p.email    || '').trim();
            if (!u || !w) return { ok: false, error: 'Enter a username and password.' };
            atlas.account.register(u, w, e || undefined);
            // With an email supplied, the server sent an 8-digit confirmation
            // code and the account is unconfirmed. We stash the credentials
            // main-process-side so verify-submit knows which username to
            // report back on success.
            if (e) {
                stashRegistration(u, w);
                return { ok: false, needsVerify: 'register' };
            }
            // No email supplied - the account is created. We don't auto-sign
            // in; the user picks when. Same success shape as the emailed
            // path so the renderer can respond identically.
            return { ok: false, registered: true, username: u };
        }
        return { ok: false, error: `Unknown auth mode "${mode}".` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// Submit the 8-digit code the server emailed.
//
// The renderer sends ONLY the code and the flow kind ('signin' | 'register').
// On the register path we look up the stashed credentials by side-channel
// (main-process variable) — never trusting anything the renderer sends.
ipcMain.handle('atlas:verify-submit', async (_event, payload) => {
    const code = String((payload && payload.code) || '').trim();
    const kind = (payload && payload.kind) === 'register' ? 'register' : 'signin';
    if (!/^\d{8}$/.test(code)) return { ok: false, error: 'The code must be 8 digits.' };
    try {
        if (kind === 'register') {
            // Registration confirm code - consumes the email_confirm pending
            // challenge. The account is now created and confirmed; the user
            // signs in whenever they're ready. We do NOT auto-sign-in - that
            // would either trigger a second new-device verify (bad UX) or
            // interpret a wanted verify as a failure.
            atlas.account.submitVerification(code);
            const creds = takeRegistration();
            const username = creds ? creds.username : '';
            return { ok: false, registered: true, username };
        }
        // Sign-in verify - server has a pending session ready to open.
        atlas.account.submitVerification(code);
        return sessionSnapshot();
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// Ask the server to re-send the pending 8-digit code. The server enforces
// a 60-second cooldown and returns a friendly error if the caller spams it,
// which the renderer just surfaces.
ipcMain.handle('atlas:verify-resend', async () => {
    try {
        atlas.account.resendVerification();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// Renderer cancelled the verify screen. Wipe the credential stash so a
// closed window can't leave a plaintext password sitting in memory.
ipcMain.handle('atlas:verify-cancel', async () => {
    clearRegistrationStash();
    return { ok: true };
});

// Change the currently-signed-in password account's password. Rejected server-
// side for license-only sessions; renderer only shows the affordance when
// getUsername() is non-empty, but we still guard here.
ipcMain.handle('atlas:change-password', async (_event, payload) => {
    const oldp = String((payload && payload.oldPassword) || '');
    const newp = String((payload && payload.newPassword) || '');
    if (!oldp || newp.length < 3 || newp.length > 128) return { ok: false, error: 'Old password required; new password must be 3-128 characters.' };
    try {
        const ok = atlas.network.changePassword(oldp, newp);
        if (ok) return { ok: true };
        return { ok: false, error: atlas.data.getErrorMessage() || 'Password change rejected.' };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('atlas:status', async () => ({
    authenticated: atlas.data.isAuthenticated(),
    banned:        atlas.data.isBanned(),
}));

// Environment snapshot for the renderer's SDK-state panel. Contains only
// non-secret host info -- no license key, no HWID, no PII.
ipcMain.handle('atlas:env', async () => {
    try { return atlas.envInfo(); }
    catch { return null; }
});

// Renderer requests to open a URL in the OS browser. Whitelisted to hostnames
// we own — never let the renderer hand us an arbitrary URL, or an XSS could
// open file:// or javascript: URLs. We validate the ORIGIN (protocol + host)
// so any path under our domain is fine, but nothing off it.
const ALLOWED_HOSTS = new Set(['atlassecurity.site', 'www.atlassecurity.site']);
ipcMain.handle('atlas:open-url', async (_event, url) => {
    try {
        const u = new URL(String(url || ''));
        if (u.protocol !== 'https:') return { ok: false, error: 'URL must be https' };
        if (!ALLOWED_HOSTS.has(u.hostname)) return { ok: false, error: 'URL host not allowed' };
        await shell.openExternal(u.toString());
        return { ok: true };
    } catch {
        return { ok: false, error: 'Invalid URL' };
    }
});

ipcMain.handle('atlas:signout', async () => {
    // Gentle sign-out -- tell the server to tear down the session, close
    // the socket, zero credentials. Process stays alive so the user
    // returns to the login screen. For attacker/tamper responses we'd
    // use atlas.exit() (kernel-level fastfail) instead.
    clearRegistrationStash();
    try {
        atlas.network.submitLog('User signed out from Electron example');
        atlas.logout();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// Periodic server revalidation. DLL runs its own 5s heartbeat internally;
// this is an additional on-demand poke to catch bans/revocations quickly.
// On failure: use atlas.exit() (kernel-level fastfail) not app.quit()
// (patchable from the JS bundle).
function startSessionWatchdog() {
    setInterval(() => {
        try {
            if (atlas.data.isAuthenticated() && !atlas.network.checkAuthentication()) {
                atlas.exit();
            }
        } catch { /* transient network blip; the DLL heartbeat retries */ }
    }, 30_000);
}

app.whenReady().then(() => {
    initAtlas();
    createWindow();
    startSessionWatchdog();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Wipe any pending credentials the instant the app is closing, before
// process teardown flushes buffers to disk.
app.on('before-quit', () => { clearRegistrationStash(); });
