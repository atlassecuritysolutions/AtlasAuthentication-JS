// Atlas SDK — Node / Electron binding.
//
//   Dashboard: https://atlassecurity.site/dashboard
//   Docs:      https://atlassecurity.site/docs
//   Legal:     https://atlassecurity.site/legal
//
//   const atlas = require('atlas-authentication');
//   atlas.API_KEY = 'YOUR_API_KEY';
//   atlas.Startup();
//   if (atlas.License.Login('license-key')) { /* signed in */ }
//
// Namespaces:
//   atlas.          session state, data, network, variables, webhooks
//   atlas.License   license-key sign-in
//   atlas.Account   username / password / email accounts

const koffi = require('koffi');
const path  = require('path');
const fs    = require('fs');

// Load Atlas.dll from disk. Packaged apps (pkg / Electron) ship the DLL
// beside the exe or under resources/; dev checkouts ship it next to this
// file. Probed in that order. Env override wins.
const _dllPath = (() => {
    if (process.env.ATLAS_DLL_PATH) return process.env.ATLAS_DLL_PATH;
    const tries = [];
    if (process.resourcesPath) tries.push(path.resolve(process.resourcesPath, 'Atlas.dll'));
    tries.push(path.resolve(path.dirname(process.execPath), 'Atlas.dll'));
    tries.push(path.resolve(__dirname, '..', 'Atlas.dll'));
    for (const p of tries) { try { fs.accessSync(p); return p; } catch {} }
    return tries[tries.length - 1];
})();
const _lib = koffi.load(_dllPath);

const _OK = 0;

// Standard C size-query pattern: NULL/0 -> bytes needed, then alloc + call.
function _str(fn) {
    const n = fn(null, 0);
    if (n <= 0) return '';
    const buf = Buffer.alloc(n);
    fn(buf, n);
    const end = buf.indexOf(0);
    return buf.slice(0, end < 0 ? buf.length : end).toString('utf8');
}

