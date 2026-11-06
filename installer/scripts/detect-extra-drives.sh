#!/bin/bash
#
# Trakend OS — Detect and mount additional (non-array, non-OS) drives
# ===================================================================
# Mounts standalone data partitions under /mnt/disks/<LABEL>.
#
# It deliberately SKIPS:
#   - the disk the root filesystem lives on
#   - any partition whose UUID is already in /etc/fstab (managed by the OS)
#   - any partition labelled "trakend-data" or "trakend-disk*" (array members —
#     all array disks share the label trakend-data, and mounting them here
#     before trakend-os starts fights the array service)
#   - anything already mounted anywhere
#
# Installed by installer/build-iso.sh. The matching unit
# (trakend-drives.service) is installed DISABLED by default.
#

ROOT_SRC=$(findmnt -n -o SOURCE / 2>/dev/null)
ROOT_DISK=""
if [ -n "$ROOT_SRC" ] && [ -b "$ROOT_SRC" ]; then
  ROOT_DISK=$(lsblk -no PKNAME "$ROOT_SRC" 2>/dev/null | head -1)
fi

FSTAB_UUIDS=$(grep -v '^\s*#' /etc/fstab 2>/dev/null | grep -o 'UUID=[^[:space:]]*' | cut -d= -f2)

is_in_fstab() {
  local uuid="$1"
  [ -z "$uuid" ] && return 1
  echo "$FSTAB_UUIDS" | grep -qx "$uuid"
}

is_array_label() {
  case "$1" in
    trakend-data|trakend-disk*|TRAKEND_DATA|TRAKEND_ROOT|TRAKEND_BOOT|TRAKEND_EFI) return 0 ;;
    *) return 1 ;;
  esac
}

# lsblk -ln prints a flat list without tree glyphs; filter on TYPE=part.
while read -r pname ptype; do
  [ "$ptype" = "part" ] || continue
  PPATH="/dev/$pname"
  [ -b "$PPATH" ] || continue

  PARENT=$(lsblk -no PKNAME "$PPATH" 2>/dev/null | head -1)
  [[ "$PARENT" == loop* ]] && continue
  [ -n "$ROOT_DISK" ] && [ "$PARENT" = "$ROOT_DISK" ] && continue

  PFSTYPE=$(blkid -s TYPE -o value "$PPATH" 2>/dev/null || echo "")
  case "$PFSTYPE" in ext4|ext3|xfs|btrfs|ntfs) ;; *) continue ;; esac

  PUUID=$(blkid -s UUID -o value "$PPATH" 2>/dev/null || echo "")
  is_in_fstab "$PUUID" && continue

  PLABEL=$(blkid -s LABEL -o value "$PPATH" 2>/dev/null || echo "")
  is_array_label "$PLABEL" && { logger -t trakend-drives "Skipping array member $PPATH (label=$PLABEL)"; continue; }

  # Already mounted somewhere? Leave it alone.
  findmnt -n -S "$PPATH" >/dev/null 2>&1 && continue

  SAFE_LABEL=$(echo "${PLABEL:-$pname}" | tr -c 'A-Za-z0-9._-\n' '_')
  MNT="/mnt/disks/$SAFE_LABEL"
  mkdir -p "$MNT"
  mountpoint -q "$MNT" 2>/dev/null && continue

  if [ "$PFSTYPE" = "ntfs" ]; then
    mount -t ntfs-3g "$PPATH" "$MNT" 2>/dev/null || continue
  else
    mount "$PPATH" "$MNT" 2>/dev/null || continue
  fi
  logger -t trakend-drives "Mounted $PPATH at $MNT"
done < <(lsblk -ln -o NAME,TYPE 2>/dev/null | awk '$2=="part"')
