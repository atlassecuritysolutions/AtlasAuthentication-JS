// preload runs before the renderer's page. It's the only place with access to
// both `ipcRenderer` and the page's `window`. Everything else is sandboxed.
// The `atlas` object exposed here is the ENTIRE surface the renderer sees.
// If it isn't in this file, the renderer cannot reach it.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
    // Unified auth call — the renderer sends { mode, license?, username?, password?, email? }
    // and the main process routes to License::Login / Account::Login / Account::Register.
    // On an account flow that needs a code, main returns { needsVerify: 'signin' | 'register' }
    // and the renderer opens its inline code prompt, then calls verifySubmit(code, kind).
    //
    // Passwords sent through here are NEVER echoed back to the renderer. On a
    // register-with-email flow, main stashes credentials in a main-process-only
    // variable and resumes sign-in itself once the code lands.
    login:          (payload) => ipcRenderer.invoke('atlas:login', payload),

    // 8-digit code prompts.
    //   verifySubmit({ code, kind })   kind = 'signin' | 'register'
    //   verifyResend()                 asks the server for a fresh code (60s cooldown)
    //   verifyCancel()                 wipes main's pending-registration stash
    // On successful submit, main returns the same session snapshot as `login`.
    verifySubmit:   (payload) => ipcRenderer.invoke('atlas:verify-submit', payload),
    verifyResend:   ()        => ipcRenderer.invoke('atlas:verify-resend'),
    verifyCancel:   ()        => ipcRenderer.invoke('atlas:verify-cancel'),

    changePassword: (payload) => ipcRenderer.invoke('atlas:change-password', payload),
    status:         ()        => ipcRenderer.invoke('atlas:status'),
    signout:        ()        => ipcRenderer.invoke('atlas:signout'),
    openUrl:        (url)     => ipcRenderer.invoke('atlas:open-url', url),
});
