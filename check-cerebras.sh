#!/usr/bin/env bash
# Pre-flight check for the hackathon. Run from this directory.
#   ./check-cerebras.sh
# Reads CEREBRAS_API_KEY from the environment (or a local .env).
set -uo pipefail

cd "$(dirname "$0")" || exit 1
[ -f .env ] && set -a && . ./.env && set +a

fail=0
note() { printf '%s\n' "$*"; }
section() { printf '\n=== %s ===\n' "$*"; }

section "1. API key"
if [ -z "${CEREBRAS_API_KEY:-}" ]; then
  note "MISSING: CEREBRAS_API_KEY is not set."
  note "  export CEREBRAS_API_KEY=csk-...   (or put it in kimi-hackathon/.env)"
  fail=1
else
  note "ok: key present (${#CEREBRAS_API_KEY} chars, prefix ${CEREBRAS_API_KEY:0:4}...)"
fi

section "2. Models visible to your org"
if [ -n "${CEREBRAS_API_KEY:-}" ]; then
  models=$(curl -sS --max-time 30 https://api.cerebras.ai/v1/models \
    -H "Authorization: Bearer $CEREBRAS_API_KEY")
  if command -v jq >/dev/null 2>&1; then
    ids=$(printf '%s' "$models" | jq -r '.data[]?.id' 2>/dev/null)
  else
    ids=$(printf '%s' "$models" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  fi

  if [ -z "$ids" ]; then
    note "FAILED: could not read model list. Raw response:"
    printf '%s\n' "$models" | head -c 500
    fail=1
  else
    printf '%s\n' "$ids" | sed 's/^/  - /'
    if printf '%s\n' "$ids" | grep -qx 'kimi-k3.1-pro'; then
      note "ok: kimi-k3.1-pro is available to your org."
    else
      note "NOTE: kimi-k3.1-pro is not in your list yet."
      note "      Expected if your capacity request (due Fri Nov 20, 7:00 PM PT) has not"
      note "      been processed. Use gpt-oss-120b to prove the harness in the meantime,"
      note "      and re-run this at kickoff. If the org-assigned endpoint ID differs,"
      note "      use the ID printed above in the config."
    fi
  fi
fi

section "3. Raw API speed (server-side tok/s)"
if [ -n "${CEREBRAS_API_KEY:-}" ]; then
  model="${CEREBRAS_SMOKE_MODEL:-gpt-oss-120b}"
  note "measuring $model ..."
  node openclaw/skills/kimi-speed-lab/tps.mjs \
    --model "$model" --reasoning low --max-tokens 1200 --runs 2 || fail=1
fi

section "4. OpenClaw harness"
if command -v openclaw >/dev/null 2>&1; then
  note "ok: $(openclaw --version 2>&1 | head -1)"
  note "-- configured models for cerebras --"
  openclaw models list --provider cerebras 2>&1 | head -20
  note ""
  note "-- config file --"
  openclaw config file 2>&1 | head -3
else
  note "MISSING: openclaw not on PATH."
  fail=1
fi

section "5. End-to-end agent turn"
if command -v openclaw >/dev/null 2>&1 && [ -n "${CEREBRAS_API_KEY:-}" ]; then
  note "running one embedded agent turn (no gateway required)..."
  openclaw agent exec "Reply with exactly: harness green" \
    --model "${CEREBRAS_SMOKE_MODEL:-gpt-oss-120b}" \
    --thinking low --timeout 120 2>&1 | tail -5
  note ""
  note "If that printed 'harness green', OpenClaw is driving Cerebras. Nothing else matters today."
fi

printf '\n'
if [ "$fail" -eq 0 ]; then
  note "pre-flight: PASS"
else
  note "pre-flight: NEEDS ATTENTION (see above)"
fi
exit "$fail"
