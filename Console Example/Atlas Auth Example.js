// Atlas Authentication Library — Example Usage (Node / Console)
// Run as x64 Node >= 18 | Set your API key below.
//
// Mirrors the C++ Console example — three auth paths in one menu, plus a
// post-login change-password prompt for user-mode sessions.
//
//     [1] License key         classic single-user, HWID-bound flow
//     [2] Username/password   sign in to a password account
//     [3] Register            bind a license to a new username/password,
//                             then auto-sign-in as the new account
//
// Every downstream call — data.*, network.checkAuthentication,
// network.submitLog, network.changePassword — works identically regardless of
// which path was chosen.

const atlas = require('../Atlas SDK/src');

// Set your API key — copy from atlassecurity.site → dashboard → API keys.
// (C++ users set this in Atlas.h; JS/Node users set it here in code.)
atlas.setApiKey('YOUR_API_KEY');

(async () => {
    // Must be called once at startup before any other Atlas functions.
    atlas.startup();

    console.log('Atlas Authentication Example\n');
    console.log('Choose an auth path:');
    console.log('  [1] License key       (classic, HWID-bound)');
    console.log('  [2] Username/password (existing password account)');
    console.log('  [3] Register          (bind a license to a new user/pass)');

    const choice = (await prompt('\nChoice [1/2/3]: ')).trim();

    let authed = false;

    if (choice === '1') {
        const license = (await prompt('Enter license key: ')).trim();
        console.log('Connecting to server...');
        authed = atlas.login(license);
        if (!authed) printError('Authentication failed!');
    } else if (choice === '2') {
        const username = (await prompt('Enter username: ')).trim();
        const password = (await prompt('Enter password: ')).trim();
        console.log('Connecting to server...');
        authed = atlas.login(username, password);
        if (!authed) printError('Authentication failed!');
    } else if (choice === '3') {
        const license  = (await prompt('Enter license key to bind: ')).trim();
        const username = (await prompt('Pick a username (3-80 chars): ')).trim();
        const password = (await prompt('Pick a password (6-128 chars): ')).trim();
        console.log('Registering account...');
        if (!atlas.register(license, username, password)) {
            printError('Registration failed!');
        } else {
            const info = atlas.data.getErrorMessage(); // Register success message rides on the same field
            if (info) console.log(`[+] ${info}`);
            console.log('Signing in with the new account...');
            authed = atlas.login(username, password);
            if (!authed) printError('Sign-in after registration failed!');
        }
    } else {
        console.log('\nUnknown choice — exiting.');
        process.exit(1);
    }

    if (!authed) {
        console.log('\nPress Enter to exit...');
        await prompt('');
        process.exit(1);
    }

    // Call periodically to verify the session is still valid — terminates if not.
    atlas.network.checkAuthentication();

    // Access user data after successful authentication. getUsername() is set
    // only for password-mode logins; empty for license-only.
    const username = atlas.data.getUsername();
    console.log('\n--- User Information ---');
    if (username) console.log(`Username: ${username}`);
    console.log(`License:  ${atlas.data.getLicense()}`);
    console.log(`Expiry:   ${atlas.data.getExpiry()}`);
    console.log(`IP:       ${atlas.data.getIP()}`);
    console.log(`HWID:     ${atlas.data.getHWID()}`);
    console.log(`Level:    ${atlas.data.getLevel()}`);   // number
    console.log(`Note:     ${atlas.data.getNote()}`);
    console.log(`Active Users: ${atlas.data.getActiveUserCount()}`);
    console.log(`Total Users:  ${atlas.data.getUserCount()}`);

    // Send a custom log message — appears in your dashboard Logs tab.
    atlas.network.submitLog('User successfully completed the example');

    // ChangePassword is only meaningful in a password-mode session. Mirrors the
    // C++ Console example: we only offer the prompt when it applies.
    if (username) {
        const yn = (await prompt('\nChange password? [y/N]: ')).trim().toLowerCase();
        if (yn === 'y') {
            const oldp = (await prompt('Current password: ')).trim();
            const newp = (await prompt('New password (6-128 chars): ')).trim();
            if (atlas.network.changePassword(oldp, newp)) {
                console.log('[+] Password changed. Use the new password on your next login.');
            } else {
                printError('Password change failed!');
            }
        }
    }

    // Download a file uploaded via the Atlas Panel
    // const fileData = atlas.network.download(1);
    // if (fileData.length > 0) {
    //     require('fs').writeFileSync('downloaded_file.bin', fileData);
    //     console.log(`\nFile downloaded (${fileData.length} bytes)`);
    // }

    console.log('\nPress Enter to exit program fully...');
    await prompt('');
    process.exit(0);
})();

// Small helpers kept at the bottom so main() reads top-to-bottom just like
// the C++ example.
function prompt(label) {
    return new Promise((resolve) => {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        rl.question(label, (l) => { rl.close(); resolve(l); });
    });
}
function printError(headline) {
    const err = atlas.data.getErrorMessage();
    console.log(`\n[!] ${headline}`);
    if (err) console.log(`[!] Reason: ${err}`);
}
