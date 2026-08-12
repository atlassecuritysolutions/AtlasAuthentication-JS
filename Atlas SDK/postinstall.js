// Atlas SDK postinstall script.
//
// The JS analog of the C++ MSBuild post-build target and the Py
// install hook. Runs automatically after `npm install` / `npm ci` /
// `npm update`. The dev types one command and the binding files
// stay in lockstep with the C++ SDK release.
//
// Three responsibilities, in order:
//   1. Write the dev marker so the runtime DLL updater knows this
//      is a dev install (not an end-user bundle).
//   2. Fetch releases/latest from the JS repo. If newer than what
//      just installed, download the new src/index.js + package.json
//      and atomic-swap them in place, preserving the dev's API_KEY.
//   3. Stay silent on every failure. No exit(1), no thrown errors.
//      npm install must never break because of the postinstall.
//
// Atomic swap pattern: write to <file>.new, then fs.renameSync over
// the existing file. fs.renameSync is atomic on Windows + POSIX when
// both paths are on the same volume (npm guarantees this -- install
// is on one disk).

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');

const RELEASES_URL = 'https://api.github.com/repos/atlassecuritysolutions/AtlasAuthentication-JS/releases/latest';
const ASSETS = [
    { relPath: path.join('src', 'index.js'),  assetName: 'src/index.js' },
    { relPath: 'package.json',                assetName: 'package.json' },
];

function writeDevMarker() {
    try {
        const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const dir = path.join(local, 'AtlasAuth');
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

function currentVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        return pkg.version || '0.0.0';
    } catch (_) {
        return '0.0.0';
    }
}

function logLine(msg) {
    process.stdout.write('[atlas-sdk] ' + msg + '\n');
}

function httpsGetJson(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'atlas-sdk-postinstall/1.0' },
            timeout: 5000,
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (_) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function httpsGetBytes(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'atlas-sdk-postinstall/1.0' },
            timeout: 15000,
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function compareSemver(a, b) {
    const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    while (pa.length < 3) pa.push(0);
    while (pb.length < 3) pb.push(0);
    for (let i = 0; i < 3; i++) {
        if (pa[i] < pb[i]) return -1;
        if (pa[i] > pb[i]) return 1;
    }
    return 0;
}

function extractApiKey(body) {
    // API_KEY [ws] = [ws] ' or " ... ". Returns the value, or "".
    const m = body.match(/API_KEY\s*[=:]\s*['"]([^'"]*)['"]/);
    return m ? m[1] : '';
}

function patchApiKeyAndStamp(newBytes, userKey, fromV, toV) {
    // Insert a "// Atlas SDK auto-updated on DATE: X -> Y" comment
    // above the API_KEY line, then replace the API_KEY value with
    // the dev's existing key. Mirrors PatchApiKeyAndStamp in the C++
    // runtime updater.
    let body = newBytes.toString('utf8');
    const idx = body.indexOf('API_KEY');
    if (idx === -1) return newBytes;
    const lineStart = body.lastIndexOf('\n', idx) + 1;
    if (fromV && toV && fromV !== toV) {
        const stamp = `// Atlas SDK auto-updated on ${new Date().toISOString().replace('T', ' ').slice(0, 19)}: ${fromV} -> ${toV}\n`;
        body = body.slice(0, lineStart) + stamp + body.slice(lineStart);
    }
    if (!userKey) return Buffer.from(body, 'utf8');
    const m = body.match(/API_KEY(\s*[=:]\s*)(['"])([^'"]*)\2/);
    if (!m) return Buffer.from(body, 'utf8');
    body = body.replace(/API_KEY(\s*[=:]\s*)(['"])([^'"]*)\2/, `API_KEY$1$2${userKey}$2`);
    return Buffer.from(body, 'utf8');
}

function atomicSwapFile(targetPath, bytes) {
    const newPath = targetPath + '.new';
    try {
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
        fs.writeFileSync(newPath, bytes);
        fs.renameSync(newPath, targetPath);
        return true;
    } catch (_) {
        try { if (fs.existsSync(newPath)) fs.unlinkSync(newPath); } catch (_) {}
        return false;
    }
}

(async function main() {
    writeDevMarker();

    let release;
    try {
        release = await httpsGetJson(RELEASES_URL);
    } catch (_) {
        return; // silent -- postinstall is best-effort
    }
    if (!release || !release.tag_name || !Array.isArray(release.assets)) return;

    const remoteV = String(release.tag_name).replace(/^v/i, '');
    const localV  = currentVersion();
    if (compareSemver(remoteV, localV) <= 0) return; // up to date or ahead

    // Read the dev's existing API_KEY from the file we just installed.
    let userKey = '';
    try {
        const idxPath = path.join(__dirname, 'src', 'index.js');
        if (fs.existsSync(idxPath)) {
            userKey = extractApiKey(fs.readFileSync(idxPath, 'utf8'));
        }
    } catch (_) {}

    let swapped = 0;
    for (const a of ASSETS) {
        const asset = release.assets.find((x) => x && x.name === a.assetName);
        if (!asset || !asset.browser_download_url) continue;
        if (!/^https:\/\/(api\.github\.com|github\.com|objects\.githubusercontent\.com|raw\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(asset.browser_download_url)) continue;
        let bytes;
        try { bytes = await httpsGetBytes(asset.browser_download_url); }
        catch (_) { continue; }
        if (!bytes) continue;

        // API_KEY file: preserve dev's key + stamp the comment.
        if (a.assetName === 'src/index.js') {
            bytes = patchApiKeyAndStamp(bytes, userKey, localV, remoteV);
        }
        // package.json: stamp the version field via the same path; the
        // dev's API_KEY is in src/index.js, not here.

        const target = path.join(__dirname, a.relPath);
        if (atomicSwapFile(target, bytes)) swapped++;
    }

    if (swapped > 0) {
        logLine(`updated binding files: ${localV} -> ${remoteV} (${swapped} file(s))`);
    }
})().catch(() => { /* silent */ });
