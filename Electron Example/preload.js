// preload runs before the renderer's page. It's the only place with access to
// both `ipcRenderer` and the page's `window`. Everything else is sandboxed.
// The `atlas` object exposed here is the ENTIRE surface the renderer sees.
// If it isn't in this file, the renderer cannot reach it.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
    login:   (licenseKey) => ipcRenderer.invoke('atlas:login', licenseKey),
    status:  ()           => ipcRenderer.invoke('atlas:status'),
    signout: ()           => ipcRenderer.invoke('atlas:signout'),
    openUrl: (url)        => ipcRenderer.invoke('atlas:open-url', url),
    env:     ()           => ipcRenderer.invoke('atlas:env'),
});
