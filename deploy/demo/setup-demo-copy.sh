#!/usr/bin/env bash
# Builds a private DEMO copy of Texzium ERP on this server, next to live:
#
#   database  texzium_demo        a clone of the live database (live is only READ)
#   backend   /root/texzium-demo/backend    127.0.0.1:3002   unit texzium-demo-backend
#   frontend  /root/texzium-demo/frontend   127.0.0.1:3102   unit texzium-demo-frontend
#
# The copy cannot reach the outside world: e-mail (SMTP), WhatsApp, the payment
# gateway and connectors are switched off in the cloned database, and it uses no
# shared job queue. Each copy has its own node_modules (never a link to live's), its
# own login secret and its own content folder. Live files, services, database and
# document numbers are not changed.
#
# Run as root on the server, from the live backend folder:
#   bash deploy/demo/setup-demo-copy.sh            first time
#   bash deploy/demo/setup-demo-copy.sh --reset    throw the demo copy away and rebuild it
set -euo pipefail

LIVE=/root/texzium-erp
DEMO=/root/texzium-demo
DEMO_DB=texzium_demo
BE_PORT=3002
FE_PORT=3102
LOOPBACK=/root/backups/bind_loopback_20261008_165548.js
RESET=${1:-}

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -f "$LIVE/backend/.env" ] || die "$LIVE/backend/.env not found"
[ -f "$LOOPBACK" ] || die "$LOOPBACK not found"

# The live database URL, read from .env without executing it.
LIVE_URL=$(grep -E '^DATABASE_URL=' "$LIVE/backend/.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
[ -n "$LIVE_URL" ] || die "DATABASE_URL not found in live .env"
LIVE_PG=${LIVE_URL%%\?*}
LIVE_DB=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$LIVE_PG")
[ "$LIVE_DB" != "$DEMO_DB" ] || die "the live database is called $DEMO_DB; refusing"
DEMO_PG=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "$LIVE_PG" "$DEMO_DB")
ADMIN_PG=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/postgres";console.log(u.toString())' "$LIVE_PG")
DB_USER=$(node -e 'console.log(decodeURIComponent(new URL(process.argv[1]).username))' "$LIVE_PG")

# Old scratch services from October use the same ports.
for unit in texzium-enh-scratch-be texzium-enh-scratch-fe; do
  if systemctl list-unit-files "$unit.service" >/dev/null 2>&1 && systemctl is-active --quiet "$unit"; then
    say "stopping the old scratch service $unit (it used port $BE_PORT/$FE_PORT)"
    systemctl stop "$unit"; systemctl disable "$unit" >/dev/null 2>&1 || true
  fi
done
for port in $BE_PORT $FE_PORT; do
  if ss -ltn "sport = :$port" | grep -q LISTEN && ! systemctl is-active --quiet texzium-demo-backend texzium-demo-frontend; then
    die "port $port is already in use by something else: $(ss -ltnp "sport = :$port" | tail -1)"
  fi
done

if [ "$RESET" = "--reset" ]; then
  say "removing the old demo copy"
  systemctl stop texzium-demo-frontend texzium-demo-backend 2>/dev/null || true
  rm -rf "$DEMO"
  psql "$ADMIN_PG" -q -c "DROP DATABASE IF EXISTS $DEMO_DB" 2>/dev/null ||
    su - postgres -c "psql -q -c 'DROP DATABASE IF EXISTS $DEMO_DB'"
elif [ -d "$DEMO" ]; then
  die "$DEMO already exists. Use --reset to rebuild the demo copy from scratch."
fi

say "1/6 cloning the live database into $DEMO_DB (live is only read)"
if ! psql "$ADMIN_PG" -q -c "CREATE DATABASE $DEMO_DB" 2>/dev/null; then
  su - postgres -c "psql -q -c 'CREATE DATABASE $DEMO_DB OWNER \"$DB_USER\"'"
fi
pg_dump -Fc "$LIVE_PG" | pg_restore --no-owner --no-acl -d "$DEMO_PG"

