#!/bin/bash
#
# Trakend OS — ISO Builder (Fully Offline Installer)
# =====================================================
# Creates a bootable ISO containing the Trakend OS installer.
# ALL packages, dependencies, and assets are pre-downloaded during
# the Docker build so that installation requires ZERO internet.
#
# Runs inside Docker. Output goes to /output/trakend-os-installer.iso
#

set -e
set -o pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

VERSION=$(grep '"version"' /build/trakend-os/package.json 2>/dev/null | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/' || true)
VERSION="${VERSION:-1.0.000}"
# Git remote the installed system will pull updates from (must match backend/src/config/default.ts)
GIT_REPO_URL="${GIT_REPO_URL:-https://github.com/joeabillion/TRAKENDOS.git}"

log()  { echo -e "${CYAN}[ISO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}  $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

WORK="/tmp/trakend-iso-build"
ROOTFS="$WORK/rootfs"
ISO_DIR="$WORK/iso"
PKG_CACHE="$WORK/pkg-cache"

rm -rf "$WORK"
mkdir -p "$ROOTFS" "$ISO_DIR" "$PKG_CACHE"

echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║                                                   ║${NC}"
echo -e "${CYAN}  ║      ${BOLD}TRAKEND OS — ISO Builder${NC}${CYAN}  ║${NC}"
echo -e "${CYAN}  ║      Version ${VERSION} (Offline)                 ║${NC}"
echo -e "${CYAN}  ║                                                   ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# ============================================================
# PHASE A: Pre-download EVERYTHING for offline installation
# ============================================================
log "PHASE A: Pre-downloading all packages for offline installation..."
echo ""

# ── A1: Build target system package cache via debootstrap --make-tarball ──
log "A1: Creating target system package cache..."

TARGET_CACHE="$PKG_CACHE/target-rootfs"
mkdir -p "$TARGET_CACHE"

# Create a temporary debootstrap to build the package lists and cache
# This downloads all base packages without unpacking
DEBOOTSTRAP_DIR="$PKG_CACHE/debootstrap-cache"
mkdir -p "$DEBOOTSTRAP_DIR"

# Run debootstrap with --download-only flag by doing full debootstrap,
# then we'll tar the apt cache. Alternatively, use --make-tarball
# NOTE: linux-image-generic is NOT included here — it runs depmod/update-initramfs
# postinstall scripts that cause kernel panics on the live USB kernel.
# It is downloaded separately in Phase A2 and installed with safety wrappers.
debootstrap --arch=amd64 \
  --include=systemd,systemd-sysv,dbus,udev,kmod,iproute2,iputils-ping,\
netplan.io,openssh-server,sudo,curl,wget,git,\
ca-certificates,gnupg,lsb-release,pciutils,usbutils,\
hdparm,dmidecode,parted,\
e2fsprogs,dosfstools,ntfs-3g,mdadm,lvm2,\
python3,nano,less,cron \
  --make-tarball="$PKG_CACHE/debootstrap-base.tar" \
  jammy "$DEBOOTSTRAP_DIR" http://archive.ubuntu.com/ubuntu/ 2>&1 | tail -10

ok "Base debootstrap packages cached ($(du -sh "$PKG_CACHE/debootstrap-base.tar" | awk '{print $1}'))"

# ── A2: Download extra .deb packages (GRUB, universe packages, etc) ──
log "A2: Downloading extra .deb packages..."

# Create a minimal chroot just to download packages
DLROOT="$PKG_CACHE/download-root"
mkdir -p "$DLROOT"
debootstrap --arch=amd64 --variant=minbase \
  --include=apt,dpkg,ca-certificates,gnupg,curl \
  jammy "$DLROOT" http://archive.ubuntu.com/ubuntu/ 2>&1 | tail -5

# Set up full repos
cat > "$DLROOT/etc/apt/sources.list" << 'SRCEOF'
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
SRCEOF

mount --bind /proc "$DLROOT/proc"
mount --bind /sys "$DLROOT/sys"
mount --bind /dev "$DLROOT/dev"
mount --bind /dev/pts "$DLROOT/dev/pts" 2>/dev/null || true

# Download (not install) all extra packages we need on the target
EXTRA_DEB_DIR="$PKG_CACHE/extra-debs"
mkdir -p "$EXTRA_DEB_DIR"

chroot "$DLROOT" bash -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq

  # Download GRUB, boot, and system packages
  apt-get download -y -o Dir::Cache::archives=/tmp/debs/ 2>/dev/null || true
  cd /tmp && mkdir -p debs

  apt-get install -y --download-only -o Dir::Cache::archives=/tmp/debs/ \
    linux-image-generic linux-headers-generic \
    grub-efi-amd64 grub-efi-amd64-bin grub-efi-amd64-signed \
    shim-signed efibootmgr grub2-common grub-common \
    smartmontools lm-sensors htop tmux \
    dialog live-boot \
    samba samba-common-bin \
    acpid systemd-sysv dbus \
    xfsprogs btrfs-progs gdisk sqlite3 ethtool cifs-utils nfs-kernel-server \
    rsync locales linux-firmware avahi-daemon avahi-utils wsdd \
    2>&1 | tail -10
' 2>&1

# Copy downloaded .debs
cp "$DLROOT"/tmp/debs/*.deb "$EXTRA_DEB_DIR/" 2>/dev/null || true
cp "$DLROOT"/var/cache/apt/archives/*.deb "$EXTRA_DEB_DIR/" 2>/dev/null || true

ok "Extra .deb packages cached ($(ls "$EXTRA_DEB_DIR"/*.deb 2>/dev/null | wc -l) packages, $(du -sh "$EXTRA_DEB_DIR" | awk '{print $1}'))"

# ── A3: Download Docker packages ──
log "A3: Downloading Docker packages..."

DOCKER_DEB_DIR="$PKG_CACHE/docker-debs"
mkdir -p "$DOCKER_DEB_DIR"

chroot "$DLROOT" bash -c '
  export DEBIAN_FRONTEND=noninteractive
  mkdir -p /tmp/docker-debs/partial
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y --download-only -o Dir::Cache::archives=/tmp/docker-debs/ \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    2>&1 | tail -10
' 2>&1

cp "$DLROOT"/tmp/docker-debs/*.deb "$DOCKER_DEB_DIR/" 2>/dev/null || true
cp "$DLROOT"/var/cache/apt/archives/*.deb "$DOCKER_DEB_DIR/" 2>/dev/null || true

# Also save Docker GPG key and repo config
mkdir -p "$PKG_CACHE/docker-config"
cp "$DLROOT/etc/apt/keyrings/docker.gpg" "$PKG_CACHE/docker-config/" 2>/dev/null || true

ok "Docker packages cached ($(ls "$DOCKER_DEB_DIR"/*.deb 2>/dev/null | wc -l) packages, $(du -sh "$DOCKER_DEB_DIR" | awk '{print $1}'))"

# ── A4: Download Node.js packages ──
log "A4: Downloading Node.js packages..."

NODEJS_DEB_DIR="$PKG_CACHE/nodejs-debs"
mkdir -p "$NODEJS_DEB_DIR"

chroot "$DLROOT" bash -c '
  export DEBIAN_FRONTEND=noninteractive
  mkdir -p /tmp/nodejs-debs/partial
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y --download-only -o Dir::Cache::archives=/tmp/nodejs-debs/ \
    nodejs 2>&1 | tail -5
' 2>&1

cp "$DLROOT"/tmp/nodejs-debs/*.deb "$NODEJS_DEB_DIR/" 2>/dev/null || true
cp "$DLROOT"/var/cache/apt/archives/*.deb "$NODEJS_DEB_DIR/" 2>/dev/null || true

# Save nodesource repo config
mkdir -p "$PKG_CACHE/nodejs-config"
cp "$DLROOT/etc/apt/sources.list.d/nodesource.list" "$PKG_CACHE/nodejs-config/" 2>/dev/null || true
cp -r "$DLROOT/etc/apt/keyrings/"*nodesource* "$PKG_CACHE/nodejs-config/" 2>/dev/null || true
cp -r "$DLROOT/usr/share/keyrings/"*nodesource* "$PKG_CACHE/nodejs-config/" 2>/dev/null || true

ok "Node.js packages cached ($(du -sh "$NODEJS_DEB_DIR" | awk '{print $1}'))"

# ── A5: Pre-install npm dependencies and build frontend ──
log "A5: Pre-installing npm dependencies and building frontend..."

NPM_CACHE="$PKG_CACHE/npm-ready"
mkdir -p "$NPM_CACHE"

# We need Node.js in the build container — install it now
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get install -y nodejs > /dev/null 2>&1

# Copy project and install/build
cp -a /build/trakend-os "$NPM_CACHE/trakend-os"
cd "$NPM_CACHE/trakend-os"

# Keep the .git history so the installed /opt/trakend/os is a real repo and the
# in-app updater (git pull --ff-only) works. Compact it first to keep the ISO small.
if [ -d .git ]; then
  git config --global --add safe.directory "$NPM_CACHE/trakend-os" 2>/dev/null || true
  git gc --aggressive --prune=now 2>&1 | tail -2 || warn "git gc failed (continuing)"
  # Make sure the installed system pulls from the canonical remote, not a dev's fork/SSH URL
  git remote set-url origin "$GIT_REPO_URL" 2>/dev/null || git remote add origin "$GIT_REPO_URL" 2>/dev/null || true
  ok "Git repository retained ($(du -sh .git | awk '{print $1}'), origin=$GIT_REPO_URL, HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo '?'))"
else
  warn ".git not present in build context — installed system will need 'Initialize updates' (POST /api/updates/init-repo)"
fi

# Root install (only 'concurrently' for dev; non-fatal)
npm install --quiet --no-audit --no-fund 2>&1 | tail -5 || true

# Backend install + build — MUST succeed; a missing dist/index.js makes the ISO useless.
cd backend
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund 2>&1 | tail -5 || fail "Backend npm ci failed"
else
  npm install --no-audit --no-fund 2>&1 | tail -5 || fail "Backend npm install failed"
fi
npx tsc 2>&1 | tail -30 || fail "Backend TypeScript build FAILED"
[ -f dist/index.js ] || fail "Backend dist/index.js MISSING after build"
node --check dist/index.js || fail "Backend dist/index.js does not parse"
ok "Backend compiled (dist/index.js)"
cd ..

# Frontend install + build — MUST succeed.
cd frontend
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund 2>&1 | tail -5 || fail "Frontend npm ci failed"
else
  npm install --no-audit --no-fund 2>&1 | tail -5 || fail "Frontend npm install failed"
fi
npx vite build 2>&1 | tail -30 || fail "Frontend Vite build FAILED"
[ -f dist/index.html ] || fail "Frontend dist/index.html MISSING after build"
ok "Frontend built (dist/index.html)"
cd ..

# node-pty must have compiled its native addon (needs build-essential/python3 in the Dockerfile)
if [ -d backend/node_modules/node-pty ]; then
  ls backend/node_modules/node-pty/build/Release/*.node >/dev/null 2>&1 \
    || fail "node-pty native addon did not compile (build/Release/*.node missing) — check build-essential/python3/make/g++ in installer/Dockerfile"
  ok "node-pty native addon present"
fi

# Required single-source-of-truth files for the target system
for f in installer/systemd/trakend-os.service installer/systemd/trakend-safemode.service \
         installer/systemd/trakend-drives.service installer/systemd/trakend-firstboot.service \
         installer/systemd/trakend-backup.service installer/systemd/trakend-backup.timer \
         installer/systemd/docker.service.d/trakend.conf \
         installer/scripts/detect-extra-drives.sh installer/scripts/firstboot.sh installer/scripts/trakend-info.sh \
         installer/apt/20auto-upgrades installer/apt/51trakend-gpu-blacklist \
         installer/apt/99-trakend-nvidia-pin installer/apt/blacklist-nouveau.conf \
         scripts/safemode/trakend-safemode.sh ws-wrapper.js; do
  [ -f "$f" ] || fail "Required file missing from build context: $f"
done
ok "Systemd/apt/helper source files present"

ok "npm dependencies installed and both packages built ($(du -sh "$NPM_CACHE/trakend-os" | awk '{print $1}'))"

# Clean up download chroot
umount "$DLROOT/dev/pts" 2>/dev/null || true
umount "$DLROOT/dev" 2>/dev/null || true
umount "$DLROOT/proc" 2>/dev/null || true
umount "$DLROOT/sys" 2>/dev/null || true
rm -rf "$DLROOT"

echo ""
log "PHASE A COMPLETE — All packages pre-downloaded"
echo ""

# ============================================================
# PHASE B: Build the live root filesystem (for the USB installer)
# ============================================================
log "PHASE B: Building live installer filesystem..."

# Step 1: Base system for the live USB
log "Step 1/6: Installing base system with debootstrap..."

debootstrap --arch=amd64 --variant=minbase \
  --include=systemd,systemd-sysv,dbus,udev,kmod,iproute2,iputils-ping,\
netplan.io,openssh-server,sudo,curl,wget,git,\
ca-certificates,gnupg,lsb-release,pciutils,usbutils,\
hdparm,dmidecode,parted,\
e2fsprogs,dosfstools,ntfs-3g,mdadm,lvm2,\
debootstrap,rsync,\
linux-image-generic,\
grub-efi-amd64-bin,grub-efi-amd64-signed,grub-pc-bin,shim-signed,\
python3,nano,less \
  jammy "$ROOTFS" http://archive.ubuntu.com/ubuntu/

ok "Base system installed (Phase 1)"

# Phase 2: Enable full repos and install universe packages
log "Installing additional packages..."

cat > "$ROOTFS/etc/apt/sources.list" << 'SRCEOF'
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
SRCEOF

mount --bind /proc "$ROOTFS/proc"
mount --bind /sys "$ROOTFS/sys"
mount --bind /dev "$ROOTFS/dev"
mount --bind /dev/pts "$ROOTFS/dev/pts" 2>/dev/null || true

chroot "$ROOTFS" bash -c '
  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq dialog live-boot lm-sensors smartmontools efibootmgr 2>&1 | tail -5
  update-initramfs -c -k all 2>&1 | tail -3
' 2>&1

# Verify kernel and initrd
log "Verifying kernel and initrd..."
ls "$ROOTFS"/boot/vmlinuz-* > /dev/null 2>&1 && ok "Kernel found" || fail "Kernel not found"
ls "$ROOTFS"/boot/initrd.img-* > /dev/null 2>&1 && ok "Initrd found" || fail "Initrd not found"

umount "$ROOTFS/dev/pts" 2>/dev/null || true
umount "$ROOTFS/dev" 2>/dev/null || true
umount "$ROOTFS/proc" 2>/dev/null || true
umount "$ROOTFS/sys" 2>/dev/null || true

ok "All packages installed (Phase 2)"

# ============================================================
# Step 2: Configure the live system
# ============================================================
log "Step 2/6: Configuring live environment..."

mkdir -p "$ROOTFS/mnt" "$ROOTFS/tmp" "$ROOTFS/run" "$ROOTFS/media" "$ROOTFS/srv"

echo "trakend-installer" > "$ROOTFS/etc/hostname"
cat > "$ROOTFS/etc/hosts" << 'EOF'
127.0.0.1   localhost trakend-installer
::1         localhost
EOF

cat > "$ROOTFS/etc/apt/sources.list" << 'EOF'
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
EOF

cat > "$ROOTFS/etc/netplan/01-installer.yaml" << 'EOF'
network:
  version: 2
  renderer: networkd
  ethernets:
    all-ethernet:
      match:
        name: "e*"
      dhcp4: true
      dhcp6: false
EOF

# Auto-login on tty1
mkdir -p "$ROOTFS/etc/systemd/system/getty@tty1.service.d"
cat > "$ROOTFS/etc/systemd/system/getty@tty1.service.d/override.conf" << 'EOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
EOF

chroot "$ROOTFS" bash -c 'echo "root:trakend" | chpasswd' 2>/dev/null || true
chroot "$ROOTFS" systemctl enable ssh 2>/dev/null || true

ok "Live environment configured"

# ============================================================
# Step 3: Embed Trakend OS project files + ALL offline caches
# ============================================================
log "Step 3/6: Embedding Trakend OS and offline package caches..."

mkdir -p "$ROOTFS/opt/trakend"

# Copy the pre-built project (with node_modules and frontend dist)
rsync -a --exclude='installer/output' --exclude='unraid old' \
  "$NPM_CACHE/trakend-os/" "$ROOTFS/opt/trakend/os/"

[ -f "$ROOTFS/opt/trakend/os/backend/dist/index.js" ] || fail "backend/dist/index.js missing in embedded project"
[ -f "$ROOTFS/opt/trakend/os/frontend/dist/index.html" ] || fail "frontend/dist/index.html missing in embedded project"
ok "Trakend OS project embedded (pre-built with dependencies, .git retained)"

# Copy the offline package caches
mkdir -p "$ROOTFS/opt/trakend/offline-packages"

# Debootstrap tarball for the target system
cp "$PKG_CACHE/debootstrap-base.tar" "$ROOTFS/opt/trakend/offline-packages/" 2>/dev/null || true
ok "Debootstrap cache embedded"

# Extra .deb packages (GRUB, smartmontools, samba, etc)
mkdir -p "$ROOTFS/opt/trakend/offline-packages/extra-debs"
cp "$EXTRA_DEB_DIR"/*.deb "$ROOTFS/opt/trakend/offline-packages/extra-debs/" 2>/dev/null || true
ok "Extra .deb packages embedded ($(ls "$ROOTFS/opt/trakend/offline-packages/extra-debs/"*.deb 2>/dev/null | wc -l) packages)"

# Docker .deb packages
mkdir -p "$ROOTFS/opt/trakend/offline-packages/docker-debs"
cp "$DOCKER_DEB_DIR"/*.deb "$ROOTFS/opt/trakend/offline-packages/docker-debs/" 2>/dev/null || true
mkdir -p "$ROOTFS/opt/trakend/offline-packages/docker-config"
cp "$PKG_CACHE/docker-config/docker.gpg" "$ROOTFS/opt/trakend/offline-packages/docker-config/" 2>/dev/null || true
ok "Docker packages embedded ($(ls "$ROOTFS/opt/trakend/offline-packages/docker-debs/"*.deb 2>/dev/null | wc -l) packages)"

# Node.js .deb packages
mkdir -p "$ROOTFS/opt/trakend/offline-packages/nodejs-debs"
cp "$NODEJS_DEB_DIR"/*.deb "$ROOTFS/opt/trakend/offline-packages/nodejs-debs/" 2>/dev/null || true
ok "Node.js packages embedded"

TOTAL_CACHE_SIZE=$(du -sh "$ROOTFS/opt/trakend/offline-packages" | awk '{print $1}')
ok "Total offline cache: ${TOTAL_CACHE_SIZE}"

# ============================================================
# Step 4: Create the installation wizard (OFFLINE version)
# ============================================================
log "Step 4/6: Creating offline installation wizard..."

# Launcher script
cat > "$ROOTFS/opt/trakend/run-installer.sh" << 'LAUNCHER'
#!/bin/bash
mkdir -p /mnt /tmp /run /media /srv 2>/dev/null || true
sleep 3
if [ -f /opt/trakend/install-wizard.sh ]; then
  exec /opt/trakend/install-wizard.sh
fi
echo "ERROR: Could not find installer wizard. Dropping to shell."
exec /bin/bash
LAUNCHER
chmod +x "$ROOTFS/opt/trakend/run-installer.sh"

# ── The full standalone offline wizard script ──
cat > "$ROOTFS/opt/trakend/install-wizard.sh" << 'WIZARD_SCRIPT'
#!/bin/bash
#
# TRAKEND OS — Server Installation Wizard (OFFLINE)
# ===================================================
# All packages are pre-cached. No internet required.
# Guides through: drive selection -> format -> OS install -> GRUB -> done.
#

ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

VERSION=$(grep '"version"' /opt/trakend/os/package.json 2>/dev/null | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/')
VERSION="${VERSION:-1.0.000}"

log()     { echo -e "  ${CYAN}>>>${NC} $1"; }
ok()      { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "  ${ORANGE}[WARN]${NC} $1"; }
fail()    { echo -e "  ${RED}[FAIL]${NC} $1"; }
progress(){ echo -e "  ${CYAN}[$1]${NC} $2"; }
die()     { echo -e "\n  ${RED}FATAL: $1${NC}\n"; echo "  Press Enter to drop to shell..."; read; exec /bin/bash; }

# Copy reboot/poweroff to a dedicated tmpfs in RAM — squashfs on USB is gone after removal
mount -t tmpfs tmpfs /run/reboot-bin 2>/dev/null || mkdir -p /run/reboot-bin
cp /usr/sbin/reboot /run/reboot-bin/reboot 2>/dev/null || true
cp /usr/sbin/poweroff /run/reboot-bin/poweroff 2>/dev/null || true
cp /usr/sbin/shutdown /run/reboot-bin/shutdown 2>/dev/null || true
cp /bin/sync /run/reboot-bin/sync 2>/dev/null || true
chmod +x /run/reboot-bin/* 2>/dev/null || true

safe_reboot() {
  /run/reboot-bin/sync 2>/dev/null; sync 2>/dev/null
  sleep 1
  # Method 1: kernel sysrq — most reliable, bypasses all userspace
  echo 1 > /proc/sys/kernel/sysrq 2>/dev/null || true
  echo s > /proc/sysrq-trigger 2>/dev/null || true  # sync
  echo u > /proc/sysrq-trigger 2>/dev/null || true  # remount read-only
  echo b > /proc/sysrq-trigger 2>/dev/null || true  # reboot
  sleep 2
  # Method 2: RAM-cached reboot binary
  /run/reboot-bin/reboot -f 2>/dev/null || true
  sleep 2
  # Method 3: direct kernel reboot syscall via busybox if available
  busybox reboot -f 2>/dev/null || true
  sleep 2
  echo ""
  echo "  Auto-reboot failed. Please power cycle the server manually."
  echo "  (Hold power button for 5 seconds)"
}

OFFLINE_DIR="/opt/trakend/offline-packages"
# Canonical update remote (keep in sync with backend/src/config/default.ts)
GIT_REPO_URL="${GIT_REPO_URL:-https://github.com/joeabillion/TRAKENDOS.git}"

clear
echo ""
echo -e "${CYAN}  =================================================================${NC}"
echo -e "${CYAN}       ${BOLD}TRAKEND OS -- Server Installation Wizard${NC}"
echo -e "${CYAN}       Version ${VERSION} (Offline Installer)${NC}"
echo -e "${CYAN}  =================================================================${NC}"
echo ""
echo -e "  This will install Trakend OS onto a drive in this server."
echo -e "  ${GREEN}All packages are pre-cached — no internet required.${NC}"
echo -e "  Your data drives will remain untouched."
echo ""

sleep 2

# ── Network check (informational only — not required) ──
log "Checking network (optional — install is fully offline)..."
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$IP" ]; then
  ok "Network: $IP (available but not required)"
else
  ok "No network — that's fine, all packages are pre-cached"
fi
echo ""

# ── Drive Selection ──
echo -e "  ${BOLD}Available drives for installation:${NC}"
echo ""

# ── Identify the installer medium so it is NEVER offered as a target ──
# In the live environment "/" is an overlay, so findmnt on / is useless. Find the
# real device behind the live medium instead, and fall back to label / squashfs.
parent_disk() {
  # /dev/sdb1 -> sdb ; /dev/nvme0n1p1 -> nvme0n1 ; /dev/sr0 -> sr0 ; /dev/loop0 -> (backing file's disk)
  local src="$1" pk
  [ -z "$src" ] && return
  if [[ "$src" == /dev/loop* ]]; then
    local back; back=$(losetup -nO BACK-FILE "$src" 2>/dev/null | head -1)
    [ -n "$back" ] && src=$(findmnt -n -o SOURCE -T "$back" 2>/dev/null | head -1)
    [ -z "$src" ] && return
  fi
  [ -b "$src" ] || return
  pk=$(lsblk -no PKNAME "$src" 2>/dev/null | head -1)
  if [ -n "$pk" ]; then echo "$pk"; else basename "$src"; fi
}

EXCLUDE_DISKS=()
for medium in /run/live/medium /lib/live/mount/medium /cdrom /run/initramfs/live; do
  if mountpoint -q "$medium" 2>/dev/null; then
    src=$(findmnt -n -o SOURCE --target "$medium" 2>/dev/null | head -1)
    d=$(parent_disk "$src"); [ -n "$d" ] && EXCLUDE_DISKS+=("$d")
  fi
done
# Backing device of the live squashfs (if mounted via loop)
for lp in $(losetup -nO NAME 2>/dev/null); do
  d=$(parent_disk "$lp"); [ -n "$d" ] && EXCLUDE_DISKS+=("$d")
done
# Any disk holding a partition labelled like our ISO, or a USB disk carrying our squashfs
while IFS= read -r pline; do
  pname=$(echo "$pline" | awk '{print $1}'); plabel=$(echo "$pline" | cut -d' ' -f2-)
  case "$plabel" in
    TRAKEND_LIVE|TRAKEND_OS_INSTALLER|TRAKEND_OS_INST*) d=$(parent_disk "/dev/$pname"); [ -n "$d" ] && EXCLUDE_DISKS+=("$d") ;;
  esac
done < <(lsblk -ln -o NAME,LABEL 2>/dev/null | awk 'NF>=2')
for usbdisk in $(lsblk -d -n -o NAME,TRAN 2>/dev/null | awk '$2=="usb"{print $1}'); do
  for part in $(lsblk -ln -o NAME,TYPE "/dev/$usbdisk" 2>/dev/null | awk '$2=="part"{print $1}'); do
    tmpm=$(mktemp -d)
    if mount -o ro "/dev/$part" "$tmpm" 2>/dev/null; then
      [ -f "$tmpm/live/filesystem.squashfs" ] && EXCLUDE_DISKS+=("$usbdisk")
      umount "$tmpm" 2>/dev/null || true
    fi
    rmdir "$tmpm" 2>/dev/null || true
  done
done

is_excluded_disk() {
  local n="$1" e
  for e in "${EXCLUDE_DISKS[@]}"; do [ "$e" = "$n" ] && return 0; done
  return 1
}
if [ ${#EXCLUDE_DISKS[@]} -gt 0 ]; then
  log "Installer medium detected on: $(printf '/dev/%s ' $(printf '%s\n' "${EXCLUDE_DISKS[@]}" | sort -u)) — excluded from targets"
else
  warn "Could not identify the installer medium — be careful which drive you pick!"
fi

DRIVES=()
DRIVE_SIZES=()

while IFS= read -r line; do
  DEV_NAME=$(echo "$line" | awk '{print $1}')
  DEV_SIZE=$(echo "$line" | awk '{print $2}')
  DEV_TYPE=$(echo "$line" | awk '{print $3}')
  DEV_TRAN=$(echo "$line" | awk '{print $4}')
  DEV_MODEL=$(echo "$line" | awk '{$1=$2=$3=$4=""; print $0}' | xargs)
  DEV_PATH="/dev/$DEV_NAME"
  DEV_SIZE_B=$(lsblk -b -d -n -o SIZE "$DEV_PATH" 2>/dev/null || echo 0)
  DEV_SIZE_GB=$((DEV_SIZE_B / 1073741824))

  [ "$DEV_TYPE" != "disk" ] && continue
  is_excluded_disk "$DEV_NAME" && continue
  [[ "$DEV_NAME" == loop* ]] && continue
  [[ "$DEV_NAME" == sr* ]] && continue
  [ "$DEV_SIZE_GB" -lt 20 ] && continue

  DRIVES+=("$DEV_PATH")
  DRIVE_SIZES+=("$DEV_SIZE_GB")

  TYPE_TAG="${DIM}${DEV_TRAN:-disk}${NC}"
  [[ "$DEV_NAME" == nvme* ]] && TYPE_TAG="${GREEN}NVMe${NC}"
  [ "$DEV_TRAN" = "sata" ] || [ "$DEV_TRAN" = "ata" ] && TYPE_TAG="${DIM}SATA${NC}"
  [ "$DEV_TRAN" = "usb" ] && TYPE_TAG="${ORANGE}USB${NC}"

  echo -e "    ${BOLD}[${#DRIVES[@]}]${NC} ${DEV_PATH}  ${DEV_SIZE_GB}GB  ${TYPE_TAG}  ${DIM}${DEV_MODEL}${NC}"

done < <(lsblk -d -n -o NAME,SIZE,TYPE,TRAN,MODEL 2>/dev/null)

if [ ${#DRIVES[@]} -eq 0 ]; then
  echo ""
  fail "No suitable drives found (minimum 20GB)."
  lsblk -d -o NAME,SIZE,TYPE,TRAN,MODEL 2>/dev/null
  echo "  Press Enter for shell, Ctrl+Alt+Del to reboot."
  read
  exec /bin/bash
fi

echo ""
echo -e "    ${BOLD}[0]${NC} Cancel and reboot"
echo ""
read -p "  Select target drive for installation: " DRIVE_CHOICE

if [ "$DRIVE_CHOICE" = "0" ] || [ -z "$DRIVE_CHOICE" ]; then
  log "Cancelled. Rebooting..."
  sleep 3
  safe_reboot
fi

IDX=$((DRIVE_CHOICE - 1))
if [ "$IDX" -lt 0 ] || [ "$IDX" -ge ${#DRIVES[@]} ]; then
  fail "Invalid selection."
  sleep 2
  exec "$0"
fi

TARGET="${DRIVES[$IDX]}"
TARGET_SIZE="${DRIVE_SIZES[$IDX]}"

echo ""
echo -e "  ${RED}${BOLD}WARNING: ALL DATA ON ${TARGET} (${TARGET_SIZE}GB) WILL BE PERMANENTLY ERASED!${NC}"
echo ""
read -p "  Type 'INSTALL' to begin installation: " CONFIRM

if [ "$CONFIRM" != "INSTALL" ]; then
  log "Cancelled. Rebooting..."
  sleep 3
  safe_reboot
fi

# ── Network identity: primary NIC + hostname ──
PRIMARY_NIC=$(ip -o -4 route show default 2>/dev/null | awk '{print $5; exit}')
if [ -z "$PRIMARY_NIC" ]; then
  for n in $(ls /sys/class/net 2>/dev/null | grep -E '^(en|eth)' | sort); do
    [ "$(cat /sys/class/net/$n/operstate 2>/dev/null)" = "up" ] && { PRIMARY_NIC="$n"; break; }
  done
fi
[ -z "$PRIMARY_NIC" ] && PRIMARY_NIC=$(ls /sys/class/net 2>/dev/null | grep -E '^(en|eth)' | sort | head -1)
PRIMARY_MAC=""
[ -n "$PRIMARY_NIC" ] && PRIMARY_MAC=$(cat "/sys/class/net/$PRIMARY_NIC/address" 2>/dev/null | tr 'A-F' 'a-f')
MAC4=$(echo "$PRIMARY_MAC" | tr -d ':' | tail -c 5)
DEFAULT_HOSTNAME="trakend${MAC4:+-$MAC4}"

echo ""
[ -n "$PRIMARY_NIC" ] && log "Primary network interface: ${PRIMARY_NIC} (${PRIMARY_MAC:-unknown MAC})" || warn "No ethernet interface detected — netplan will match any 'e*' interface"
while :; do
  read -p "  Hostname for this server [${DEFAULT_HOSTNAME}]: " NEW_HOSTNAME
  NEW_HOSTNAME="${NEW_HOSTNAME:-$DEFAULT_HOSTNAME}"
  NEW_HOSTNAME=$(echo "$NEW_HOSTNAME" | tr 'A-Z' 'a-z')
  if [[ "$NEW_HOSTNAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then break; fi
  fail "Invalid hostname (use a-z, 0-9 and '-', max 63 chars)."
done
ok "Hostname: ${NEW_HOSTNAME}"

echo ""
echo -e "  ${CYAN}${BOLD}Starting Trakend OS OFFLINE installation on ${TARGET}...${NC}"
echo ""

# ── Step 1: Partition ──
progress "1/8" "Partitioning ${TARGET}..."

umount ${TARGET}* 2>/dev/null || true
wipefs -a "$TARGET" > /dev/null 2>&1 || true

parted -s "$TARGET" mklabel gpt
parted -s "$TARGET" mkpart "EFI" fat32 1MiB 513MiB
parted -s "$TARGET" set 1 esp on
parted -s "$TARGET" mkpart "Boot" ext4 513MiB 1537MiB
ROOT_GB=60
QUARTER=$((TARGET_SIZE * 25 / 100))
[ "$QUARTER" -gt "$ROOT_GB" ] && ROOT_GB=$QUARTER
[ "$ROOT_GB" -gt 120 ] && ROOT_GB=120
ROOT_END=$((1537 + ROOT_GB * 1024))
parted -s "$TARGET" mkpart "TrakendOS" ext4 1537MiB ${ROOT_END}MiB
parted -s "$TARGET" mkpart "Data" ext4 ${ROOT_END}MiB 100%

sleep 2
partprobe "$TARGET" 2>/dev/null || true
sleep 2

# Determine partition naming
if [[ "$TARGET" == *"nvme"* ]] || [[ "$TARGET" == *"mmcblk"* ]]; then
  T_EFI="${TARGET}p1"; T_BOOT="${TARGET}p2"; T_ROOT="${TARGET}p3"; T_DATA="${TARGET}p4"
else
  T_EFI="${TARGET}1"; T_BOOT="${TARGET}2"; T_ROOT="${TARGET}3"; T_DATA="${TARGET}4"
fi

# Wait for partitions to appear
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ -b "$T_EFI" ] && [ -b "$T_BOOT" ] && [ -b "$T_ROOT" ] && [ -b "$T_DATA" ] && break
  sleep 1
  partprobe "$TARGET" 2>/dev/null || true
done

[ -b "$T_ROOT" ] || die "Partitions did not appear after partitioning $TARGET"

ok "Drive partitioned (EFI: 512MB, Boot: 1GB, Root: ${ROOT_GB}GB, Data: $((TARGET_SIZE - ROOT_GB - 2))GB)"

# ── Step 2: Format ──
progress "2/8" "Formatting partitions..."

mkfs.vfat -F 32 -n "TRAKEND_EFI" "$T_EFI" > /dev/null 2>&1 || die "Failed to format EFI partition"
mkfs.ext4 -F -L "TRAKEND_BOOT" "$T_BOOT" > /dev/null 2>&1 || die "Failed to format boot partition"
mkfs.ext4 -F -L "TRAKEND_ROOT" "$T_ROOT" > /dev/null 2>&1 || die "Failed to format root partition"
mkfs.ext4 -F -L "TRAKEND_DATA" "$T_DATA" > /dev/null 2>&1 || die "Failed to format data partition"

ok "Partitions formatted"

# ── Step 3: Install base OS (OFFLINE from cached tarball) ──
progress "3/8" "Installing base operating system (OFFLINE — 5-10 minutes)..."

# Ensure /mnt exists
[ -d /mnt ] || mkdir -p /mnt 2>/dev/null || mount -t tmpfs tmpfs /mnt
INST="/mnt/trakend"
mkdir -p "$INST" || die "Cannot create $INST"

# Mount in correct order: root -> boot -> efi -> data
mount "$T_ROOT" "$INST" || die "Cannot mount root partition"
mkdir -p "$INST/boot"
mount "$T_BOOT" "$INST/boot" || die "Cannot mount boot partition"
mkdir -p "$INST/boot/efi"
mount "$T_EFI" "$INST/boot/efi" || die "Cannot mount EFI partition"
mkdir -p "$INST/data"
mount "$T_DATA" "$INST/data" || die "Cannot mount data partition"

ok "Partitions mounted"

# Use the pre-cached debootstrap tarball for OFFLINE install
# NOTE: linux-image-generic is NOT included — it causes kernel panics
# when its postinstall scripts run depmod/update-initramfs on the live USB kernel.
# It is installed later with safety wrappers in place.
if [ -f "$OFFLINE_DIR/debootstrap-base.tar" ]; then
  log "Using offline package cache..."
  debootstrap --arch=amd64 \
    --include=systemd,systemd-sysv,dbus,udev,kmod,iproute2,iputils-ping,\
netplan.io,openssh-server,sudo,curl,wget,git,\
ca-certificates,gnupg,lsb-release,pciutils,usbutils,\
hdparm,dmidecode,parted,\
e2fsprogs,dosfstools,ntfs-3g,mdadm,lvm2,\
python3,nano,less,cron \
    --unpack-tarball="$OFFLINE_DIR/debootstrap-base.tar" \
    jammy "$INST" 2>&1 | while IFS= read -r line; do echo -n "."; done
  echo ""
  ok "Base OS installed from offline cache"
else
  warn "Offline cache not found — falling back to network install..."
  debootstrap --arch=amd64 \
    --include=systemd,systemd-sysv,dbus,udev,kmod,iproute2,iputils-ping,\
netplan.io,openssh-server,sudo,curl,wget,git,\
ca-certificates,gnupg,lsb-release,pciutils,usbutils,\
hdparm,dmidecode,parted,\
e2fsprogs,dosfstools,ntfs-3g,mdadm,lvm2,\
python3,nano,less,cron \
    jammy "$INST" http://archive.ubuntu.com/ubuntu/ 2>&1 | \
    while IFS= read -r line; do echo -n "."; done
  echo ""
  ok "Base OS installed via network (fallback)"
fi

# Bind-mount for chroot operations
mount --bind /dev "$INST/dev"
mount --bind /dev/pts "$INST/dev/pts" 2>/dev/null || true
mount --bind /proc "$INST/proc"
mount --bind /sys "$INST/sys"

# ── Step 4: Configure system ──
progress "4/8" "Configuring system..."

echo "$NEW_HOSTNAME" > "$INST/etc/hostname"
cat > "$INST/etc/hosts" << HOSTEOF
127.0.0.1   localhost
127.0.1.1   ${NEW_HOSTNAME}
::1         localhost ip6-localhost ip6-loopback
HOSTEOF

# Set up repos (for future updates after install — not used during install)
cat > "$INST/etc/apt/sources.list" << 'APTEOF'
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
APTEOF

# ── Kernel-panic prevention: Install chroot safety wrappers ──
# dpkg postinstall scripts try to load kernel modules (modprobe) and
# regenerate initramfs — both crash the live USB kernel with a NULL
# pointer dereference.  We install dummy wrappers ONCE, use them for
# ALL three dpkg phases (extra-debs, Docker, Node.js), then remove
# them before the final GRUB / initramfs step.

# policy-rc.d — prevent any service starts
cat > "$INST/usr/sbin/policy-rc.d" << 'POLICYEOF'
#!/bin/sh
exit 101
POLICYEOF
chmod +x "$INST/usr/sbin/policy-rc.d"

# Dummy modprobe — silently succeed without touching real kernel modules
if [ -f "$INST/sbin/modprobe" ]; then
  mv "$INST/sbin/modprobe" "$INST/sbin/modprobe.REAL"
fi
cat > "$INST/sbin/modprobe" << 'MODEOF'
#!/bin/sh
exit 0
MODEOF
chmod +x "$INST/sbin/modprobe"

# Dummy update-initramfs — skip during dpkg triggers; we run it manually later
if [ -f "$INST/usr/sbin/update-initramfs" ]; then
  mv "$INST/usr/sbin/update-initramfs" "$INST/usr/sbin/update-initramfs.REAL"
fi
cat > "$INST/usr/sbin/update-initramfs" << 'IRDEOF'
#!/bin/sh
exit 0
IRDEOF
chmod +x "$INST/usr/sbin/update-initramfs"

# Dummy depmod — prevent module dependency scans that probe the live kernel
if [ -f "$INST/sbin/depmod" ]; then
  mv "$INST/sbin/depmod" "$INST/sbin/depmod.REAL"
fi
cat > "$INST/sbin/depmod" << 'DEPEOF'
#!/bin/sh
exit 0
DEPEOF
chmod +x "$INST/sbin/depmod"

ok "Chroot safety wrappers installed (modprobe, depmod, update-initramfs, policy-rc.d)"

# Install extra packages from OFFLINE .deb cache
log "Installing GRUB and system packages from offline cache..."
if [ -d "$OFFLINE_DIR/extra-debs" ] && ls "$OFFLINE_DIR/extra-debs/"*.deb > /dev/null 2>&1; then
  mkdir -p "$INST/tmp/extra-debs"
  cp "$OFFLINE_DIR/extra-debs/"*.deb "$INST/tmp/extra-debs/"

  chroot "$INST" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    dpkg --force-depends --force-confnew --no-triggers -i /tmp/extra-debs/*.deb 2>/dev/null || true
    apt-get -f install -y --no-download -o Dpkg::Options::="--force-confnew" -o Dpkg::Options::="--no-triggers" 2>/dev/null || true
    rm -rf /tmp/extra-debs
  ' 2>&1 | tail -10

  ok "Extra packages installed from offline cache"
else
  warn "Extra .deb cache not found — installing via network..."
  chroot "$INST" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq > /dev/null 2>&1
    apt-get install -y -qq -o Dpkg::Options::="--no-triggers" \
      grub-efi-amd64 grub-efi-amd64-bin grub-efi-amd64-signed \
      shim-signed efibootmgr grub2-common \
      smartmontools lm-sensors htop tmux samba samba-common-bin acpid \
      xfsprogs btrfs-progs gdisk sqlite3 ethtool cifs-utils nfs-kernel-server \
      rsync locales linux-firmware avahi-daemon avahi-utils wsdd 2>&1 | tail -10
  ' 2>&1
fi

chroot "$INST" bash -c '
  echo "en_US.UTF-8 UTF-8" > /etc/locale.gen
  locale-gen > /dev/null 2>&1 || true
  echo "LANG=en_US.UTF-8" > /etc/default/locale
  ln -sf /usr/share/zoneinfo/UTC /etc/localtime
' 2>/dev/null

# Network — create /etc/network dir so initramfs /init doesn't error
mkdir -p "$INST/etc/network"
touch "$INST/etc/network/interfaces"
mkdir -p "$INST/etc/netplan"
# One explicit entry for the primary NIC (matched by MAC so a renamed interface
# still works). Two glob 'match:' blocks (en*/eth*) would later conflict with a
# static-IP entry written by the UI, so we never emit those on the target.
if [ -n "$PRIMARY_NIC" ] && [ -n "$PRIMARY_MAC" ]; then
cat > "$INST/etc/netplan/01-trakend.yaml" << NETEOF
network:
  version: 2
  renderer: networkd
  ethernets:
    ${PRIMARY_NIC}:
      match:
        macaddress: "${PRIMARY_MAC}"
      set-name: ${PRIMARY_NIC}
      dhcp4: true
      dhcp6: false
NETEOF
else
cat > "$INST/etc/netplan/01-trakend.yaml" << 'NETEOF'
network:
  version: 2
  renderer: networkd
  ethernets:
    primary:
      match:
        name: "e*"
      dhcp4: true
      dhcp6: false
NETEOF
fi
chmod 0600 "$INST/etc/netplan/01-trakend.yaml" 2>/dev/null || true

# fstab
EFI_UUID=$(blkid -s UUID -o value "$T_EFI")
BOOT_UUID=$(blkid -s UUID -o value "$T_BOOT")
ROOT_UUID=$(blkid -s UUID -o value "$T_ROOT")
DATA_UUID=$(blkid -s UUID -o value "$T_DATA")

cat > "$INST/etc/fstab" << FSTAB
UUID=$ROOT_UUID   /           ext4   errors=remount-ro,noatime   0  1
UUID=$BOOT_UUID   /boot       ext4   defaults,noatime            0  2
UUID=$EFI_UUID    /boot/efi   vfat   umask=0077                  0  1
UUID=$DATA_UUID   /data       ext4   defaults,noatime            0  2
/swapfile         none        swap   sw                          0  0
FSTAB

# Swapfile on the root filesystem: 8 GiB, or 4 GiB when root is under 80 GiB
SWAP_GB=8
[ "$ROOT_GB" -lt 80 ] && SWAP_GB=4
log "Creating ${SWAP_GB} GiB swapfile..."
if fallocate -l "${SWAP_GB}G" "$INST/swapfile" 2>/dev/null || dd if=/dev/zero of="$INST/swapfile" bs=1M count=$((SWAP_GB * 1024)) status=none 2>/dev/null; then
  chmod 0600 "$INST/swapfile"
  mkswap "$INST/swapfile" > /dev/null 2>&1 && ok "Swapfile created (${SWAP_GB} GiB)" || warn "mkswap failed — swap disabled"
else
  warn "Could not allocate swapfile — removing fstab entry"
  sed -i '\|^/swapfile|d' "$INST/etc/fstab"
fi

# Users
chroot "$INST" bash -c '
  echo "root:trakend" | chpasswd
  useradd -m -s /bin/bash -G sudo trakend 2>/dev/null || true
  echo "trakend:trakend" | chpasswd
' 2>/dev/null

# SSH
mkdir -p "$INST/etc/ssh/sshd_config.d"
cat > "$INST/etc/ssh/sshd_config.d/trakend.conf" << 'SSHEOF'
PermitRootLogin prohibit-password
PasswordAuthentication yes
Port 22
SSHEOF
chroot "$INST" systemctl enable ssh 2>/dev/null || true

# Set systemd shutdown timeout to 30s max — prevents 20-min hang on reboot/poweroff
mkdir -p "$INST/etc/systemd/system.conf.d"
cat > "$INST/etc/systemd/system.conf.d/shutdown-timeout.conf" << 'SDEOF'
[Manager]
DefaultTimeoutStopSec=30s
SDEOF

ok "System configured"

# ── Step 5: Install Docker + Node.js (OFFLINE) ──
progress "5/8" "Installing Docker and Node.js (OFFLINE)..."

# Install Docker from cached .debs
if [ -d "$OFFLINE_DIR/docker-debs" ] && ls "$OFFLINE_DIR/docker-debs/"*.deb > /dev/null 2>&1; then
  mkdir -p "$INST/tmp/docker-debs"
  cp "$OFFLINE_DIR/docker-debs/"*.deb "$INST/tmp/docker-debs/"

  # Set up Docker GPG key and repo for future updates
  if [ -f "$OFFLINE_DIR/docker-config/docker.gpg" ]; then
    mkdir -p "$INST/etc/apt/keyrings"
    cp "$OFFLINE_DIR/docker-config/docker.gpg" "$INST/etc/apt/keyrings/docker.gpg"
    chmod a+r "$INST/etc/apt/keyrings/docker.gpg"
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
      > "$INST/etc/apt/sources.list.d/docker.list"
  fi

  # Safety wrappers (modprobe, depmod, update-initramfs, policy-rc.d) are
  # already in place from Step 4 — no need to re-create them.

  chroot "$INST" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    # Install with --no-triggers to avoid kernel module loading (iptables/netfilter)
    dpkg --force-depends --force-confnew --no-triggers -i /tmp/docker-debs/*.deb 2>/dev/null || true
    apt-get -f install -y --no-download -o Dpkg::Options::="--force-confnew" -o Dpkg::Options::="--no-triggers" 2>/dev/null || true
    usermod -aG docker trakend 2>/dev/null || true
    # Docker is NOT enabled at boot — it starts when the array starts
    systemctl disable docker 2>/dev/null || true
    systemctl disable docker.socket 2>/dev/null || true
    rm -rf /tmp/docker-debs
  ' 2>&1 | tail -5

  ok "Docker installed from offline cache"
else
  warn "Docker cache not found — installing via network..."
  chroot "$INST" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
      > /etc/apt/sources.list.d/docker.list
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get update -qq > /dev/null 2>&1
    apt-get install -y -qq -o Dpkg::Options::="--no-triggers" \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
      docker-compose-plugin nodejs > /dev/null 2>&1
    usermod -aG docker trakend 2>/dev/null || true
    # Docker is NOT enabled at boot — it starts when the array starts
    systemctl disable docker 2>/dev/null || true
    systemctl disable docker.socket 2>/dev/null || true
  ' 2>&1 | while IFS= read -r line; do echo -n "."; done
  echo ""
fi

# Install Node.js from cached .debs
if [ -d "$OFFLINE_DIR/nodejs-debs" ] && ls "$OFFLINE_DIR/nodejs-debs/"*.deb > /dev/null 2>&1; then
  mkdir -p "$INST/tmp/nodejs-debs"
  cp "$OFFLINE_DIR/nodejs-debs/"*.deb "$INST/tmp/nodejs-debs/"

  chroot "$INST" bash -c '
    export DEBIAN_FRONTEND=noninteractive
    dpkg --force-depends --force-confnew --no-triggers -i /tmp/nodejs-debs/*.deb 2>/dev/null || true
    apt-get -f install -y --no-download -o Dpkg::Options::="--force-confnew" -o Dpkg::Options::="--no-triggers" 2>/dev/null || true
    rm -rf /tmp/nodejs-debs
  ' 2>&1 | tail -5

  ok "Node.js installed from offline cache"
else
  warn "Node.js cache not found — should have been installed with Docker network fallback"
fi

# ── Process all deferred dpkg triggers safely ──
# Now that all packages are installed with --no-triggers, run
# dpkg --configure --pending to process triggers with the dummy
# modprobe/depmod/update-initramfs still in place (safe).
log "Processing deferred dpkg triggers (with safety wrappers)..."
chroot "$INST" bash -c '
  export DEBIAN_FRONTEND=noninteractive
  dpkg --configure --pending 2>/dev/null || true
' 2>&1 | tail -5
ok "Deferred triggers processed"

# ── Restore real binaries ──
log "Restoring real modprobe, depmod, update-initramfs..."
if [ -f "$INST/sbin/modprobe.REAL" ]; then
  mv "$INST/sbin/modprobe.REAL" "$INST/sbin/modprobe"
fi
if [ -f "$INST/sbin/depmod.REAL" ]; then
  mv "$INST/sbin/depmod.REAL" "$INST/sbin/depmod"
fi
if [ -f "$INST/usr/sbin/update-initramfs.REAL" ]; then
  mv "$INST/usr/sbin/update-initramfs.REAL" "$INST/usr/sbin/update-initramfs"
fi
rm -f "$INST/usr/sbin/policy-rc.d"
ok "Real binaries restored"

# ── Run real depmod + update-initramfs for the target kernel ──
log "Generating module dependencies and initramfs for target system..."
TARGET_KVER=$(ls "$INST/boot/vmlinuz-"* 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -1)
if [ -n "$TARGET_KVER" ]; then
  # Ensure bind mounts are in place for initramfs generation
  mountpoint -q "$INST/proc" || mount --bind /proc "$INST/proc"
  mountpoint -q "$INST/sys"  || mount --bind /sys  "$INST/sys"
  mountpoint -q "$INST/dev"  || mount --bind /dev  "$INST/dev"
  mountpoint -q "$INST/dev/pts" 2>/dev/null || mount --bind /dev/pts "$INST/dev/pts" 2>/dev/null || true

  chroot "$INST" depmod "$TARGET_KVER" 2>&1 || warn "depmod had warnings"

  # update-initramfs is broken when run from a live USB because it detects
  # the live environment (via /proc/cmdline "boot=live" which leaks through
  # the bind-mounted /proc) and refuses to run.
  # SOLUTION: Use mkinitramfs directly — it has no live-environment check
  # and is the underlying tool that update-initramfs calls anyway.
  log "Running mkinitramfs directly (bypasses live-environment check)..."
  chroot "$INST" mkinitramfs -o "/boot/initrd.img-$TARGET_KVER" "$TARGET_KVER" 2>&1 || warn "mkinitramfs had warnings"

  if [ -f "$INST/boot/initrd.img-$TARGET_KVER" ]; then
    ok "initramfs generated for kernel $TARGET_KVER ($(du -sh "$INST/boot/initrd.img-$TARGET_KVER" | awk '{print $1}'))"
  else
    warn "INITRD GENERATION FAILED — system may not boot"
  fi
else
  warn "No target kernel found — initramfs will be generated during GRUB step"
fi

mkdir -p "$INST/etc/docker"
cat > "$INST/etc/docker/daemon.json" << 'DKRJSON'
{
  "data-root": "/data/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" },
  "storage-driver": "overlay2"
}
DKRJSON

ok "Docker and Node.js installed"

# ── Step 6: Install Trakend OS (pre-built — no npm install needed) ──
progress "6/8" "Installing Trakend OS application (pre-built)..."

mkdir -p "$INST/opt/trakend"

# Copy the pre-built project (already has node_modules, dist, etc.)
cp -a /opt/trakend/os "$INST/opt/trakend/os"

mkdir -p "$INST/data/docker" "$INST/data/mysql" "$INST/data/backups" \
         "$INST/data/backups/config" "$INST/data/db" "$INST/data/logs" "$INST/data/appdata" \
         "$INST/data/shares" "$INST/data/users"

mkdir -p "$INST/opt/trakend/os/data"
ln -sf /data/db "$INST/opt/trakend/os/data/db"
ln -sf /data/logs "$INST/opt/trakend/os/data/logs"

# No need for npm install or build — already done during ISO creation!
ok "Trakend OS installed (pre-built — zero npm downloads needed)"

cat > "$INST/opt/trakend/os/backend/.env" << ENVEOF
NODE_ENV=production
PORT=80
# Placeholder on purpose: the backend ignores it and uses /data/db/jwt.secret
# (generated by trakend-firstboot.service on first boot).
JWT_SECRET=TRAKEND_CHANGE_ME_ON_FIRST_LOGIN
DATA_DIR=/data
DB_PATH=/data/db/trakend.db
LOG_DIR=/data/logs
TRAKEND_VERSION=${VERSION}
GIT_REPO_URL=${GIT_REPO_URL:-https://github.com/joeabillion/TRAKENDOS.git}
ENVEOF
chmod 0600 "$INST/opt/trakend/os/backend/.env"

# Git: the installed tree is root-owned; mark it safe and point origin at the canonical remote
if [ -d "$INST/opt/trakend/os/.git" ]; then
  chroot "$INST" bash -c '
    git config --global --add safe.directory /opt/trakend/os 2>/dev/null || true
    git -C /opt/trakend/os remote set-url origin "'"${GIT_REPO_URL:-https://github.com/joeabillion/TRAKENDOS.git}"'" 2>/dev/null || true
  ' 2>/dev/null || true
  ok "Git repository ready for in-app updates ($(chroot "$INST" git -C /opt/trakend/os rev-parse --short HEAD 2>/dev/null || echo '?'))"
else
  warn "No .git in /opt/trakend/os — use Settings > Updates > 'Initialize updates' after first boot"
fi

# Systemd units — SINGLE SOURCE OF TRUTH is installer/systemd/ in the repo
# (also applied to existing servers by scripts/apply-systemd-units.sh).
UNIT_SRC="/opt/trakend/os/installer/systemd"
HELPER_SRC="/opt/trakend/os/installer/scripts"
APT_SRC="/opt/trakend/os/installer/apt"
[ -f "$UNIT_SRC/trakend-os.service" ] || die "Missing $UNIT_SRC/trakend-os.service in installer image"

install -m 0644 "$UNIT_SRC/trakend-os.service"        "$INST/etc/systemd/system/trakend-os.service"
install -m 0644 "$UNIT_SRC/trakend-safemode.service"  "$INST/etc/systemd/system/trakend-safemode.service"
install -m 0644 "$UNIT_SRC/trakend-drives.service"    "$INST/etc/systemd/system/trakend-drives.service"
install -m 0644 "$UNIT_SRC/trakend-firstboot.service" "$INST/etc/systemd/system/trakend-firstboot.service"
install -m 0644 "$UNIT_SRC/trakend-backup.service"    "$INST/etc/systemd/system/trakend-backup.service"
install -m 0644 "$UNIT_SRC/trakend-backup.timer"      "$INST/etc/systemd/system/trakend-backup.timer"
install -d -m 0755 "$INST/etc/systemd/system/docker.service.d"
install -m 0644 "$UNIT_SRC/docker.service.d/trakend.conf" "$INST/etc/systemd/system/docker.service.d/trakend.conf"

mkdir -p "$INST/opt/trakend/scripts"
install -m 0755 "$HELPER_SRC/detect-extra-drives.sh" "$INST/opt/trakend/scripts/detect-extra-drives.sh"
install -m 0755 "$HELPER_SRC/firstboot.sh"           "$INST/opt/trakend/scripts/firstboot.sh"
install -m 0755 /opt/trakend/os/scripts/safemode/trakend-safemode.sh "$INST/opt/trakend/scripts/safemode.sh"

chroot "$INST" systemctl enable trakend-os trakend-safemode trakend-firstboot trakend-backup.timer 2>/dev/null || true
# trakend-drives is installed but intentionally NOT enabled (fights the array). No [Install] section.
# Docker/docker.socket stay disabled — the array starts Docker. Verify:
chroot "$INST" systemctl disable docker.service docker.socket 2>/dev/null || true
chroot "$INST" systemctl is-enabled docker.service 2>/dev/null | grep -qx enabled && die "docker.service is still enabled — refusing to continue"

# Network discovery + file sharing daemons (started at boot; Samba is configured by the shares service)
chroot "$INST" systemctl enable avahi-daemon wsdd smbd nmbd 2>/dev/null || true
ok "systemd units installed from $UNIT_SRC"

# ── GPU / kernel safety: nothing may auto-upgrade nvidia/cuda/kernel packages ──
install -d -m 0755 "$INST/etc/apt/apt.conf.d" "$INST/etc/apt/preferences.d" "$INST/etc/modprobe.d"
install -m 0644 "$APT_SRC/20auto-upgrades"         "$INST/etc/apt/apt.conf.d/20auto-upgrades"
install -m 0644 "$APT_SRC/51trakend-gpu-blacklist" "$INST/etc/apt/apt.conf.d/51trakend-gpu-blacklist"
install -m 0644 "$APT_SRC/99-trakend-nvidia-pin"   "$INST/etc/apt/preferences.d/99-trakend-nvidia-pin"
install -m 0644 "$APT_SRC/blacklist-nouveau.conf"  "$INST/etc/modprobe.d/blacklist-nouveau.conf"
chroot "$INST" systemctl mask apt-daily-upgrade.timer apt-daily-upgrade.service 2>/dev/null || true
chroot "$INST" systemctl disable apt-daily.timer 2>/dev/null || true
ok "APT auto-upgrades disabled; NVIDIA 580 pin + nouveau blacklist installed (see installer/GPU-DRIVER.md)"

# Enable ACPI daemon for proper reboot/shutdown
chroot "$INST" systemctl enable acpid 2>/dev/null || true

# Config backup timer
cat > "$INST/opt/trakend/config-backup.sh" << 'BKSCRIPT'
#!/bin/bash
BACKUP_DIR="/data/backups/config"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
TARGETS=""
[ -f /data/db/trakend.db ] && TARGETS="$TARGETS /data/db/trakend.db"
[ -f /opt/trakend/os/backend/.env ] && TARGETS="$TARGETS /opt/trakend/os/backend/.env"
[ -d /etc/docker ] && TARGETS="$TARGETS /etc/docker"
[ -d /etc/ssh ] && TARGETS="$TARGETS /etc/ssh"
[ -d /etc/netplan ] && TARGETS="$TARGETS /etc/netplan"
[ -d /etc/samba ] && TARGETS="$TARGETS /etc/samba"
[ -f /etc/hostname ] && TARGETS="$TARGETS /etc/hostname"
[ -n "$TARGETS" ] && tar czf "$BACKUP_DIR/trakend-config-$TIMESTAMP.tar.gz" $TARGETS 2>/dev/null
ls -t "$BACKUP_DIR"/trakend-config-*.tar.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
BKSCRIPT
chmod +x "$INST/opt/trakend/config-backup.sh"

# (trakend-backup.service/.timer, trakend-drives.service, trakend-safemode.service and
#  the helper scripts were installed above from installer/systemd + installer/scripts.)

ok "Trakend OS installed"

# ── Step 7: Install GRUB bootloader ──
progress "7/8" "Installing GRUB bootloader..."

# GRUB default config
cat > "$INST/etc/default/grub" << 'GRUBCFG'
GRUB_DEFAULT=0
GRUB_TIMEOUT=5
GRUB_DISTRIBUTOR="Trakend OS"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL="console"
GRUBCFG

# Safe mode GRUB entries
cat > "$INST/etc/grub.d/40_trakend_safemode" << 'SAFEGRUB'
#!/bin/sh
exec tail -n +3 $0
menuentry "Trakend OS - Safe Mode (Networking)" {
    load_video
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --label --set=root TRAKEND_ROOT
    linux /vmlinuz root=LABEL=TRAKEND_ROOT ro trakend.safemode=1
    initrd /initrd.img
}
menuentry "Trakend OS - Recovery Console" {
    load_video
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --label --set=root TRAKEND_ROOT
    linux /vmlinuz root=LABEL=TRAKEND_ROOT ro single
    initrd /initrd.img
}
SAFEGRUB
chmod +x "$INST/etc/grub.d/40_trakend_safemode"

# ── Verify kernel exists before GRUB setup ──
KVER=$(ls "$INST/boot/vmlinuz-"* 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -1)
if [ -z "$KVER" ]; then
  warn "No kernel found in $INST/boot — attempting to install one..."
  chroot "$INST" bash -c "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq > /dev/null 2>&1 || true
    apt-get install -y -qq linux-image-generic 2>&1 | tail -5
  "
  KVER=$(ls "$INST/boot/vmlinuz-"* 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -1)
  [ -z "$KVER" ] && die "Kernel installation failed — cannot continue"
fi
ok "Kernel version: $KVER"

# Hold kernel packages so apt never moves the kernel under the pinned NVIDIA 580 driver.
log "Holding kernel packages (apt-mark hold)..."
chroot "$INST" bash -c "
  for p in linux-image-generic linux-headers-generic linux-generic \
           linux-image-$KVER linux-headers-$KVER linux-modules-$KVER linux-modules-extra-$KVER; do
    dpkg -s \"\$p\" >/dev/null 2>&1 && apt-mark hold \"\$p\" >/dev/null 2>&1 || true
  done
  apt-mark showhold 2>/dev/null | tr '\n' ' '
" 2>/dev/null && echo "" || true
ok "Kernel packages held"

# Ensure initrd exists for this kernel
if [ ! -f "$INST/boot/initrd.img-$KVER" ]; then
  log "Generating initramfs for $KVER using mkinitramfs..."
  mountpoint -q "$INST/proc" || mount --bind /proc "$INST/proc"
  mountpoint -q "$INST/sys"  || mount --bind /sys  "$INST/sys"
  mountpoint -q "$INST/dev"  || mount --bind /dev  "$INST/dev"
  mountpoint -q "$INST/dev/pts" 2>/dev/null || mount --bind /dev/pts "$INST/dev/pts" 2>/dev/null || true
  chroot "$INST" mkinitramfs -o "/boot/initrd.img-$KVER" "$KVER" 2>&1 | tail -5
fi
[ -f "$INST/boot/initrd.img-$KVER" ] && ok "initrd.img-$KVER exists" || warn "initrd MISSING — boot will likely fail"

# Mount efivarfs if UEFI firmware is present
if [ -d /sys/firmware/efi ]; then
  mkdir -p "$INST/sys/firmware/efi/efivars" 2>/dev/null || true
  mount -t efivarfs efivarfs "$INST/sys/firmware/efi/efivars" 2>/dev/null || true
  log "UEFI firmware detected"
fi

# === Write grub.cfg FIRST so GRUB can find it ===
ROOT_UUID=$(blkid -s UUID -o value "$T_ROOT")
BOOT_UUID=$(blkid -s UUID -o value "$T_BOOT")
EFI_UUID=$(blkid -s UUID -o value "$T_EFI")

log "Writing grub.cfg (kernel=$KVER, root=$ROOT_UUID, boot=$BOOT_UUID)..."

mkdir -p "$INST/boot/grub"
cat > "$INST/boot/grub/grub.cfg" << GRUBCFG_MANUAL
# ============================================
# Trakend OS — GRUB Configuration
# Generated during installation
# ============================================

set default=0
set timeout=5

# Load video modules
insmod all_video
insmod gfxterm
set gfxmode=auto
terminal_output gfxterm

# ── Trakend OS (Normal) ──
menuentry "Trakend OS" --class trakend --class gnu-linux --class os {
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --fs-uuid --set=root ${BOOT_UUID}
    echo "Loading Trakend OS kernel..."
    linux /vmlinuz-${KVER} root=UUID=${ROOT_UUID} ro quiet splash
    initrd /initrd.img-${KVER}
}

# ── Trakend OS (Safe Mode) ──
menuentry "Trakend OS - Safe Mode" --class trakend --class gnu-linux --class os {
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --fs-uuid --set=root ${BOOT_UUID}
    echo "Loading Trakend OS (Safe Mode)..."
    linux /vmlinuz-${KVER} root=UUID=${ROOT_UUID} ro trakend.safemode=1 nomodeset
    initrd /initrd.img-${KVER}
}

# ── Trakend OS (Recovery Console) ──
menuentry "Trakend OS - Recovery Console" --class trakend --class gnu-linux --class os {
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --fs-uuid --set=root ${BOOT_UUID}
    echo "Loading recovery console..."
    linux /vmlinuz-${KVER} root=UUID=${ROOT_UUID} ro single
    initrd /initrd.img-${KVER}
}

# ── Advanced: Fallback using labels (if UUIDs change) ──
menuentry "Trakend OS - Label Fallback" --class trakend --class gnu-linux --class os {
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --label --set=root TRAKEND_BOOT
    linux /vmlinuz-${KVER} root=LABEL=TRAKEND_ROOT ro quiet splash
    initrd /initrd.img-${KVER}
}
GRUBCFG_MANUAL

ok "Manual grub.cfg written with UUID=${ROOT_UUID}"

# Copy GRUB modules to /boot/grub so runtime module loading works
if [ -d "$INST/usr/lib/grub/x86_64-efi" ]; then
  mkdir -p "$INST/boot/grub/x86_64-efi"
  cp "$INST/usr/lib/grub/x86_64-efi/"*.mod "$INST/boot/grub/x86_64-efi/" 2>/dev/null || true
  cp "$INST/usr/lib/grub/x86_64-efi/"*.lst "$INST/boot/grub/x86_64-efi/" 2>/dev/null || true
  ok "GRUB x86_64-efi modules copied to /boot/grub/"
fi

# === Build custom GRUB EFI binary with embedded early config ===
# The key problem: grub-install --removable bakes $prefix as a path on the
# EFI partition (/boot/grub), but grub.cfg lives on the separate BOOT
# partition.  We build a custom EFI binary with an embedded config that
# SEARCHES for the boot partition by UUID, then loads grub.cfg from there.

log "Building custom GRUB EFI binary with partition search..."

# Write early-config that searches for the boot partition
cat > "$INST/tmp/grub-early.cfg" << EARLYGRUB
search --no-floppy --fs-uuid --set=root ${BOOT_UUID}
set prefix=(\$root)/grub
configfile (\$root)/grub/grub.cfg
EARLYGRUB

# Also place grub.cfg at /grub/grub.cfg on the boot partition (GRUB expects
# it relative to root, and /boot is the mount point, so on-disk it's /grub/)
mkdir -p "$INST/boot/grub"
# grub.cfg is already at $INST/boot/grub/grub.cfg — that maps to
# /grub/grub.cfg on the boot partition filesystem, which is correct.

chroot "$INST" grub-mkimage -O x86_64-efi \
  -o /tmp/grubx64.efi \
  -c /tmp/grub-early.cfg \
  -p /grub \
  part_gpt part_msdos fat ext2 normal chain boot configfile \
  linux linuxefi search search_fs_file search_fs_uuid \
  search_label all_video efi_gop efi_uga gfxterm gfxmenu \
  echo reboot halt test ls cat 2>&1 && ok "Custom GRUB EFI binary built" || warn "grub-mkimage failed"

# Place the custom EFI binary in all standard locations
mkdir -p "$INST/boot/efi/EFI/BOOT" "$INST/boot/efi/EFI/TRAKEND"
if [ -f "$INST/tmp/grubx64.efi" ]; then
  cp "$INST/tmp/grubx64.efi" "$INST/boot/efi/EFI/BOOT/BOOTX64.EFI"
  cp "$INST/tmp/grubx64.efi" "$INST/boot/efi/EFI/TRAKEND/grubx64.efi"
  rm -f "$INST/tmp/grubx64.efi" "$INST/tmp/grub-early.cfg"
  ok "GRUB EFI installed to EFI/BOOT/BOOTX64.EFI and EFI/TRAKEND/grubx64.efi"
else
  # Fallback: try standard grub-install
  warn "grub-mkimage output not found — falling back to grub-install..."
  chroot "$INST" bash -c "
    grub-install \
      --target=x86_64-efi \
      --efi-directory=/boot/efi \
      --bootloader-id=TRAKEND \
      --removable \
      --recheck 2>&1
  " && ok "grub-install succeeded" || warn "grub-install reported errors"
fi

# Also copy grub.cfg to EFI partition as a last-resort search path
cp "$INST/boot/grub/grub.cfg" "$INST/boot/efi/EFI/BOOT/grub.cfg" 2>/dev/null || true
mkdir -p "$INST/boot/efi/boot/grub"
cp "$INST/boot/grub/grub.cfg" "$INST/boot/efi/boot/grub/grub.cfg" 2>/dev/null || true
mkdir -p "$INST/boot/efi/grub"
cp "$INST/boot/grub/grub.cfg" "$INST/boot/efi/grub/grub.cfg" 2>/dev/null || true

# Secure Boot shim
if [ -f "$INST/usr/lib/shim/shimx64.efi.signed" ]; then
  cp "$INST/usr/lib/shim/shimx64.efi.signed" "$INST/boot/efi/EFI/BOOT/BOOTX64.EFI.bak" 2>/dev/null || true
fi

# Verify everything is in place
echo ""
log "Verifying boot files..."
[ -f "$INST/boot/vmlinuz-$KVER" ] && ok "Kernel:  /boot/vmlinuz-$KVER" || warn "KERNEL MISSING!"
[ -f "$INST/boot/initrd.img-$KVER" ] && ok "Initrd:  /boot/initrd.img-$KVER" || warn "INITRD MISSING!"
[ -f "$INST/boot/grub/grub.cfg" ] && ok "Config:  /boot/grub/grub.cfg" || warn "grub.cfg MISSING!"
[ -f "$INST/boot/efi/EFI/BOOT/BOOTX64.EFI" ] && ok "EFI:     /boot/efi/EFI/BOOT/BOOTX64.EFI" || warn "BOOTX64.EFI MISSING!"
[ -f "$INST/boot/efi/EFI/TRAKEND/grubx64.efi" ] && ok "TRAKEND: /boot/efi/EFI/TRAKEND/grubx64.efi" || warn "TRAKEND entry missing (fallback in use)"

log "grub.cfg contents (first 10 lines):"
head -10 "$INST/boot/grub/grub.cfg"

log "EFI partition contents:"
find "$INST/boot/efi" -type f 2>/dev/null | head -20

log "Boot partition kernel files:"
ls -la "$INST/boot/vmlinuz-"* "$INST/boot/initrd.img-"* 2>/dev/null

umount "$INST/sys/firmware/efi/efivars" 2>/dev/null || true

ok "Bootloader installed"

# ── Step 8: Finalize ──
progress "8/8" "Finalizing installation..."

cat > "$INST/etc/motd" << 'MOTDEOF'

  ============================================
       TRAKEND OS SERVER
       Server Management Platform
  ============================================

MOTDEOF

install -m 0755 "$HELPER_SRC/trakend-info.sh" "$INST/etc/profile.d/trakend-info.sh"

# Clean up offline packages from the installed system (save disk space)
rm -rf "$INST/opt/trakend/offline-packages" 2>/dev/null || true
rm -rf "$INST/tmp/"* 2>/dev/null || true
chroot "$INST" apt-get clean 2>/dev/null || true

# Unmount everything in reverse order
sync
umount "$INST/dev/pts" 2>/dev/null || true
umount "$INST/dev" 2>/dev/null || true
umount "$INST/proc" 2>/dev/null || true
umount "$INST/sys" 2>/dev/null || true
umount "$INST/boot/efi" 2>/dev/null || true
umount "$INST/boot" 2>/dev/null || true
umount "$INST/data" 2>/dev/null || true
umount "$INST" 2>/dev/null || true
sync

ok "Installation complete!"

echo ""
echo -e "${CYAN}  =================================================================${NC}"
echo -e "${GREEN}${BOLD}    TRAKEND OS INSTALLATION COMPLETE!${NC}"
echo -e "${CYAN}  =================================================================${NC}"
echo ""
echo -e "  Installed to: ${BOLD}$TARGET${NC} (${TARGET_SIZE}GB)"
echo -e "  Version:      Trakend OS v${VERSION}"
echo -e "  Install Mode: ${GREEN}OFFLINE${NC} (all packages pre-cached)"
echo ""
echo -e "  ${BOLD}Drive Layout:${NC}"
echo -e "    EFI: 512MB | Boot: 1GB | Root: ${ROOT_GB}GB | Data: $((TARGET_SIZE - ROOT_GB - 2))GB"
echo ""
echo -e "  Hostname: ${BOLD}${NEW_HOSTNAME}${NC}"
echo -e "  Web UI:   ${BOLD}http://${NEW_HOSTNAME}.local${NC}  or  ${BOLD}http://<server-ip>${NC}"
echo -e "  SSH:      ${BOLD}ssh trakend@<server-ip>${NC}  (password: trakend — you must change it on first login)"
echo -e "  Web login: ${BOLD}admin / trakend${NC}  — change it immediately"
echo -e "  GPU:      install the NVIDIA 580 driver post-install — see installer/GPU-DRIVER.md"
echo ""
echo -e "  ${YELLOW}Remove the installer USB, then press Enter to reboot...${NC}"
read

# Clean shutdown — unmount installed system first
umount -R /mnt/trakend 2>/dev/null || true
echo ""
log "Rebooting..."
safe_reboot

WIZARD_SCRIPT

chmod +x "$ROOTFS/opt/trakend/install-wizard.sh"

# Auto-run wizard on live boot via systemd
cat > "$ROOTFS/etc/systemd/system/trakend-installer.service" << 'ISVC'
[Unit]
Description=Trakend OS Installation Wizard
After=multi-user.target network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/trakend/run-installer.sh
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
ISVC
chroot "$ROOTFS" systemctl enable trakend-installer 2>/dev/null || true

# Also auto-launch from .bashrc as backup
cat >> "$ROOTFS/root/.bashrc" << 'BASHRC'

# Auto-launch installer if not already running
if [ "$(tty)" = "/dev/tty1" ] && ! pgrep -f "install-wizard" > /dev/null 2>&1; then
  /opt/trakend/run-installer.sh
fi
BASHRC

ok "Installation wizard embedded"

# ============================================================
# Step 5: Create squashfs image
# ============================================================
log "Step 5/6: Compressing filesystem into squashfs..."

umount "$ROOTFS/dev/pts" 2>/dev/null || true
umount "$ROOTFS/dev" 2>/dev/null || true
umount "$ROOTFS/proc" 2>/dev/null || true
umount "$ROOTFS/sys" 2>/dev/null || true

chroot "$ROOTFS" apt-get clean 2>/dev/null || true
rm -rf "$ROOTFS/tmp/"* 2>/dev/null || true

mkdir -p "$ISO_DIR/live"

KERNEL=$(ls "$ROOTFS"/boot/vmlinuz-* 2>/dev/null | sort -V | tail -1)
INITRD=$(ls "$ROOTFS"/boot/initrd.img-* 2>/dev/null | sort -V | tail -1)

if [ -z "$KERNEL" ] || [ -z "$INITRD" ]; then
  warn "Kernel or initrd not found — regenerating..."
  mount --bind /proc "$ROOTFS/proc"
  mount --bind /sys "$ROOTFS/sys"
  mount --bind /dev "$ROOTFS/dev"
  chroot "$ROOTFS" update-initramfs -c -k all 2>&1
  umount "$ROOTFS/dev" 2>/dev/null || true
  umount "$ROOTFS/proc" 2>/dev/null || true
  umount "$ROOTFS/sys" 2>/dev/null || true
  KERNEL=$(ls "$ROOTFS"/boot/vmlinuz-* 2>/dev/null | sort -V | tail -1)
  INITRD=$(ls "$ROOTFS"/boot/initrd.img-* 2>/dev/null | sort -V | tail -1)
fi

[ -z "$KERNEL" ] || [ -z "$INITRD" ] && fail "Kernel or initrd not found!"

cp "$KERNEL" "$ISO_DIR/live/vmlinuz"
cp "$INITRD" "$ISO_DIR/live/initrd"

mksquashfs "$ROOTFS" "$ISO_DIR/live/filesystem.squashfs" \
  -comp gzip -b 256K \
  -e boot/vmlinuz* boot/initrd* 2>&1 | tail -5

ok "Squashfs created ($(du -sh "$ISO_DIR/live/filesystem.squashfs" | awk '{print $1}'))"

# ============================================================
# Step 6: Build the ISO image
# ============================================================
log "Step 6/6: Building bootable ISO image..."

mkdir -p "$ISO_DIR/boot/grub"

# Copy GRUB modules so they can be loaded at runtime
mkdir -p "$ISO_DIR/boot/grub/x86_64-efi"
cp /usr/lib/grub/x86_64-efi/*.mod "$ISO_DIR/boot/grub/x86_64-efi/" 2>/dev/null || true
cp /usr/lib/grub/x86_64-efi/*.lst "$ISO_DIR/boot/grub/x86_64-efi/" 2>/dev/null || true
mkdir -p "$ISO_DIR/boot/grub/i386-pc"
cp /usr/lib/grub/i386-pc/*.mod "$ISO_DIR/boot/grub/i386-pc/" 2>/dev/null || true
cp /usr/lib/grub/i386-pc/*.lst "$ISO_DIR/boot/grub/i386-pc/" 2>/dev/null || true

# GRUB config
cat > "$ISO_DIR/boot/grub/grub.cfg" << 'GRUBCFG'
set default=0
set timeout=5

insmod all_video
insmod gfxterm
set gfxmode=auto
terminal_output gfxterm

menuentry "Trakend OS -- Install" {
    linux /live/vmlinuz boot=live components quiet splash
    initrd /live/initrd
}

menuentry "Trakend OS -- Install (Copy to RAM)" {
    linux /live/vmlinuz boot=live components toram quiet splash
    initrd /live/initrd
}

menuentry "Trakend OS -- Install (Safe Mode)" {
    linux /live/vmlinuz boot=live components nomodeset noapic acpi=off
    initrd /live/initrd
}

menuentry "Trakend OS -- Install (Verbose)" {
    linux /live/vmlinuz boot=live components nosplash debug
    initrd /live/initrd
}

menuentry "Boot from local disk" {
    set root=(hd1)
    chainloader +1
}
GRUBCFG

# Place grub.cfg in multiple locations
mkdir -p "$ISO_DIR/EFI/boot" "$ISO_DIR/EFI/BOOT"
cp "$ISO_DIR/boot/grub/grub.cfg" "$ISO_DIR/EFI/boot/grub.cfg"
cp "$ISO_DIR/boot/grub/grub.cfg" "$ISO_DIR/EFI/BOOT/grub.cfg"

# Early GRUB config: searches for the live filesystem
cat > "$WORK/early-grub.cfg" << 'EARLYGRUB'
search --no-floppy --file --set=root /live/vmlinuz
set prefix=($root)/boot/grub
configfile ($root)/boot/grub/grub.cfg
EARLYGRUB

# Build UEFI GRUB image with embedded search config
grub-mkimage -O x86_64-efi -o "$ISO_DIR/EFI/boot/bootx64.efi" \
  -c "$WORK/early-grub.cfg" \
  -p /boot/grub \
  part_gpt part_msdos fat ext2 normal chain boot configfile \
  linux linuxefi multiboot iso9660 gfxmenu gfxterm search search_fs_file \
  search_fs_uuid search_label all_video loopback squash4 2>/dev/null || \
  cp /usr/lib/grub/x86_64-efi/monolithic/grubx64.efi "$ISO_DIR/EFI/boot/bootx64.efi" 2>/dev/null || true

cp "$ISO_DIR/EFI/boot/bootx64.efi" "$ISO_DIR/EFI/BOOT/BOOTX64.EFI" 2>/dev/null || true

# EFI boot image (embedded FAT partition in ISO)
mkdir -p "$WORK/efi_img"
dd if=/dev/zero of="$ISO_DIR/boot/grub/efi.img" bs=1M count=10 2>/dev/null
mkfs.vfat "$ISO_DIR/boot/grub/efi.img" > /dev/null 2>&1
mount "$ISO_DIR/boot/grub/efi.img" "$WORK/efi_img"
mkdir -p "$WORK/efi_img/EFI/boot" "$WORK/efi_img/boot/grub"
cp "$ISO_DIR/EFI/boot/bootx64.efi" "$WORK/efi_img/EFI/boot/bootx64.efi"
cp "$ISO_DIR/boot/grub/grub.cfg" "$WORK/efi_img/boot/grub/grub.cfg"
umount "$WORK/efi_img"
cp "$ISO_DIR/boot/grub/efi.img" "$ISO_DIR/EFI/boot/" 2>/dev/null || true

# BIOS boot image
grub-mkimage -O i386-pc -o "$ISO_DIR/boot/grub/bios.img" \
  -p /boot/grub biosdisk iso9660 part_gpt part_msdos fat ext2 \
  normal chain boot configfile linux multiboot search \
  search_fs_file search_fs_uuid search_label all_video 2>/dev/null || true

cp /usr/lib/grub/i386-pc/boot_hybrid.img "$ISO_DIR/boot/grub/" 2>/dev/null || true
cp /usr/lib/ISOLINUX/isohdpfx.bin "$ISO_DIR/boot/grub/isohdpfx.bin" 2>/dev/null || \
  dd if=/usr/lib/grub/i386-pc/boot_hybrid.img of="$ISO_DIR/boot/grub/isohdpfx.bin" bs=432 count=1 2>/dev/null || true

# Build ISO
xorriso -as mkisofs \
  -iso-level 3 \
  -full-iso9660-filenames \
  -volid "TRAKEND_OS_INSTALLER" \
  -eltorito-boot boot/grub/bios.img \
    -no-emul-boot -boot-load-size 4 -boot-info-table \
    --eltorito-catalog boot/grub/boot.cat \
  --grub2-boot-info \
  --grub2-mbr "$ISO_DIR/boot/grub/isohdpfx.bin" \
  -eltorito-alt-boot \
    -e boot/grub/efi.img -no-emul-boot \
  -append_partition 2 0xef "$ISO_DIR/boot/grub/efi.img" \
  -output /output/trakend-os-${VERSION}-installer.iso \
  -graft-points \
  "$ISO_DIR" 2>&1

ISO_SIZE=$(du -h /output/trakend-os-${VERSION}-installer.iso 2>/dev/null | awk '{print $1}')
ok "ISO created: trakend-os-${VERSION}-installer.iso (${ISO_SIZE})"

echo ""
echo -e "${CYAN}  =================================================================${NC}"
echo -e "${GREEN}${BOLD}    Trakend OS OFFLINE Installer ISO Built Successfully!${NC}"
echo -e "${CYAN}  =================================================================${NC}"
echo ""
echo -e "  File: trakend-os-${VERSION}-installer.iso"
echo -e "  Size: ${ISO_SIZE}"
echo -e "  Mode: ${GREEN}FULLY OFFLINE${NC} — all packages pre-cached"
echo ""
echo -e "  ${BOLD}What's bundled:${NC}"
echo -e "    - Ubuntu 22.04 base system (debootstrap cache)"
echo -e "    - GRUB, boot tools, smartmontools, Samba"
echo -e "    - Docker CE + Docker Compose"
echo -e "    - Node.js 20.x"
echo -e "    - Trakend OS (pre-built with all npm dependencies)"
echo ""
echo -e "  ${BOLD}Flash to USB with Rufus (DD mode), then:${NC}"
echo -e "    1. Plug USB into server"
echo -e "    2. Boot from USB (F2/F12/DEL)"
echo -e "    3. Follow the installation wizard"
echo -e "    4. Remove USB and reboot"
echo ""
