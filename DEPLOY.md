# Deploy on Railway (always-on paper trading)

## Cost (not fully free)

Railway is **free to try**, not free forever for 24/7:

| Stage | Cost |
| --- | --- |
| Trial | ~$5 credits / 30 days |
| Ongoing (realistic) | **Hobby ~$5/month** (includes $5 usage credit) |

A small always-on Node service + tiny volume usually stays near Hobby. The Free plan after trial is too tight for reliable 24/7.

## What you get

- Public URL for Market Watch + Strategy Lab
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
| `DHAN_ACCESS_TOKEN` | your Dhan access token |
| `DHAN_API_BASE` | `https://api.dhan.co` (prod) |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |

5. **Volume** (Settings → Volumes): create a volume, mount path **`/data`**. Without this, paper trades are wiped on every redeploy.
6. **Networking**: generate a public domain.
7. Open `https://YOUR-APP.up.railway.app/lab` → **Start paper run** once.

## Verify

- App loads in the browser
- Railway **Deploy Logs** show `[paper-worker] started` and later sync messages on expiry mornings
- Close the browser; leave the Railway service running — paper sync continues
- Redeploy once and confirm active paper run / trade history still exists

## Local production-like start

```bash
npm run build
DATA_DIR=./data npm start
```

`npm start` boots the paper worker, then serves the built app.

## Notes

- Dhan access tokens expire — update `DHAN_ACCESS_TOKEN` in Railway when you refresh the token.
- Still **paper only** — no real order placement.
- Option-chain / rolling API rate limits still apply (~1 req / 3s).
