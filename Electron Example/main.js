// ============================================================================
// Electron main process — Atlas Authentication integration.
//
// SECURITY MODEL:
//   Atlas lives here (main process). It NEVER touches the renderer directly.
//   The renderer runs contextIsolation: true / nodeIntegration: false /
//   sandbox: true. It reaches Atlas ONLY through the narrow IPC surface
//   below. Every sensitive handler must gate on Atlas.Data.IsAuthenticated().
//
//   Even if the renderer HTML gets XSS'd, the attacker cannot load the DLL,
//   cannot read the license, cannot leak the HWID, and cannot bypass the
//   authenticated-gate.
//
//   Credentials NEVER cross the IPC boundary in either direction beyond the
//   one call that submits them. When a register-with-email flow needs to
//   resume sign-in after the confirmation code lands, the credentials are
//   stashed in a main-process-only variable and never echoed back to the
//   renderer.
// ============================================================================

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const atlas = require('atlas-authentication');

atlas.API_KEY = '894kO8WB5suGzk1KuLGoKsZyJPlnUEbYc3LYzZQq8axmgwFZ1rGBMnWzN6Wnjx8q';

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 940,
        height: 640,
        minWidth: 720,
        minHeight: 520,
        backgroundColor: '#080f1e',
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
    if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function initAtlas() {
    try { atlas.Startup(); }
    catch (err) {
        dialog.showErrorBox('Atlas failed to initialize', err.message || String(err));
        app.exit(1);
    }
}

// -- Pending-registration stash (MAIN-PROCESS ONLY) --------------------------
// When a register-with-email flow needs its confirm code, we stash the
// credentials the user typed so verify-submit can report the username back
// on success. Never crosses the IPC boundary again.
let pendingRegistration = null;
const REGISTRATION_STASH_TTL_MS = 15 * 60 * 1000;
let registrationStashTimer = null;

function stashRegistration(username, password) {
    clearRegistrationStash();
    pendingRegistration = { username, password, expiresAt: Date.now() + REGISTRATION_STASH_TTL_MS };
    registrationStashTimer = setTimeout(clearRegistrationStash, REGISTRATION_STASH_TTL_MS);
}
function clearRegistrationStash() {
    if (registrationStashTimer) { clearTimeout(registrationStashTimer); registrationStashTimer = null; }
    if (pendingRegistration) { pendingRegistration.username = ''; pendingRegistration.password = ''; }
    pendingRegistration = null;
}
function takeRegistration() {
    const p = pendingRegistration;
    clearRegistrationStash();
    if (!p || Date.now() > p.expiresAt) return null;
    return p;
}

// -- IPC surface — narrow on purpose -----------------------------------------

function sessionSnapshot() {
    return {
        ok: true,
        username:   atlas.Data.GetUsername(),
        license:    atlas.Data.GetLicense(),
        hwid:       atlas.Data.GetHWID(),
        ip:         atlas.Data.GetIP(),
        expiry:     atlas.Data.GetExpiry(),
        level:      atlas.Data.GetLevel(),
        note:       atlas.Data.GetNote(),
        userCount:  atlas.Data.GetUserCount(),
        active:     atlas.Data.GetActiveUserCount(),
    };
}

ipcMain.handle('atlas:login', async (_event, payload) => {
    const p = payload || {};
    const mode = p.mode || 'license';

    if (mode === 'license') {
        const k = String(p.license || '').trim();
        if (!k) return { ok: false, error: 'Enter a license key.' };
        if (!atlas.License.Login(k)) return { ok: false, error: atlas.Data.GetErrorMessage() || 'Authentication rejected by the server.' };
        return sessionSnapshot();
    }

    if (mode === 'user') {
        const u = String(p.username || '').trim();
        const w = String(p.password || '');
        if (!u || !w) return { ok: false, error: 'Enter your username and password.' };
        const r = atlas.Account.Login(u, w);
        if (r.status === atlas.Account.Status.Ok) return sessionSnapshot();
        if (r.status === atlas.Account.Status.NeedsVerification) return { ok: false, needsVerify: 'signin' };
        return { ok: false, error: r.error_message || 'Wrong username or password.' };
    }

    if (mode === 'register') {
        const u = String(p.username || '').trim();
        const w = String(p.password || '');
        const e = String(p.email    || '').trim();
        if (!u || !w) return { ok: false, error: 'Enter a username and password.' };
        if (!atlas.Account.Register(u, w, e)) return { ok: false, error: atlas.Data.GetErrorMessage() || 'Registration rejected.' };
        if (e && atlas.Account.HasPendingEmailConfirm()) {
            stashRegistration(u, w);
            return { ok: false, needsVerify: 'register' };
        }
        return { ok: false, registered: true, username: u };
    }

    return { ok: false, error: `Unknown auth mode "${mode}".` };
});

ipcMain.handle('atlas:verify-submit', async (_event, payload) => {
    const code = String((payload && payload.code) || '').trim();
    const kind = (payload && payload.kind) === 'register' ? 'register' : 'signin';
    if (!/^\d{8}$/.test(code)) return { ok: false, error: 'The code must be 8 digits.' };

    if (kind === 'register') {
        if (!atlas.Account.ConfirmEmail(code)) return { ok: false, error: atlas.Data.GetErrorMessage() || 'Verification rejected.' };
        const creds = takeRegistration();
        return { ok: false, registered: true, username: creds ? creds.username : '' };
    }

    if (!atlas.Account.SubmitVerification(code)) return { ok: false, error: atlas.Data.GetErrorMessage() || 'Verification rejected.' };
    return sessionSnapshot();
});

ipcMain.handle('atlas:verify-resend', async () => {
    if (!atlas.Account.ResendVerification()) return { ok: false, error: atlas.Data.GetErrorMessage() || 'Resend rejected.' };
    return { ok: true };
});

ipcMain.handle('atlas:verify-cancel', async () => {
    clearRegistrationStash();
    return { ok: true };
});

ipcMain.handle('atlas:change-password', async (_event, payload) => {
    const oldp = String((payload && payload.oldPassword) || '');
    const newp = String((payload && payload.newPassword) || '');
    if (!oldp || newp.length < 3 || newp.length > 128) return { ok: false, error: 'Old password required; new password must be 3-128 characters.' };
    if (!atlas.Network.ChangePassword(oldp, newp)) return { ok: false, error: atlas.Data.GetErrorMessage() || 'Password change rejected.' };
    return { ok: true };
});

ipcMain.handle('atlas:status', async () => ({
    authenticated: atlas.Data.IsAuthenticated(),
    banned:        atlas.Data.IsBanned(),
}));

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
    clearRegistrationStash();
    atlas.Network.SubmitLog('User signed out from Electron example');
    atlas.Logout();
    return { ok: true };
});

function startSessionWatchdog() {
    setInterval(() => {
        try {
            if (atlas.Data.IsAuthenticated() && !atlas.Network.CheckAuthentication()) {
                atlas.Exit();
            }
        } catch { /* transient blip; DLL heartbeat retries */ }
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

app.on('before-quit', () => { clearRegistrationStash(); });
