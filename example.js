// Atlas Authentication SDK — Node.js Console Example
// Run as x64 Node ≥18 · Set your API key below (Atlas.setApiKey)
// Mirrors ../C++ Integration/Atlas Auth Example.cpp line-for-line so
// developers porting from C++ can diff the two files directly.

const readline = require('readline');
const atlas = require('./src'); // in a published package this is: require('@atlas/auth')

async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
    // Set your API key — copy from atlassecurity.site → dashboard → API keys
    atlas.setApiKey('YOUR_API_KEY_HERE');

    // (Optional) Pin the apphash. Without this call, startup() auto-detects a
    // sensible source — for a Node script that's `require.main.filename`; for
    // Electron it's `<resourcesPath>/app.asar`. Set it explicitly if you want
    // to hash your bundle path, or if your build pipeline injects a
    // precomputed hash. See ../docs/AppHash.md for the security contract.
    //
    // atlas.setAppHashFromFile('./resources/app.asar');   // hash the file
    // atlas.setAppHash('a1b2c3d4...64chars');            // precomputed hex

    // Must be called once at startup before any other Atlas functions
    atlas.startup();

    // Print what apphash the server will actually see — helpful during dev.
    console.log(`Apphash: ${atlas.getResolvedAppHash()}`);

    console.log('Atlas Authentication Example\n');

    // Prompt user for license key and authenticate with the server
    const license = (await prompt('Enter license: ')).trim();
    console.log('Attempting to connect to server...');

    if (!atlas.login(license)) {
        // Check the Logs tab in your dashboard for full details
        const errorMsg = atlas.data.getErrorMessage();
        console.log('\n[!] Authentication failed!');
        if (errorMsg) console.log(`[!] Reason: ${errorMsg}`);
        console.log('\nPress Enter to exit...');
        await prompt('');
        process.exit(1);
    }

    // Call periodically to verify the session is still valid — terminates if not
    atlas.network.checkAuthentication();

    // Access user data after successful authentication
    console.log('\n--- User Information ---');
    console.log(`License: ${atlas.data.getLicense()}`);
    console.log(`Expiry: ${atlas.data.getExpiry()}`);
    console.log(`IP: ${atlas.data.getIP()}`);
    console.log(`HWID: ${atlas.data.getHWID()}`);
    console.log(`Level: ${atlas.data.getLevel()}`);
    console.log(`Note: ${atlas.data.getNote()}`);
    console.log(`Active Users: ${atlas.data.getActiveUserCount()}`);
    console.log(`Total Users: ${atlas.data.getUserCount()}`);

    // Send a custom log message — appears in your dashboard Logs tab
    atlas.network.submitLog('User successfully completed the example');

    // Download a file uploaded via the Atlas Panel
    // const fileData = atlas.network.download(1);
    // if (fileData.length > 0) {
    //     require('fs').writeFileSync('downloaded_file.bin', fileData);
    //     console.log(`\nFile downloaded (${fileData.length} bytes)`);
    // }

    // Your application code continues here
    console.log('\nPress Enter to exit program fully...');
    await prompt('');
    process.exit(0);
}

main().catch((err) => {
    if (err && err.name === 'AtlasError') {
        console.error(`\n[!] ${err.message}`);
    } else {
        console.error('\n[!] Unexpected error:', err);
    }
    process.exit(1);
});
