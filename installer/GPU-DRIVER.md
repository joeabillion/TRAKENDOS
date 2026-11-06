# NVIDIA GPU driver on Trakend OS (Tesla P40 / Pascal)

Production servers carry **NVIDIA Tesla P40** cards. They run the **NVIDIA 580 driver
branch** (currently `580.173.02`) on Ubuntu 22.04 with the HWE kernel
(`6.8.0-124-generic`). Pascal is *not* supported by the 59x/6xx branches, so a
driver bump silently breaks the GPU — and a kernel bump breaks the DKMS module.

**Nothing on a Trakend server may auto-upgrade `nvidia-*`, `libnvidia-*`, `cuda*`
or `linux-*` packages.** The ISO bakes that in; this document explains what is in
place and how to install/maintain the driver by hand.

## What the image ships with (no driver, just the guard rails)

| File | Purpose |
|------|---------|
| `/etc/apt/apt.conf.d/20auto-upgrades` | All `APT::Periodic::*` set to `"0"` — no unattended activity |
| `/etc/apt/apt.conf.d/51trakend-gpu-blacklist` | `Unattended-Upgrade::Package-Blacklist` for `nvidia-`, `libnvidia-`, `cuda`, `libcudnn`, `nvidia-container`, `linux-image-`, `linux-headers-`, `linux-modules-`, `linux-generic`; `Remove-Unused-Kernel-Packages false`; `Automatic-Reboot false` |
| `/etc/apt/preferences.d/99-trakend-nvidia-pin` | Pins `nvidia-* libnvidia-* xserver-xorg-video-nvidia-*` to `580.*` (priority 1001); `59*` and `6*` get priority -1 (never installed) |
| `/etc/modprobe.d/blacklist-nouveau.conf` | Keeps nouveau off the card |
| `apt-mark hold` | `linux-image-generic linux-headers-generic linux-generic linux-image-$KVER linux-headers-$KVER linux-modules-$KVER` held at install time |
| `apt-daily-upgrade.timer/.service` | masked |

Source of truth for these files: `installer/apt/` in this repo. On an **existing**
server, apply them with:

```bash
sudo bash /opt/trakend/os/scripts/apply-systemd-units.sh
```

(That script also holds whatever kernel + nvidia packages are currently installed.)

The in-app updater (`Settings > Updates`) only touches `/opt/trakend/os`; it never
runs `apt`. It does log a `WARN` if an incoming commit modifies any path matching
`apt|modprobe|nvidia|cuda|dkms|grub|fstab`, so you can review before applying.

## Installing the 580 driver (post-install, needs internet)

The driver is **not** on the ISO (the `.deb`s are ~500 MB and change often).
Install it once after first boot:

```bash
# 1. Make sure the kernel headers for the running kernel are present (the ISO holds them)
sudo apt update
sudo apt install -y linux-headers-$(uname -r) dkms

# 2. Install the 580 branch (pinned, so apt will resolve to 580.* automatically)
sudo apt install -y nvidia-driver-580 nvidia-utils-580

# 3. Container runtime (optional, needed for GPU-enabled Docker containers)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
# Docker is started by the Trakend array; restart it from the UI (stop/start array)
# or: sudo systemctl restart docker   (only if the array is running)

# 4. Hold everything so nothing moves without an operator
sudo apt-mark hold nvidia-driver-580 nvidia-utils-580 nvidia-container-toolkit \
  $(dpkg-query -W -f='${binary:Package}\n' 'nvidia-*' 'libnvidia-*' | grep -v ':' )
sudo apt-mark hold linux-image-generic linux-headers-generic linux-generic \
  linux-image-$(uname -r) linux-headers-$(uname -r) linux-modules-$(uname -r)

# 5. Reboot and verify
sudo reboot
nvidia-smi
```

`nvidia-smi` must report `Driver Version: 580.x`. The dashboard GPU widget shows the
version with a green **pinned** badge when it starts with `580.`.

If `nvidia-ctk runtime configure` rewrote `/etc/docker/daemon.json`, make sure it
still contains `"data-root": "/data/docker"` — the array relies on it.

## If the GPU widget shows "Driver error"

`nvidia-smi` is installed but cannot talk to the kernel module. The widget shows
the first line of stderr (typically *"NVIDIA-SMI has failed because it couldn't
communicate with the NVIDIA driver"*). Check:

```bash
journalctl -k | grep -i nvidia          # module load errors
dkms status                              # module built for the running kernel?
uname -r; dpkg -l 'linux-image-*' | grep ^ii
apt-mark showhold                        # kernel + nvidia packages should be listed
```

Most common cause: a kernel package moved (hold missing) and DKMS did not rebuild.
Fix: `sudo dkms autoinstall` or boot the previous kernel from GRUB, then re-hold.

## Deliberately upgrading the driver within the 580 branch

```bash
sudo apt-mark unhold $(apt-mark showhold | grep -E '^(nvidia|libnvidia)')
sudo apt update && sudo apt install nvidia-driver-580 nvidia-utils-580   # resolves to newest 580.*
sudo apt-mark hold $(dpkg-query -W -f='${binary:Package}\n' 'nvidia-*' 'libnvidia-*' | grep -v ':')
sudo reboot
```

The pin file guarantees apt will never pick a 59x/6xx build even while unheld.

## Never do this on a Trakend server

- `apt upgrade` / `apt full-upgrade` / `do-release-upgrade` without first reading
  `apt-mark showhold` and `apt list --upgradable`.
- `ubuntu-drivers autoinstall` (it picks the newest branch, which drops Pascal).
- Enabling `unattended-upgrades`. If you must, the blacklist in
  `51trakend-gpu-blacklist` is already in place — verify it with
  `unattended-upgrade --dry-run --debug`.
