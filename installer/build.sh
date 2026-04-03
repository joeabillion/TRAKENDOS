#!/bin/bash
#
# Trakend OS — Build Installer ISO (Linux/Mac)
# =============================================
# Uses Docker to build the bootable installer ISO.
#
# Usage:
#   cd trakend-os
#   ./installer/build.sh
#
# Output: installer/output/trakend-os-1.0.000-installer.iso
#

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ══════════════════════════════════════════════${NC}"
echo -e "${CYAN}    TRAKEND OS — ISO Installer Builder${NC}"
echo -e "${CYAN}  ══════════════════════════════════════════════${NC}"
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}[ERROR]${NC} Docker is not running. Please start Docker and try again."
  exit 1
fi

echo -e "${CYAN}[1/3]${NC} Building Docker image..."
docker build -t trakend-iso-builder -f installer/Dockerfile .

echo ""
echo -e "${CYAN}[2/3]${NC} Creating output directory..."
mkdir -p installer/output

echo ""
echo -e "${CYAN}[3/3]${NC} Building ISO (this takes 15-30 minutes)..."
docker run --rm --privileged -v "$(pwd)/installer/output:/output" trakend-iso-builder

echo ""
echo -e "${GREEN}${BOLD}  ✓ ISO built successfully!${NC}"
echo ""
ls -lh installer/output/*.iso
echo ""
echo "  Flash to USB with:"
echo "    sudo dd if=installer/output/trakend-os-*-installer.iso of=/dev/sdX bs=4M status=progress"
echo "  Or use Etcher/Rufus."
echo ""
