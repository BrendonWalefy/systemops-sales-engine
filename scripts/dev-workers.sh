#!/usr/bin/env bash
#
# Simula localmente os workers que em produção rodam via Vercel Cron
# (message-worker, sender-worker). Sem isso, mensagens de webhook enfileiradas
# em `npm run dev` local nunca são processadas — a IA nunca responde.
#
# Uso: rode em paralelo com `npm run dev`, antes de qualquer teste E2E local
# (scripts/e2e-webhook-test.ts ou a suíte OmniQA):
#
#   npx dotenv -e .env.local -- ./scripts/dev-workers.sh
#
set -euo pipefail

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "CRON_SECRET is not set (rode via dotenv -e .env.local)" >&2
  exit 64
fi

BASE_URL="${SYSTEMOPS_BASE_URL:-http://localhost:3000}"
INTERVAL="${DEV_WORKERS_INTERVAL_SECONDS:-1.5}"

echo "Simulando cron workers locais contra ${BASE_URL} (intervalo ${INTERVAL}s). Ctrl+C para parar."

while true; do
  curl -s -o /dev/null -H "Authorization: Bearer ${CRON_SECRET}" "${BASE_URL}/api/cron/message-worker"
  curl -s -o /dev/null -H "Authorization: Bearer ${CRON_SECRET}" "${BASE_URL}/api/cron/sender-worker"
  sleep "${INTERVAL}"
done