// One line per Atlas_* export. Signatures mirror AtlasExports.cpp verbatim.
const _c = {
    SetApiKey:              _lib.func('int __cdecl Atlas_SetApiKey(const char*)'),
    Startup:                _lib.func('int __cdecl Atlas_Startup()'),
    Logout:                 _lib.func('int __cdecl Atlas_Logout()'),
    Exit:                   _lib.func('void __cdecl Atlas_Exit()'),

    Login:                  _lib.func('int __cdecl Atlas_Login(const char*)'),
    LoginUser:              _lib.func('int __cdecl Atlas_LoginUser(const char*, const char*)'),
    Register:               _lib.func('int __cdecl Atlas_Register(const char*, const char*, const char*)'),

    LoginAccountEx:         _lib.func('int __cdecl Atlas_LoginAccountEx(const char*, const char*, _Out_ int*)'),
    SubmitVerify:           _lib.func('int __cdecl Atlas_SubmitVerify(const char*)'),
    ResendVerify:           _lib.func('int __cdecl Atlas_ResendVerify()'),
    RegisterAccount:        _lib.func('int __cdecl Atlas_RegisterAccount(const char*, const char*, const char*)'),
    ConfirmEmail:           _lib.func('int __cdecl Atlas_ConfirmEmail(const char*)'),
    HasPendingEmailConfirm: _lib.func('int __cdecl Atlas_HasPendingEmailConfirm()'),
    RedeemKey:              _lib.func('int __cdecl Atlas_RedeemKey(int, const char*)'),
    RequestPasswordReset:   _lib.func('int __cdecl Atlas_RequestPasswordReset(const char*)'),
    CompletePasswordReset:  _lib.func('int __cdecl Atlas_CompletePasswordReset(const char*, const char*)'),

    GetLastVerifyMaskedEmail: _lib.func('int __cdecl Atlas_GetLastVerifyMaskedEmail(_Out_ char*, size_t)'),
    GetLastVerifyIP:          _lib.func('int __cdecl Atlas_GetLastVerifyIP(_Out_ char*, size_t)'),
    GetLastVerifyCountry:     _lib.func('int __cdecl Atlas_GetLastVerifyCountry(_Out_ char*, size_t)'),

    CheckAuthentication:    _lib.func('int __cdecl Atlas_CheckAuthentication()'),
    Ping:                   _lib.func('int __cdecl Atlas_Ping()'),
    BanUser:                _lib.func('int __cdecl Atlas_BanUser(const char*, int)'),
    SubmitLog:              _lib.func('int __cdecl Atlas_SubmitLog(const char*)'),
    ChangePassword:         _lib.func('int __cdecl Atlas_ChangePassword(const char*, const char*)'),

    GetLicense:             _lib.func('int __cdecl Atlas_GetLicense(_Out_ char*, size_t)'),
    GetUsername:            _lib.func('int __cdecl Atlas_GetUsername(_Out_ char*, size_t)'),
    GetEmail:               _lib.func('int __cdecl Atlas_GetEmail(_Out_ char*, size_t)'),
    GetPassword:            _lib.func('int __cdecl Atlas_GetPassword(_Out_ char*, size_t)'),
    GetHWID:                _lib.func('int __cdecl Atlas_GetHWID(_Out_ char*, size_t)'),
    GetIP:                  _lib.func('int __cdecl Atlas_GetIP(_Out_ char*, size_t)'),
    GetExpiry:              _lib.func('int __cdecl Atlas_GetExpiry(_Out_ char*, size_t)'),
    GetNote:                _lib.func('int __cdecl Atlas_GetNote(_Out_ char*, size_t)'),
    GetDevice:              _lib.func('int __cdecl Atlas_GetDevice(_Out_ char*, size_t)'),
    GetFirstSeenDate:       _lib.func('int __cdecl Atlas_GetFirstSeenDate(_Out_ char*, size_t)'),
    GetLastSeenDate:        _lib.func('int __cdecl Atlas_GetLastSeenDate(_Out_ char*, size_t)'),
    GetUserCount:           _lib.func('int __cdecl Atlas_GetUserCount(_Out_ char*, size_t)'),
    GetActiveUserCount:     _lib.func('int __cdecl Atlas_GetActiveUserCount(_Out_ char*, size_t)'),
    GetErrorMessage:        _lib.func('int __cdecl Atlas_GetErrorMessage(_Out_ char*, size_t)'),
    GetLevel:               _lib.func('int __cdecl Atlas_GetLevel()'),
    GetUserId:              _lib.func('int __cdecl Atlas_GetUserId()'),
    GetDaysRemaining:       _lib.func('int __cdecl Atlas_GetDaysRemaining()'),
    IsLifetime:             _lib.func('int __cdecl Atlas_IsLifetime()'),
    IsExpiringSoon:         _lib.func('int __cdecl Atlas_IsExpiringSoon(int)'),
    IsAuthenticated:        _lib.func('int __cdecl Atlas_IsAuthenticated()'),
    IsBanned:               _lib.func('int __cdecl Atlas_IsBanned()'),
    HasError:               _lib.func('int __cdecl Atlas_HasError()'),
    ClearError:             _lib.func('void __cdecl Atlas_ClearError()'),

    VariableFetch:          _lib.func('int __cdecl Atlas_VariableFetch(const char*, _Out_ char*, size_t)'),
    VariableFetchBool:      _lib.func('int __cdecl Atlas_VariableFetchBool(const char*)'),
    VariableFetchInt:       _lib.func('int __cdecl Atlas_VariableFetchInt(const char*)'),

    WebhookSendDiscord:      _lib.func('int __cdecl Atlas_WebhookSendDiscord(const char*, const char*)'),
    WebhookSendDiscordEmbed: _lib.func('int __cdecl Atlas_WebhookSendDiscordEmbed(const char*, const char*, const char*, int)'),
    WebhookSend:             _lib.func('int __cdecl Atlas_WebhookSend(const char*, const char*)'),
};


const Atlas = {
    // Your app's API key. Get it from atlassecurity.site/dashboard.
    API_KEY: 'YOUR_API_KEY',


    // -- Session lifecycle ---------------------------------------------------

    // Initialise the library. Call once at the top of main().
    Startup() {
        _c.SetApiKey(this.API_KEY);
        const rc = _c.Startup();
        if (rc !== _OK) throw new Error(_str(_c.GetErrorMessage) || `Atlas_Startup failed (${rc})`);
    },

    // Terminate the session and clear all authentication state.
    Logout() { _c.Logout(); },

    // Kill the process the hardest way Windows allows. Unbypassable,
    // uncatchable, no cleanup.
    Exit()   { _c.Exit();   },
};


// -- License mode --------------------------------------------------------
// Single-user, license-key auth. No email, no verification code.

