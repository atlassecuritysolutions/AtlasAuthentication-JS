// Atlas Authentication Library - Example Usage (Console)
// Run as x64 Node >= 18 | Set your API key in atlas-authentication (Atlas.API_KEY)

const readline = require('readline');
const atlas    = require('../Atlas SDK/src');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

(async () => {
    // Must be called once at startup before any other Atlas functions.
    atlas.Startup();

    console.log('Atlas Authentication Example\n');
    console.log('Choose an auth path:');
    console.log('  [1] License key       (classic, HWID-bound)');
    console.log('  [2] Account sign-in   (username + password + email verification)');
    console.log('  [3] Register account  (creates a new account, optional email (Configured in dashboard))');
    console.log();
    const choice = (await ask('Choice [1/2/3]: ')).trim();

    let authed = false;

    if (choice === '1') {
        const license = (await ask('Enter license key: ')).trim();
        authed = atlas.License.Login(license);
    }
    else if (choice === '2') {
        // ================================================================
        // ACCOUNT SIGN-IN - headless flow, every prompt rendered inline.
        //
        // Account.Login() returns a status. On NeedsVerification the server
        // emailed an 8-digit code; the SDK is holding the challenge until
        // SubmitVerification(code) is called.
        // ================================================================
        const username = (await ask('Enter username: ')).trim();
        const password = (await ask('Enter password: ')).trim();

        const r = atlas.Account.Login(username, password);
        const S = atlas.Account.Status;

        if (r.status === S.Ok) {
            authed = true;
        }
        else if (r.status === S.NeedsVerification) {
            let where = r.sign_in_ip;
            if (r.sign_in_country) where += ` / ${r.sign_in_country}`;
            console.log(`\nWe emailed an 8-digit code to ${r.masked_email} (from ${where})`);
            const code = (await ask('Enter the code: ')).trim();
            authed = atlas.Account.SubmitVerification(code);
        }
    }
    else if (choice === '3') {
        // ================================================================
        // REGISTER - create the account and confirm the email if supplied.
        // Register does NOT sign you in - run this example again and pick
        // [2] to sign in whenever you're ready.
        // ================================================================
        const username = (await ask('Pick a username: ')).trim();
        const password = (await ask('Pick a password: ')).trim();
        const email    = (await ask('Email (optional - enter to skip): ')).trim();

        if (!atlas.Account.Register(username, password, email)) {
            console.log(`\n[!] ${atlas.Data.GetErrorMessage()}`);
            await ask('\nPress Enter to exit...'); rl.close(); process.exit(1);
        }
        if (atlas.Account.HasPendingEmailConfirm()) {
            console.log(`\nWe emailed an 8-digit confirmation code to ${email}.`);
            const code = (await ask('Enter the code: ')).trim();
            if (!atlas.Account.ConfirmEmail(code)) {
                console.log(`\n[!] ${atlas.Data.GetErrorMessage()}`);
                await ask('\nPress Enter to exit...'); rl.close(); process.exit(1);
            }
        }
        console.log(`\n[+] Account '${username}' is ready. Run this example again and pick [2] to sign in.`);
        await ask('\nPress Enter to exit...'); rl.close(); process.exit(0);
    }
    else {
        console.log('\nUnknown choice - exiting.');
        rl.close(); process.exit(1);
    }

    if (!authed) {
        console.log(`\n[!] Authentication failed. ${atlas.Data.GetErrorMessage()}`);
        await ask('\nPress Enter to exit...'); rl.close(); process.exit(1);
    }

    // On account sessions GetLicense() returns a synthetic "user:<name>" -
    // hide it and print Username instead. On license-only sessions Username
    // is empty and License is the real key.
    console.log('\n--- User Information ---');
    const isAccount = !!atlas.Data.GetUsername();
    if (isAccount) console.log(`Username:     ${atlas.Data.GetUsername()}`);
    else           console.log(`License:      ${atlas.Data.GetLicense()}`);
    console.log(`Expiry:       ${atlas.Data.GetExpiry()}`);
    console.log(`IP:           ${atlas.Data.GetIP()}`);
    console.log(`HWID:         ${atlas.Data.GetHWID()}`);
    console.log(`Level:        ${atlas.Data.GetLevel()}`);
    console.log(`Note:         ${atlas.Data.GetNote()}`);
    console.log(`Active Users: ${atlas.Data.GetActiveUserCount()}`);
    console.log(`Total Users:  ${atlas.Data.GetUserCount()}`);

    // Send a custom log message - appears in your dashboard Logs tab.
    atlas.Network.SubmitLog('User successfully completed the example');

    // ChangePassword is only meaningful on a password-mode session.
    if (atlas.Data.GetUsername()) {
        const yn = (await ask('\nChange password? [y/N]: ')).trim().toLowerCase();
        if (yn === 'y') {
            const oldp = (await ask('Current password: ')).trim();
            const newp = (await ask('New password: ')).trim();
            if (atlas.Network.ChangePassword(oldp, newp))
                console.log('[+] Password changed. Use the new password on your next sign-in.');
            else
                console.log(`[!] ${atlas.Data.GetErrorMessage()}`);
        }
    }

    // ================================================================
    // OPTIONAL - password reset flow. Not run inline (would interrupt
    // the session we just opened). Two calls, ready to lift:
    //
    //     atlas.Account.RequestPasswordReset('username-or-email');
    //     // ... user reads the 8-digit code from their email ...
    //     atlas.Account.CompletePasswordReset(code, new_password);
    // ================================================================

    await ask('\nPress Enter to exit program fully...');
    rl.close(); process.exit(0);
})();
