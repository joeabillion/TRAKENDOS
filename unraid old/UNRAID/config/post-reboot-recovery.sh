#!/bin/bash
# POST-REBOOT DOCKER RECOVERY SCRIPT
# Run this after reboot: bash /boot/config/post-reboot-recovery.sh

echo "Starting Docker recovery on cache drive..."

# 1. Set up Docker on cache
mkdir -p /mnt/cache/system/docker
dd if=/dev/zero of=/mnt/cache/system/docker/docker.img bs=1M count=20480
mkfs.btrfs /mnt/cache/system/docker/docker.img
losetup /dev/loop2 /mnt/cache/system/docker/docker.img
mount /dev/loop2 /var/lib/docker

# 2. Start Docker
/etc/rc.d/rc.docker start
sleep 20

# 3. Recreate containers from backups
cd /mnt/disk4/BACKENDRESTORE

# Use the JSON files to recreate containers
bash RESTORE.sh

echo "Recovery complete! Check docker ps"