say "2/6 switching off e-mail, WhatsApp, payment gateway and connectors in the demo database"
psql "$DEMO_PG" -v ON_ERROR_STOP=1 -q <<'SQL'
UPDATE "CompanySMTPConfig"    SET "isActive" = false, "smtpHost" = '127.0.0.1', "smtpPort" = 1, "smtpPass" = 'demo-disabled';
UPDATE "WhatsAppConfig"       SET "isActive" = false, "accessToken" = 'demo-disabled', "webhookToken" = NULL;
UPDATE "WhatsAppBotConfig"    SET "isActive" = false;
UPDATE "PaymentGatewayConfig" SET "isActive" = false, "apiKey" = NULL, "secretKey" = NULL;
UPDATE "Connector"            SET "status" = 'INACTIVE', "apiKey" = NULL, "apiSecret" = NULL, "webhookUrl" = NULL;
SQL

say "3/6 copying the code (own folders, own node_modules)"
mkdir -p "$DEMO" "$DEMO/content"
git clone -q "$LIVE/backend" "$DEMO/backend"
git -C "$DEMO/backend" checkout -q "$(git -C "$LIVE/backend" rev-parse HEAD)"
git clone -q "$LIVE/frontend" "$DEMO/frontend"
git -C "$DEMO/frontend" checkout -q "$(git -C "$LIVE/frontend" rev-parse HEAD)"
cp -a "$LIVE/backend/node_modules" "$DEMO/backend/node_modules"
cp -a "$LIVE/frontend/node_modules" "$DEMO/frontend/node_modules"

JWT=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')
cat > "$DEMO/backend/.env" <<ENV
# DEMO copy only. Written by deploy/demo/setup-demo-copy.sh.
DATABASE_URL="$DEMO_PG"
PORT=$BE_PORT
JWT_SECRET=$JWT
CONTENT_STORAGE_DIR=$DEMO/content
DATA_DELETION_AUTOPURGE=off
# no shared job queue, no WhatsApp: point them at a port nothing listens on
REDIS_HOST=127.0.0.1
REDIS_PORT=1
WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:1
WHATSAPP_APP_SECRET=demo-disabled
ENV
chmod 600 "$DEMO/backend/.env"

say "4/6 building the demo backend"
( cd "$DEMO/backend" && npx prisma generate >/dev/null && npm run build >/dev/null )

say "5/6 building the demo frontend (talks to the demo backend only)"
( cd "$DEMO/frontend" && BACKEND_API_URL=http://127.0.0.1:$BE_PORT npm run build >/dev/null )

say "6/6 starting the demo services"
cat > /etc/systemd/system/texzium-demo-backend.service <<UNIT
[Unit]
Description=Texzium ERP DEMO backend (127.0.0.1:$BE_PORT)
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=$DEMO/backend
EnvironmentFile=$DEMO/backend/.env
ExecStart=/usr/bin/node -r $LOOPBACK dist/main
Restart=on-failure
RestartSec=5
StandardOutput=append:/root/texzium-demo-backend.log
StandardError=append:/root/texzium-demo-backend.log

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/texzium-demo-frontend.service <<UNIT
[Unit]
Description=Texzium ERP DEMO frontend (127.0.0.1:$FE_PORT)
After=texzium-demo-backend.service

[Service]
Type=simple
WorkingDirectory=$DEMO/frontend
Environment=BACKEND_API_URL=http://127.0.0.1:$BE_PORT
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $FE_PORT
Restart=on-failure
RestartSec=5
StandardOutput=append:/root/texzium-demo-frontend.log
StandardError=append:/root/texzium-demo-frontend.log

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now texzium-demo-backend texzium-demo-frontend >/dev/null 2>&1
for i in $(seq 1 40); do
  sleep 2
  be=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$BE_PORT/users" || true)
  fe=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FE_PORT/login" || true)
  [ "$be" = 401 ] && [ "$fe" = 200 ] && break
done
echo "demo backend  127.0.0.1:$BE_PORT -> $be (401 expected)"
echo "demo frontend 127.0.0.1:$FE_PORT -> $fe (200 expected)"
[ "$be" = 401 ] && [ "$fe" = 200 ] || die "the demo services did not come up; see /root/texzium-demo-*.log"
echo
echo "Demo copy ready. Next: bash deploy/demo/load-demo-data.sh"
