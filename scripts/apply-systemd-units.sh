#!/bin/bash
#
# Trakend OS — Apply systemd units + apt/GPU safety files from the repo to THIS server
# ===================================================================================
# Idempotent. Copies the single-source-of-truth files under installer/systemd/ and
# installer/apt/ into place, installs helper scripts, daemon-reloads, and fixes
# enable/disable state. Does NOT restart trakend-os (use --restart to do so).
#
# Usage (on an existing server):
#   sudo bash /opt/trakend/os/scripts/apply-systemd-units.sh [--restart] [--no-apt]
#
set -euo pipefail

RESTART=0
APPLY_APT=1
DOCKER_ARRAY_ONLY=0
for a in "$@"; do
  case "$a" in
    --restart) RESTART=1 ;;
    --no-apt)  APPLY_APT=0 ;;
    # Disable docker.service at boot so ONLY the array starts it. Opt-in: on a server whose
    # web stack/DB/tunnel live on /data (not the array) a failed array start would otherwise
    # take those down too. Enable this once a clean reboot has been verified.
    --docker-array-only) DOCKER_ARRAY_ONLY=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$SCRIPT_DIR")"
UNITS="$REPO/installer/systemd"
APT="$REPO/installer/apt"
HELPERS="$REPO/installer/scripts"

[ -d "$UNITS" ] || { echo "Missing $UNITS — is this a full checkout?" >&2; exit 1; }

echo "[units] installing from $UNITS"
install -m 0644 "$UNITS"/trakend-os.service         /etc/systemd/system/trakend-os.service
install -m 0644 "$UNITS"/trakend-safemode.service   /etc/systemd/system/trakend-safemode.service
install -m 0644 "$UNITS"/trakend-drives.service     /etc/systemd/system/trakend-drives.service
install -m 0644 "$UNITS"/trakend-firstboot.service  /etc/systemd/system/trakend-firstboot.service
install -m 0644 "$UNITS"/trakend-backup.service     /etc/systemd/system/trakend-backup.service
install -m 0644 "$UNITS"/trakend-backup.timer       /etc/systemd/system/trakend-backup.timer
install -d -m 0755 /etc/systemd/system/docker.service.d
install -m 0644 "$UNITS"/docker.service.d/trakend.conf /etc/systemd/system/docker.service.d/trakend.conf

# Legacy unit from scripts/create-usb-installer.sh — it carried Conflicts=trakend-os.service.
if [ -f /etc/systemd/system/trakend-safemode-file.service ]; then
  echo "[units] removing legacy trakend-safemode-file.service"
  systemctl disable trakend-safemode-file.service 2>/dev/null || true
  rm -f /etc/systemd/system/trakend-safemode-file.service
fi

echo "[units] installing helper scripts to /opt/trakend/scripts"
install -d -m 0755 /opt/trakend/scripts
install -m 0755 "$HELPERS"/detect-extra-drives.sh /opt/trakend/scripts/detect-extra-drives.sh
install -m 0755 "$HELPERS"/firstboot.sh           /opt/trakend/scripts/firstboot.sh
install -m 0755 "$REPO"/scripts/safemode/trakend-safemode.sh /opt/trakend/scripts/safemode.sh
install -m 0755 "$HELPERS"/trakend-info.sh        /etc/profile.d/trakend-info.sh
# Existing servers already have their secrets/users set up; don't run firstboot on them.
[ -e /data/.firstboot-done ] || { mkdir -p /data && touch /data/.firstboot-done; }

if [ "$APPLY_APT" -eq 1 ] && [ -d "$APT" ]; then
  echo "[apt] installing GPU/kernel safety files"
  install -m 0644 "$APT"/20auto-upgrades           /etc/apt/apt.conf.d/20auto-upgrades
  install -m 0644 "$APT"/51trakend-gpu-blacklist   /etc/apt/apt.conf.d/51trakend-gpu-blacklist
  install -d -m 0755 /etc/apt/preferences.d
  install -m 0644 "$APT"/99-trakend-nvidia-pin     /etc/apt/preferences.d/99-trakend-nvidia-pin
  install -m 0644 "$APT"/blacklist-nouveau.conf    /etc/modprobe.d/blacklist-nouveau.conf
  systemctl mask apt-daily-upgrade.timer apt-daily-upgrade.service 2>/dev/null || true
  systemctl disable --now apt-daily.timer 2>/dev/null || true
  # Hold whatever kernel + nvidia packages are currently installed.
  KVER=$(uname -r)
  HOLD="linux-image-generic linux-headers-generic linux-generic linux-image-$KVER linux-headers-$KVER linux-modules-$KVER"
  HOLD="$HOLD $(dpkg-query -W -f='${binary:Package}\n' 'nvidia-*' 'libnvidia-*' 2>/dev/null | grep -v ':' | tr '\n' ' ' || true)"
  for p in $HOLD; do
    dpkg -s "$p" >/dev/null 2>&1 && apt-mark hold "$p" >/dev/null 2>&1 || true
  done
  echo "[apt] held: $(apt-mark showhold | tr '\n' ' ')"
fi

echo "[units] daemon-reload + enable state"
systemctl daemon-reload
systemctl enable trakend-os.service trakend-safemode.service trakend-firstboot.service trakend-backup.timer >/dev/null 2>&1 || true
# trakend-drives has no [Install] section; make sure no stale symlink keeps it enabled.
rm -f /etc/systemd/system/multi-user.target.wants/trakend-drives.service
if [ "$DOCKER_ARRAY_ONLY" -eq 1 ]; then
  echo "[units] docker will be started by the array only (disabled at boot)"
  systemctl disable docker.service docker.socket >/dev/null 2>&1 || true
else
  echo "[units] docker boot state left unchanged (pass --docker-array-only to let the array own it)"
fi

if [ "$RESTART" -eq 1 ]; then
  echo "[units] restarting trakend-os"
  systemctl restart trakend-os.service
fi

echo "[units] done. Status:"
systemctl --no-pager --no-legend list-unit-files 'trakend-*' 'docker.service' 'docker.socket' 2>/dev/null || true
