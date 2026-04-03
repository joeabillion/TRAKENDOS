#!/bin/bash
#
# Trakend OS — Safe Mode Service
# ================================
# When booted in safe mode, this script runs instead of the full Trakend OS.
# It provides:
#   - Basic SSH access
#   - A minimal web UI on port 80 for diagnostics
#   - Docker is NOT started (prevents container conflicts)
#   - Array is NOT started (prevents data drive issues)
#   - Network is configured for DHCP
#   - All logs are available for inspection
#
# Safe mode is triggered via GRUB menu or by creating /etc/trakend-safemode
#

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
VERSION=$(grep '"version"' /opt/trakend/os/package.json 2>/dev/null | head -1 | sed 's/.*"\([0-9][^"]*\)".*/\1/')

clear
echo ""
echo -e "${YELLOW}  ╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}  ║                                                   ║${NC}"
echo -e "${YELLOW}  ║      ${BOLD}TRAKEND OS — SAFE MODE${NC}${YELLOW}                       ║${NC}"
echo -e "${YELLOW}  ║      Version ${VERSION:-unknown}                            ║${NC}"
echo -e "${YELLOW}  ║                                                   ║${NC}"
echo -e "${YELLOW}  ╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${YELLOW}  ║                                                   ║${NC}"
echo -e "${YELLOW}  ║  ${NC}Docker:     ${RED}STOPPED${NC}${YELLOW}                               ║${NC}"
echo -e "${YELLOW}  ║  ${NC}Array:      ${RED}STOPPED${NC}${YELLOW}                               ║${NC}"
echo -e "${YELLOW}  ║  ${NC}Web UI:     ${CYAN}http://${IP:-<detecting>}:80${NC}${YELLOW}${NC}"
echo -e "${YELLOW}  ║  ${NC}SSH:        ${GREEN}ACTIVE${NC} ${CYAN}ssh root@${IP:-<detecting>}${NC}${YELLOW}${NC}"
echo -e "${YELLOW}  ║                                                   ║${NC}"
echo -e "${YELLOW}  ╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}  Safe mode loads minimal services for troubleshooting.${NC}"
echo -e "${YELLOW}  Docker and the array are NOT started.${NC}"
echo ""

# Ensure SSH is running
systemctl start ssh 2>/dev/null || true

# Stop Docker if it somehow started
systemctl stop docker 2>/dev/null || true
systemctl stop trakend-os 2>/dev/null || true
systemctl stop trakend-drives 2>/dev/null || true

# Start minimal diagnostic web server
# This is a simple Node.js server that provides basic system info and log access
mkdir -p /tmp/trakend-safemode

cat > /tmp/trakend-safemode/server.js << 'WEBEOF'
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = 80;

function getSystemInfo() {
  const info = {};
  try { info.hostname = execSync('hostname', { encoding: 'utf-8' }).trim(); } catch { info.hostname = 'unknown'; }
  try { info.uptime = execSync('uptime -p', { encoding: 'utf-8' }).trim(); } catch { info.uptime = 'unknown'; }
  try { info.ip = execSync("hostname -I | awk '{print $1}'", { encoding: 'utf-8' }).trim(); } catch { info.ip = 'unknown'; }
  try { info.memory = execSync("free -h | grep Mem | awk '{print $3\"/\"$2}'", { encoding: 'utf-8' }).trim(); } catch { info.memory = 'unknown'; }
  try { info.disk = execSync("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'", { encoding: 'utf-8' }).trim(); } catch { info.disk = 'unknown'; }
  try { info.kernel = execSync('uname -r', { encoding: 'utf-8' }).trim(); } catch { info.kernel = 'unknown'; }
  try { info.dockerStatus = execSync('systemctl is-active docker 2>/dev/null || echo stopped', { encoding: 'utf-8' }).trim(); } catch { info.dockerStatus = 'unknown'; }
  try { info.drives = execSync('lsblk -d -o NAME,SIZE,TYPE,TRAN,MODEL --noheadings | grep disk', { encoding: 'utf-8' }).trim(); } catch { info.drives = ''; }
  try { info.journalErrors = execSync('journalctl -p err -n 30 --no-pager 2>/dev/null || echo "No errors"', { encoding: 'utf-8' }).trim(); } catch { info.journalErrors = 'Unable to read'; }
  try { info.trakendLogs = execSync('journalctl -u trakend-os -n 50 --no-pager 2>/dev/null || echo "No logs"', { encoding: 'utf-8' }).trim(); } catch { info.trakendLogs = 'Unable to read'; }
  try { info.networkInterfaces = execSync('ip -br addr', { encoding: 'utf-8' }).trim(); } catch { info.networkInterfaces = 'unknown'; }
  try { info.smartSummary = execSync('for d in /dev/sd?; do echo "$d: $(smartctl -H $d 2>/dev/null | grep "overall" || echo "N/A")"; done 2>/dev/null', { encoding: 'utf-8' }).trim(); } catch { info.smartSummary = ''; }
  return info;
}

