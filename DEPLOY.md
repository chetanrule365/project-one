# Deploy on Google Cloud (always-free e2-micro)

Always-on paper trading on one **e2-micro** VM in `us-central1` (also valid:
`us-west1`, `us-east1`). That shape is in Google’s [Always Free](https://cloud.google.com/free/docs/free-cloud-features#compute)
tier: **$0 compute** if it is your only VM and you stay on a 30 GB standard disk.

You still need a **billing account** attached (Google’s rule). Set a **$1–$5
budget alert**. Outbound calls to Dhan count as egress and can go past the
1 GB/month free network cap.

## One-time Google setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **Billing → Link a billing account** (card required; Always Free resources are not charged if you only create what this guide creates).
3. **Billing → Budgets & alerts** → create a budget (e.g. $5) with email alerts.
4. Open **Cloud Shell** (icon at the top of the console).

## Deploy (Cloud Shell)

```bash
git clone https://github.com/chetanrule365/project-one.git
cd project-one
gcloud config set project market-watch-510115
bash deploy/gcp/provision.sh
```

The script creates `paper-vm`, builds the app in Cloud Shell (the VM only has
1 GB RAM), uploads it, and starts a systemd service.

Then:

```bash
gcloud compute ssh paper-vm --zone=us-central1-a
sudo nano /etc/paper.env
```

Set:

| Name | Value |
| --- | --- |
| `DHAN_CLIENT_ID` | your Dhan client id |
| `DHAN_PIN` | Dhan PIN (TOTP auto-login) |
| `DHAN_TOTP_SECRET` | TOTP secret from web.dhan.co |
| `DHAN_API_BASE` | `https://api.dhan.co` |

```bash
sudo systemctl restart paper
curl -sS http://127.0.0.1:3000/healthz
```

Open `http://VM_IP:3000` (the provision script prints the IP). Paper state lives
on the VM disk at `/var/lib/paper-data`.

## Update later

From Cloud Shell, in the repo:

```bash
git pull
bash deploy/gcp/provision.sh
```

Existing `paper-vm` is reused; `/var/lib/paper-data` is not wiped.

## Verify

- `/healthz` returns `ok`
- App loads in the browser
- `sudo journalctl -u paper -f` shows `[paper-worker] started`
- Close the browser; leave the VM running — paper sync continues on weekdays

## If e2-micro is out of capacity

Retry another zone, still in a free region:

```bash
ZONE=us-central1-b bash deploy/gcp/provision.sh
ZONE=us-east1-b bash deploy/gcp/provision.sh
```

## Notes

- Do **not** create extra VMs, static IPs, or load balancers if you want to stay
  on Always Free.
- Port **3000** is open to the internet. Restrict the firewall later if you want.
- Dhan tokens still expire every 24h; TOTP auto-login refreshes them on disk.
- Still **paper only** — no real order placement.

---

# Railway Free (serverless)

Free plan deploys **must** be serverless (`sleepApplication` in `railway.toml`).
The service sleeps after ~5–10 minutes with no traffic. Opening the site (or a
weekday ping) wakes it; the paper worker starts with the process.

## Railway setup

1. Push this repo to GitHub.
2. Open [railway.app](https://railway.app) → your service → **Settings → Deploy → Serverless** → **on**.
3. **Settings → Variables:**

| Name | Value |
| --- | --- |
| `DHAN_CLIENT_ID` | your Dhan client id |
| `DHAN_API_BASE` | `https://api.dhan.co` (prod) |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |
| `DHAN_PIN` | Dhan PIN (TOTP) |
| `DHAN_TOTP_SECRET` | TOTP secret from web.dhan.co |

4. **Volume:** mount path **`/data`** (keeps `paper.json` across sleeps).
5. **Networking:** public domain.
6. Deploy with **Deploy latest commit** (not Redeploy on an old failed build).

### Wake for 10:00 IST entries

If nobody opens the site, the worker stays asleep and will not enter at 10:00.
Add a free ping (e.g. [cron-job.org](https://cron-job.org)) to:

`https://YOUR-APP.up.railway.app/healthz`

- Every 5 minutes
- Monday–Friday
- 04:20–09:50 UTC (09:50–15:20 IST)

While awake, Dhan calls during the session keep it from sleeping. Overnight it
sleeps so you stay near the $1 credit.

Hobby ($5/month, Serverless **off**) is still the path for unattended 24/7
without an external ping.

## Local production-like start

```bash
npm run build
DATA_DIR=./data npm start
```

`npm start` boots the paper worker, then serves the built app.
