#!/usr/bin/env bash
# T0.4 regression test — /api/push fail-closed contract (AUD#4).
# Needs a completed `next build` in the working directory. No database
# required: every asserted path returns before any Supabase call.
set -euo pipefail

PORT="${PUSH_TEST_PORT:-4310}"
BASE="http://127.0.0.1:${PORT}"
SERVER_PID=""

start_server() {
  # $@ = extra env VAR=value pairs for this server instance. Combining
  # `env -u NAME` with `NAME=value` behaves differently across coreutils
  # versions (GNU vs BSD), so branch cleanly: no args → run with the
  # secret unset; args → run with exactly those assignments.
  if [ "$#" -eq 0 ]; then
    env -u PUSH_WEBHOOK_SECRET npx next start -p "$PORT" >/dev/null 2>&1 &
  else
    env "$@" npx next start -p "$PORT" >/dev/null 2>&1 &
  fi
  SERVER_PID=$!
  for _ in $(seq 1 120); do
    if curl -s -o /dev/null "$BASE"; then return 0; fi
    sleep 0.5
  done
  echo "FAIL: next start did not come up on :$PORT" >&2
  exit 1
}

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}
trap stop_server EXIT

assert_status() {
  local expected="$1"; shift
  local label="$1"; shift
  local actual
  actual=$(curl -s -o /dev/null -w '%{http_code}' "$@")
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label — expected HTTP $expected, got $actual" >&2
    exit 1
  fi
  echo "PASS: $label ($expected)"
}

echo "=== /api/push with PUSH_WEBHOOK_SECRET unset (must fail closed) ==="
start_server
assert_status 500 "unset secret → 500, even with a well-formed body" \
  -X POST "$BASE/api/push" -H 'Content-Type: application/json' \
  -d '{"user_id":"x","title":"spoof","body":"click here"}'
stop_server

echo "=== /api/push with PUSH_WEBHOOK_SECRET set ==="
start_server PUSH_WEBHOOK_SECRET=test-secret-for-ci
assert_status 401 "no Authorization header → 401" \
  -X POST "$BASE/api/push" -H 'Content-Type: application/json' -d '{"id":"x"}'
assert_status 401 "wrong bearer → 401" \
  -X POST "$BASE/api/push" -H 'Authorization: Bearer wrong' \
  -H 'Content-Type: application/json' -d '{"id":"x"}'
assert_status 400 "correct bearer, body without notification id → 400 (content fields alone are never trusted)" \
  -X POST "$BASE/api/push" -H 'Authorization: Bearer test-secret-for-ci' \
  -H 'Content-Type: application/json' -d '{"user_id":"x","title":"spoof"}'
stop_server

echo "ALL PUSH ROUTE TESTS PASSED"
