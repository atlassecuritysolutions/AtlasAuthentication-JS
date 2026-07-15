// Atlas Authentication SDK — TypeScript declarations.
// Mirrors the shape of src/index.js exactly.

/** Numeric status codes returned by the underlying DLL. */
export const Status: {
    readonly OK: 0;
    readonly NOT_STARTED: 1;
    readonly NO_API_KEY: 2;
    readonly LOGIN_FAILED: 3;
    readonly NOT_AUTHED: 4;
    readonly BAD_ARG: 5;
    readonly BUFFER_TOO_SMALL: 6;
    readonly SERVER: 7;
    readonly INTERNAL: 8;
};

/** Thrown by any Atlas call that fails outside the normal login-rejected path. */
export class AtlasError extends Error {
    readonly code: number;
    readonly statusName: string;
    constructor(code: number, context?: string);
}

export interface InitOptions {
    /** Absolute path to Atlas.dll. Overrides ATLAS_DLL_PATH and package-default lookup. */
    dllPath?: string;
}

export interface EnvInfo {
    bindingVersion: string;
    dllVersion: string;
    dllHost: boolean;
    /** True if the caller set an apphash override; false if auto-detection ran (or nothing was set). */
    apphashSetByCaller: boolean;
    /** The apphash that will be sent to the server on the next request. */
    resolvedApphash: string;
    node: string;
    arch: string;
    platform: string;
    osRelease: string;
}

/**
 * Toggle SDK modal dialogs. Default is quiet (true). Pass false only if you
 * want the SDK to show its own MessageBox on startup failure (rare — Node
 * hosts almost always want to display errors in their own UI).
 */
export function setQuiet(quiet: boolean): true;

/** Optional pre-bind hook to point at a specific DLL path. */
export function init(options?: InitOptions): void;

/** Set the API key. Must be called before startup(). */
export function setApiKey(apiKey: string): true;

/**
 * Hash the given file with SHA-256 and pin the result as the apphash. The
 * hash is computed in JS via node's crypto (no DLL round-trip). One-shot per
 * process; must be called before startup(). See docs/AppHash.md.
 */
export function setAppHashFromFile(filePath: string): true;

/**
 * Set the apphash directly to a precomputed lowercase-hex SHA-256 (64 chars).
 * Rejects any other input. One-shot; must be called before startup().
 */
export function setAppHash(hex64: string): true;

/**
 * Ask the DLL to hash a specific path itself. Prefer setAppHashFromFile()
 * for most cases — it avoids a filesystem race between the set call and
 * the DLL's read at server-call time.
 */
export function setAppHashPath(filePath: string): true;

/** Read the apphash that will be sent to the server on the next request. */
export function getResolvedAppHash(): string;

// ── Auto-update (opt-in) ────────────────────────────────────────────────────

export interface EnableAutoUpdateOptions {
    /**
     * A non-empty acknowledgement string. Any string ≥16 chars works;
     * the point is to make the developer type words that mean "I know
     * this pulls executable code from GitHub." Example:
     *   { ack: "I understand this pulls executable code from GitHub" }
     */
    ack: string;
}

export interface AutoUpdateStatus {
    optedIn: boolean;
    cacheDir: string;
    installedFlag: boolean;
    declinedFlag: boolean;
    lastKnownSha: string;
    packagedElectron: boolean;
    productionNode: boolean;
    dllHost: boolean;
}

/**
 * Opt this machine into the JS auto-updater. Off by default. Refuses in
 * packaged Electron apps and when NODE_ENV=production. Persists via
 * %LOCALAPPDATA%\AtlasAuth\dll_installed.flag so future Node processes see
 * the opt-in without recalling this function.
 */
export function enableAutoUpdate(options: EnableAutoUpdateOptions): true;

/**
 * Explicitly opt out. Writes %LOCALAPPDATA%\AtlasAuth\dll_declined.flag,
 * suppresses all future update checks from this machine.
 */
export function disableAutoUpdate(): true;

/** Read-only snapshot of the updater's persisted state. */
export function autoUpdateStatus(): AutoUpdateStatus;

/** Initialize the Atlas protection stack. Idempotent. */
export function startup(): true;

/**
 * Authenticate. Two overloads:
 *   login(licenseKey)         — license-only login (classic single-user flow).
 *   login(username, password) — user-account login (after Register).
 * Returns true on success, false on server rejection (call
 * `data.getErrorMessage()` for the reason). Any other failure throws AtlasError.
 */
export function login(licenseKey: string): boolean;
export function login(username: string, password: string): boolean;

/**
 * One-shot: bind a license key to a new username/password account. On
 * success the caller should call login(username, password) to open a
 * session — register itself does not. Fails if the license already has an
 * account, the username is taken, or the license is invalid.
 */
export function register(licenseKey: string, username: string, password: string): boolean;

/** Terminate the process through the SDK's own kill path. */
export function exit(): void;

/** SDK/DLL version string ("1.0.0"). */
export function version(): string;

/** Runtime environment snapshot — safe to attach to support tickets. */
export function envInfo(): EnvInfo;

export const data: {
    getLicense(): string;
    /** Password-account username for sessions opened via login(user, pass); empty for license-only. */
    getUsername(): string;
    getHWID(): string;
    getIP(): string;
    getExpiry(): string;
    /** Numeric access level (0 when unknown or not authenticated). */
    getLevel(): number;
    getNote(): string;
    getUserCount(): string;
    getActiveUserCount(): string;
    getErrorMessage(): string;
    isAuthenticated(): boolean;
    isBanned(): boolean;
};

export const network: {
    /** True if the session is still valid server-side. */
    checkAuthentication(): boolean;
    /** durationMinutes = 0 means permanent. */
    banUser(reason: string, durationMinutes: number): true;
    submitLog(text: string): true;
    /**
     * Change the password of the current password account. Only valid after
     * login(username, password). Returns true on success, false on server
     * rejection (call data.getErrorMessage() for the reason). Throws AtlasError
     * for transport / not-authed failures.
     */
    changePassword(oldPassword: string, newPassword: string): boolean;
    /** Fetch a panel-uploaded file by numeric ID. */
    download(fileId: number): Buffer;
};
