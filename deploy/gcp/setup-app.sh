#!/bin/bash
# Enable systemd on files already in /opt/paper. Run as root on the VM.
set -euo pipefail

APP_DIR=/opt/paper
DATA_DIR=/var/lib/paper-data

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash /opt/paper/deploy/gcp/setup-app.sh" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Missing $APP_DIR/package.json — upload the app first (provision.sh)." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
id -u paper >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin paper

cd "$APP_DIR"
if [[ ! -f build/start.js ]]; then
  npm ci
  npm run build
elif [[ ! -d node_modules ]]; then
  npm ci --omit=dev
fi

install -m 644 "$APP_DIR/deploy/gcp/paper.service" /etc/systemd/system/paper.service

if [[ ! -f /etc/paper.env ]]; then
  cat >/etc/paper.env <<'EOF'
DHAN_CLIENT_ID=
DHAN_PIN=
DHAN_TOTP_SECRET=
DHAN_API_BASE=https://api.dhan.co
EOF
  chmod 600 /etc/paper.env
  echo "Created empty /etc/paper.env — add Dhan credentials and restart paper."
fi

chown -R paper:paper "$APP_DIR" "$DATA_DIR"
systemctl daemon-reload
systemctl enable paper
systemctl restart paper
sleep 2
systemctl --no-pager --full status paper || true

echo "Health: $(curl -sf http://127.0.0.1:3000/healthz || echo 'not ready yet')"