function renderPage(info) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Trakend OS — Safe Mode</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0f1419; color: #e1e8ed; padding: 20px; }
    .banner { background: #3d2b00; border: 2px solid #f59e0b; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center; }
    .banner h1 { color: #f59e0b; font-size: 24px; margin-bottom: 8px; }
    .banner p { color: #fbbf24; font-size: 14px; }
    .card { background: #1a2028; border: 1px solid #2d3748; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card h2 { color: #63b3ed; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #2d3748; padding-bottom: 8px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .row .label { color: #a0aec0; }
    .row .value { color: #e1e8ed; font-family: monospace; }
    .status-stopped { color: #fc8181; }
    .status-active { color: #68d391; }
    pre { background: #0d1117; border: 1px solid #2d3748; border-radius: 6px; padding: 12px; font-size: 12px; overflow-x: auto; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .btn { padding: 8px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; border: none; font-weight: 600; }
    .btn-green { background: #276749; color: white; }
    .btn-green:hover { background: #2f855a; }
    .btn-red { background: #9b2c2c; color: white; }
    .btn-red:hover { background: #c53030; }
    .btn-blue { background: #2b6cb0; color: white; }
    .btn-blue:hover { background: #3182ce; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="banner">
    <h1>⚠ TRAKEND OS — SAFE MODE</h1>
    <p>System is running with minimal services for troubleshooting.</p>
    <p style="margin-top:8px;font-size:12px">Docker and Array are stopped. SSH is active.</p>
  </div>

  <div class="grid">
    <div class="card">
      <h2>System Info</h2>
      <div class="row"><span class="label">Hostname</span><span class="value">${info.hostname}</span></div>
      <div class="row"><span class="label">IP Address</span><span class="value">${info.ip}</span></div>
      <div class="row"><span class="label">Uptime</span><span class="value">${info.uptime}</span></div>
      <div class="row"><span class="label">Memory</span><span class="value">${info.memory}</span></div>
      <div class="row"><span class="label">Root Disk</span><span class="value">${info.disk}</span></div>
      <div class="row"><span class="label">Kernel</span><span class="value">${info.kernel}</span></div>
      <div class="row"><span class="label">Docker</span><span class="value status-stopped">${info.dockerStatus}</span></div>
    </div>

    <div class="card">
      <h2>Drives</h2>
      <pre>${info.drives || 'No drives detected'}</pre>
      ${info.smartSummary ? '<h2 style="margin-top:12px">SMART Status</h2><pre>' + info.smartSummary + '</pre>' : ''}
    </div>
  </div>

  <div class="card">
    <h2>Network Interfaces</h2>
    <pre>${info.networkInterfaces}</pre>
  </div>

  <div class="card">
    <h2>Recent Errors (journalctl -p err)</h2>
    <pre>${info.journalErrors}</pre>
  </div>

  <div class="card">
    <h2>Trakend OS Service Logs</h2>
    <pre>${info.trakendLogs}</pre>
  </div>

  <div class="card">
    <h2>Actions</h2>
    <div class="actions">
      <form method="POST" action="/action/boot-normal"><button class="btn btn-green" type="submit">Boot Normal Mode</button></form>
      <form method="POST" action="/action/start-docker"><button class="btn btn-blue" type="submit">Start Docker Only</button></form>
      <form method="POST" action="/action/start-trakend"><button class="btn btn-blue" type="submit">Start Trakend OS</button></form>
      <form method="POST" action="/action/reboot"><button class="btn btn-red" type="submit">Reboot Server</button></form>
      <form method="POST" action="/action/shutdown"><button class="btn btn-red" type="submit">Shutdown Server</button></form>
    </div>
  </div>

  <script>setTimeout(()=>location.reload(), 30000);</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/action/')) {
    const action = req.url.replace('/action/', '');
    try {
      switch (action) {
        case 'boot-normal':
          execSync('rm -f /etc/trakend-safemode');
          execSync('systemctl reboot');
          break;
        case 'start-docker':
          execSync('systemctl start docker');
          break;
        case 'start-trakend':
          execSync('systemctl start docker && systemctl start trakend-os');
          break;
        case 'reboot':
          execSync('systemctl reboot');
          break;
        case 'shutdown':
          execSync('systemctl poweroff');
          break;
      }
    } catch (e) { /* ignore */ }
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  const info = getSystemInfo();
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(renderPage(info));
});

server.listen(PORT, () => {
  console.log(`Trakend OS Safe Mode web UI running on port ${PORT}`);
});
WEBEOF

# Start the minimal web server
node /tmp/trakend-safemode/server.js &

echo -e "  ${GREEN}Safe mode web UI started on port 80${NC}"
echo -e "  ${CYAN}http://${IP}${NC}"
echo ""
echo -e "  To exit safe mode and boot normally:"
echo -e "    ${BOLD}rm /etc/trakend-safemode && reboot${NC}"
echo ""
echo -e "  Or use the web UI to select 'Boot Normal Mode'"
echo ""

# Keep running
wait
