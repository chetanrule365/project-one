#!/bin/bash
# Create the always-free e2-micro, build the app off-VM, copy it, start systemd.
# Run from Google Cloud Shell in this repo:  bash deploy/gcp/provision.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
ZONE="${ZONE:-us-central1-a}"
NAME="${NAME:-paper-vm}"
FIREWALL="${FIREWALL:-allow-paper-3000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "Set a project first: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

echo "Project=$PROJECT Zone=$ZONE Instance=$NAME"

gcloud services enable compute.googleapis.com --project="$PROJECT"

if ! gcloud compute firewall-rules describe "$FIREWALL" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$FIREWALL" \
    --project="$PROJECT" \
    --allow=tcp:3000 \
    --target-tags=paper-http \
    --source-ranges=0.0.0.0/0 \
    --description="Paper app HTTP"
fi

if ! gcloud compute instances describe "$NAME" --project="$PROJECT" --zone="$ZONE" >/dev/null 2>&1; then
  gcloud compute instances create "$NAME" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --machine-type=e2-micro \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-standard \
    --tags=paper-http \
    --metadata-from-file=startup-script="$SCRIPT_DIR/startup.sh"
else
  echo "Instance $NAME already exists"
fi

echo "Waiting for VM startup (Node + swap)…"
READY=0
for _ in $(seq 1 48); do
  if gcloud compute ssh "$NAME" --project="$PROJECT" --zone="$ZONE" --command="test -f /var/log/paper-startup.ok" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 10
done
if [[ "$READY" -ne 1 ]]; then
  echo "VM did not finish startup. SSH and check: sudo tail -n 50 /var/log/syslog" >&2
  exit 1
fi

echo "Building production bundle here (not on the 1 GB VM)…"
cd "$ROOT"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required in this environment (Cloud Shell includes it)." >&2
  exit 1
fi
npm ci
npm run build

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
cp -a package.json package-lock.json "$STAGING/"
cp -a build public deploy "$STAGING/"
(cd "$STAGING" && npm ci --omit=dev)

echo "Uploading app to $NAME…"
tar -C "$STAGING" -czf - . | gcloud compute ssh "$NAME" --project="$PROJECT" --zone="$ZONE" --command="sudo mkdir -p /opt/paper && sudo tar -xzf - -C /opt/paper && sudo bash /opt/paper/deploy/gcp/setup-app.sh"

if [[ -f "$ROOT/.env" ]]; then
  echo "Uploading local .env to /etc/paper.env"
  gcloud compute scp --project="$PROJECT" --zone="$ZONE" "$ROOT/.env" "$NAME:/tmp/paper.env"
  gcloud compute ssh "$NAME" --project="$PROJECT" --zone="$ZONE" --command="sudo mv /tmp/paper.env /etc/paper.env && sudo chmod 600 /etc/paper.env && sudo chown root:root /etc/paper.env && sudo systemctl restart paper"
fi

IP="$(gcloud compute instances describe "$NAME" --project="$PROJECT" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

echo
echo "Deployed. Open http://$IP:3000"
echo "If the UI says Dhan is not configured:"
echo "  gcloud compute ssh $NAME --zone=$ZONE"
echo "  sudo nano /etc/paper.env"
echo "  sudo systemctl restart paper"
echo
echo "Set a \$1–\$5 budget alert under Billing. Compute can stay \$0; egress to Dhan may not."
