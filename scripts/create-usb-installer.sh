#!/bin/bash
#
# Trakend OS USB Installer Creator
# ==================================
# Creates a bootable USB drive that installs Trakend OS on a server.
# The USB boots into a minimal Linux environment, presents a drive selection
# screen, formats the drives, and installs Trakend OS.
#
# Usage:
#   sudo ./scripts/create-usb-installer.sh /dev/sdX
#
# Requirements:
#   - A USB drive (8GB minimum)
#   - debootstrap, grub, parted installed on the build machine
#   - Root privileges
#
# WARNING: This will ERASE the target USB drive!
#

set -e

ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION=$(cat "$PROJECT_DIR/package.json" | grep '"version"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
WORK_DIR="/tmp/trakend-usb-build-$$"
MOUNT_POINT="$WORK_DIR/mnt"

banner() {
  echo ""
  echo -e "${CYAN}  ╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}  ║    Trakend OS USB Installer Creator      ║${NC}"
  echo -e "${CYAN}  ║             Version ${VERSION}                 ║${NC}"
  echo -e "${CYAN}  ╚══════════════════════════════════════════╝${NC}"
  echo ""
}

log()     { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${ORANGE}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
  log "Cleaning up..."
  umount "$MOUNT_POINT/dev" 2>/dev/null || true
  umount "$MOUNT_POINT/proc" 2>/dev/null || true
  umount "$MOUNT_POINT/sys" 2>/dev/null || true
  umount "$MOUNT_POINT" 2>/dev/null || true
  rm -rf "$WORK_DIR" 2>/dev/null || true
}

trap cleanup EXIT

# ============================================================
# Validation
# ============================================================
banner

if [ "$EUID" -ne 0 ]; then
  error "Must be run as root: sudo $0 /dev/sdX"
  exit 1
fi

USB_DEVICE="$1"
if [ -z "$USB_DEVICE" ]; then
  echo -e "${BOLD}Usage:${NC} sudo $0 /dev/sdX"
  echo ""
  echo "Available drives:"
  lsblk -d -o NAME,SIZE,TYPE,TRAN | grep -E "disk\s+(usb|)" | while read line; do
    echo "  /dev/$line"
  done
  echo ""
  error "Please specify a USB device"
  exit 1
fi

if [ ! -b "$USB_DEVICE" ]; then
  error "$USB_DEVICE is not a block device"
  exit 1
fi

# Safety check — refuse to write to mounted system drives
MOUNTED=$(mount | grep "^${USB_DEVICE}" | awk '{print $3}')
if echo "$MOUNTED" | grep -qE "^/$|^/boot|^/home"; then
  error "REFUSING to write to $USB_DEVICE — it contains system partitions!"
  exit 1
fi

DRIVE_SIZE=$(lsblk -b -d -o SIZE "$USB_DEVICE" | tail -1)
DRIVE_SIZE_GB=$((DRIVE_SIZE / 1073741824))
DRIVE_MODEL=$(lsblk -d -o MODEL "$USB_DEVICE" | tail -1 | xargs)

echo -e "${BOLD}Target Device:${NC} $USB_DEVICE"
echo -e "${BOLD}Model:${NC}         $DRIVE_MODEL"
echo -e "${BOLD}Size:${NC}          ${DRIVE_SIZE_GB}GB"
echo ""
echo -e "${RED}${BOLD}WARNING: ALL DATA ON $USB_DEVICE WILL BE ERASED!${NC}"
echo ""
read -p "Type 'YES' to continue: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  log "Aborted."
  exit 0
fi

# ============================================================
# Check build dependencies
# ============================================================
log "Checking build dependencies..."

DEPS="debootstrap grub-pc-bin grub-efi-amd64-bin mtools parted dosfstools e2fsprogs"
MISSING=""
for dep in $DEPS; do
  if ! dpkg -l "$dep" &>/dev/null; then
    MISSING="$MISSING $dep"
  fi
done

if [ -n "$MISSING" ]; then
  log "Installing missing dependencies:$MISSING"
  apt-get update -qq
  apt-get install -y -qq $MISSING > /dev/null
fi
success "Dependencies ready"

# ============================================================
# Prepare work directory
# ============================================================
log "Preparing build environment..."
mkdir -p "$WORK_DIR" "$MOUNT_POINT"

# ============================================================
# Partition the USB drive
# ============================================================
log "Partitioning $USB_DEVICE..."

# Unmount any existing partitions
umount ${USB_DEVICE}* 2>/dev/null || true

# Create GPT partition table
parted -s "$USB_DEVICE" mklabel gpt

# Partition 1: EFI System (512MB)
parted -s "$USB_DEVICE" mkpart primary fat32 1MiB 513MiB
parted -s "$USB_DEVICE" set 1 esp on

# Partition 2: Boot/Install (remaining space)
parted -s "$USB_DEVICE" mkpart primary ext4 513MiB 100%

sleep 2  # Wait for kernel to re-read partition table

# Detect partition names (handles /dev/sdX1 and /dev/nvmeXn1p1 patterns)
if [[ "$USB_DEVICE" == *"nvme"* ]]; then
  PART1="${USB_DEVICE}p1"
  PART2="${USB_DEVICE}p2"
else
  PART1="${USB_DEVICE}1"
  PART2="${USB_DEVICE}2"
fi

# Format partitions
mkfs.vfat -F 32 -n TRAKEND_EFI "$PART1" > /dev/null
mkfs.ext4 -F -L TRAKEND_OS "$PART2" > /dev/null

success "Partitioned and formatted"

# ============================================================
# Mount and install base system
# ============================================================
log "Installing minimal Ubuntu base system (this takes a few minutes)..."

mount "$PART2" "$MOUNT_POINT"
mkdir -p "$MOUNT_POINT/boot/efi"
mount "$PART1" "$MOUNT_POINT/boot/efi"

# Install minimal Ubuntu 22.04 base
debootstrap --arch=amd64 jammy "$MOUNT_POINT" http://archive.ubuntu.com/ubuntu/

success "Base system installed"

# ============================================================
# Configure the installer system
# ============================================================
log "Configuring installer environment..."

# Mount virtual filesystems
mount --bind /dev "$MOUNT_POINT/dev"
mount --bind /proc "$MOUNT_POINT/proc"
mount --bind /sys "$MOUNT_POINT/sys"

# Set hostname
echo "trakend-installer" > "$MOUNT_POINT/etc/hostname"

# Create the Trakend OS installer script that runs on boot
mkdir -p "$MOUNT_POINT/opt/trakend"

# Copy the project files to the USB
log "Copying Trakend OS files to USB..."
cp -r "$PROJECT_DIR" "$MOUNT_POINT/opt/trakend/os"
success "Project files copied"

# Create the installer TUI script
cat > "$MOUNT_POINT/opt/trakend/install-trakend.sh" << 'INSTALLER_EOF'
#!/bin/bash
#
# Trakend OS Server Installer
# This runs when the USB boots — presents drive selection, formats, and installs.
#

set -e

ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║                                              ║${NC}"
echo -e "${CYAN}  ║          TRAKEND OS INSTALLER                ║${NC}"
echo -e "${CYAN}  ║          Server Management Platform          ║${NC}"
echo -e "${CYAN}  ║                                              ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════╝${NC}"
echo ""

# ============================================================
# Drive Selection
# ============================================================
echo -e "${BOLD}Available drives for installation:${NC}"
echo ""

DRIVES=()
IDX=1
while IFS= read -r line; do
  NAME=$(echo "$line" | awk '{print $1}')
  SIZE=$(echo "$line" | awk '{print $2}')
  MODEL=$(echo "$line" | awk '{$1=$2=$3=""; print $0}' | xargs)

  # Skip the USB we booted from
  USB_LABEL=$(lsblk -o LABEL "/dev/$NAME" 2>/dev/null | grep -c "TRAKEND")
  if [ "$USB_LABEL" -gt 0 ]; then
    continue
  fi

  DRIVES+=("/dev/$NAME")
  echo -e "  ${BOLD}[$IDX]${NC} /dev/$NAME - ${SIZE} - ${MODEL}"
  IDX=$((IDX + 1))
done < <(lsblk -d -o NAME,SIZE,TYPE,MODEL | grep "disk" | grep -v "loop")

if [ ${#DRIVES[@]} -eq 0 ]; then
  echo -e "${RED}No suitable drives found for installation.${NC}"
  echo "Press any key to reboot..."
  read -n 1
  reboot
fi

echo ""
echo -e "  ${BOLD}[0]${NC} Cancel and reboot"
echo ""
read -p "Select target drive for Trakend OS installation: " CHOICE

if [ "$CHOICE" = "0" ] || [ -z "$CHOICE" ]; then
  echo "Installation cancelled. Rebooting..."
  sleep 2
  reboot
fi

IDX=$((CHOICE - 1))
if [ "$IDX" -lt 0 ] || [ "$IDX" -ge ${#DRIVES[@]} ]; then
  echo -e "${RED}Invalid selection.${NC}"
  sleep 2
  exec "$0"
fi

TARGET="${DRIVES[$IDX]}"
TARGET_SIZE=$(lsblk -b -d -o SIZE "$TARGET" | tail -1)
TARGET_SIZE_GB=$((TARGET_SIZE / 1073741824))

echo ""
echo -e "${RED}${BOLD}WARNING: ALL DATA ON $TARGET (${TARGET_SIZE_GB}GB) WILL BE ERASED!${NC}"
echo ""
read -p "Type 'INSTALL' to confirm: " CONFIRM

if [ "$CONFIRM" != "INSTALL" ]; then
  echo "Aborted. Rebooting..."
  sleep 2
  reboot
fi

# ============================================================
# Format Target Drive
# ============================================================
echo ""
echo -e "${CYAN}[1/6]${NC} Partitioning $TARGET..."

# Create partition layout:
# 1. EFI (512MB)
# 2. Boot (1GB)
# 3. Root OS (50GB or 30% of drive, whichever is larger)
# 4. Data (remaining space — for Docker volumes, databases, user data)

parted -s "$TARGET" mklabel gpt

# EFI partition
parted -s "$TARGET" mkpart primary fat32 1MiB 513MiB
parted -s "$TARGET" set 1 esp on

# Boot partition
parted -s "$TARGET" mkpart primary ext4 513MiB 1537MiB

# Calculate root size (50GB or 30% of drive)
ROOT_SIZE_GB=50
THIRTY_PERCENT=$((TARGET_SIZE_GB * 30 / 100))
if [ "$THIRTY_PERCENT" -gt "$ROOT_SIZE_GB" ]; then
  ROOT_SIZE_GB=$THIRTY_PERCENT
fi
ROOT_END=$((1537 + ROOT_SIZE_GB * 1024))

# Root partition
parted -s "$TARGET" mkpart primary ext4 1537MiB ${ROOT_END}MiB

# Data partition (rest of drive)
parted -s "$TARGET" mkpart primary ext4 ${ROOT_END}MiB 100%

sleep 2

# Detect partition names
if [[ "$TARGET" == *"nvme"* ]]; then
  EFI_PART="${TARGET}p1"
  BOOT_PART="${TARGET}p2"
  ROOT_PART="${TARGET}p3"
  DATA_PART="${TARGET}p4"
else
  EFI_PART="${TARGET}1"
  BOOT_PART="${TARGET}2"
  ROOT_PART="${TARGET}3"
  DATA_PART="${TARGET}4"
fi

echo -e "${GREEN}[OK]${NC} Drive partitioned"

echo -e "${CYAN}[2/6]${NC} Formatting partitions..."

mkfs.vfat -F 32 -n TRAKEND_EFI "$EFI_PART"
mkfs.ext4 -F -L TRAKEND_BOOT "$BOOT_PART"
mkfs.ext4 -F -L TRAKEND_ROOT "$ROOT_PART"
mkfs.ext4 -F -L TRAKEND_DATA "$DATA_PART"

echo -e "${GREEN}[OK]${NC} Partitions formatted"
echo -e "  EFI:  $EFI_PART (512MB)"
echo -e "  Boot: $BOOT_PART (1GB)"
echo -e "  Root: $ROOT_PART (${ROOT_SIZE_GB}GB)"
echo -e "  Data: $DATA_PART (remaining space)"

# ============================================================
# Install OS
# ============================================================
echo -e "${CYAN}[3/6]${NC} Installing base operating system..."

INSTALL_ROOT="/mnt/trakend-install"
mkdir -p "$INSTALL_ROOT"
mount "$ROOT_PART" "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT/boot" "$INSTALL_ROOT/boot/efi" "$INSTALL_ROOT/data"
mount "$BOOT_PART" "$INSTALL_ROOT/boot"
mount "$EFI_PART" "$INSTALL_ROOT/boot/efi"
mount "$DATA_PART" "$INSTALL_ROOT/data"

# Copy base system
cp -a /. "$INSTALL_ROOT/" 2>/dev/null || rsync -a --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/mnt --exclude=/tmp / "$INSTALL_ROOT/"

echo -e "${GREEN}[OK]${NC} Base OS installed"

# ============================================================
# Install Trakend OS Application
# ============================================================
echo -e "${CYAN}[4/6]${NC} Installing Trakend OS application..."

# Copy Trakend OS to the installed system
mkdir -p "$INSTALL_ROOT/opt/trakend"
cp -r /opt/trakend/os "$INSTALL_ROOT/opt/trakend/os"

# Create data directories on the data partition
mkdir -p "$INSTALL_ROOT/data/docker" \
         "$INSTALL_ROOT/data/mysql" \
         "$INSTALL_ROOT/data/backups" \
         "$INSTALL_ROOT/data/logs" \
         "$INSTALL_ROOT/data/db"

# Symlink data directories into Trakend OS
ln -sf /data/db "$INSTALL_ROOT/opt/trakend/os/data/db" 2>/dev/null || true
ln -sf /data/logs "$INSTALL_ROOT/opt/trakend/os/data/logs" 2>/dev/null || true

echo -e "${GREEN}[OK]${NC} Trakend OS installed"

# ============================================================
# Configure System
# ============================================================
echo -e "${CYAN}[5/6]${NC} Configuring system..."

# Set hostname
echo "trakend-server" > "$INSTALL_ROOT/etc/hostname"

# fstab
EFI_UUID=$(blkid -s UUID -o value "$EFI_PART")
BOOT_UUID=$(blkid -s UUID -o value "$BOOT_PART")
ROOT_UUID=$(blkid -s UUID -o value "$ROOT_PART")
DATA_UUID=$(blkid -s UUID -o value "$DATA_PART")

cat > "$INSTALL_ROOT/etc/fstab" << FSTAB
# Trakend OS File System Table
UUID=$ROOT_UUID  /          ext4  errors=remount-ro,noatime  0  1
UUID=$BOOT_UUID  /boot      ext4  defaults,noatime           0  2
UUID=$EFI_UUID   /boot/efi  vfat  umask=0077                 0  1
UUID=$DATA_UUID  /data      ext4  defaults,noatime           0  2
FSTAB

# Create systemd service for Trakend OS
cat > "$INSTALL_ROOT/etc/systemd/system/trakend-os.service" << 'SVCEOF'
[Unit]
Description=Trakend OS Server Management Platform
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/trakend/os
ExecStart=/usr/bin/node backend/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATA_DIR=/data

[Install]
WantedBy=multi-user.target
SVCEOF

# Enable service on boot
chroot "$INSTALL_ROOT" systemctl enable trakend-os 2>/dev/null || true

# Configure Docker to use data partition
mkdir -p "$INSTALL_ROOT/etc/docker"
cat > "$INSTALL_ROOT/etc/docker/daemon.json" << 'DOCKEREOF'
{
  "data-root": "/data/docker",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
DOCKEREOF

echo -e "${GREEN}[OK]${NC} System configured"

# ============================================================
# Install Bootloader
# ============================================================
echo -e "${CYAN}[6/6]${NC} Installing bootloader..."

# Bind mount for chroot
mount --bind /dev "$INSTALL_ROOT/dev"
mount --bind /proc "$INSTALL_ROOT/proc"
mount --bind /sys "$INSTALL_ROOT/sys"

# Install GRUB for both UEFI and Legacy BIOS
chroot "$INSTALL_ROOT" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=TRAKEND --removable 2>/dev/null || true
chroot "$INSTALL_ROOT" grub-install --target=i386-pc "$TARGET" 2>/dev/null || true
chroot "$INSTALL_ROOT" update-grub 2>/dev/null || true

# Cleanup mounts
umount "$INSTALL_ROOT/dev" "$INSTALL_ROOT/proc" "$INSTALL_ROOT/sys" 2>/dev/null || true
umount "$INSTALL_ROOT/boot/efi" "$INSTALL_ROOT/boot" "$INSTALL_ROOT/data" "$INSTALL_ROOT" 2>/dev/null || true

echo -e "${GREEN}[OK]${NC} Bootloader installed"

# ============================================================
# Done!
# ============================================================
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║        Installation Complete!                ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Trakend OS has been installed to $TARGET${NC}"
echo ""
echo -e "Drive layout:"
echo -e "  ${BOLD}EFI${NC}:  512MB  (boot firmware)"
echo -e "  ${BOLD}Boot${NC}: 1GB    (kernel, initrd)"
echo -e "  ${BOLD}Root${NC}: ${ROOT_SIZE_GB}GB   (operating system)"
echo -e "  ${BOLD}Data${NC}: Remaining (Docker, MySQL, backups, user data)"
echo ""
echo -e "After reboot, access Trakend OS at:"
echo -e "  ${BOLD}http://<server-ip>:3001${NC}"
echo ""
echo -e "Default login: ${ORANGE}admin${NC} / ${ORANGE}trakend${NC}"
echo ""
read -p "Remove USB and press Enter to reboot... "
reboot

INSTALLER_EOF

chmod +x "$MOUNT_POINT/opt/trakend/install-trakend.sh"

# Auto-run installer on boot
cat > "$MOUNT_POINT/etc/systemd/system/trakend-installer.service" << 'SVCEOF'
[Unit]
Description=Trakend OS Installer
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/opt/trakend/install-trakend.sh
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
SVCEOF

chroot "$MOUNT_POINT" systemctl enable trakend-installer 2>/dev/null || true

# ============================================================
# Install GRUB on USB
# ============================================================
log "Installing bootloader on USB..."

chroot "$MOUNT_POINT" apt-get update -qq > /dev/null 2>&1
chroot "$MOUNT_POINT" apt-get install -y -qq linux-image-generic grub-pc-bin grub-efi-amd64-bin > /dev/null 2>&1

chroot "$MOUNT_POINT" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=TRAKEND --removable "$USB_DEVICE" 2>/dev/null || true
chroot "$MOUNT_POINT" grub-install --target=i386-pc "$USB_DEVICE" 2>/dev/null || true
chroot "$MOUNT_POINT" update-grub 2>/dev/null || true

success "Bootloader installed"

# ============================================================
# Cleanup and finish
# ============================================================
umount "$MOUNT_POINT/dev" "$MOUNT_POINT/proc" "$MOUNT_POINT/sys" 2>/dev/null || true
umount "$MOUNT_POINT/boot/efi" 2>/dev/null || true
umount "$MOUNT_POINT" 2>/dev/null || true

sync

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║     USB Installer Created Successfully!      ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Your Trakend OS installer USB is ready on ${BOLD}$USB_DEVICE${NC}"
echo ""
echo -e "To install Trakend OS on a server:"
echo -e "  1. Plug the USB into the target server"
echo -e "  2. Boot from USB (F12 / BIOS boot menu)"
echo -e "  3. Follow the on-screen drive selection wizard"
echo -e "  4. Remove USB and reboot when complete"
echo ""