Atlas.License = {
    // License-key sign-in.
    Login:     (license_key) => _c.Login(license_key) === _OK,

    // Username + password sign-in for a license bound to one user.
    // For accounts with email verification, use atlas.Account.Login.
    LoginUser: (username, password) => _c.LoginUser(username, password) === _OK,

    // Bind a license key to a new username/password.
    // Does NOT sign in on success — call LoginUser(u, p) after.
    Register:  (license_key, username, password) => _c.Register(license_key, username, password) === _OK,
};


// -- Account mode --------------------------------------------------------
// Username / password / email accounts. Email verification, password reset,
// and per-account key redemption.

Atlas.Account = {
    Status: Object.freeze({
        Ok:                'Ok',
        WrongCredentials:  'WrongCredentials',
        NeedsVerification: 'NeedsVerification',
        Banned:            'Banned',
        AccountPaused:     'AccountPaused',
        ServerUnreachable: 'ServerUnreachable',
        Error:             'Error',
    }),

    // Sign in with account credentials. Check result.status.
    // On NeedsVerification the SDK holds the challenge — call SubmitVerification(code).
    // On Ok, r.expiry / r.level / r.note are populated when the server sent them.
    Login(username, password) {
        const uid = [0];
        const rc = _c.LoginAccountEx(username, password, uid);
        const r = {
            status: 'Error', user_id: uid[0], error_message: '',
            expiry: '', level: 1, note: '',
            masked_email: '', sign_in_ip: '', sign_in_country: '',
        };
        if      (rc === _OK) {
            r.status = 'Ok';
            r.expiry = _str(_c.GetExpiry);
            r.level  = _c.GetLevel();
            r.note   = _str(_c.GetNote);
        }
        else if (rc === 10)  {
            r.status = 'NeedsVerification';
            r.masked_email    = _str(_c.GetLastVerifyMaskedEmail);
            r.sign_in_ip      = _str(_c.GetLastVerifyIP);
            r.sign_in_country = _str(_c.GetLastVerifyCountry);
        }
        else if (rc === 3) {
            // Server-side reason lives in the message text. The C ABI collapses
            // WrongCredentials / Banned / AccountPaused into one code, so we
            // route on the message; unknown text falls through to WrongCredentials
            // (the common case).
            const msg = _str(_c.GetErrorMessage);
            r.error_message = msg;
            const m = msg.toLowerCase();
            if      (m.includes('banned'))                                   r.status = 'Banned';
            else if (m.includes('paused') || m.includes('account paused'))   r.status = 'AccountPaused';
            else                                                             r.status = 'WrongCredentials';
        }
        else if (rc === 7) {
            r.status = 'ServerUnreachable';
            r.error_message = _str(_c.GetErrorMessage);
        }
        else {
            r.status = 'Error';
            r.error_message = _str(_c.GetErrorMessage);
        }
        return r;
    },

    // Create a standalone account. Email optional but needed for password reset.
    // Does NOT sign in. If email is set, account stays unverified until ConfirmEmail.
    Register:               (username, password, email = '') => _c.RegisterAccount(username, password, email) === _OK,

    // Submit the 8-digit code for the pending sign-in verify challenge.
    SubmitVerification:     (code) => _c.SubmitVerify(code) === _OK,

    // Resend the sign-in verification code (60s server-side cooldown).
    ResendVerification:     () => _c.ResendVerify() === _OK,

    // Confirm a newly-registered account's email with the emailed code.
    ConfirmEmail:           (code) => _c.ConfirmEmail(code) === _OK,

    // True while a registration email-confirm is pending.
    HasPendingEmailConfirm: () => _c.HasPendingEmailConfirm() !== 0,

    // Redeem a license key onto the currently signed-in account.
    Redeem:                 (license_key) => _c.RedeemKey(0, license_key) === _OK,

    // Start a password reset. identifier = username or email.
    // Always returns true — anti-enumeration, the server never leaks whether it matched.
    RequestPasswordReset:   (identifier) => _c.RequestPasswordReset(identifier) === _OK,

    // Complete the reset with the emailed code + new password.
    CompletePasswordReset:  (code, new_password) => _c.CompletePasswordReset(code, new_password) === _OK,
};


// -- Network -------------------------------------------------------------
// Direct server RPCs on the current session.

Atlas.Network = {
    // Poll the server to confirm the current session is still valid.
    CheckAuthentication: () => _c.CheckAuthentication() === _OK,

    // Ban the current user from your app. duration_minutes = 0 → permanent.
    BanUser:             (reason, duration_minutes = 0) => _c.BanUser(reason, duration_minutes) === _OK,

    // Emit a custom log line (max 512 chars) to the dashboard's Logs tab.
    SubmitLog:           (text) => _c.SubmitLog(text) === _OK,

    // Change the current account's password.
    ChangePassword:      (old_password, new_password) => _c.ChangePassword(old_password, new_password) === _OK,

    // Round-trip latency to the auth server in ms, or -1 if unreachable.
    Ping:                () => _c.Ping(),
};


