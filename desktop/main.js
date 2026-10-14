const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DESKTOP_PORT = Number(process.env.STREAMLOL_DESKTOP_PORT) || 17811;

const buildDir = app.isPackaged
    ? path.join(process.resourcesPath, 'web-build')
    : path.resolve(__dirname, '..', 'web', 'build');

const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'build', 'icon.ico');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
};

function configPath() {
    return path.join(app.getPath('userData'), 'streamlol-desktop.json');
}

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    } catch {
        return {};
    }
}

function writeConfig(patch) {
    const next = { ...readConfig(), ...patch, updatedAt: Date.now() };
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
    return next;
}

function serveBuild() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');

            if (url.pathname === '/__streamlol__/config.json') {
                if (req.method === 'GET') {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store',
                    });
                    res.end(JSON.stringify(readConfig()));
                    return;
                }
                if (req.method === 'PUT' || req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk) => { body += chunk; });
                    req.on('end', () => {
                        try {
                            const payload = JSON.parse(body || '{}');
                            const saved = writeConfig({
                                transportUrl: typeof payload.transportUrl === 'string' ? payload.transportUrl : '',
                            });
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(saved));
                        } catch (error) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ err: error.message }));
                        }
                    });
                    return;
                }
                res.writeHead(405);
                res.end();
                return;
            }

            const requested = decodeURIComponent(url.pathname);
            let filePath = path.normalize(path.join(buildDir, requested));
            const root = buildDir.endsWith(path.sep) ? buildDir : buildDir + path.sep;
            if (filePath !== buildDir && !filePath.startsWith(root)) {
                res.writeHead(403);
                res.end();
                return;
            }
            if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                filePath = path.join(buildDir, 'index.html');
            }
            fs.readFile(filePath, (error, body) => {
                if (error) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
                res.end(body);
            });
        });
        server.listen(DESKTOP_PORT, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
    });
}

function missingPage() {
    return `data:text/html,${encodeURIComponent(`<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#0b0d12;color:#f4f1ea;padding:2rem"><h1>Streamlol</h1><p>The desktop shell loads the Shelves web build from web/build. Build it from the web folder, then start this shell again.</p></body></html>`)}`;
}

async function openWindow() {
    const window = new BrowserWindow({
        width: 1280,
        height: 800,
        backgroundColor: '#0b0d12',
        autoHideMenuBar: true,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:streamlol',
        },
    });
    const override = process.env.STREAMLOL_WEB_URL;
    if (override) {
        await window.loadURL(override);
        return;
    }
    if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
        await window.loadURL(missingPage());
        return;
    }
    let server;
    try {
        server = await serveBuild();
    } catch (error) {
        if (error && error.code === 'EADDRINUSE') {
            await window.loadURL(`http://127.0.0.1:${DESKTOP_PORT}/`);
            return;
        }
        throw error;
    }
    app.on('before-quit', () => server.close());
    await window.loadURL(`http://127.0.0.1:${DESKTOP_PORT}/`);
}

app.whenReady().then(openWindow);
app.on('window-all-closed', () => app.quit());
