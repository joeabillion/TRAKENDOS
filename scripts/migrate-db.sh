#!/bin/bash
#
# Trakend OS — move the SQLite database from the legacy path to /data/db safely
# ============================================================================
# Older units lacked DB_PATH, so the backend wrote /var/lib/trakend-os/trakend.db.
# This checkpoints the WAL, copies the DB with the online backup API, verifies
# integrity, and restarts the service. Idempotent; refuses to overwrite a
# non-empty /data/db DB unless --force is given.
#
#   sudo systemd-run --unit=trakend-migrate-db --collect bash /opt/trakend/os/scripts/migrate-db.sh [--force]
#
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
SRC=/var/lib/trakend-os/trakend.db
DST=/data/db/trakend.db
BACKEND=/opt/trakend/os/backend
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1

[ -f "$SRC" ] || { echo "No legacy DB at $SRC — nothing to do."; exit 0; }

count() { ( cd "$BACKEND" && node -e "const D=require('better-sqlite3');const d=new D('$1',{readonly:true});try{console.log(d.prepare('select count(*) c from array_drives').get().c)}catch{console.log(0)}" ); }

if [ -f "$DST" ] && [ "$FORCE" -ne 1 ]; then
  DST_N=$(count "$DST"); SRC_N=$(count "$SRC")
  echo "destination has $DST_N drive assignment(s); legacy has $SRC_N"
  if [ "$DST_N" -gt 0 ]; then
    echo "Destination is not empty — refusing without --force."; exit 2
  fi
fi

echo "stopping trakend-os"
systemctl stop trakend-os

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/dbmigrate-$STAMP /data/db
for f in "$DST" "$DST-wal" "$DST-shm"; do [ -e "$f" ] && mv "$f" /root/dbmigrate-$STAMP/ || true; done

( cd "$BACKEND" && node -e "
const D=require('better-sqlite3');
const s=new D('$SRC');
console.log('source integrity:', s.pragma('integrity_check')[0].integrity_check);
s.pragma('wal_checkpoint(TRUNCATE)');
s.backup('$DST').then(()=>{ s.close();
  const d=new D('$DST'); console.log('copy integrity:', d.pragma('integrity_check')[0].integrity_check); d.close();
}).catch(e=>{ console.error('backup failed:', e.message); process.exit(1); });
" )
cp -a /var/lib/trakend-os/jwt.secret /data/db/ 2>/dev/null || true
touch /data/db/.migrated-from-var-lib
chmod 600 "$DST"

echo "starting trakend-os"
systemctl start trakend-os
echo "done. old /data/db files (if any) saved in /root/dbmigrate-$STAMP"
