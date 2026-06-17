#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <cron-endpoint-url>" >&2
  exit 64
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "CRON_SECRET is not set" >&2
  exit 64
fi

url="$1"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

status_code="$(
  curl --silent --show-error --location \
    --request GET "$url" \
    --header "Authorization: Bearer ${CRON_SECRET}" \
    --output "$response_file" \
    --write-out "%{http_code}"
)"

echo "HTTP ${status_code} ${url}"

if [[ -s "$response_file" ]]; then
  if jq . "$response_file" >/dev/null 2>&1; then
    jq . "$response_file"
  else
    cat "$response_file"
  fi
else
  echo "(empty response body)"
fi

if [[ ! "$status_code" =~ ^2 ]]; then
  exit 1
fi
