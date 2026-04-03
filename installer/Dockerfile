########################################################
#  Trakend OS — ISO Installer Builder (Offline)
#  =============================================
#  Builds a bootable ISO with ALL packages pre-cached
#  so installation requires ZERO internet access.
#
#  Usage (from project root):
#    docker build -t trakend-iso-builder -f installer/Dockerfile .
#    docker run --rm --privileged -v "%cd%/installer/output:/output" trakend-iso-builder
#
#  Output: installer/output/trakend-os-installer.iso
#
#  NOTE: --privileged is required for debootstrap,
#        mount operations, and loopback devices.
########################################################

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TRAKEND_VERSION=1.0.000

# Install all build tools
RUN apt-get update && apt-get install -y \
    debootstrap \
    grub-pc-bin \
    grub-efi-amd64-bin \
    grub-efi-amd64-signed \
    shim-signed \
    mtools \
    xorriso \
    isolinux \
    syslinux-utils \
    squashfs-tools \
    dosfstools \
    e2fsprogs \
    parted \
    rsync \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    cpio \
    genisoimage \
    live-build \
    dpkg-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the entire Trakend OS project into the builder
COPY . /build/trakend-os

# Copy the build script
COPY installer/build-iso.sh /build/build-iso.sh
RUN chmod +x /build/build-iso.sh

# Output directory
RUN mkdir -p /output

CMD ["/build/build-iso.sh"]
