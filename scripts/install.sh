#!/bin/bash
#
# Trakend OS Installation Script
# ================================
# One-command installer for Trakend OS on Ubuntu/Debian servers.
#
# Usage:
#   chmod +x scripts/install.sh
#   sudo ./scripts/install.sh
#

set -e

ORANGE='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║      Trakend OS Installer v1.0       ║${NC}"
echo -e "${CYAN}  ║     Server Management Platform       ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR]${NC} Please run as root (sudo ./scripts/install.sh)"
  exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$NAME
  VER=$VERSION_ID
else
  echo -e "${RED}[ERROR]${NC} Cannot detect OS. This installer supports Ubuntu/Debian."
  exit 1
fi

echo -e "${CYAN}[INFO]${NC} Detected: $OS $VER"

# ============================================================
# 1. Install system dependencies
# ============================================================
echo ""
echo -e "${CYAN}[STEP 1/6]${NC} Installing system dependencies..."

apt-get update -qq
apt-get install -y -qq \
  curl \
  wget \
  git \
  build-essential \
  python3 \
  ca-certificates \
  gnupg \
  lsb-release \
  smartmontools \
  lm-sensors \
  > /dev/null

echo -e "${GREEN}[OK]${NC} System dependencies installed"

# ============================================================
# 2. Install Node.js 20 LTS
# ============================================================
echo ""
echo -e "${CYAN}[STEP 2/6]${NC} Installing Node.js 20 LTS..."

if ! command -v node &> /dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null
  echo -e "${GREEN}[OK]${NC} Node.js $(node -v) installed"
else
  echo -e "${GREEN}[OK]${NC} Node.js $(node -v) already installed"
fi

# ============================================================
# 3. Install Docker
# ============================================================
echo ""
echo -e "${CYAN}[STEP 3/6]${NC} Installing Docker..."

if ! command -v docker &> /dev/null; then
  # Add Docker's official GPG key
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/$ID/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg > /dev/null 2>&1
  chmod a+r /etc/apt/keyrings/docker.gpg

  # Add the repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null

  # Start and enable Docker
  systemctl start docker
  systemctl enable docker

  echo -e "${GREEN}[OK]${NC} Docker $(docker --version | cut -d' ' -f3 | tr -d ',') installed"
else
  echo -e "${GREEN}[OK]${NC} Docker already installed: $(docker --version | cut -d' ' -f3 | tr -d ',')"
fi

# ============================================================
# 4. Install Trakend OS dependencies
# ============================================================
echo ""
echo -e "${CYAN}[STEP 4/6]${NC} Installing Trakend OS dependencies..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Install root dependencies
npm install --quiet > /dev/null 2>&1

# Install backend and frontend
npm run install:all > /dev/null 2>&1

echo -e "${GREEN}[OK]${NC} All dependencies installed"

# ============================================================
# 5. Build the project
# ============================================================
echo ""
echo -e "${CYAN}[STEP 5/6]${NC} Building Trakend OS..."

# Setup environment files
if [ -f backend/.env.example ] && [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
fi
if [ -f frontend/.env.example ] && [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
fi

# Create data directories
mkdir -p data/db data/logs

# Build
npm run build > /dev/null 2>&1

echo -e "${GREEN}[OK]${NC} Build complete"

# ============================================================
# 6. Create systemd service
# ============================================================
echo ""
echo -e "${CYAN}[STEP 6/6]${NC} Creating systemd service..."

cat > /etc/systemd/system/trakend-os.service << EOF
[Unit]
Description=Trakend OS Server Management Platform
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node backend/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable trakend-os

echo -e "${GREEN}[OK]${NC} Systemd service created"

# ============================================================
# Done!
# ============================================================
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║          Installation Complete!              ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}[INFO]${NC} Default login credentials:"
echo -e "         Username: ${ORANGE}admin${NC}"
echo -e "         Password: ${ORANGE}trakend${NC}"
echo -e "         ${RED}Change these immediately after first login!${NC}"
echo ""
echo -e "${CYAN}[INFO]${NC} Start Trakend OS:"
echo -e "         sudo systemctl start trakend-os"
echo ""
echo -e "${CYAN}[INFO]${NC} Access the web interface:"
echo -e "         http://$(hostname -I | awk '{print $1}'):3001"
echo ""
echo -e "${CYAN}[INFO]${NC} Check status:"
echo -e "         sudo systemctl status trakend-os"
echo ""
echo -e "${CYAN}[INFO]${NC} View logs:"
echo -e "         sudo journalctl -u trakend-os -f"
echo ""
