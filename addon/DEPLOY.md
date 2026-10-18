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

- Library links are bearer credentials: anyone with the full URL can read and edit that library. Keep links private. Unknown tokens are rejected; only `/configure` creates a library.
- Creation is limited to 20 libraries per IP per hour; Stremio sign-in is limited to 10 attempts per IP per 15 minutes. Redis coordinates these limits across instances; local hosting uses bounded per-process counters. Limited requests return `429` with `Retry-After`. When configured Redis cannot enforce a limit, these actions return `503`.
- The app trusts one reverse-proxy hop for the client IP and HTTPS scheme. Vercel handles this automatically; self-hosted deployments must restrict direct access to the backend and configure the proxy to overwrite forwarded headers. Use HTTPS for public hosting.
- Library pages send `Referrer-Policy: no-referrer`, prevent framing and MIME sniffing, and use HttpOnly remembered-library cookies. Unexpected server errors omit internal details. Stremio requests time out after 15 seconds.

- Public TMDB and Cinemeta responses are cached automatically in the connected Redis database, so users and server instances reuse metadata. No new service or environment variable is needed.
- Discover/search/catalog pages expire after 15 minutes, title metadata and ratings after 6 hours, and TMDB genre/provider reference data after 24 hours. A bounded in-memory cache avoids Redis reads for warm entries.
- Identical concurrent requests within one server instance share a single upstream call. Separate instances can still fetch the same cold key simultaneously; subsequent requests reuse Redis.
- Personal libraries, viewed filters, reviews, credentials and Stremio sessions are excluded from the shared metadata cache. TMDB list pools stay local and credential-scoped. Without Redis, metadata caching works only within each running instance.
- Upstream failures are retried on the next request. Redis errors fall back to upstream fetching; metadata keys expire automatically but add Redis storage and command usage.

- Do **not** open `/configure` every time — each visit creates a **new** empty library. Reuse your bookmarked `…/<token>/configure`.
- Local `addon/data/*.json` is separate from Redis; migrate later by copying JSON into Redis if needed.
