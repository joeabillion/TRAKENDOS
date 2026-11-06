#!/bin/bash
#
# Trakend OS — First boot setup (run once by trakend-firstboot.service)
# ====================================================================
#  - generate a per-server JWT secret in /data/db/jwt.secret (0600)
#  - force the "trakend" user to change the factory password on first SSH login
#  - restrict root SSH to key-based auth
#  - write the marker /data/.firstboot-done
#
set -u

log() { logger -t trakend-firstboot "$*"; echo "[firstboot] $*"; }

mkdir -p /data/db

# 1. JWT secret (48 random bytes, hex)
if [ ! -s /data/db/jwt.secret ]; then
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 48 > /data/db/jwt.secret
  else
    head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' > /data/db/jwt.secret
  fi
  chmod 0600 /data/db/jwt.secret
  log "Generated /data/db/jwt.secret"
fi

# The backend (backend/src/utils/secret.ts) ignores the placeholder JWT_SECRET in
# backend/.env and loads /data/db/jwt.secret, so nothing else to wire up here.

# 2. Force password change for the trakend user on first login
if id trakend >/dev/null 2>&1; then
  chage -d 0 trakend 2>/dev/null && log "trakend user must change password at next login"
fi

# 3. Root SSH: keys only
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/trakend.conf <<'SSHEOF'
PermitRootLogin prohibit-password
PasswordAuthentication yes
Port 22
SSHEOF
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
log "sshd: PermitRootLogin prohibit-password"

# 4. Marker
touch /data/.firstboot-done
log "First boot setup complete"
exit 0
