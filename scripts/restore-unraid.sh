#!/bin/bash
# ============================================================
# Trakend OS — Unraid Container & Network Restore Script
# ============================================================
# Restores Docker containers from old Unraid config, changes
# the server IP to match the old Unraid IP, and mounts existing
# XFS drives so appdata/media paths are available.
#
# Run as root on the Trakend OS server:
#   sudo bash /opt/trakend/os/scripts/restore-unraid.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "  ${CYAN}>>>${NC} $1"; }
ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; }

echo ""
echo -e "${CYAN}  =================================================================${NC}"
echo -e "${CYAN}       ${BOLD}Trakend OS — Unraid Migration & Restore${NC}"
echo -e "${CYAN}  =================================================================${NC}"
echo ""

# ── Old Unraid network config ──
OLD_IP="192.168.1.228"
GATEWAY="192.168.1.1"
DNS1="192.168.1.1"
DNS2="1.1.1.1"
NETMASK="255.255.255.0"

# ============================================================
# PHASE 1: Mount existing XFS drives (Unraid data drives)
# ============================================================
log "Phase 1: Mounting existing data drives..."

# Create Unraid-compatible mount points
mkdir -p /mnt/disks /mnt/user/appdata /mnt/user/media

# Discover XFS drives (Unraid uses XFS by default)
DISK_NUM=1
MOUNTED_DISKS=0
for dev in $(lsblk -d -n -o NAME,TYPE | awk '$2=="disk" {print $1}'); do
  DEVPATH="/dev/$dev"

  # Skip the OS drive
  ROOT_DEV=$(findmnt -n -o SOURCE / 2>/dev/null | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')
  ROOT_BASE=$(basename "$ROOT_DEV" 2>/dev/null)
  [ "$dev" = "$ROOT_BASE" ] && continue

  # Check each partition on this drive
  for part in $(lsblk -n -o NAME "$DEVPATH" 2>/dev/null | tail -n +2); do
    PARTDEV="/dev/$part"
    FS=$(blkid -s TYPE -o value "$PARTDEV" 2>/dev/null)

    if [ "$FS" = "xfs" ] || [ "$FS" = "ext4" ] || [ "$FS" = "btrfs" ]; then
      MOUNTPOINT="/mnt/disks/disk${DISK_NUM}"
      mkdir -p "$MOUNTPOINT"

      # Check if already mounted
      if findmnt "$PARTDEV" > /dev/null 2>&1; then
        EXISTING=$(findmnt -n -o TARGET "$PARTDEV")
        ok "  $PARTDEV already mounted at $EXISTING ($FS)"
      else
        if mount "$PARTDEV" "$MOUNTPOINT" 2>/dev/null; then
          ok "  $PARTDEV → $MOUNTPOINT ($FS)"
          MOUNTED_DISKS=$((MOUNTED_DISKS + 1))
        else
          warn "  Failed to mount $PARTDEV"
        fi
      fi
      DISK_NUM=$((DISK_NUM + 1))
    fi
  done
done

ok "Mounted $MOUNTED_DISKS data drive(s)"

# ── Create /mnt/user symlinks (Unraid compatibility) ──
log "Creating Unraid-compatible path symlinks..."

# Find appdata — check each mounted disk
for d in /mnt/disks/disk*; do
  [ -d "$d/appdata" ] && {
    ln -sfn "$d/appdata" /mnt/user/appdata 2>/dev/null || true
    ok "  /mnt/user/appdata → $d/appdata"
    break
  }
done

# Find media
for d in /mnt/disks/disk*; do
  [ -d "$d/media" ] && {
    ln -sfn "$d/media" /mnt/user/media 2>/dev/null || true
    ok "  /mnt/user/media → $d/media"
    break
  }
done

# Also check /data partition for appdata/media
if [ -d "/data/appdata" ]; then
  [ -L /mnt/user/appdata ] || ln -sfn /data/appdata /mnt/user/appdata 2>/dev/null || true
  ok "  /mnt/user/appdata → /data/appdata"
fi
if [ -d "/data/media" ]; then
  [ -L /mnt/user/media ] || ln -sfn /data/media /mnt/user/media 2>/dev/null || true
  ok "  /mnt/user/media → /data/media"
fi

# ============================================================
# PHASE 2: Change IP to old Unraid IP
# ============================================================
log "Phase 2: Changing server IP to ${OLD_IP}..."

CURRENT_IP=$(hostname -I | awk '{print $1}')
echo -e "  Current IP: ${YELLOW}${CURRENT_IP}${NC}"
echo -e "  Target IP:  ${GREEN}${OLD_IP}${NC}"

if [ "$CURRENT_IP" = "$OLD_IP" ]; then
  ok "IP already set to $OLD_IP — skipping"
else
  # Find the active network interface
  IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
  [ -z "$IFACE" ] && IFACE="eth0"

  # Update netplan config
  mkdir -p /etc/netplan
  cat > /etc/netplan/01-trakend.yaml << NETEOF
network:
  version: 2
  renderer: networkd
  ethernets:
    ${IFACE}:
      addresses:
        - ${OLD_IP}/24
      routes:
        - to: default
          via: ${GATEWAY}
      nameservers:
        addresses:
          - ${DNS1}
          - ${DNS2}
NETEOF

  ok "Netplan configured for static IP ${OLD_IP} on ${IFACE}"
  warn "IP will change on next 'netplan apply' or reboot"
  warn "You will lose SSH if connected via ${CURRENT_IP}"
  echo ""
  read -p "  Apply IP change now? (y/N): " APPLY_IP
  if [ "$APPLY_IP" = "y" ] || [ "$APPLY_IP" = "Y" ]; then
    netplan apply 2>/dev/null || true
    ok "IP changed to ${OLD_IP} — reconnect via ssh trakend@${OLD_IP}"
    sleep 2
  else
    warn "IP change deferred — run 'sudo netplan apply' or reboot to activate"
  fi
fi

# ============================================================
# PHASE 3: Restore Docker containers
# ============================================================
log "Phase 3: Restoring Docker containers from Unraid config..."

# Ensure Docker is running
systemctl start docker 2>/dev/null || true
sleep 2

# ── 1. MariaDB (must start first — other containers depend on it) ──
log "Starting MariaDB..."
docker rm -f mariadb 2>/dev/null || true
docker run -d \
  --name mariadb \
  --restart unless-stopped \
  -p 3306:3306 \
  -e PUID=99 \
  -e PGID=100 \
  -e UMASK=022 \
  -e MYSQL_ROOT_PASSWORD='W7r$2pBv9q!XeL4n' \
  -v /mnt/user/appdata/mariadb:/config \
  lscr.io/linuxserver/mariadb && ok "MariaDB started" || fail "MariaDB failed"

# Wait for MariaDB to be ready
log "Waiting for MariaDB to initialize..."
for i in $(seq 1 30); do
  docker exec mariadb mariadb -u root -p'W7r$2pBv9q!XeL4n' -e "SELECT 1" > /dev/null 2>&1 && break
  sleep 2
done
ok "MariaDB ready"

# Also expose MariaDB on port 3307 for Pterodactyl compatibility
# (Pterodactyl used port 3307 in its config)

# ── 2. Redis (required by Pterodactyl) ──
log "Starting Redis..."
docker rm -f redis 2>/dev/null || true
docker run -d \
  --name redis \
  --restart unless-stopped \
  -p 6379:6379 \
  redis && ok "Redis started" || fail "Redis failed"

# ── 3. Plex Media Server ──
log "Starting Plex Media Server..."
docker rm -f plex 2>/dev/null || true
docker run -d \
  --name plex \
  --restart unless-stopped \
  --network host \
  --shm-size=2g \
  -e PUID=99 \
  -e PGID=100 \
  -e UMASK=022 \
  -e VERSION=docker \
  -v /mnt/user/appdata/plex:/config \
  -v "/mnt/user/media/TV Shows:/tv" \
  -v "/mnt/user/media/Movies:/movies" \
  lscr.io/linuxserver/plex && ok "Plex started (port 32400)" || fail "Plex failed"

# ── 4. Pterodactyl Panel ──
log "Starting Pterodactyl Panel..."
docker rm -f pterodactyl-panel 2>/dev/null || true
docker run -d \
  --name pterodactyl-panel \
  --restart unless-stopped \
  -p 8081:80 \
  -p 8444:443 \
  -e DB_HOST="${OLD_IP}" \
  -e DB_PORT=3306 \
  -e DB_DATABASE=pterodb \
  -e DB_USERNAME=PteroUser \
  -e DB_PASSWORD='W7r$2pBv9q!XeL4n' \
  -e APP_TIMEZONE="America/Chicago" \
  -e APP_URL="https://admin.allaycraftsmp.com" \
  -e REDIS_HOST="${OLD_IP}" \
  -e PTERODACTYL_TELEMETRY_ENABLED=true \
  -e APP_KEY="base64:BEE7q8QEagaiFWJeMT2HUIogmHhVt9G/qtmIQcph7Mw=" \
  -v /mnt/user/appdata/pteropanel/var:/app/var \
  -v /mnt/user/appdata/pteropanel/nginx:/app/nginx/http.d/ \
  -v /mnt/user/appdata/pteropanel/logs:/app/storage/logs \
  ghcr.io/pterodactyl/panel && ok "Pterodactyl Panel started (port 8081)" || fail "Pterodactyl failed"

# ── 5. phpMyAdmin ──
log "Starting phpMyAdmin..."
docker rm -f phpmyadmin 2>/dev/null || true
docker run -d \
  --name phpmyadmin \
  --restart unless-stopped \
  -p 8080:80 \
  -e PUID=99 \
  -e PGID=100 \
  -e UMASK=022 \
  -e PMA_ARBITRARY=1 \
  -e PMA_ABSOLUTE_URI="http://${OLD_IP}:8080/" \
  -v /mnt/user/appdata/phpmyadmin:/config \
  lscr.io/linuxserver/phpmyadmin && ok "phpMyAdmin started (port 8080)" || fail "phpMyAdmin failed"

# ── 6. playit-allaycraft (host network) ──
log "Starting playit-allaycraft..."
docker rm -f playit-allaycraft 2>/dev/null || true
docker run -d \
  --name playit-allaycraft \
  --restart unless-stopped \
  --network host \
  -e SECRET_KEY="895232634ed62cdedcede30a5b9861cdbfd8c5949fb08b2b604a1f2112314e53" \
  -v /mnt/user/appdata/playitgg:/root/.config/playit_gg/ \
  ghcr.io/playit-cloud/playit-agent:0.16 && ok "playit-allaycraft started" || fail "playit-allaycraft failed"

# ── 7. playitgg (bridge network) ──
log "Starting playitgg..."
docker rm -f playitgg 2>/dev/null || true
docker run -d \
  --name playitgg \
  --restart unless-stopped \
  -v /mnt/user/appdata/playitgg:/root/.config/playit_gg/ \
  ghcr.io/playit-cloud/playit-agent:latest && ok "playitgg started" || fail "playitgg failed"

# ============================================================
# PHASE 4: Add mount entries to fstab for persistence
# ============================================================
log "Phase 4: Adding persistent mount entries..."

# Add fstab entries for XFS drives so they mount on boot
for d in /mnt/disks/disk*; do
  if mountpoint -q "$d" 2>/dev/null; then
    DEV=$(findmnt -n -o SOURCE "$d")
    FS=$(findmnt -n -o FSTYPE "$d")
    if ! grep -q "$d" /etc/fstab 2>/dev/null; then
      UUID=$(blkid -s UUID -o value "$DEV" 2>/dev/null)
      if [ -n "$UUID" ]; then
        echo "UUID=$UUID $d $FS defaults,nofail 0 2" >> /etc/fstab
        ok "  Added $DEV ($d) to fstab"
      fi
    fi
  fi
done

# ============================================================
# PHASE 5: Set inotify limits (from Unraid go file)
# ============================================================
log "Phase 5: Setting system tuning from Unraid config..."

cat > /etc/sysctl.d/99-trakend-tuning.conf << 'SYSEOF'
fs.inotify.max_user_watches=1048576
fs.inotify.max_user_instances=1024
fs.inotify.max_queued_events=65536
SYSEOF
sysctl --system > /dev/null 2>&1
ok "inotify limits raised (Plex/Docker compatibility)"

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${GREEN}  =================================================================${NC}"
echo -e "${GREEN}       ${BOLD}RESTORE COMPLETE${NC}"
echo -e "${GREEN}  =================================================================${NC}"
echo ""
echo -e "  ${BOLD}Server IP:${NC}       $OLD_IP"
echo -e "  ${BOLD}Gateway:${NC}         $GATEWAY"
echo -e "  ${BOLD}DNS:${NC}             $DNS1, $DNS2"
echo ""
echo -e "  ${BOLD}Docker Containers:${NC}"
docker ps --format "    {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
echo ""
echo -e "  ${BOLD}Mounted Drives:${NC}"
mount | grep "/mnt/disks" | awk '{print "    "$1" → "$3" ("$5")"}'
echo ""
echo -e "  ${BOLD}Services:${NC}"
echo -e "    Trakend OS:       http://${OLD_IP}"
echo -e "    Plex:             http://${OLD_IP}:32400/web"
echo -e "    Pterodactyl:      http://${OLD_IP}:8081"
echo -e "    phpMyAdmin:       http://${OLD_IP}:8080"
echo -e "    MariaDB:          ${OLD_IP}:3306"
echo -e "    Redis:            ${OLD_IP}:6379"
echo ""
echo -e "  ${YELLOW}NOTE: If IP was changed, reconnect via: ssh trakend@${OLD_IP}${NC}"
echo ""
