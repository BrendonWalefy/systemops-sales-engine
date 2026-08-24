#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=${1:-.env.local}
echo "Validating $ENV_FILE"

if [ ! -f "$ENV_FILE" ]; then
  echo "File $ENV_FILE not found" >&2
  exit 2
fi

required=(DATABASE_URL SESSION_SECRET)
missing=()
while IFS= read -r line; do
  # skip comments and empty
  [[ "$line" =~ ^# ]] && continue
  [[ -z "$line" ]] && continue
  if [[ ! "$line" =~ =[[:print:]] ]]; then
    echo "Warning: suspicious line (no '=' found): $line"
  fi
done < "$ENV_FILE"

for k in "${required[@]}"; do
  if ! grep -q "^$k=" "$ENV_FILE"; then
    missing+=($k)
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing required vars: ${missing[*]}" >&2
  exit 3
fi

echo "Basic validation passed. Check for concatenated lines or malformed PEMs manually if present."
exit 0
