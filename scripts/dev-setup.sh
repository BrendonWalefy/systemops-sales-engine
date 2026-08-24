#!/usr/bin/env bash
set -euo pipefail

# Simple dev setup helper for SystemOps
# Usage: ./scripts/dev-setup.sh [--no-install] [--no-migrate] [--workers]

NO_INSTALL=0
NO_MIGRATE=0
START_WORKERS=0

for arg in "$@"; do
  case "$arg" in
    --no-install) NO_INSTALL=1 ;;
    --no-migrate) NO_MIGRATE=1 ;;
    --workers) START_WORKERS=1 ;;
    --help|-h) echo "Usage: $0 [--no-install] [--no-migrate] [--workers]"; exit 0 ;;
    *) ;;
  esac
done

echo "Starting dev setup..."

if [ "$NO_INSTALL" -eq 0 ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f .env.local ]; then
  if [ -f .env.example ]; then
    cp .env.example .env.local
    echo "Created .env.local from .env.example — edit it to add DATABASE_URL and secrets."
    if [ -n "${EDITOR:-}" ]; then
      $EDITOR .env.local
    else
      echo "Set $EDITOR to open .env.local (e.g. export EDITOR=code)"
    fi
  else
    echo ".env.example not found, create .env.local manually."
  fi
else
  echo ".env.local already exists."
fi

if [ "$NO_MIGRATE" -eq 0 ]; then
  echo "Running migrations..."
  npm run db:migrate
fi

echo "Starting Next dev server..."
if [ "$START_WORKERS" -eq 1 ]; then
  echo "Starting workers in background..."
  npm run dev:workers &>/tmp/systemops-dev-workers.log &
  echo "Workers logs: /tmp/systemops-dev-workers.log"
fi

npm run dev
