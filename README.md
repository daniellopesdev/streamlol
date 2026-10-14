# Streamlol

Personal **Shelves** for Stremio: library, viewed (calendar), reviews, lists, and Discover with IMDb / genre / platform filters — plus a **Shelves** tab in a forked [stremio-web](https://github.com/Stremio/stremio-web).

The player, addons, and Real-Debrid stack are untouched. Streamlol only adds organization and discovery.

## What you get

| Piece | Role |
| --- | --- |
| `addon/` | Stremio addon: catalogs + HTTP API for shelves, Discover, film details / suggestions |
| `web/` | Fork of stremio-web with a parallel **Shelves** tab (TV remote–friendly controls) |
| `desktop/` | Optional Electron shell that loads the web production build |

**Official Stremio apps (including TV)** only see the addon’s catalog rows. The Shelves tab exists in this web fork / desktop shell.

## Requirements

- Node.js 22+
- pnpm 11.8.0 for `web/` (use `npx pnpm@11.8.0`)
- A free [TMDB API](https://www.themoviedb.org/settings/api) key or read token (recommended for platforms + cast / director suggestions)

## Quick start (local)

### 1. Addon

```bash
cd addon
cp .env.example .env   # optional: set TMDB_TOKEN for server-wide default
npm install
npm start              # http://127.0.0.1:7000
```

Open `http://127.0.0.1:7000/configure`, create a library, install into Stremio (or copy the manifest URL). You can also paste a TMDB token in Shelves → Settings or on the configure page.

### 2. Web (Shelves tab)

```bash
cd web
npx pnpm@11.8.0 install
npx pnpm@11.8.0 start  # http://localhost:8080
```

Open the **Shelves** tab in the nav. Connect with the manifest URL from the configure page if it does not auto-detect.

### 3. Desktop app (Windows `.exe`)

```bash
cd web && npx pnpm@11.8.0 run build
cd ../desktop && npm install && npm run pack
```

Run `desktop/dist/win-unpacked/Streamlol.exe` (amber shelf icon), or double‑click **Streamlol.lnk** / **Streamlol.bat** (starts the addon + app). A shortcut is also on your Desktop.

Dev without packaging: `cd desktop && npm start` (needs `web/build` already built).

## Self-hosting the addon

Stremio needs **HTTPS** for non-localhost addons. Run `addon/` behind a reverse proxy, or use the included Docker image:

```bash
docker build -t streamlol-addon ./addon
docker run -d -p 7000:7000 \
  -v streamlol-data:/app/data \
  -e TMDB_TOKEN=your_token_optional \
  streamlol-addon
```

Persist `/app/data` — each user’s library is a JSON file keyed by token.

## Features

- **Library / Viewed / Reviewed** shelves, with Viewed grouped by calendar month
- **Lists** and saved Discover filters as Stremio catalog rows
- **Discover**: sort, IMDb floor, genres (include / exclude), years, platforms (merged brands), hide viewed
- **Movies | Series** under every category
- Film panel: score, notes, lists, viewed date, cast / director suggestions (TMDB)

Platform chips collapse TMDB duplicates (e.g. *Amazon Prime Video with Ads*) into one brand; filtering still matches every sibling provider id.

## Board (stock Stremio / TV)

**Manage on the website, watch from Stremio.**

1. Open `https://YOUR-APP/configure` once → bookmark `https://YOUR-APP/<token>/`.
2. Set your **TMDB** token (required), then curate Discover / lists / viewed there.
3. Install `…/<token>/manifest.json` in Stremio.
4. Board / Discover shows **Shelves · …** rows.

The optional Streamlol desktop fork is no longer required for day-to-day use.

**Same PC:** `http://127.0.0.1:7000/<token>/`  
**TV:** use the HTTPS Vercel URL (see `addon/DEPLOY.md`). Ads can be enabled later via `ADS_*` env vars.

### Deploy on Vercel (recommended for TV)

See [`addon/DEPLOY.md`](addon/DEPLOY.md). Short version:

```bash
cd addon
npx vercel login
# add Upstash Redis + env UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
npx vercel --prod
```

Then open `https://your-app.vercel.app/configure`, bookmark your token URL, and install that manifest in Stremio.

## Upstream

`web/` is based on [Stremio/stremio-web](https://github.com/Stremio/stremio-web) **v5.0.0-beta.42** (GPL-2.0). Streamlol changes live mainly under `web/src/routes/Shelves/` plus small nav / router wiring.

This project is not affiliated with Stremio or Smart Code OOD.

## License

[GPL-2.0](LICENSE) — required because this repository includes a modified stremio-web.

Movie / TV metadata via [Cinemeta](https://github.com/Stremio/stremio-cinemeta) and optionally [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
