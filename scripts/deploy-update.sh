#!/bin/bash
#
# Trakend OS — safe in-place update for an existing server
# ========================================================
# Pulls the latest code, builds it, applies systemd units + apt safety files, and
# restarts the service ONLY if both build artifacts exist. Prints a verification
# summary at the end. Idempotent; safe to re-run.
#
#   sudo bash /opt/trakend/os/scripts/deploy-update.sh [branch]   (default: server-live)
#
set -euo pipefail
BRANCH="${1:-server-live}"
REPO=/opt/trakend/os
STAMP=$(date +%Y%m%d-%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
cd "$REPO"

echo "══ 0. Pre-flight backups → /root/trakend-pre-$STAMP"
mkdir -p "/root/trakend-pre-$STAMP"
cp -a /etc/fstab "/root/trakend-pre-$STAMP/fstab"
[ -f /etc/samba/smb.conf ] && cp -a /etc/samba/smb.conf "/root/trakend-pre-$STAMP/smb.conf"
[ -f /data/db/trakend.db ] && sqlite3 /data/db/trakend.db ".backup '/root/trakend-pre-$STAMP/trakend.db'" 2>/dev/null || cp -a /data/db/trakend.db "/root/trakend-pre-$STAMP/" 2>/dev/null || true
cp -a /etc/systemd/system/trakend-*.service "/root/trakend-pre-$STAMP/" 2>/dev/null || true
PREV=$(git rev-parse --short HEAD)
echo "   previous commit: $PREV"

echo "══ 1. Containers using legacy mount paths (these paths are retired by the array):"
docker ps -aq 2>/dev/null | xargs -r docker inspect -f '{{.Name}} {{range .Mounts}}{{.Source}} {{end}}' 2>/dev/null \
  | grep -E '/mnt/disks/(usb[0-9]+|disk[0-9]+-[a-z]+)' || echo "   none"

echo "══ 2. git pull ($BRANCH)"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "   now at: $(git rev-parse --short HEAD)"

echo "══ 3. backend: npm install + tsc"
( cd backend && npm install --no-audit --no-fund 2>&1 | tail -2 && npx tsc )
[ -f backend/dist/index.js ] || { echo "FATAL: backend/dist/index.js missing after build — NOT restarting. Rolling back to $PREV"; git reset --hard "$PREV"; exit 1; }

echo "══ 4. frontend: npm install + vite build"
( cd frontend && npm install --no-audit --no-fund 2>&1 | tail -2 && ulimit -n 65535 && npx vite build 2>&1 | tail -3 )
[ -f frontend/dist/index.html ] || { echo "FATAL: frontend/dist/index.html missing after build — NOT restarting. Rolling back to $PREV"; git reset --hard "$PREV"; exit 1; }

echo "══ 5. systemd units + apt/GPU safety"
bash scripts/apply-systemd-units.sh

echo "══ 6. restart trakend-os"
systemctl restart trakend-os.service
sleep 6
systemctl --no-pager status trakend-os.service | head -5

echo "══ 7. verification"
echo "-- array log (last 25 ARRAY lines):"
journalctl -u trakend-os --no-pager -n 400 | grep -E '\[ARRAY\]|ARRAY' | tail -25 || true
echo "-- fstab diff vs backup (only /mnt lines should change):"
diff "/root/trakend-pre-$STAMP/fstab" /etc/fstab || true
echo "-- mounts:"
findmnt -n -o TARGET,SOURCE,FSTYPE,OPTIONS -t ext4,xfs,btrfs | grep -E '^/(data|mnt/disks)' | sort
echo "-- OS lines still present in fstab:"
grep -E ' / | /boot | /data | swap ' /etc/fstab | grep -v '^#' || echo "!! CHECK FSTAB !!"
echo "-- samba:"
systemctl is-active smbd nmbd 2>/dev/null | tr '\n' ' '; echo; smbstatus -S 2>/dev/null | tail -n +4 | head -10 || true
echo "-- health:"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/health || true
echo "══ done. Backups in /root/trakend-pre-$STAMP"
