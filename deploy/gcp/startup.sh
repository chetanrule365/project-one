#!/bin/bash
# First-boot prep for the always-free e2-micro (1 GB RAM).
# Idempotent: safe if Google reruns metadata startup.
set -euo pipefail

SWAPFILE=/swapfile
APP_DIR=/opt/paper
DATA_DIR=/var/lib/paper-data

export DEBIAN_FRONTEND=noninteractive

if [[ ! -f "$SWAPFILE" ]]; then
  fallocate -l 2G "$SWAPFILE"
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
fi
if ! swapon --show | grep -q "$SWAPFILE"; then
  swapon "$SWAPFILE"
fi
if ! grep -q "$SWAPFILE" /etc/fstab; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
fi

apt-get update -y
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

id -u paper >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin paper
mkdir -p "$APP_DIR" "$DATA_DIR"
chown paper:paper "$APP_DIR" "$DATA_DIR"
chmod 750 "$DATA_DIR"

touch /var/log/paper-startup.ok
echo "startup complete $(date -Is)" >> /var/log/paper-startup.log
