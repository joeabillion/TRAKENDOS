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
# SQLite backup: use the online backup API (consistent even with a -wal in flight).
# Never plain-copy a .db without its -wal/-shm — a mismatched WAL corrupts the copy.
if [ -f /data/db/trakend.db ]; then
  ( cd "$REPO/backend" && node -e "const D=require('better-sqlite3');new D('/data/db/trakend.db',{readonly:true}).backup('/root/trakend-pre-$STAMP/trakend.db').then(()=>console.log('   db backup ok')).catch(e=>{console.log('   db backup failed:',e.message)})" ) || true
fi
# Legacy DB location check (pre-fix units had no DB_PATH and wrote here). Warn loudly.
if [ -f /var/lib/trakend-os/trakend.db ] && [ ! -f /data/db/.migrated-from-var-lib ]; then
  echo "   NOTE: a database also exists at /var/lib/trakend-os/trakend.db (legacy path)."
  echo "         If the UI shows no drives after this update, run: scripts/migrate-db.sh"
fi
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
set +e   # nothing below should abort the script
echo "-- waiting for array auto-start to settle..."
for i in $(seq 1 20); do
  journalctl -u trakend-os --no-pager --since "2 min ago" 2>/dev/null | grep -qE 'Array started|Array startup aborted|Array auto-start failed' && break
  sleep 3
done
echo "-- array log:"
journalctl -u trakend-os --no-pager --since "3 min ago" | grep -iE 'array|mount|fstab|parity' | tail -30
echo "-- fstab diff vs backup (only /mnt lines should change):"
diff "/root/trakend-pre-$STAMP/fstab" /etc/fstab
echo "-- mounts:"
findmnt -ln -o TARGET,SOURCE,FSTYPE,OPTIONS -t ext4,xfs,btrfs | grep -E '^/(data|mnt/disks)' | sort
echo "-- OS lines still present in fstab:"
grep -E ' / | /boot | /data | swap ' /etc/fstab | grep -v '^#' || echo "!! CHECK FSTAB !!"
echo "-- samba:"
systemctl is-active smbd nmbd 2>/dev/null | tr '\n' ' '; echo; smbstatus -S 2>/dev/null | tail -n +4 | head -10 || true
echo "-- health:"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/health || true
echo "══ done. Backups in /root/trakend-pre-$STAMP"
