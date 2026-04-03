#!/bin/bash
#
# Trakend OS — USB Installer Creator
# =====================================
# Creates a bootable USB flash drive that installs Trakend OS onto a
# server's internal drive. Boot from USB → pick a drive → install → reboot.
#
# The installed server runs independently — no USB needed after install.
# Config backups are automatic so you never lose settings.
#
# Supports: UEFI (GPT) + Legacy BIOS boot
#
# Usage:
#   sudo ./scripts/create-usb-installer.sh [/dev/sdX]
#
# Requirements:
#   - USB drive (4GB minimum, 8GB+ recommended)
#   - Ubuntu/Debian build machine with root privileges
#   - Internet connection (downloads base packages)
#
# WARNING: This will ERASE the target USB drive!
#

set -euo pipefail

# ============================================================
# Colors and helpers
# ============================================================
ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION=$(grep '"version"' "$PROJECT_DIR/package.json" | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/')
WORK_DIR="/tmp/trakend-usb-$$"
MNT_USB="$WORK_DIR/usb"

banner() {
  clear
  echo ""
  echo -e "${CYAN}  ╔═══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}  ║                                                   ║${NC}"
  echo -e "${CYAN}  ║      ${BOLD}TRAKEND OS — USB Installer Creator${NC}${CYAN}          ║${NC}"
  echo -e "${CYAN}  ║      Version ${VERSION}                               ║${NC}"
  echo -e "${CYAN}  ║                                                   ║${NC}"
  echo -e "${CYAN}  ║   Creates a bootable USB that installs            ║${NC}"
  echo -e "${CYAN}  ║   Trakend OS onto your server's drive.            ║${NC}"
  echo -e "${CYAN}  ║                                                   ║${NC}"
  echo -e "${CYAN}  ╚═══════════════════════════════════════════════════╝${NC}"
  echo ""
}

log()     { echo -e "  ${CYAN}▸${NC} $1"; }
ok()      { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${ORANGE}⚠${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; }
step()    { echo ""; echo -e "  ${BOLD}${CYAN}[$1]${NC} ${BOLD}$2${NC}"; }

cleanup() {
  log "Cleaning up..."
  for mp in "$MNT_USB/dev/pts" "$MNT_USB/dev" "$MNT_USB/proc" "$MNT_USB/sys" \
            "$MNT_USB/boot/efi"; do
    umount "$mp" 2>/dev/null || true
  done
  umount "$MNT_USB" 2>/dev/null || true
  rm -rf "$WORK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# ============================================================
# Pre-flight
# ============================================================
banner

if [ "$EUID" -ne 0 ]; then
  fail "Must run as root: ${BOLD}sudo $0 /dev/sdX${NC}"
  exit 1
fi

# Install build dependencies
DEPS="debootstrap grub-pc-bin grub-efi-amd64-bin mtools parted dosfstools e2fsprogs rsync squashfs-tools"
MISSING=""
for dep in $DEPS; do
  dpkg -l "$dep" &>/dev/null || MISSING="$MISSING $dep"
done
if [ -n "$MISSING" ]; then
  log "Installing build tools:$MISSING"
  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq $MISSING > /dev/null 2>&1
  ok "Build tools ready"
fi

# ============================================================
# USB device selection
# ============================================================
USB_DEVICE="${1:-}"

if [ -z "$USB_DEVICE" ]; then
  echo -e "  ${BOLD}Select the USB drive to make into an installer:${NC}"
  echo ""

  DEVS=()
  while IFS= read -r line; do
    DEV_NAME=$(echo "$line" | awk '{print $1}')
    DEV_SIZE=$(echo "$line" | awk '{print $2}')
    DEV_TRAN=$(echo "$line" | awk '{print $3}')
    DEV_MODEL=$(echo "$line" | awk '{$1=$2=$3=""; print $0}' | xargs)
    if [[ "$DEV_TRAN" == "usb" ]]; then
      DEVS+=("/dev/$DEV_NAME")
      echo -e "    ${BOLD}[${#DEVS[@]}]${NC} /dev/${DEV_NAME}  ${DEV_SIZE}  ${DIM}${DEV_MODEL}${NC}"
    fi
  done < <(lsblk -d -n -o NAME,SIZE,TRAN,MODEL | grep "disk")

  if [ ${#DEVS[@]} -eq 0 ]; then
    warn "No USB drives detected. Showing all drives:"
    echo ""
    lsblk -d -o NAME,SIZE,TYPE,TRAN,MODEL
    echo ""
    read -p "  Enter device path (e.g., /dev/sdb): " USB_DEVICE
  else
    echo ""
    read -p "  Select drive [1-${#DEVS[@]}]: " CHOICE
    if [[ "$CHOICE" =~ ^[0-9]+$ ]] && [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le ${#DEVS[@]} ]; then
      USB_DEVICE="${DEVS[$((CHOICE-1))]}"
    else
      USB_DEVICE="$CHOICE"
    fi
  fi
fi

if [ ! -b "$USB_DEVICE" ]; then
  fail "$USB_DEVICE is not a valid block device"
  exit 1
fi

# Safety check
if mount | grep -q "^${USB_DEVICE}.*\(/ \|/boot\|/home\)"; then
  fail "REFUSING — $USB_DEVICE has active system mounts!"
  exit 1
fi

DRIVE_SIZE_B=$(lsblk -b -d -n -o SIZE "$USB_DEVICE" | xargs)
DRIVE_SIZE_GB=$((DRIVE_SIZE_B / 1073741824))
DRIVE_MODEL=$(lsblk -d -n -o MODEL "$USB_DEVICE" | xargs)

echo ""
echo -e "  ${BOLD}Target USB:${NC}  $USB_DEVICE ($DRIVE_MODEL, ${DRIVE_SIZE_GB}GB)"
echo ""
echo -e "  ${RED}${BOLD}⚠  ALL DATA ON THIS USB WILL BE ERASED${NC}"
echo ""
read -p "  Type 'YES' to continue: " CONFIRM
[ "$CONFIRM" != "YES" ] && { log "Cancelled."; exit 0; }

# ============================================================
# Step 1: Partition USB
# ============================================================
step "1/5" "Partitioning USB drive"

umount ${USB_DEVICE}* 2>/dev/null || true
sleep 1
wipefs -a "$USB_DEVICE" > /dev/null 2>&1 || true

parted -s "$USB_DEVICE" mklabel gpt
parted -s "$USB_DEVICE" mkpart "EFI" fat32 1MiB 513MiB
parted -s "$USB_DEVICE" set 1 esp on
parted -s "$USB_DEVICE" set 1 boot on
parted -s "$USB_DEVICE" mkpart "TRAKEND_INSTALLER" ext4 513MiB 100%

sleep 2
partprobe "$USB_DEVICE" 2>/dev/null || true
sleep 1

if [[ "$USB_DEVICE" == *"nvme"* ]] || [[ "$USB_DEVICE" == *"mmcblk"* ]]; then
  EFI_PART="${USB_DEVICE}p1"
  ROOT_PART="${USB_DEVICE}p2"
else
  EFI_PART="${USB_DEVICE}1"
  ROOT_PART="${USB_DEVICE}2"
fi

for i in 1 2 3 4 5; do
  [ -b "$EFI_PART" ] && [ -b "$ROOT_PART" ] && break
  sleep 1
done

mkfs.vfat -F 32 -n "TRKEFI" "$EFI_PART" > /dev/null 2>&1
mkfs.ext4 -F -L "TRKINST" "$ROOT_PART" > /dev/null 2>&1

ok "USB partitioned (EFI + Installer root)"

# ============================================================
# Step 2: Install minimal Linux on USB
# ============================================================
step "2/5" "Installing minimal Linux on USB (3-8 minutes)"

mkdir -p "$MNT_USB"
mount "$ROOT_PART" "$MNT_USB"
mkdir -p "$MNT_USB/boot/efi"
mount "$EFI_PART" "$MNT_USB/boot/efi"

debootstrap --arch=amd64 --variant=minbase --include=\
systemd,systemd-sysv,dbus,udev,kmod,iproute2,iputils-ping,\
ifupdown,openssh-server,sudo,curl,wget,git,\
ca-certificates,gnupg,lsb-release,pciutils,usbutils,\
hdparm,smartmontools,lm-sensors,dmidecode,parted,\
e2fsprogs,dosfstools,ntfs-3g,mdadm,lvm2,\
debootstrap,rsync,\
linux-image-generic,grub-pc-bin,grub-efi-amd64-bin,\
python3,nano,less,dialog \
  jammy "$MNT_USB" http://archive.ubuntu.com/ubuntu/ 2>&1 | \
  while IFS= read -r line; do echo -n "."; done
echo ""

ok "USB base system installed"

# ============================================================
# Step 3: Copy Trakend OS files + create installer wizard
# ============================================================
step "3/5" "Embedding Trakend OS and installer wizard"

# Mount virtual FS for chroot
mount --bind /dev "$MNT_USB/dev"
mount --bind /dev/pts "$MNT_USB/dev/pts" 2>/dev/null || true
mount --bind /proc "$MNT_USB/proc"
mount --bind /sys "$MNT_USB/sys"

# Copy Trakend OS project to USB
mkdir -p "$MNT_USB/opt/trakend"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='data' \
  "$PROJECT_DIR/" "$MNT_USB/opt/trakend/os/"

ok "Trakend OS files embedded"

# Hostname & basic config
echo "trakend-installer" > "$MNT_USB/etc/hostname"

# APT sources
cat > "$MNT_USB/etc/apt/sources.list" << 'EOF'
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
EOF

# -----------------------------------------------------------
# The actual installer wizard that runs when USB boots
# -----------------------------------------------------------
cat > "$MNT_USB/opt/trakend/install-wizard.sh" << 'WIZARD_EOF'
#!/bin/bash
#
# ═══════════════════════════════════════════════════════
#  TRAKEND OS — Server Installation Wizard
# ═══════════════════════════════════════════════════════
#
# This script runs automatically when the USB boots.
# It presents a drive selection wizard, partitions the target
# drive, installs the full OS + Trakend OS, and configures
# GRUB so the server boots independently.
#

set -e

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

log()     { echo -e "  ${CYAN}▸${NC} $1"; }
ok()      { echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { echo -e "  ${ORANGE}⚠${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; }
progress(){ echo -e "  ${CYAN}[$1]${NC} $2"; }

clear
echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║         ${BOLD}TRAKEND OS — Server Installation Wizard${NC}${CYAN}           ║${NC}"
echo -e "${CYAN}  ║         Version ${VERSION}                                    ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║   This will install Trakend OS onto a drive in this       ║${NC}"
echo -e "${CYAN}  ║   server. The USB is only needed for installation.        ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for drives to settle
sleep 2

# ────────────────────────────────────────────────────────
# Drive Selection
# ────────────────────────────────────────────────────────
echo -e "  ${BOLD}Available drives for installation:${NC}"
echo ""

# Find the USB we booted from (skip it)
BOOT_DEV=$(findmnt -n -o SOURCE / 2>/dev/null | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')

DRIVES=()
DRIVE_NAMES=()
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
  [ "$DEV_PATH" = "$BOOT_DEV" ] && continue
  [[ "$DEV_NAME" == loop* ]] && continue
  [ "$DEV_SIZE_GB" -lt 20 ] && continue  # Skip drives < 20GB

  DRIVES+=("$DEV_PATH")
  DRIVE_NAMES+=("$DEV_MODEL")
  DRIVE_SIZES+=("$DEV_SIZE_GB")

  # Color code by type
  TYPE_TAG=""
  if [ "$DEV_TRAN" = "sata" ] || [ "$DEV_TRAN" = "ata" ]; then
    TYPE_TAG="${DIM}SATA${NC}"
  elif [[ "$DEV_NAME" == nvme* ]]; then
    TYPE_TAG="${GREEN}NVMe${NC}"
  elif [ "$DEV_TRAN" = "usb" ]; then
    TYPE_TAG="${ORANGE}USB${NC}"
  else
    TYPE_TAG="${DIM}${DEV_TRAN:-disk}${NC}"
  fi

  echo -e "    ${BOLD}[${#DRIVES[@]}]${NC} ${DEV_PATH}  ${DEV_SIZE_GB}GB  ${TYPE_TAG}  ${DIM}${DEV_MODEL}${NC}"

done < <(lsblk -d -n -o NAME,SIZE,TYPE,TRAN,MODEL)

if [ ${#DRIVES[@]} -eq 0 ]; then
  echo ""
  fail "No suitable drives found (minimum 20GB, excluding boot USB)"
  echo ""
  echo "  Connected drives:"
  lsblk -d -o NAME,SIZE,TYPE,TRAN,MODEL
  echo ""
  echo "  Press any key to drop to a shell, or Ctrl+Alt+Del to reboot."
  read -n 1
  /bin/bash
  exit 1
fi

echo ""
echo -e "    ${BOLD}[0]${NC} Cancel and reboot"
echo ""
read -p "  Select target drive: " DRIVE_CHOICE

if [ "$DRIVE_CHOICE" = "0" ] || [ -z "$DRIVE_CHOICE" ]; then
  log "Cancelled. Rebooting in 3 seconds..."
  sleep 3
  reboot
fi

IDX=$((DRIVE_CHOICE - 1))
if [ "$IDX" -lt 0 ] || [ "$IDX" -ge ${#DRIVES[@]} ]; then
  fail "Invalid selection"
  sleep 2
  exec "$0"
fi

TARGET="${DRIVES[$IDX]}"
TARGET_SIZE="${DRIVE_SIZES[$IDX]}"
TARGET_NAME="${DRIVE_NAMES[$IDX]}"

echo ""
echo -e "  ${BOLD}Selected:${NC} $TARGET — ${TARGET_SIZE}GB — $TARGET_NAME"
echo ""

# ────────────────────────────────────────────────────────
# Ask about additional data drives
# ────────────────────────────────────────────────────────
DATA_DRIVES=()
OTHER_DRIVES=()
for i in "${!DRIVES[@]}"; do
  [ "$i" -eq "$IDX" ] && continue
  OTHER_DRIVES+=("${DRIVES[$i]}")
done

if [ ${#OTHER_DRIVES[@]} -gt 0 ]; then
  echo -e "  ${BOLD}Additional drives detected for data storage:${NC}"
  for d in "${OTHER_DRIVES[@]}"; do
    DSIZE=$(lsblk -d -n -o SIZE "$d" | xargs)
    DMODEL=$(lsblk -d -n -o MODEL "$d" | xargs)
    echo -e "    • $d  $DSIZE  ${DIM}$DMODEL${NC}"
  done
  echo ""
  echo -e "  These will be auto-mounted for Docker, databases, and backups."
  echo -e "  ${DIM}(They will NOT be formatted unless they have no filesystem)${NC}"
  echo ""
fi

# ────────────────────────────────────────────────────────
# Confirm
# ────────────────────────────────────────────────────────
echo -e "  ${RED}${BOLD}⚠  ALL DATA ON ${TARGET} WILL BE PERMANENTLY ERASED!${NC}"
echo ""
read -p "  Type 'INSTALL' to begin: " CONFIRM

if [ "$CONFIRM" != "INSTALL" ]; then
  log "Cancelled. Rebooting in 3 seconds..."
  sleep 3
  reboot
fi

echo ""
echo -e "  ${CYAN}${BOLD}Starting Trakend OS installation...${NC}"
echo ""

# ────────────────────────────────────────────────────────
# Step 1: Partition target drive
# ────────────────────────────────────────────────────────
progress "1/8" "Partitioning ${TARGET}..."

umount ${TARGET}* 2>/dev/null || true
wipefs -a "$TARGET" > /dev/null 2>&1 || true

parted -s "$TARGET" mklabel gpt

# EFI: 512MB
parted -s "$TARGET" mkpart "EFI" fat32 1MiB 513MiB
parted -s "$TARGET" set 1 esp on

# Boot: 1GB (kernels, initrd)
parted -s "$TARGET" mkpart "Boot" ext4 513MiB 1537MiB

# Root: OS partition (60GB or 25% of drive, whichever is larger, max 120GB)
ROOT_GB=60
QUARTER=$((TARGET_SIZE * 25 / 100))
[ "$QUARTER" -gt "$ROOT_GB" ] && ROOT_GB=$QUARTER
[ "$ROOT_GB" -gt 120 ] && ROOT_GB=120
ROOT_END=$((1537 + ROOT_GB * 1024))

parted -s "$TARGET" mkpart "TrakendOS" ext4 1537MiB ${ROOT_END}MiB

# Data: everything else (Docker, MySQL, backups, user data)
parted -s "$TARGET" mkpart "Data" ext4 ${ROOT_END}MiB 100%

sleep 2
partprobe "$TARGET" 2>/dev/null || true
sleep 1

if [[ "$TARGET" == *"nvme"* ]] || [[ "$TARGET" == *"mmcblk"* ]]; then
  T_EFI="${TARGET}p1"
  T_BOOT="${TARGET}p2"
  T_ROOT="${TARGET}p3"
  T_DATA="${TARGET}p4"
else
  T_EFI="${TARGET}1"
  T_BOOT="${TARGET}2"
  T_ROOT="${TARGET}3"
  T_DATA="${TARGET}4"
fi

# Wait for partition devices
for i in 1 2 3 4 5; do
  [ -b "$T_EFI" ] && [ -b "$T_ROOT" ] && [ -b "$T_DATA" ] && break
  sleep 1
done

ok "Drive partitioned"

# ────────────────────────────────────────────────────────
# Step 2: Format partitions
# ────────────────────────────────────────────────────────
progress "2/8" "Formatting partitions..."

mkfs.vfat -F 32 -n "TRAKEND_EFI" "$T_EFI" > /dev/null 2>&1
mkfs.ext4 -F -L "TRAKEND_BOOT" "$T_BOOT" > /dev/null 2>&1
mkfs.ext4 -F -L "TRAKEND_ROOT" "$T_ROOT" > /dev/null 2>&1
mkfs.ext4 -F -L "TRAKEND_DATA" "$T_DATA" > /dev/null 2>&1

ok "Partitions formatted"
echo -e "    EFI:   512MB   (UEFI boot)"
echo -e "    Boot:  1GB     (kernel, initrd)"
echo -e "    Root:  ${ROOT_GB}GB    (operating system)"
echo -e "    Data:  $((TARGET_SIZE - ROOT_GB - 2))GB   (Docker, MySQL, backups)"

# ────────────────────────────────────────────────────────
# Step 3: Install base OS
# ────────────────────────────────────────────────────────
progress "3/8" "Installing base operating system..."

INST="/mnt/trakend"
mkdir -p "$INST"
mount "$T_ROOT" "$INST"
mkdir -p "$INST/boot" "$INST/boot/efi" "$INST/data"
mount "$T_BOOT" "$INST/boot"
mount "$T_EFI" "$INST/boot/efi"
mount "$T_DATA" "$INST/data"

# Use debootstrap to install a clean system on the target drive
debootstrap --arch=amd64 --include=\
systemd,systemd-sysv,dbus,udev,kmod,iproute2,iputils-ping,\
netplan.io,openssh-server,sudo,curl,wget,git,\
ca-certificates,gnupg,lsb-release,pciutils,usbutils,\
hdparm,smartmontools,lm-sensors,dmidecode,parted,\
e2fsprogs,dosfstools,ntfs-3g,mdadm,lvm2,\
linux-image-generic,grub-pc-bin,grub-efi-amd64-bin,\
python3,nano,less,htop,tmux,cron \
  jammy "$INST" http://archive.ubuntu.com/ubuntu/ 2>&1 | \
  while IFS= read -r line; do echo -n "."; done
echo ""

ok "Base OS installed on ${TARGET}"

# Mount virtual FS for chroot
mount --bind /dev "$INST/dev"
mount --bind /dev/pts "$INST/dev/pts" 2>/dev/null || true
mount --bind /proc "$INST/proc"
mount --bind /sys "$INST/sys"

# ────────────────────────────────────────────────────────
# Step 4: Configure the installed system
# ────────────────────────────────────────────────────────
progress "4/8" "Configuring system..."

echo "trakend" > "$INST/etc/hostname"
cat > "$INST/etc/hosts" << 'HOSTEOF'
127.0.0.1   localhost
127.0.1.1   trakend
::1         localhost ip6-localhost ip6-loopback
HOSTEOF

# APT repos
cat > "$INST/etc/apt/sources.list" << 'APTEOF'
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu/ jammy-security main restricted universe multiverse
APTEOF

# Locale
chroot "$INST" bash -c '
  echo "en_US.UTF-8 UTF-8" > /etc/locale.gen
  locale-gen > /dev/null 2>&1 || true
  echo "LANG=en_US.UTF-8" > /etc/default/locale
  ln -sf /usr/share/zoneinfo/UTC /etc/localtime
' 2>/dev/null

# Network — DHCP on all ethernet
cat > "$INST/etc/netplan/01-trakend.yaml" << 'NETEOF'
network:
  version: 2
  renderer: networkd
  ethernets:
    all-en:
      match:
        name: "en*"
      dhcp4: true
      dhcp6: true
    all-eth:
      match:
        name: "eth*"
      dhcp4: true
      dhcp6: true
NETEOF

# fstab
EFI_UUID=$(blkid -s UUID -o value "$T_EFI")
BOOT_UUID=$(blkid -s UUID -o value "$T_BOOT")
ROOT_UUID=$(blkid -s UUID -o value "$T_ROOT")
DATA_UUID=$(blkid -s UUID -o value "$T_DATA")

cat > "$INST/etc/fstab" << FSTAB
# Trakend OS — File System Table
UUID=$ROOT_UUID   /           ext4   errors=remount-ro,noatime   0  1
UUID=$BOOT_UUID   /boot       ext4   defaults,noatime            0  2
UUID=$EFI_UUID    /boot/efi   vfat   umask=0077                  0  1
UUID=$DATA_UUID   /data       ext4   defaults,noatime            0  2
FSTAB

# Users
chroot "$INST" bash -c '
  echo "root:trakend" | chpasswd
  useradd -m -s /bin/bash -G sudo trakend 2>/dev/null || true
  echo "trakend:trakend" | chpasswd
' 2>/dev/null

# SSH
mkdir -p "$INST/etc/ssh/sshd_config.d"
cat > "$INST/etc/ssh/sshd_config.d/trakend.conf" << 'SSHEOF'
PermitRootLogin yes
PasswordAuthentication yes
Port 22
SSHEOF
chroot "$INST" systemctl enable ssh 2>/dev/null || true

ok "System configured"

# ────────────────────────────────────────────────────────
# Step 5: Install Docker + Node.js
# ────────────────────────────────────────────────────────
progress "5/8" "Installing Docker and Node.js..."

chroot "$INST" bash -c '
  # Docker
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
    > /etc/apt/sources.list.d/docker.list

  # Node.js 20
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1

  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
    docker-compose-plugin nodejs > /dev/null 2>&1

  usermod -aG docker trakend 2>/dev/null || true
  systemctl enable docker 2>/dev/null || true
' 2>&1 | while IFS= read -r line; do echo -n "."; done
echo ""

# Docker config — use data partition
mkdir -p "$INST/etc/docker"
cat > "$INST/etc/docker/daemon.json" << 'DKREOF'
{
  "data-root": "/data/docker",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
DKREOF

ok "Docker and Node.js installed"

# ────────────────────────────────────────────────────────
# Step 6: Install Trakend OS application
# ────────────────────────────────────────────────────────
progress "6/8" "Installing Trakend OS application..."

mkdir -p "$INST/opt/trakend"
cp -a /opt/trakend/os "$INST/opt/trakend/os"

# Data directories on the data partition
mkdir -p "$INST/data/docker"
mkdir -p "$INST/data/mysql"
mkdir -p "$INST/data/backups"
mkdir -p "$INST/data/backups/config"
mkdir -p "$INST/data/db"
mkdir -p "$INST/data/logs"
mkdir -p "$INST/data/appdata"

# Symlink data dirs into Trakend OS working area
mkdir -p "$INST/opt/trakend/os/data"
ln -sf /data/db "$INST/opt/trakend/os/data/db"
ln -sf /data/logs "$INST/opt/trakend/os/data/logs"

# Install npm deps and build
log "Building Trakend OS (this takes a few minutes)..."
chroot "$INST" bash -c '
  cd /opt/trakend/os
  npm install --quiet 2>/dev/null
  cd backend && npm install --quiet 2>/dev/null && npx tsc 2>/dev/null && cd ..
  cd frontend && npm install --quiet 2>/dev/null && npx vite build 2>/dev/null && cd ..
' 2>&1 | while IFS= read -r line; do echo -n "."; done
echo ""

# .env for backend
cat > "$INST/opt/trakend/os/backend/.env" << 'ENVEOF'
NODE_ENV=production
PORT=80
JWT_SECRET=TRAKEND_CHANGE_ME_ON_FIRST_LOGIN
DATA_DIR=/data
DB_PATH=/data/db/trakend.db
LOG_DIR=/data/logs
ENVEOF

# Trakend OS systemd service
cat > "$INST/etc/systemd/system/trakend-os.service" << SVCEOF
[Unit]
Description=Trakend OS Server Management Platform
After=network-online.target docker.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/trakend/os
ExecStartPre=/bin/mkdir -p /data/docker /data/mysql /data/db /data/logs /data/backups
ExecStart=/usr/bin/node backend/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=80
Environment=DATA_DIR=/data
Environment=CONFIG_DIR=/data/config
Environment=TRAKEND_VERSION=$VERSION

[Install]
WantedBy=multi-user.target
SVCEOF

chroot "$INST" systemctl enable trakend-os 2>/dev/null || true

# ────────────────────────────────────────────────────────
# Config backup service (runs nightly + on shutdown)
# ────────────────────────────────────────────────────────
cat > "$INST/opt/trakend/config-backup.sh" << 'BKEOF'
#!/bin/bash
# Trakend OS — Config Backup
# Backs up all configs, Docker compose files, and settings to /data/backups/config/
# Keeps last 30 backups. Runs nightly via systemd timer.

BACKUP_DIR="/data/backups/config"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/trakend-config-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

# What to back up
TARGETS=""
[ -f /data/db/trakend.db ] && TARGETS="$TARGETS /data/db/trakend.db"
[ -d /opt/trakend/os/backend/.env ] && TARGETS="$TARGETS /opt/trakend/os/backend/.env"
[ -f /opt/trakend/os/backend/.env ] && TARGETS="$TARGETS /opt/trakend/os/backend/.env"
[ -d /etc/docker ] && TARGETS="$TARGETS /etc/docker"
[ -d /etc/ssh ] && TARGETS="$TARGETS /etc/ssh"
[ -d /etc/netplan ] && TARGETS="$TARGETS /etc/netplan"
[ -f /etc/hostname ] && TARGETS="$TARGETS /etc/hostname"
[ -d /data/appdata ] && TARGETS="$TARGETS /data/appdata"

if [ -n "$TARGETS" ]; then
  tar czf "$BACKUP_FILE" $TARGETS 2>/dev/null
  logger -t "trakend-backup" "Config backup created: $BACKUP_FILE"
fi

# Prune old backups (keep last 30)
ls -t "$BACKUP_DIR"/trakend-config-*.tar.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

# Report
COUNT=$(ls "$BACKUP_DIR"/trakend-config-*.tar.gz 2>/dev/null | wc -l)
SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | awk '{print $1}')
logger -t "trakend-backup" "Backup complete. $COUNT backups stored ($SIZE total)"
BKEOF

chmod +x "$INST/opt/trakend/config-backup.sh"

# Nightly backup timer
cat > "$INST/etc/systemd/system/trakend-backup.service" << 'BKSVC'
[Unit]
Description=Trakend OS Config Backup

[Service]
Type=oneshot
ExecStart=/opt/trakend/config-backup.sh
BKSVC

cat > "$INST/etc/systemd/system/trakend-backup.timer" << 'BKTMR'
[Unit]
Description=Trakend OS Nightly Config Backup

[Timer]
OnCalendar=*-*-* 02:00:00
OnBootSec=15min
Persistent=true

[Install]
WantedBy=timers.target
BKTMR

chroot "$INST" systemctl enable trakend-backup.timer 2>/dev/null || true

# ────────────────────────────────────────────────────────
# Drive auto-detect for additional data drives
# ────────────────────────────────────────────────────────
mkdir -p "$INST/opt/trakend/scripts"
cat > "$INST/opt/trakend/scripts/detect-extra-drives.sh" << 'EXTRAEOF'
#!/bin/bash
# Trakend OS — Detect and mount additional server drives
# Mounts any non-OS drives under /mnt/disks/<label> for use as storage pools.

ROOT_DEV=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//')

while IFS= read -r line; do
  DEV_NAME=$(echo "$line" | awk '{print $1}')
  DEV_PATH="/dev/$DEV_NAME"
  DEV_SIZE_B=$(lsblk -b -d -n -o SIZE "$DEV_PATH" 2>/dev/null || echo 0)

  [ "$DEV_PATH" = "$ROOT_DEV" ] && continue
  [[ "$DEV_NAME" == loop* ]] && continue
  [ "$DEV_SIZE_B" -lt 1073741824 ] && continue  # Skip < 1GB

  while IFS= read -r pname; do
    PPATH="/dev/$pname"
    PFSTYPE=$(blkid -s TYPE -o value "$PPATH" 2>/dev/null || echo "")
    PLABEL=$(blkid -s LABEL -o value "$PPATH" 2>/dev/null || echo "$pname")

    case "$PFSTYPE" in ext4|ext3|xfs|btrfs|ntfs) ;; *) continue ;; esac

    MNT="/mnt/disks/$PLABEL"
    mkdir -p "$MNT"
    mountpoint -q "$MNT" 2>/dev/null && continue

    if [ "$PFSTYPE" = "ntfs" ]; then
      mount -t ntfs-3g "$PPATH" "$MNT" 2>/dev/null || continue
    else
      mount "$PPATH" "$MNT" 2>/dev/null || continue
    fi
    logger -t "trakend-drives" "Mounted $PPATH at $MNT"
  done < <(lsblk -n -o NAME "$DEV_PATH" | tail -n +2)
done < <(lsblk -d -n -o NAME,TYPE | grep "disk")
EXTRAEOF

chmod +x "$INST/opt/trakend/scripts/detect-extra-drives.sh"

cat > "$INST/etc/systemd/system/trakend-drives.service" << 'DRVSVC'
[Unit]
Description=Trakend OS Extra Drive Detection
After=local-fs.target
Before=docker.service trakend-os.service

[Service]
Type=oneshot
ExecStart=/opt/trakend/scripts/detect-extra-drives.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
DRVSVC

chroot "$INST" systemctl enable trakend-drives 2>/dev/null || true

ok "Trakend OS installed and configured"

# ────────────────────────────────────────────────────────
# Step 7: Install bootloader (GRUB)
# ────────────────────────────────────────────────────────
progress "7/8" "Installing GRUB bootloader..."

# UEFI
chroot "$INST" grub-install --target=x86_64-efi \
  --efi-directory=/boot/efi \
  --bootloader-id=TRAKEND \
  --removable \
  "$TARGET" 2>/dev/null || echo -e "    ${ORANGE}⚠${NC} UEFI install had warnings (may still work)"

# Legacy BIOS
chroot "$INST" grub-install --target=i386-pc \
  "$TARGET" 2>/dev/null || echo -e "    ${ORANGE}⚠${NC} Legacy BIOS install had warnings (may still work)"

# GRUB config
cat > "$INST/etc/default/grub" << 'GRUBEOF'
GRUB_DEFAULT=0
GRUB_TIMEOUT=5
GRUB_DISTRIBUTOR="Trakend OS"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL="console"
GRUBEOF

chroot "$INST" update-grub 2>/dev/null

# Add Safe Mode GRUB menu entry
cat > "$INST/etc/grub.d/40_trakend_safemode" << 'SAFEGRUB'
#!/bin/sh
exec tail -n +3 \$0
menuentry "Trakend OS - Safe Mode" --class trakend-safe {
    load_video
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --label --set=root TRAKEND_ROOT
    linux /vmlinuz root=LABEL=TRAKEND_ROOT ro single systemd.unit=rescue.target trakend.safemode=1
    initrd /initrd.img
}
menuentry "Trakend OS - Safe Mode (Networking)" --class trakend-safe-net {
    load_video
    insmod gzio
    insmod part_gpt
    insmod ext2
    search --no-floppy --label --set=root TRAKEND_ROOT
    linux /vmlinuz root=LABEL=TRAKEND_ROOT ro trakend.safemode=1
    initrd /initrd.img
}
menuentry "Trakend OS - Recovery Console" --class trakend-recovery {
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
chroot "$INST" update-grub 2>/dev/null

# Safe mode systemd service
cp /opt/trakend/os/scripts/safemode/trakend-safemode.sh "$INST/opt/trakend/scripts/safemode.sh" 2>/dev/null || true
chmod +x "$INST/opt/trakend/scripts/safemode.sh" 2>/dev/null || true

cat > "$INST/etc/systemd/system/trakend-safemode.service" << 'SAFESVC'
[Unit]
Description=Trakend OS Safe Mode
ConditionKernelCommandLine=trakend.safemode=1
Before=trakend-os.service docker.service trakend-drives.service
Conflicts=trakend-os.service

[Service]
Type=simple
ExecStart=/opt/trakend/scripts/safemode.sh
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1

[Install]
WantedBy=multi-user.target
SAFESVC

# Also trigger safe mode if the file exists (manual trigger)
cat > "$INST/etc/systemd/system/trakend-safemode-file.service" << 'SAFEFILE'
[Unit]
Description=Trakend OS Safe Mode (file trigger)
ConditionPathExists=/etc/trakend-safemode
Before=trakend-os.service docker.service
Conflicts=trakend-os.service

[Service]
Type=simple
ExecStart=/opt/trakend/scripts/safemode.sh
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1

[Install]
WantedBy=multi-user.target
SAFEFILE

chroot "$INST" systemctl enable trakend-safemode 2>/dev/null || true
chroot "$INST" systemctl enable trakend-safemode-file 2>/dev/null || true

ok "Bootloader installed with Safe Mode (UEFI + Legacy BIOS)"

# ────────────────────────────────────────────────────────
# Step 8: Login banner + cleanup
# ────────────────────────────────────────────────────────
progress "8/8" "Finishing up..."

# MOTD
cat > "$INST/etc/motd" << 'MOTDEOF'

  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║            TRAKEND OS SERVER                   ║
  ║       Server Management Platform               ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝

MOTDEOF

cat > "$INST/etc/profile.d/trakend-info.sh" << 'PROFEOF'
#!/bin/bash
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo -e "  Web UI: \033[1;36mhttp://${IP}\033[0m"
echo -e "  Login:  \033[1;33madmin\033[0m / \033[1;33mtrakend\033[0m"
echo ""
PROFEOF
chmod +x "$INST/etc/profile.d/trakend-info.sh"

# Cleanup chroot mounts
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

# ────────────────────────────────────────────────────────
# Done!
# ────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║    ${GREEN}${BOLD}✓  TRAKEND OS INSTALLATION COMPLETE!${NC}${CYAN}                   ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ╠═══════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}Installed to: ${BOLD}$TARGET${NC} (${TARGET_SIZE}GB)${CYAN}${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}Drive layout:${NC}${CYAN}                                              ║${NC}"
echo -e "${CYAN}  ║  ${NC}  EFI:   512MB  — UEFI boot firmware${CYAN}                    ║${NC}"
echo -e "${CYAN}  ║  ${NC}  Boot:  1GB    — Kernel and initrd${CYAN}                     ║${NC}"
echo -e "${CYAN}  ║  ${NC}  Root:  ${ROOT_GB}GB   — Operating system${CYAN}                      ║${NC}"
echo -e "${CYAN}  ║  ${NC}  Data:  Rest   — Docker, MySQL, backups${CYAN}                ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}Web UI:${NC}  http://<server-ip>${CYAN}                               ║${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}SSH:${NC}     ssh trakend@<server-ip>${CYAN}                          ║${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}Login:${NC}   admin / trakend${CYAN}                                  ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}${YELLOW}Config backups run nightly at 2am to /data/backups/${NC}${CYAN}      ║${NC}"
echo -e "${CYAN}  ║  ${NC}${YELLOW}Additional drives auto-mount under /mnt/disks/${NC}${CYAN}          ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Remove the USB drive and press Enter to reboot...${NC}"
read
reboot

WIZARD_EOF

chmod +x "$MNT_USB/opt/trakend/install-wizard.sh"

# Auto-launch wizard on USB boot
cat > "$MNT_USB/etc/systemd/system/trakend-installer.service" << 'ISVC'
[Unit]
Description=Trakend OS Installation Wizard
After=multi-user.target
ConditionPathExists=/opt/trakend/install-wizard.sh

[Service]
Type=oneshot
ExecStart=/opt/trakend/install-wizard.sh
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
ISVC

chroot "$MNT_USB" systemctl enable trakend-installer 2>/dev/null || true

# Console auto-login so the wizard can interact
mkdir -p "$MNT_USB/etc/systemd/system/getty@tty1.service.d"
cat > "$MNT_USB/etc/systemd/system/getty@tty1.service.d/override.conf" << 'GEOF'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root --noclear %I $TERM
GEOF

ok "Installer wizard embedded"

# ============================================================
# Step 4: Install GRUB on USB (UEFI + Legacy)
# ============================================================
step "4/5" "Installing bootloader on USB (UEFI + Legacy BIOS)"

chroot "$MNT_USB" bash -c "
  apt-get update -qq > /dev/null 2>&1
  apt-get install -y -qq linux-image-generic grub-pc-bin grub-efi-amd64-bin > /dev/null 2>&1
" 2>&1 | while IFS= read -r line; do echo -n "."; done
echo ""

chroot "$MNT_USB" grub-install --target=x86_64-efi \
  --efi-directory=/boot/efi \
  --bootloader-id=TRAKEND \
  --removable \
  --no-nvram \
  "$USB_DEVICE" 2>/dev/null || warn "UEFI grub-install warning (may still work)"

chroot "$MNT_USB" grub-install --target=i386-pc \
  "$USB_DEVICE" 2>/dev/null || warn "Legacy BIOS grub-install warning (may still work)"

cat > "$MNT_USB/etc/default/grub" << 'GRUBCFG'
GRUB_DEFAULT=0
GRUB_TIMEOUT=5
GRUB_DISTRIBUTOR="Trakend OS Installer"
GRUB_CMDLINE_LINUX_DEFAULT="quiet"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL="console"
GRUBCFG

chroot "$MNT_USB" update-grub 2>/dev/null

ok "USB bootloader installed"

# ============================================================
# Step 5: Cleanup
# ============================================================
step "5/5" "Finalizing USB"

# Unmount chroot binds
umount "$MNT_USB/dev/pts" 2>/dev/null || true
umount "$MNT_USB/dev" 2>/dev/null || true
umount "$MNT_USB/proc" 2>/dev/null || true
umount "$MNT_USB/sys" 2>/dev/null || true
umount "$MNT_USB/boot/efi" 2>/dev/null || true
umount "$MNT_USB" 2>/dev/null || true

sync
sleep 1

ok "USB installer finalized"

# ============================================================
# Done!
# ============================================================
echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║    ${GREEN}${BOLD}✓  Trakend OS USB Installer Created!${NC}${CYAN}                   ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ╠═══════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}USB Device:${NC} $USB_DEVICE ($DRIVE_MODEL)${CYAN}${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}OS Version:${NC} Trakend OS v${VERSION}${CYAN}${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}Boot Mode:${NC}  UEFI + Legacy BIOS${CYAN}${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}${BOLD}How to install Trakend OS:${NC}${CYAN}                                 ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC} 1. Plug this USB into the target server${CYAN}                ║${NC}"
echo -e "${CYAN}  ║  ${NC} 2. Boot from USB (F2/F12/DEL for BIOS menu)${CYAN}           ║${NC}"
echo -e "${CYAN}  ║  ${NC} 3. Follow the on-screen installation wizard${CYAN}            ║${NC}"
echo -e "${CYAN}  ║  ${NC} 4. Select which drive to install Trakend OS onto${CYAN}       ║${NC}"
echo -e "${CYAN}  ║  ${NC} 5. Remove USB and reboot when done${CYAN}                     ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ║  ${NC}After install, access: ${BOLD}http://<server-ip>${NC}${CYAN}                 ║${NC}"
echo -e "${CYAN}  ║  ${NC}Default login: ${BOLD}admin${NC} / ${BOLD}trakend${NC}${CYAN}                            ║${NC}"
echo -e "${CYAN}  ║                                                           ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
