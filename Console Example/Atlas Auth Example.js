// Atlas Authentication Library - Example Usage (Node / Console)
// Run as x64 Node >= 18 | Set your API key below.
//
// Mirrors the C++ Console example - three auth paths, one prompt each. Account
// sign-in and registration handle the email-verification / confirmation code
// inline, so this single script exercises every path Atlas supports.
//
//     [1] License key       classic single-user, HWID-bound flow
//     [2] Account sign-in   username + password + inline verification code
//     [3] Register account  creates a new account, inline email confirmation
//
// Everything downstream - data.*, network.checkAuthentication,
// network.submitLog, network.changePassword - works identically regardless of
// which path was chosen.

const atlas   = require('../Atlas SDK/src');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

// Set your API key - copy from atlassecurity.site → dashboard → API keys.
// (C++ users set this in Atlas.h; JS/Node users set it here in code.)
atlas.setApiKey('YOUR_API_KEY');

(async () => {
    // Must be called once at startup before any other Atlas functions.
    atlas.startup();

    console.log('Atlas Authentication Example\n');
    console.log('Choose an auth path:');
    console.log('  [1] License key       (classic, HWID-bound)');
    console.log('  [2] Account sign-in   (username + password + email verification)');
    console.log('  [3] Register account  (creates a new account, optional email)\n');
    const choice = (await ask('Choice [1/2/3]: ')).trim();

    let authed = false;

    if (choice === '1') {
        const license = (await ask('Enter license key: ')).trim();
        authed = atlas.login(license);
    }
    else if (choice === '2') {
        // Account sign-in - headless flow. account.login() returns a status
        // object; on 'needs_verify' the server has emailed an 8-digit code
        // to the account's address and is waiting for it.
        const username = (await ask('Enter username: ')).trim();
        const password = (await ask('Enter password: ')).trim();
        const r = atlas.account.login(username, password);
        if (r.status === 'ok') {
            authed = true;
        } else if (r.status === 'needs_verify') {
            console.log('\nWe emailed an 8-digit code to the address on file for this account.');
            const code = (await ask('Enter the code: ')).trim();
            atlas.account.submitVerification(code);
            authed = true;
        } else {
            console.log(`\n[!] ${r.error || 'Wrong username or password.'}`);
        }
    }
    else if (choice === '3') {
        // Register - create the account and confirm the email. Register does
        // NOT sign you in; re-run this example and pick [2] to sign in later.
        const username = (await ask('Pick a username: ')).trim();
        const password = (await ask('Pick a password: ')).trim();
        const email    = (await ask('Email (optional - enter to skip): ')).trim();
        try {
            atlas.account.register(username, password, email || undefined);
            if (email) {
                console.log(`\nWe emailed an 8-digit confirmation code to ${email}.`);
                const code = (await ask('Enter the code: ')).trim();
                atlas.account.submitVerification(code);
            }
            console.log(`\n[+] Account '${username}' is ready. Run this example again and pick [2] to sign in.`);
        } catch (err) {
            console.log(`\n[!] ${err.message}`);
        }
        rl.close();
        process.exit(0);
    }
    else {
        console.log('\nUnknown choice - exiting.');
        rl.close();
        process.exit(1);
    }

    if (!authed) {
        console.log(`\n[!] Authentication failed. ${atlas.data.getErrorMessage()}`);
        rl.close();
        process.exit(1);
    }

    // Call periodically to verify the session is still valid - terminates if not.
    atlas.network.checkAuthentication();

    // Session data - every field is populated the moment authed is true.
    // getUsername() is empty on license-only sessions.
    const username = atlas.data.getUsername();
    console.log('\n--- User Information ---');
    if (username) console.log(`Username:     ${username}`);
    console.log(`License:      ${atlas.data.getLicense()}`);
    console.log(`Expiry:       ${atlas.data.getExpiry()}`);
    console.log(`IP:           ${atlas.data.getIP()}`);
    console.log(`HWID:         ${atlas.data.getHWID()}`);
    console.log(`Level:        ${atlas.data.getLevel()}`);
    console.log(`Note:         ${atlas.data.getNote()}`);
    console.log(`Active Users: ${atlas.data.getActiveUserCount()}`);
    console.log(`Total Users:  ${atlas.data.getUserCount()}`);

    // Send a custom log message - appears in your dashboard Logs tab.
    atlas.network.submitLog('User successfully completed the example');

    // ChangePassword is only meaningful on a password-mode session.
    if (username) {
        const yn = (await ask('\nChange password? [y/N]: ')).trim().toLowerCase();
        if (yn === 'y') {
            const oldp = (await ask('Current password: ')).trim();
            const newp = (await ask('New password: ')).trim();
            if (atlas.network.changePassword(oldp, newp))
                console.log('[+] Password changed. Use the new password on your next sign-in.');
            else
                console.log(`[!] ${atlas.data.getErrorMessage()}`);
        }
    }

    // Password reset - not run inline (the session we just opened works, a
    // reset would only interrupt it). Wire these two calls into your own
    // "forgot password" surface:
    //
    //     atlas.account.requestPasswordReset('username-or-email');
    //     // ... user reads the 8-digit code from their email ...
    //     atlas.account.completePasswordReset(code, newPassword);

    // Download a file uploaded via the Atlas Panel
    // const fileData = atlas.network.download(1);
    // if (fileData.length > 0) {
    //     require('fs').writeFileSync('downloaded_file.bin', fileData);
    //     console.log(`\nFile downloaded (${fileData.length} bytes)`);
    // }

    await ask('\nPress Enter to exit program fully...');
    rl.close();
    process.exit(0);
})();
