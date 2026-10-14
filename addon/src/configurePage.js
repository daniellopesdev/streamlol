const TMDB_STEPS = [
    'Create a free account at <b>themoviedb.org/signup</b> and confirm the email TMDB sends you.',
    'Open <b>themoviedb.org/settings/api</b> (avatar &rarr; Settings &rarr; API).',
    'Click <b>Create</b> / <b>Request an API key</b>, pick <b>Developer</b>, accept the terms.',
    'Fill the form: any app name (e.g. "Streamlol"), URL <b>http://localhost</b>, use "Personal film lists". Submit.',
    'Back on the API page, copy <b>API Read Access Token</b> (the long one starting with <b>eyJ</b>). The short 32-character API Key works too.',
    'Paste it in the Shelves app (or below). It is stored only on this addon server, under your library.',
];

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
}

function configurePage({ manifestUrl, installUrl, token, tmdb, appUrl }) {
    const status = tmdb === 'user' ? 'Saved' : tmdb === 'server' ? 'Using the server token' : 'Not set';
    const shelvesUrl = appUrl || manifestUrl.replace(/manifest\.json$/, '');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Streamlol Shelves</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; font-size: 18px; background: #0b0d12; color: #f4f1ea; }
    main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
    h1 { font-size: 2rem; margin: 0 0 0.5rem; color: #e8a838; }
    h2 { font-size: 1.3rem; margin: 2.5rem 0 0.75rem; }
    p, li { line-height: 1.55; color: rgba(244,241,234,0.7); }
    ol { padding-left: 1.4rem; }
    li { margin-bottom: 0.6rem; }
    b { color: #fff; }
    input { width: 100%; margin: 0.5rem 0 1rem; padding: 1rem; font-size: 1rem; background: #1a2030; color: #fff; border: 2px solid transparent; border-radius: 0.75rem; }
    input:focus { outline: none; border-color: #e8a838; }
    .row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    .button { display: inline-flex; align-items: center; min-height: 3.5rem; padding: 0 1.5rem; font-size: 1.05rem; font-weight: 600; border-radius: 3.5rem; border: 2px solid transparent; background: #3d9b8f; color: #041210; text-decoration: none; cursor: pointer; }
    .button.secondary { background: rgba(255,255,255,0.08); color: #fff; }
    .button:focus, .button:hover { outline: none; border-color: #fff; }
    .status { display: inline-block; padding: 0.3rem 0.9rem; border-radius: 1rem; background: rgba(255,255,255,0.08); font-size: 0.9rem; }
    .status.ok { background: rgba(34,179,101,0.25); color: #8ff0bb; }
    #message { min-height: 1.5rem; }
  </style>
</head>
<body>
  <main>
    <h1>Streamlol Shelves</h1>
    <p>Curate lists and Discover filters on the web. Stremio Board / Discover shows them as <b>Shelves · …</b> rows (including on TV).</p>

    <h2>1. Open your Shelves</h2>
    <p>Bookmark this library URL. Opening the generic /configure page again creates a <b>new empty</b> library.</p>
    <div class="row">
      <a class="button" href="${escapeHtml(shelvesUrl)}">Open Shelves app</a>
      <a class="button secondary" href="${escapeHtml(installUrl)}">Install in Stremio</a>
    </div>

    <h2>2. Manifest</h2>
    <input readonly value="${escapeHtml(manifestUrl)}" onfocus="this.select()">
    <div class="row">
      <a class="button secondary" href="${escapeHtml(manifestUrl)}">Open manifest</a>
    </div>

    <h2>3. TMDB token <span id="status" class="status${tmdb ? ' ok' : ''}">${status}</span></h2>
    ${tmdb ? `
    <p>Token is already saved. You can also change it inside the Shelves app → Settings.</p>
    <details>
      <summary>Change or replace the token</summary>
      <form id="tmdb">
        <input id="tmdb-token" type="password" autocomplete="off" placeholder="Paste a new API Read Access Token">
        <div class="row">
          <button class="button" type="submit">Save token</button>
          <button class="button secondary" type="button" id="tmdb-clear">Remove token</button>
        </div>
      </form>
    </details>
    ` : `
    <p>Required for Discover, platforms, cast and suggestions:</p>
    <ol>${TMDB_STEPS.map((step) => `<li>${step}</li>`).join('')}</ol>
    <form id="tmdb">
      <input id="tmdb-token" type="password" autocomplete="off" placeholder="Paste API Read Access Token">
      <div class="row">
        <button class="button" type="submit">Save token</button>
      </div>
    </form>
    `}
    <p id="message"></p>

    <h2>Library token</h2>
    <p>Keep this private. It identifies your shelves: <b>${escapeHtml(token)}</b></p>
  </main>
  <script>
    const api = ${JSON.stringify(`/api/${token}/tmdb`)};
    const message = document.getElementById('message');
    const status = document.getElementById('status');
    function show(text, ok) {
      message.textContent = text;
      status.textContent = ok ? 'Saved' : 'Not set';
      status.className = ok ? 'status ok' : 'status';
    }
    document.getElementById('tmdb').addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = 'Checking token with TMDB...';
      const response = await fetch(api, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: document.getElementById('tmdb-token').value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        document.getElementById('tmdb-token').value = '';
        show('Token saved. Open the Shelves app to curate.', true);
      } else {
        message.textContent = payload.err || 'Could not save token.';
      }
    });
    const clear = document.getElementById('tmdb-clear');
    if (clear) clear.addEventListener('click', async () => {
      const response = await fetch(api, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      show('Token removed.', payload.tmdb === 'server');
    });
  </script>
</body>
</html>`;
}

module.exports = { configurePage };
