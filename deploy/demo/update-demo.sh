#!/usr/bin/env bash
# Moves the DEMO copy (/root/texzium-demo) to a backend branch and a frontend branch
# from GitHub, to try new work before it goes live:
#   - fetches both branches into the live repositories (fetch only: live's checked-out
#     code, build and services are not touched),
#   - checks them out in the demo copy,
#   - applies the branch's NEW manual migrations to the DEMO database only,
#   - builds and tests both, and restarts the two demo services.
#
#   bash deploy/demo/update-demo.sh <backend-branch> <frontend-branch>
#   e.g. bash deploy/demo/update-demo.sh presales-bant presales-bant
set -euo pipefail

BE_BRANCH=${1:?backend branch}
FE_BRANCH=${2:?frontend branch}
LIVE=/root/texzium-erp
DEMO=/root/texzium-demo

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

[ -d "$DEMO/backend" ] && [ -d "$DEMO/frontend" ] ||
  die "no demo copy at $DEMO: run  bash $LIVE/backend/deploy/demo/setup-demo-copy.sh  first"

DEMO_PG=$(grep -E '^DATABASE_URL=' "$DEMO/backend/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
DEMO_PG=${DEMO_PG%%\?*}
case "$DEMO_PG" in */texzium_demo) ;; *) die "the demo .env does not point at texzium_demo";; esac

say "1/5 fetching $BE_BRANCH and $FE_BRANCH from GitHub (live is only fetched into, not changed)"
git -C "$LIVE/backend" fetch -q origin "$BE_BRANCH"
git -C "$LIVE/frontend" fetch -q origin "$FE_BRANCH"

say "2/5 backend: $BE_BRANCH"
cd "$DEMO/backend"
OLD=$(git rev-parse HEAD)
git fetch -q "$LIVE/backend" "refs/remotes/origin/$BE_BRANCH"
git checkout -q -B "demo-$BE_BRANCH" FETCH_HEAD
NEW=$(git rev-parse HEAD)
echo "   $(git log --oneline -1)"
MIGRATIONS=$(git diff --name-only --diff-filter=A "$OLD" "$NEW" -- 'prisma/manual-migrations/*.sql' | sort)
for f in $MIGRATIONS; do
  echo "   applying $f to the demo database"
  psql "$DEMO_PG" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true
done
[ -n "$MIGRATIONS" ] || echo "   no new migrations"
npx prisma generate >/dev/null
npm run build >/tmp/demo-backend-build.log 2>&1 || { tail -20 /tmp/demo-backend-build.log; die "backend build failed"; }
systemctl restart texzium-demo-backend

say "3/5 frontend: $FE_BRANCH"
cd "$DEMO/frontend"
git fetch -q "$LIVE/frontend" "refs/remotes/origin/$FE_BRANCH"
git checkout -q -B "demo-$FE_BRANCH" FETCH_HEAD
echo "   $(git log --oneline -1)"

say "4/5 frontend checks: typecheck, tests, build"
npm run typecheck >/tmp/demo-fe-typecheck.log 2>&1 || { tail -30 /tmp/demo-fe-typecheck.log; die "typecheck failed"; }
echo "   typecheck ok"
npm test >/tmp/demo-fe-test.log 2>&1 || { grep -E "^not ok|^# (pass|fail)" /tmp/demo-fe-test.log; die "frontend tests failed (full log: /tmp/demo-fe-test.log)"; }
grep -E "^# (pass|fail)" /tmp/demo-fe-test.log | sed 's/^/   /'
BACKEND_API_URL=http://127.0.0.1:3002 npm run build >/tmp/demo-fe-build.log 2>&1 || { tail -30 /tmp/demo-fe-build.log; die "frontend build failed"; }
echo "   build ok"
systemctl restart texzium-demo-frontend

say "5/5 checking the demo services"
for i in $(seq 1 40); do
  sleep 2
  be=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/users || true)
  fe=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3102/login || true)
  [ "$be" = 401 ] && [ "$fe" = 200 ] && break
done
echo "   demo backend 3002 -> $be (401 expected), demo frontend 3102 -> $fe (200 expected)"
[ "$be" = 401 ] && [ "$fe" = 200 ] || die "a demo service did not come up; see /root/texzium-demo-*.log"
echo
echo "Demo copy is on backend $BE_BRANCH and frontend $FE_BRANCH."
