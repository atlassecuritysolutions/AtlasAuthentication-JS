// TypeScript definitions for the Atlas JS binding. One-to-one with src/index.js.
//
//   Dashboard: https://atlassecurity.site/dashboard
//   Docs:      https://atlassecurity.site/docs
//   Legal:     https://atlassecurity.site/legal

export type AccountStatus =
    | 'Ok'
    | 'WrongCredentials'
    | 'NeedsVerification'
    | 'Banned'
    | 'AccountPaused'
    | 'ServerUnreachable'
    | 'Error';

export interface AccountLoginResult {
    /** Sign-in outcome. Branch on this before reading any other field. */
    status: AccountStatus;
    /** Numeric user id assigned by the auth server. Only meaningful on 'Ok'. */
    user_id: number;
    /** Human-readable reason. Populated on any non-'Ok' status. */
    error_message: string;
    /** "DD-MM-YYYY HH:MM:SS" or "Lifetime". Populated on 'Ok'. */
    expiry: string;
    /** Access level for the signed-in user. Populated on 'Ok'. */
    level: number;
    /** Admin-set note, "" if none. Populated on 'Ok'. */
    note: string;
    /** e.g. `s***i@gmail.com` — for the "we sent a code to X" UI. Populated on 'NeedsVerification'. */
    masked_email: string;
    /** IP the server saw for the sign-in attempt. Populated on 'NeedsVerification'. */
    sign_in_ip: string;
    /** ISO country code. Populated on 'NeedsVerification'. */
    sign_in_country: string;
}

export interface AtlasLicense {
    /** License-key sign-in. HWID-bound on first use. */
    Login(license_key: string): boolean;
    /** Username + password sign-in for a license bound to one user.
     *  For accounts with email verification, use `atlas.Account.Login`. */
    LoginUser(username: string, password: string): boolean;
    /** Bind a license key to a new username/password.
     *  Does NOT sign in on success — call `LoginUser` after. */
    Register(license_key: string, username: string, password: string): boolean;
}

export interface AtlasAccount {
    Status: Readonly<{
        Ok: 'Ok';
        WrongCredentials: 'WrongCredentials';
        NeedsVerification: 'NeedsVerification';
        Banned: 'Banned';
        AccountPaused: 'AccountPaused';
        ServerUnreachable: 'ServerUnreachable';
        Error: 'Error';
    }>;
    /** Sign in with account credentials. Inspect `result.status` to branch.
     *  On 'NeedsVerification' the SDK holds the challenge — call SubmitVerification.
     *  On 'Ok', `result.expiry` / `result.level` / `result.note` are populated. */
    Login(username: string, password: string): AccountLoginResult;
    /** Create a standalone account. Email optional but needed for password reset.
     *  Does NOT sign in. If email is set, account stays unverified until ConfirmEmail. */
    Register(username: string, password: string, email?: string): boolean;
    /** Submit the 8-digit code for the pending sign-in verify challenge. */
    SubmitVerification(code: string): boolean;
    /** Resend the sign-in verification code (60s server-side cooldown). */
    ResendVerification(): boolean;
    /** Confirm a newly-registered account's email with the emailed code. */
    ConfirmEmail(code: string): boolean;
    /** True while a registration email-confirm is pending. */
    HasPendingEmailConfirm(): boolean;
    /** Redeem a license key onto the currently signed-in account. */
    Redeem(license_key: string): boolean;
    /** Start a password reset. `identifier` = username or email.
     *  Always returns true — anti-enumeration, the server never leaks whether it matched. */
    RequestPasswordReset(identifier: string): boolean;
    /** Complete the reset with the emailed code + new password. */
    CompletePasswordReset(code: string, new_password: string): boolean;
}

export interface AtlasNetwork {
    /** Poll the server to confirm the current session is still valid. */
    CheckAuthentication(): boolean;
    /** Ban the current user from your app. `duration_minutes = 0` → permanent. */
    BanUser(reason: string, duration_minutes?: number): boolean;
    /** Emit a custom log line (max 512 chars) to the dashboard's Logs tab. */
    SubmitLog(text: string): boolean;
    /** Change the current account's password. */
    ChangePassword(old_password: string, new_password: string): boolean;
    /** Round-trip latency to the auth server in ms, or -1 if unreachable. */
    Ping(): number;
}

export interface AtlasData {
    // Identity
    GetLicense(): string;
    GetUsername(): string;
    GetEmail(): string;
    GetPassword(): string;
    GetIP(): string;
    GetHWID(): string;
    GetDevice(): string;
    GetNote(): string;
    GetFirstSeenDate(): string;
    GetLastSeenDate(): string;
    GetUserId(): number;
    GetLevel(): number;

    // Expiry
    GetExpiry(): string;
    GetDaysRemaining(): number;
    IsLifetime(): boolean;
    IsExpiringSoon(days_threshold?: number): boolean;

    // Status
    IsAuthenticated(): boolean;
    IsBanned(): boolean;

    // App-wide stats
    GetActiveUserCount(): string;
    GetUserCount(): string;

    // Errors
    GetErrorMessage(): string;
    ClearError(): void;
    HasError(): boolean;
}

export interface AtlasVariables {
    /** "" if the key doesn't exist. */
    Fetch(key: string): string;
    /** "true" / "1" / "yes" → true; else false. */
    FetchBool(key: string): boolean;
    /** 0 if missing or unparseable. */
    FetchInt(key: string): number;
}

export interface AtlasWebhook {
    /** Plaintext Discord webhook message. */
    SendDiscord(webhook_url: string, message: string): boolean;
    /** Discord embed. `color` is 0xRRGGBB. */
    SendDiscordEmbed(webhook_url: string, title: string, description: string, color?: number): boolean;
    /** POST an arbitrary JSON payload — Slack, custom endpoints, telemetry. */
    Send(url: string, json_payload: string): boolean;
}

export interface Atlas {
    /** Your app's API key. Get it from atlassecurity.site/dashboard. Set BEFORE calling Startup(). */
    API_KEY: string;

    /** Initialise the library. Call once at the top of main(). Throws on failure. */
    Startup(): void;
    /** Terminate the session and clear all authentication state. */
    Logout(): void;
    /** Kill the process the hardest way Windows allows. Unbypassable, uncatchable, no cleanup. */
    Exit(): never;

    License: AtlasLicense;
    Account: AtlasAccount;
    Network: AtlasNetwork;
    Data: AtlasData;
    Variables: AtlasVariables;
    Webhook: AtlasWebhook;
}

declare const atlas: Atlas;
export = atlas;
