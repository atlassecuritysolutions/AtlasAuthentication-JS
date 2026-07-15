// preload runs before the renderer's page. It's the only place with access to
// both `ipcRenderer` and the page's `window`. Everything else is sandboxed.
// The `atlas` object exposed here is the ENTIRE surface the renderer sees.
// If it isn't in this file, the renderer cannot reach it.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
    // Unified auth call — the renderer sends { mode, license?, username?, password? }
    // and the main process routes to Atlas.Login(license) / Atlas.Login(u,p) /
    // Atlas.Register(...). Returns a full session snapshot on success.
    login:          (payload) => ipcRenderer.invoke('atlas:login', payload),
    changePassword: (payload) => ipcRenderer.invoke('atlas:change-password', payload),
    status:         ()        => ipcRenderer.invoke('atlas:status'),
    signout:        ()        => ipcRenderer.invoke('atlas:signout'),
    openUrl:        (url)     => ipcRenderer.invoke('atlas:open-url', url),
    env:            ()        => ipcRenderer.invoke('atlas:env'),
});
