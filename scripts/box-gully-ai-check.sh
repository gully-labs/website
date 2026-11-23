#!/bin/sh
# One combined box job for the Gully AI hardening PR: install, typecheck, lint, the ask/telegram/status/legal tests, a
# production build and the real-browser shots, all inside the Playwright image (3 GB, 2 CPUs). Run through agent-slot:
#   /srv/tmp/agent-slot.sh sh scripts/box-gully-ai-check.sh <dir-with-the-source>
set -u
D="${1:?dir}"
exec timeout 2400 docker run --rm --memory 3g --cpus 2 -v "$D":/w -w /w -e CI=1 -e SHOTS_DIR=/w/shots-out -e TEST_PORT=5311 mcr.microsoft.com/playwright:v1.63.0-noble sh -c '
set -u
fail=0
step() { echo "=== $1"; shift; "$@" || { echo "STEP FAILED: $*"; fail=1; }; }
npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000 >/tmp/npm.log 2>&1 || { tail -5 /tmp/npm.log; echo "npm ci failed"; exit 1; }
step tsc node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
step eslint node node_modules/eslint/bin/eslint.js src/pages/admin src/docs src/components/ask src/components/holders/parts.tsx server/ask*.mjs server/status.mjs server/telegram-ui.mjs scripts/test-ask-knowledge.mjs scripts/load-ask-fake.mjs scripts/shot-gully-ai-console.mjs
for t in test-ask test-ask-coverage test-legal test-hosts test-public-error; do step $t node scripts/$t.mjs; done
step test-ask-knowledge node --test scripts/test-ask-knowledge.mjs
for t in test-telegram test-tg-miniapp test-tg-relay test-status; do [ -f scripts/$t.mjs ] && step $t node scripts/$t.mjs; done
step seo-audit node scripts/test-seo-audit.mjs
step ask-index-check node scripts/build-ask-index.mjs --check
step vite-build node node_modules/vite/bin/vite.js build
step shots node scripts/shot-gully-ai-console.mjs
echo "ALL DONE fail=$fail"
exit $fail
'
