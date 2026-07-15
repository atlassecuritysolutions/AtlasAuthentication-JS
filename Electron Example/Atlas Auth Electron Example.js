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

// ── one-time SDK bring-up ──────────────────────────────────────────────────
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

// ── IPC surface - narrow on purpose ─────────────────────────────────────────

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
        level:      atlas.data.getLevel(),        // number
        note:       atlas.data.getNote(),
        userCount:  atlas.data.getUserCount(),
        active:     atlas.data.getActiveUserCount(),
    };
}

// atlas:login now accepts three flows discriminated by the `mode` field so a
// single IPC handler powers License / User / Register. The renderer picks the
// mode via a segmented control (mirrors the Console + ImGui examples).
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
            if (!atlas.login(u, w)) return { ok: false, error: atlas.data.getErrorMessage() || 'Authentication rejected by the server.' };
            return sessionSnapshot();
        }
        if (mode === 'register') {
            const k = String(p.license || '').trim();
            const u = String(p.username || '').trim();
            const w = String(p.password || '');
            if (!k || !u || !w) return { ok: false, error: 'Fill every field to register.' };
            if (!atlas.register(k, u, w)) return { ok: false, error: atlas.data.getErrorMessage() || 'Registration rejected by the server.' };
            // Auto-sign-in as the newly-created account — same as every other example.
            if (!atlas.login(u, w)) return { ok: false, error: atlas.data.getErrorMessage() || 'Sign-in after registration failed.' };
            return sessionSnapshot();
        }
        return { ok: false, error: `Unknown auth mode "${mode}".` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// Change the currently-signed-in password account's password. Rejected server-
// side for license-only sessions; renderer only shows the affordance when
// getUsername() is non-empty, but we still guard here.
ipcMain.handle('atlas:change-password', async (_event, payload) => {
    const oldp = String((payload && payload.oldPassword) || '');
    const newp = String((payload && payload.newPassword) || '');
    if (!oldp || newp.length < 6 || newp.length > 128) return { ok: false, error: 'Old password required; new password must be 6-128 chars.' };
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

// Renderer requests to open a URL in the OS browser. Whitelisted to https
// origins we own -- never let the renderer hand us an arbitrary URL, or
// an XSS could open file:// or javascript: URLs.
const ALLOWED_URLS = new Set(['https://atlassecurity.site']);
ipcMain.handle('atlas:open-url', async (_event, url) => {
    if (!ALLOWED_URLS.has(url)) return { ok: false, error: 'URL not allowed' };
    await shell.openExternal(url);
    return { ok: true };
});

ipcMain.handle('atlas:signout', async () => {
    // Gentle sign-out -- tell the server to tear down the session, close
    // the socket, zero credentials. Process stays alive so the user
    // returns to the login screen. For attacker/tamper responses we'd
    // use atlas.exit() (kernel-level fastfail) instead.
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
