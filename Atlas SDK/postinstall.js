// Atlas SDK postinstall script.
//
// Runs after `npm install` / `npm ci` / `npm update` and does one thing: write
// the dev marker, so the SDK can tell a developer machine from an end-user
// bundle.
//
// It makes no network calls and rewrites no package files. An earlier version
// fetched src/index.js from a GitHub release and swapped it in place, which
// skipped npm's integrity check and the lockfile, and no release ever carried
// those assets. Binding updates arrive through `npm update`, from the registry.
//
// Never throws and never exits non-zero: npm install must not break because
// of the postinstall.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

function currentVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        return pkg.version || '0.0.0';
    } catch (_) {
        return '0.0.0';
    }
}

function writeDevMarker() {
    try {
        const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const dir = path.join(local, 'AtlasAuth', 'data');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const marker = {
            sdk: 'npm',
            version: currentVersion(),
            ts: new Date().toISOString(),
        };
        fs.writeFileSync(
            path.join(dir, 'dev_marker.json'),
            JSON.stringify(marker, null, 2),
            'utf8'
        );
    } catch (_) { /* silent -- dev marker is a hint, not a gate */ }
}

writeDevMarker();
