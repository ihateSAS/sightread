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
  body=$(mktemp)
  code=$(curl -sS --max-time 30 -o "$body" -w '%{http_code}' \
    https://api.cerebras.ai/v1/models \
    -H "Authorization: Bearer $CEREBRAS_API_KEY")
  models=$(cat "$body")
  rm -f "$body"
  if command -v jq >/dev/null 2>&1; then
    ids=$(printf '%s' "$models" | jq -r '.data[]?.id' 2>/dev/null)
  else
    ids=$(printf '%s' "$models" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  fi

  if [ "$code" = "429" ] || printf '%s' "$models" | grep -q 'error code: 1015'; then
    note "SKIPPED: /v1/models is rate-limited at the edge (HTTP $code, Cloudflare 1015)."
    note "         That is not a key failure. Section 3 proves the key authenticates."
  elif [ "$code" = "401" ] || [ "$code" = "403" ]; then
    note "FAILED: the key was rejected (HTTP $code)."
    printf '%s\n' "$models" | head -c 500
    fail=1
  elif [ -z "$ids" ]; then
    note "FAILED: could not read model list (HTTP $code). Raw response:"
    printf '%s\n' "$models" | head -c 500
    fail=1
  else
    printf '%s\n' "$ids" | sed 's/^/  - /'
    # The org-assigned ID is not always the friendly name: the event endpoint is
    # advertised as moonshotai-kimi-k3.1-pro-test. Match on the substring and use
    # whatever ID the catalog actually prints.
    kimi_ids=$(printf '%s\n' "$ids" | grep -i 'kimi' || true)
    if [ -n "$kimi_ids" ]; then
      note "ok: kimi is listed for your org:"
      printf '%s\n' "$kimi_ids" | sed 's/^/      /'
      note "   -> SIGHTREAD_MODEL=cerebras/$(printf '%s' "$kimi_ids" | head -1)"
    else
      note "NOTE: no kimi id in your list yet."
      note "      Expected before capacity lands. Re-run this at kickoff; the token"
      note "      table below is the part that tells you if it is live."
    fi
  fi
fi

section "3. Does kimi actually answer? (listing is not access)"
if [ -n "${CEREBRAS_API_KEY:-}" ]; then
  kimi_live=0
  for cand in ${SIGHTREAD_MODEL:-} ${CEREBRAS_KIMI_CANDIDATES:-moonshotai-kimi-k3.1-pro-test moonshotai-kimi-k3.1-pro kimi-k3.1-pro kimi-k2-thinking}; do
    cand=${cand#cerebras/}
    [ -z "$cand" ] && continue
    t0=$(date +%s%N)
    code=$(curl -sS --max-time 30 -o /tmp/kimi-probe.json -w '%{http_code}' \
      https://api.cerebras.ai/v1/chat/completions \
      -H "Authorization: Bearer $CEREBRAS_API_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"model\":\"$cand\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: READY\"}],\"max_tokens\":16}")
    ms=$(( ($(date +%s%N) - t0) / 1000000 ))
    if [ "$code" = "200" ]; then
      note "  LIVE  $cand  (HTTP 200, ${ms}ms)"
      note "        -> SIGHTREAD_MODEL=cerebras/$cand"
      kimi_live=1
    else
      note "  --    $cand  (HTTP $code: $(head -c 120 /tmp/kimi-probe.json 2>/dev/null))"
    fi
  done
  rm -f /tmp/kimi-probe.json
  if [ "$kimi_live" = "0" ]; then
    note "NOTE: no kimi id answered. The app stays on the qwen fallback and says so"
    note "      on screen, which is correct, not a failure. Re-run when the limit"
    note "      key lands."
  fi
fi

section "4. Raw API speed (server-side tok/s)"
if [ -n "${CEREBRAS_API_KEY:-}" ]; then
  model="${CEREBRAS_SMOKE_MODEL:-gpt-oss-120b}"
  note "measuring $model ..."
  node openclaw/skills/kimi-speed-lab/tps.mjs \
    --model "$model" --reasoning low --max-tokens 1200 --runs 2 || fail=1
fi

section "5. OpenClaw harness"
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

section "6. End-to-end agent turn"
if command -v openclaw >/dev/null 2>&1 && [ -n "${CEREBRAS_API_KEY:-}" ]; then
  smoke="${CEREBRAS_SMOKE_MODEL:-gpt-oss-120b}"
  case "$smoke" in cerebras/*) ;; *) smoke="cerebras/$smoke" ;; esac
  note "running one embedded agent turn on $smoke (no gateway required)..."
  # Capture instead of piping straight to tail: the turn has to be checked for
  # the reply, otherwise a crash still reads as PASS at the bottom of this run.
  reply=$(openclaw agent exec "Reply with exactly: harness green" \
    --model "$smoke" \
    --thinking low --timeout 120 2>&1)
  printf '%s\n' "$reply" | tail -5
  note ""
  if printf '%s' "$reply" | grep -q "harness green"; then
    note "ok: the turn returned 'harness green'. OpenClaw is driving Cerebras."
  elif printf '%s' "$reply" | grep -qE "database or disk is full|disk I/O error|ERR_SQLITE_ERROR"; then
    note "FAILED: the turn never ran. OpenClaw's state database is failing with a disk"
    note "        I/O error, which means the machine is out of space, not the key."
    note "        Free space on the boot volume (df -h /), then re-run."
    fail=1
  else
    note "FAILED: the turn did not return 'harness green'. Read the output above."
    fail=1
  fi
fi

printf '\n'
if [ "$fail" -eq 0 ]; then
  note "pre-flight: PASS"
else
  note "pre-flight: NEEDS ATTENTION (see above)"
fi
exit "$fail"
