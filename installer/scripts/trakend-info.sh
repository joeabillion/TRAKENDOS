#!/bin/bash
# /etc/profile.d/trakend-info.sh — shown at interactive login
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
[ -z "$IP" ] && IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo -e "  Web UI: \033[1;36mhttp://${IP:-<no-ip>}\033[0m"
echo ""
