const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

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

function serveBuild() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
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
        server.listen(0, '127.0.0.1', () => resolve(server));
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
        webPreferences: { contextIsolation: true, nodeIntegration: false },
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
    const server = await serveBuild();
    const { port } = server.address();
    app.on('before-quit', () => server.close());
    await window.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(openWindow);
app.on('window-all-closed', () => app.quit());
