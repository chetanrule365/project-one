# Railway

Free-plan deploys must be serverless (`sleepApplication` in `railway.toml`). The service sleeps after a few minutes with no traffic. Opening the site (or a weekday ping) wakes it; the paper worker starts with the process.

## Setup

1. Push this repo to GitHub and create a Railway service from it.
2. **Settings → Deploy → Serverless** → on.
3. **Variables:**

| Name | Value |
| --- | --- |
| `DHAN_CLIENT_ID` | Dhan client id |
| `DHAN_API_BASE` | `https://api.dhan.co` |
| `DHAN_TOTP_SECRET` | TOTP secret from web.dhan.co |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | same Atlas URI as local `.env` |
| `MONGODB_DB` | `project-one` |
| `SESSION_SECRET` | same as local `.env` |
| `CLOUD_WORKER_SECRET` | same as local `.env` |

Do **not** set `CLOUD_APP_URL` on Railway. Set it only on the laptop (public Railway URL) to send backtests to the cloud.

4. **Volume:** mount path `/data` (optional cache; MongoDB is source of truth).
5. **Networking:** public domain.
6. Atlas → Network Access → allow `0.0.0.0/0`.
7. Deploy latest commit. Unlock at `/login` with the Dhan PIN.

### Wake for 10:00 IST entries

Ping `https://YOUR-APP.up.railway.app/healthz` every 5 minutes, Monday–Friday, 04:20–09:50 UTC.

Hobby ($5/month, Serverless off) is the path for unattended 24/7 without an external ping.
