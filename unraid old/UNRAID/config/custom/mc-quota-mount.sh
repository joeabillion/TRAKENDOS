#!/bin/bash
# /boot/config/custom/mc-quota-mount.sh
set -euo pipefail

LOG=/var/log/mc-quota-mount.log
exec >>"$LOG" 2>&1
echo "==== $(date -Is) mc-quota-mount start ===="

# Wait for array (/mnt/user) to exist on boot
until [ -d /mnt/user ]; do sleep 1; done

BASE_IMG="/mnt/disk4/mc-quota"
BASE_D4="/mnt/disk4/pterodactyl-wings-volumes"
BASE_U="/mnt/user/pterodactyl-wings-volumes"

# UUID map: image -> Wings server UUID
declare -A MAP=(
  [allaysmp.img]="24de6acb-4c50-47c8-a4c6-2f485b2dbdef"
  [lifesteal.img]="d0df048a-c0d4-4a21-85dc-4c81f9bbbfd2"
  [proxy.img]="de00d401-cfce-4f64-88ec-4b81d1c617b1"
  [lobby.img]="3ef8c3b1-68db-4fdc-a093-a5ea5c7383cf"
)

mkdir -p "$BASE_D4" "$BASE_U"

# Detach any stray duplicate loop devices pointing at our images but not mounted
# (keeps only the mounted ones that findmnt reports)
findmnt -o SOURCE -rn | grep -E '/dev/loop' | tr -d ' ' > /tmp/_mounted_loops.txt || true
losetup -a | awk -F: '{print $1" "$2}' | while read -r loop rest; do
  img="$(sed -E 's/.*\((.*)\).*/\1/' <<<"$rest")"
  if [[ "$img" == "$BASE_IMG/"* ]]; then
    if ! grep -qx "$loop" /tmp/_mounted_loops.txt; then
      echo "Detaching stray $loop for image $img"
      losetup -d "$loop" || true
    fi
  fi
done
rm -f /tmp/_mounted_loops.txt

for img in "${!MAP[@]}"; do
  uuid="${MAP[$img]}"
  file="$BASE_IMG/$img"
  mp_d4="$BASE_D4/$uuid"
  mp_u="$BASE_U/$uuid"

  mkdir -p "$mp_d4" "$mp_u"

  # Reuse existing loop if present, else create
  loopdev="$(losetup -j "$file" | awk -F: 'NR==1{print $1}')"
  if [ -z "${loopdev:-}" ]; then
    echo "Attaching loop for $file"
    loopdev="$(losetup --find --show "$file")"
  fi

  # Optional fast fsck if the image was marked dirty (skip if fsck not present)
  if command -v fsck.ext4 >/dev/null 2>&1; then
    echo "fsck -p on $file (non-blocking if clean)"
    fsck.ext4 -p "$file" || true
  fi

  # Mount ext4 and bind to /mnt/user path
  if ! mountpoint -q "$mp_d4"; then
    echo "Mounting $loopdev -> $mp_d4"
    mount -t ext4 -o noatime "$loopdev" "$mp_d4"
  fi
  if ! mountpoint -q "$mp_u"; then
    echo "Bind-mount $mp_d4 -> $mp_u"
    mount --bind "$mp_d4" "$mp_u"
  fi
done

# Ensure Wings owns the top-level directory (recursive chown can be heavy on big worlds)
chown 988:988 "$BASE_D4" "$BASE_U"

echo "==== $(date -Is) mc-quota-mount done ===="
