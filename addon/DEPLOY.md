# Deploy Streamlol addon on Vercel (HTTPS for Board / TV)

Vercel gives you a public HTTPS URL Stremio (and smart TVs) can install. Library data cannot live in local files there — use **Upstash Redis** (free tier works).

## 1. One-time setup

```bash
cd addon
npm install
npx vercel login
```

## 2. Create Upstash Redis (required on Vercel)

Without this you get `EROFS: read-only file system` — Vercel cannot write `addon/data`.

In the [Vercel dashboard](https://vercel.com/dashboard) → your project:

1. **Storage** → **Create Database** → **Upstash Redis** (Marketplace / Integrations also work)
2. **Connect** it to this project for **Production** (and Preview if you want)
3. Confirm **Settings → Environment Variables** shows either:
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or
   - `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV naming — also supported)
4. **Redeploy** after adding Storage (env vars only apply to new deployments)

Optional: set `TMDB_TOKEN` as a project env var (or paste the token later on the configure page).

Quick check after deploy: `https://YOUR-APP.vercel.app/health`  
→ must say `"storage":"redis"`. If `"missing"`, Redis is not connected.

## 3. Deploy

```bash
cd addon
npx vercel --prod
```

You get a URL like `https://streamlol-addon-xxx.vercel.app`.

## 4. Create your library + install

1. Open `https://YOUR-APP.vercel.app/configure` **once** — you are redirected to  
   `https://YOUR-APP.vercel.app/<token>/`  
   **Bookmark that URL** (opening `/configure` again creates a new empty library).
2. Paste your **TMDB** token when asked (required).
3. Curate lists / Discover / viewed on that website.
4. Install the manifest in Stremio:  
   `https://YOUR-APP.vercel.app/<token>/manifest.json`
5. Open **Board / Discover** — rows named `Shelves · …` appear after you add titles.

### Optional ads

In Vercel env:

```
ADS_ENABLED=true
ADSENSE_CLIENT=ca-pub-xxxxxxxx
AD_SLOT_TOP=..........
AD_SLOT_RAIL=..........
AD_SLOT_FOOTER=..........
```

With only `ADS_ENABLED=true`, reserved placeholder slots show (good while AdSense is pending approval).

## 5. Check

```text
https://YOUR-APP.vercel.app/health
→ { "ok": true, "storage": "redis" }
```

If `storage` is `file`, Redis env vars are missing and data will not persist on Vercel.

## Notes

- Do **not** open `/configure` every time — each visit creates a **new** empty library. Reuse your bookmarked `…/<token>/configure`.
- Local `addon/data/*.json` is separate from Redis; migrate later by copying JSON into Redis if needed.
