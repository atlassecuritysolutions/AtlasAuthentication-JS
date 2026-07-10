#!/usr/bin/env node
// ============================================================================
// Atlas SDK — manage auto-update from the command line.
//
// The JS equivalent of the manage_autoupdate.bat that the C++ updater ships.
// Run interactively from anywhere:
//
//   node manage_autoupdate.js status         # what's the current state?
//   node manage_autoupdate.js enable         # opt in (writes installed.flag)
//   node manage_autoupdate.js disable        # opt out (writes declined.flag)
//   node manage_autoupdate.js check          # one-shot: probe GitHub now
//   node manage_autoupdate.js reset          # clear all flags + SHA cache
//   node manage_autoupdate.js open-folder    # open %LOCALAPPDATA%\AtlasAuth
//
// Prints human-readable output. Exits 0 on success, non-zero on error.
// Never prompts modally — this is CLI, not UI.
// ============================================================================

'use strict';

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const updater = require('./src/updater');

const cmd = (process.argv[2] || 'status').toLowerCase();
const ACK = 'I understand this pulls executable code from GitHub';

function printStatus() {
    const s = updater.status();
    console.log('Atlas auto-update — status');
    console.log('  opted in:            ', s.optedIn ? 'yes' : 'no');
    console.log('  cache dir:           ', s.cacheDir);
    console.log('  installed.flag file: ', s.installedFlag ? 'exists' : 'absent');
    console.log('  declined.flag file:  ', s.declinedFlag ? 'exists' : 'absent');
    console.log('  last known SHA:      ', s.lastKnownSha || '(none)');
    console.log('  environment gates:');
    console.log('    packaged Electron:', s.packagedElectron ? 'YES (auto-update refused)' : 'no');
    console.log('    NODE_ENV=production:', s.productionNode ? 'YES (auto-update refused)' : 'no');
}

async function doCheck() {
    // Resolve the SDK's DLL path the same way index.js does. This is
    // module-relative so `node manage_autoupdate.js check` works from
    // any cwd as long as this script sits next to the package.
    const dllPath = path.resolve(__dirname, 'Atlas.dll');
    console.log(`probing GitHub for a newer Atlas.dll, target: ${dllPath}`);
    const result = await updater.tryUpdate({ dllPath });
    console.log(`  checked: ${result.checked}`);
    console.log(`  updated: ${result.updated}`);
    console.log(`  reason:  ${result.reason}`);
    if (result.updated) {
        console.log(`\nA new Atlas.dll has been downloaded as ${dllPath}.new`);
        console.log(`It will be swapped in the next time you run any Atlas-linked Node process.`);
    }
    process.exit(result.reason.startsWith('signature verification failed') ? 2 : 0);
}

function doReset() {
    const dir = updater._internal.getCacheDir();
    const targets = [
        updater._internal.INSTALLED_FLAG,
        updater._internal.DECLINED_FLAG,
        updater._internal.COMMIT_FILE,
    ];
    let removed = 0;
    for (const name of targets) {
        try { fs.unlinkSync(path.join(dir, name)); removed++; } catch { /* absent, fine */ }
    }
    console.log(`reset complete — removed ${removed} state file(s) from ${dir}`);
    console.log('Auto-update is now in its factory state. Call `enable` to opt in again.');
}

function doOpenFolder() {
    const dir = updater._internal.ensureCacheDir();
    console.log(`opening: ${dir}`);
    if (process.platform === 'win32') {
        require('child_process').execFile('explorer.exe', [dir]);
    } else {
        console.log('(open the path manually on non-Windows systems)');
    }
}

async function main() {
    switch (cmd) {
        case 'status':
            printStatus();
            break;
        case 'enable':
            try {
                updater.enableAutoUpdate({ ack: ACK });
                console.log('opted in — Atlas.dll will be checked against GitHub on next startup()');
                printStatus();
            } catch (err) {
                console.error(`enable failed: ${err.message}`);
                process.exit(1);
            }
            break;
        case 'disable':
            updater.disableAutoUpdate();
            console.log('opted out — declined.flag written, no further update checks');
            printStatus();
            break;
        case 'check':
            await doCheck();
            break;
        case 'reset':
            doReset();
            break;
        case 'open-folder':
        case 'openfolder':
        case 'folder':
            doOpenFolder();
            break;
        case 'help':
        case '--help':
        case '-h':
        case '/?':
            console.log(fs.readFileSync(__filename, 'utf8').split('===')[1] || '(help unavailable)');
            break;
        default:
            console.error(`unknown command: ${cmd}`);
            console.error('run "node manage_autoupdate.js help" for usage');
            process.exit(1);
    }
}

main().catch((err) => {
    console.error('fatal:', err && err.stack || err);
    process.exit(1);
});
