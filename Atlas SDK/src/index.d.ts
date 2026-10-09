// TypeScript definitions for the Atlas JS binding. One-to-one with src/index.js.
//
//   Dashboard: https://atlassecurity.site/dashboard
//   Docs:      https://atlassecurity.site/docs?p=sdk/overview
//   Legal:     https://atlassecurity.site/legal
//
// Uses Node's Buffer: install @types/node.

/// <reference types="node" />

declare namespace atlas {
    /** 'ServerUnreachable' needs an Atlas.dll newer than 1.0.3; on 1.0.3 and earlier a network
     *  failure arrives as 'WrongCredentials' with the cause in `error_message`. */
    type AccountStatus =
        | 'Ok'
        | 'WrongCredentials'
        | 'NeedsVerification'
        | 'Banned'
        | 'AccountPaused'
        | 'ServerUnreachable'
        | 'Error';

    interface AccountLoginResult {
        /** Sign-in outcome. Branch on this before reading any other field. */
        status: AccountStatus;
        /** Numeric user id assigned by the auth server. Only meaningful on 'Ok'. */
        user_id: number;
        /** Human-readable reason. Populated on any non-'Ok' status except 'NeedsVerification'. */
        error_message: string;
        /** "DD-MM-YYYY" or "Never". Populated on 'Ok'. */
        expiry: string;
        /** Access level for the signed-in user. Populated on 'Ok'. */
        level: number;
        /** Admin-set note, "None" if none. Populated on 'Ok'. */
        note: string;
        /** e.g. `m***s@example.com` - for the "we sent a code to X" UI. Populated on 'NeedsVerification'. */
        masked_email: string;
        /** IP the server saw for the sign-in attempt. Populated on 'NeedsVerification'. */
        sign_in_ip: string;
        /** ISO country code. Populated on 'NeedsVerification'. */
        sign_in_country: string;
    }

    // License: sign in with a license key. The first sign-in locks the key to this PC.
    // LoginUser and Register are only for a license that carries its own username and password. For real user accounts use Account.
    // https://atlassecurity.site/docs?p=sdk/license
    interface AtlasLicense {
        Login(license_key: string): boolean;
        LoginUser(username: string, password: string): boolean;
        Register(license_key: string, username: string, password: string): boolean;
    }

    // Account: username and password accounts, with optional email verification and password reset.
    // Login returns a result: read result.status first. 'NeedsVerification' means an 8-digit code was emailed, so call SubmitVerification(code).
    // Register does not sign in.
    // https://atlassecurity.site/docs?p=sdk/account
    interface AtlasAccount {
        Status: Readonly<Record<AccountStatus, AccountStatus>>;
        Login(username: string, password: string): AccountLoginResult;
        Register(username: string, password: string, email?: string): boolean;
        SubmitVerification(code: string): boolean;
        ResendVerification(): boolean;
        ConfirmEmail(code: string): boolean;
        HasPendingEmailConfirm(): boolean;
        Redeem(license_key: string): boolean;
        RequestPasswordReset(identifier: string): boolean;
        CompletePasswordReset(code: string, new_password: string): boolean;
    }

    // Network: ask the server something during a session. The library already checks the session in the background,
    // so CheckAuthentication() is only for right before a sensitive action.
    // https://atlassecurity.site/docs?p=sdk/network
    interface AtlasNetwork {
        CheckAuthentication(): boolean;
        Download(file_id: number): Buffer;
        BanUser(reason: string, duration_minutes?: number): boolean;
        SubmitLog(text: string): boolean;
        ChangePassword(old_password: string, new_password: string): boolean;
        Ping(): number;
    }

    // Data: facts about the signed-in session. Valid only after a successful sign-in.
    // A getter with nothing to return gives "" or 0. GetDaysRemaining() is the exception: -1 means no expiry,
    // 0 means expired or under 24 hours left. GetExpiry() is "DD-MM-YYYY" or "Never".
    // https://atlassecurity.site/docs?p=sdk/data
    interface AtlasData {
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

        // App-wide counts
        GetActiveUserCount(): string;
        GetUserCount(): string;

        // Errors
        GetErrorMessage(): string;
        ClearError(): void;
        HasError(): boolean;
    }

    // Variables: values you set on the dashboard, read while the app runs. Change one without shipping a new build.
    // A key that does not exist gives "" (Fetch), 0 (FetchInt) or false (FetchBool).
    // https://atlassecurity.site/docs?p=sdk/variables
    interface AtlasVariables {
        Fetch(key: string): string;
        FetchBool(key: string): boolean;
        FetchInt(key: string): number;
    }

    // Entitlements: what this license or account may do, from the features and credits you create on the dashboard.
    // Has and Remaining are for showing and hiding. Only Consume is enforced by the server.
    // https://atlassecurity.site/docs?p=sdk/entitlements
    interface AtlasEntitlements {
        Has(key: string): boolean;
        Remaining(key: string): number;
        Consume(key: string, amount?: number): boolean;
        List(): string[];
        Refresh(): boolean;
    }

    // Webhook: send an HTTP POST from the client (Discord, Slack or your own endpoint). Unrelated to Atlas sign-in.
    // https://atlassecurity.site/docs?p=sdk/webhook
    interface AtlasWebhook {
        SendDiscord(webhook_url: string, message: string): boolean;
        SendDiscordEmbed(webhook_url: string, title: string, description: string, color?: number): boolean;
        Send(url: string, json_payload: string): boolean;
    }

    // Any call that can fail returns false or an empty value. Data.GetErrorMessage() says why.
    interface Atlas {
        // Dashboard > Applications. Set before Startup().
        API_KEY: string;

        // Session lifecycle: Startup() once, first (throws on failure). Logout() ends the session; the library stays loaded.
        // Exit() kills the process, no cleanup.
        // https://atlassecurity.site/docs?p=sdk/lifecycle
        Startup(): void;
        Logout(): void;
        Exit(): never;

        // Stops the library opening any message box of its own (server notices, the wrong-API-key box, the update
        // notice). Call it before Startup(). The reason for a refusal stays in Data.GetErrorMessage().
        DisableMessageBoxes(disabled?: boolean): void;

        License: AtlasLicense;
        Account: AtlasAccount;
        Network: AtlasNetwork;
        Data: AtlasData;
        Variables: AtlasVariables;
        Entitlements: AtlasEntitlements;
        Webhook: AtlasWebhook;
    }
}

declare const atlas: atlas.Atlas;
export = atlas;
