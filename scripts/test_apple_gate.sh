#!/usr/bin/env bash
# Guard: the Apple sign-in button must stay behind NEXT_PUBLIC_ENABLE_APPLE_SIGNIN.
#
# Apple is not configured (it needs a paid Developer Program membership, a
# Services ID and a .p8 key). An ungated Apple button is a guaranteed dead end
# in the primary signup flow, which is exactly what R1 is trying to fix — so
# this asserts the gate is still in place.
#
# This is a source guard, not a behavioural test: the repo has no component
# test runner, and a build-output grep can't work because the i18n dictionary
# ships "Continue with Apple" either way. Replace with a render test if a
# component runner is ever added.
set -euo pipefail

FILE="src/components/auth/OAuthButtons.tsx"
FLAG="NEXT_PUBLIC_ENABLE_APPLE_SIGNIN"
fail() { echo "FAIL: $1" >&2; exit 1; }

[ -f "$FILE" ] || fail "$FILE not found"

grep -q "process.env.$FLAG" "$FILE" \
  || fail "$FILE no longer reads $FLAG — the Apple gate was removed"

grep -q 'APPLE_ENABLED && (' "$FILE" \
  || fail "$FILE no longer wraps the Apple button in APPLE_ENABLED"

# The gate must default to hidden: only the exact string "true" opts in.
grep -q "$FLAG === \"true\"" "$FILE" \
  || fail "$FLAG must be compared to \"true\" so an unset/typo'd value stays hidden"

# Google must NOT be gated — it is the configured provider and the primary CTA.
awk '/APPLE_ENABLED && \(/,/^      \)}/' "$FILE" | grep -q 'signIn("google")' \
  && fail "the Google button ended up inside the Apple gate"

echo "PASS: Apple sign-in is gated behind $FLAG (default hidden); Google is ungated"
