# Deploy on Railway (always-on paper trading)

## Cost (not fully free)

Railway is **free to try**, not free forever for 24/7:

| Stage | Cost |
| --- | --- |
| Trial | ~$5 credits / 30 days |
| Ongoing (realistic) | **Hobby ~$5/month** (includes $5 usage credit) |

A small always-on Node service + tiny volume usually stays near Hobby. The Free plan after trial is too tight for reliable 24/7.

## What you get

- Public URL for Market Watch, Strategies, and Option Chain
- Paper worker starts with the process (no need to keep the browser open)
- Paper state (`paper.json`) + option cache on a **persistent volume** at `/data`

## One-time setup

1. Push this repo to GitHub.
2. Open [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select this repo.
3. Railway will build via the included `Dockerfile`.
4. **Variables** (Settings → Variables):

| Name | Value |
| --- | --- |
| `DHAN_CLIENT_ID` | your Dhan client id |
| `DHAN_API_BASE` | `https://api.dhan.co` (prod) |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |

Then supply the access token (it expires every 24h):

- **TOTP auto-login (recommended, hands-off):** enable TOTP on web.dhan.co
  (DhanHQ Trading APIs → Setup TOTP) and add `DHAN_PIN` + `DHAN_TOTP_SECRET`.
  The app mints and refreshes the token itself — no daily action. Verify with
  `DHAN_CLIENT_ID=… DHAN_PIN=… DHAN_TOTP_SECRET=… npx tsx scripts/dhan-token.ts`.
- **Fallback:** add `DHAN_ACCESS_TOKEN` (a token generated from web.dhan.co).

The minted token is cached at `/data/dhan-auth.json`, so keep the volume mounted.

5. **Volume** (Settings → Volumes): create a volume, mount path **`/data`**. Without this, paper trades are wiped on every redeploy.
6. **Networking**: generate a public domain.
7. Open `https://YOUR-APP.up.railway.app/paper` — paper trading is always on for all indices.

## Verify

- App loads in the browser
- Railway **Deploy Logs** show `[paper-worker] started` and later sync messages on weekday mornings (10:00–14:00 IST)
- Close the browser; leave the Railway service running — paper sync continues
- Redeploy once and confirm active paper run / trade history still exists

## Local production-like start

```bash
npm run build
DATA_DIR=./data npm start
```

`npm start` boots the paper worker, then serves the built app.

## Notes

- Dhan access tokens expire every 24h. With TOTP auto-login you never have to update it manually.
- Still **paper only** — no real order placement.
- Option-chain / rolling API rate limits still apply (~1 req / 3s).
