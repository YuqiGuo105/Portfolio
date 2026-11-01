#!/bin/bash
# Rebuild one production commit of the homepage and capture it. See README.md.
# Usage: run-one.sh <sha> <yyyy-mm-dd> [port]
# Env: HISTORY_REPO (a full clone), WORK (scratch dir), NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
# (the public values the site ships; requests to Supabase are answered locally by capture.cjs).
set -u
SHA=$1; DATE=$2; PORT=${3:-4101}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${HISTORY_REPO:?set HISTORY_REPO to a full clone of the site}
WORK=${WORK:-/tmp/site-history}
OUT=$WORK/shots
mkdir -p "$WORK/worktrees" "$WORK/node_modules" "$OUT"
WT=$WORK/worktrees/$SHA
[ -d "$WT" ] || git -C "$REPO" worktree add -q --detach "$WT" "$SHA"
# One node_modules per lockfile, shared by every commit that uses it.
LOCK=$(sha1sum "$WT/package-lock.json" | cut -c1-12)
NM=$WORK/node_modules/$LOCK
if [ ! -d "$NM/node_modules" ]; then
  mkdir -p "$NM" && cp "$WT/package.json" "$WT/package-lock.json" "$NM/"
  (cd "$NM" && (npm ci --no-audit --no-fund --loglevel=error || npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)) > "$OUT/$SHA-npm.log" 2>&1
fi
rm -rf "$WT/node_modules" && ln -s "$NM/node_modules" "$WT/node_modules"
cd "$WT"
NEXT_TELEMETRY_DISABLED=1 setsid node node_modules/next/dist/bin/next dev -p "$PORT" > "$OUT/$SHA-dev.log" 2>&1 &
PID=$!
for i in $(seq 1 90); do grep -q "started server" "$OUT/$SHA-dev.log" && break; sleep 2; done
curl -s -o /dev/null --max-time 400 "http://localhost:$PORT/"
node "$HERE/capture.cjs" "$PORT" "$SHA" "$DATE" "$OUT"
RC=$?
kill -- -"$PID" 2>/dev/null; kill "$PID" 2>/dev/null
exit $RC
