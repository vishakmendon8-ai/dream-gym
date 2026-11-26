#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==================================================================="
echo "  Dream Gym - Secureye Local LAN Bridge (Port 8080)"
echo "==================================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js 22+ is required. Install from https://nodejs.org/"
  exit 1
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
fi

if [ ! -d "node_modules" ]; then
  echo "Installing bridge dependencies (first run only)..."
  npm install
fi

exec npm start