// -- Data ----------------------------------------------------------------
// Read-only session accessors. Populated after a successful sign-in.

Atlas.Data = {
    // Identity
    GetLicense:         () => _str(_c.GetLicense),          // License key the session opened with.
    GetUsername:        () => _str(_c.GetUsername),         // Account username, "" on license-only sessions.
    GetEmail:           () => _str(_c.GetEmail),            // Account email, "" if none / license-only.
    GetPassword:        () => _str(_c.GetPassword),         // Password used at sign-in, "" on license-only.
    GetIP:              () => _str(_c.GetIP),               // Server-detected client IP.
    GetHWID:            () => _str(_c.GetHWID),             // Hardware fingerprint.
    GetDevice:          () => _str(_c.GetDevice),           // ComputerName / Windows username.
    GetNote:            () => _str(_c.GetNote),             // Admin-set note, "" if none.
    GetFirstSeenDate:   () => _str(_c.GetFirstSeenDate),    // First-ever authentication timestamp.
    GetLastSeenDate:    () => _str(_c.GetLastSeenDate),     // Most recent authentication timestamp.
    GetUserId:          () => _c.GetUserId(),               // Account row id, 0 if signed out.
    GetLevel:           () => _c.GetLevel(),                // Access level, 0 if unknown.

    // Expiry
    GetExpiry:          () => _str(_c.GetExpiry),                                       // "DD-MM-YYYY HH:MM:SS" or "Lifetime".
    GetDaysRemaining:   () => _c.GetDaysRemaining(),                                    // -1 = lifetime, 0 = expired.
    IsLifetime:         () => _c.IsLifetime() !== 0,                                    // True if the license never expires.
    IsExpiringSoon:     (days_threshold = 7) => _c.IsExpiringSoon(days_threshold) !== 0, // True if expiring within days_threshold.

    // Status
    IsAuthenticated:    () => _c.IsAuthenticated() !== 0,   // True if a live session is open.
    IsBanned:           () => _c.IsBanned() !== 0,          // True if the current user is banned.

    // App-wide stats
    GetActiveUserCount: () => _str(_c.GetActiveUserCount),  // Users currently authenticated app-wide.
    GetUserCount:       () => _str(_c.GetUserCount),        // Total registered users.

    // Errors
    GetErrorMessage:    () => _str(_c.GetErrorMessage),     // Last error message, "" if none.
    ClearError:         () => _c.ClearError(),              // Reset the error state.
    HasError:           () => _c.HasError() !== 0,          // True if the last call set an error.
};


// -- Variables -----------------------------------------------------------
// Read-only key/value store you configure on the dashboard.

Atlas.Variables = {
    // "" if the key doesn't exist.
    Fetch: (key) => {
        const kb = Buffer.from(key + '\0', 'utf8');
        const n = _c.VariableFetch(kb, null, 0);
        if (n <= 0) return '';
        const buf = Buffer.alloc(n);
        _c.VariableFetch(kb, buf, n);
        const end = buf.indexOf(0);
        return buf.slice(0, end < 0 ? buf.length : end).toString('utf8');
    },
    FetchBool: (key) => _c.VariableFetchBool(key) !== 0,    // "true" / "1" / "yes" → true; else false.
    FetchInt:  (key) => _c.VariableFetchInt(key),           // 0 if missing or unparseable.
};


// -- Webhook -------------------------------------------------------------
// Fire-and-forget HTTP POSTs (Discord, Slack, custom). Unrelated to Atlas auth.

Atlas.Webhook = {
    // Plaintext Discord webhook message.
    SendDiscord:      (webhook_url, message) => _c.WebhookSendDiscord(webhook_url, message) === _OK,

    // Discord embed. color is 0xRRGGBB.
    SendDiscordEmbed: (webhook_url, title, description, color = 0x3498db) =>
                          _c.WebhookSendDiscordEmbed(webhook_url, title, description, color) === _OK,

    // POST an arbitrary JSON payload — Slack, custom endpoints, telemetry.
    Send:             (url, json_payload) => _c.WebhookSend(url, json_payload) === _OK,
};

module.exports = Atlas;
