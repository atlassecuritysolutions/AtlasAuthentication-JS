// Atlas Authentication Library - Example Usage
// Run as x64 Node >= 18 | Set your API key below

const atlas = require('../shared/src');

// Set your API key -- copy from atlassecurity.site -> dashboard -> API keys
// (C++ users set this in Atlas.h; JS/Node users set it here in code)
atlas.setApiKey('YOUR_API_KEY');

(async () => {
    // Must be called once at startup before any other Atlas functions
    atlas.startup();

    console.log('Atlas Authentication Example\n');

    // Prompt user for license key and authenticate with the server
    process.stdout.write('Enter license: ');
    const license = (await readLine()).trim();
    console.log('Attempting to connect to server...');

    if (!atlas.login(license)) {
        // Check the Logs tab in your dashboard for full details
        const errorMsg = atlas.data.getErrorMessage();
        console.log('\n[!] Authentication failed!');
        if (errorMsg) console.log(`[!] Reason: ${errorMsg}`);
        console.log('\nPress Enter to exit...');
        await readLine();
        process.exit(1);
    }

    // Call periodically to verify the session is still valid -- terminates if not
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

    // Send a custom log message -- appears in your dashboard Logs tab
    atlas.network.submitLog('User successfully completed the example');

    // Download a file uploaded via the Atlas Panel
    // const fileData = atlas.network.download(1);
    // if (fileData.length > 0) {
    //     require('fs').writeFileSync('downloaded_file.bin', fileData);
    //     console.log(`\nFile downloaded (${fileData.length} bytes)`);
    // }

    // Your application code continues here
    console.log('\nPress Enter to exit program fully...');
    await readLine();
    process.exit(0);
})();

// Node doesn't have a synchronous std::getline equivalent; readline is the
// idiomatic replacement. Kept at the bottom so main() reads top-to-bottom
// just like the C++ example.
function readLine() {
    return new Promise((resolve) => {
        const rl = require('readline').createInterface({ input: process.stdin });
        rl.once('line', (l) => { rl.close(); resolve(l); });
    });
}
