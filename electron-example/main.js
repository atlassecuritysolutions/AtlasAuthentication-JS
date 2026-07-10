// ============================================================================
// Electron main process — Atlas Authentication integration.
//
// SECURITY MODEL:
//   Atlas lives here, in the main process, and NEVER touches the renderer.
//   The renderer:
//     - has contextIsolation on
//     - has nodeIntegration off
//     - can only reach Atlas through the narrow IPC surface exposed by
//       preload.js (login / logout / status)
//   That way, even if a page in the renderer is XSS'd, it cannot call the
//   Atlas DLL directly, cannot read the license, cannot leak the HWID, and
//   cannot bypass the authenticated-gate check on other IPC handlers.
//
//   Every sensitive IPC handler MUST call atlas.data.isAuthenticated() and
//   refuse if false. See `revealLicense` for the pattern.
// ============================================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Point at the SDK sitting in the parent JS Integration folder.
// In a real Electron app, git-clone or vendor this folder and: require('./atlas-auth')
const atlas = require('..');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 720,
        height: 540,
        backgroundColor: '#0d1829',
        title: 'Atlas Authentication — Electron Example',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

// ── one-time SDK bring-up ───────────────────────────────────────────────────
// Wrapped in try/catch so a missing DLL surfaces as a real dialog instead of
// a silent renderer that never gets a response.
function initAtlas() {
    try {
        // In production, load your key from a signed remote config, not a
        // hardcoded string. The C++ SDK's compile-time obfuscation doesn't
        // apply to JS bundles, so treat this key as sensitive.
        atlas.setApiKey('YOUR_API_KEY_HERE');
        atlas.startup();
    } catch (err) {
        dialog.showErrorBox(
            'Atlas failed to initialize',
            `${err.message}\n\nEnvironment: ${JSON.stringify(atlas.envInfo(), null, 2)}`
        );
        app.exit(1);
    }
}

// ── IPC surface — narrow on purpose ─────────────────────────────────────────

// login: renderer submits a license key, main authenticates.
ipcMain.handle('atlas:login', async (_event, licenseKey) => {
    if (typeof licenseKey !== 'string') {
        return { ok: false, error: 'License key must be a string.' };
    }
    try {
        const ok = atlas.login(licenseKey);
        if (!ok) {
            return { ok: false, error: atlas.data.getErrorMessage() || 'Login rejected.' };
        }
        return {
            ok: true,
            // Never include the license key itself. Give the renderer only what
            // it needs to render the "you're in" state.
            level: atlas.data.getLevel(),
            expiry: atlas.data.getExpiry(),
            note: atlas.data.getNote(),
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// status: cheap gate the renderer polls to hide UI on ban / session drop.
ipcMain.handle('atlas:status', async () => {
    return {
        authenticated: atlas.data.isAuthenticated(),
        banned: atlas.data.isBanned(),
    };
});

// revealLicense: example of a sensitive handler. Guarded by
// isAuthenticated() so a renderer that lost its session cannot pull it.
ipcMain.handle('atlas:revealLicense', async () => {
    if (!atlas.data.isAuthenticated()) return { ok: false, error: 'Not authenticated.' };
    return { ok: true, license: atlas.data.getLicense() };
});

// Periodic server check — fires from main every 30s, not from the renderer.
// The DLL runs its own 5s heartbeat regardless; this is the on-demand poke.
function startSessionWatchdog() {
    setInterval(() => {
        try {
            if (atlas.data.isAuthenticated() && !atlas.network.checkAuthentication()) {
                // Session dropped or user banned mid-run — hand off to the SDK's
                // own kill path rather than app.quit() (harder to patch out).
                atlas.exit();
            }
        } catch { /* transport blip — the 5s heartbeat will retry */ }
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
