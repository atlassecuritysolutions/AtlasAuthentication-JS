// preload runs before the renderer's page. It's the only place with access to
// both `ipcRenderer` and the page's `window` — everything else is sandboxed.
// The `atlas` object we expose here is the ENTIRE surface the renderer sees.
// If it isn't in this file, the renderer cannot reach it.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
    login: (licenseKey) => ipcRenderer.invoke('atlas:login', licenseKey),
    status: () => ipcRenderer.invoke('atlas:status'),
    revealLicense: () => ipcRenderer.invoke('atlas:revealLicense'),
});
