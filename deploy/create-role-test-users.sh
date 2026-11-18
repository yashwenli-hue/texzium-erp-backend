#!/usr/bin/env bash
# Creates one test user for each RevenueOS business role (PRE_SALES, SALES,
# SALES_MANAGER, FINANCE) through the running backend, signed in as an administrator.
# Passwords are typed at the prompt and never shown, stored or put on the command line.
#
# Run on the server after 20261118_revenueos_business_roles.sql is applied and the
# backend restarted:   bash deploy/create-role-test-users.sh
set -euo pipefail

API="${API:-http://127.0.0.1:3000}"
DOMAIN="${TEST_USER_DOMAIN:-texzium.test}"

read -rp "Administrator email: " ADMIN_EMAIL
read -rsp "Administrator password: " ADMIN_PASSWORD; echo
read -rsp "Password to give the 4 test users (8+ characters): " TEST_PASSWORD; echo
[ "${#TEST_PASSWORD}" -ge 8 ] || { echo "The test password must be at least 8 characters."; exit 1; }

json() { node -e 'process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(a=>{const i=a.indexOf("=");return [a.slice(0,i),a.slice(i+1)]}))))' "$@"; }

TOKEN=$(curl -sS -H 'Content-Type: application/json' \
  -d "$(json email="$ADMIN_EMAIL" password="$ADMIN_PASSWORD")" "$API/auth/login" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.access_token){console.error("Sign-in failed: "+(r.message||s));process.exit(1)}process.stdout.write(r.access_token)})')

ROLES=$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/roles")
node -e 'const r=JSON.parse(process.argv[1]);if(!Array.isArray(r)){console.error("Cannot list roles: "+(r.message||JSON.stringify(r))+" (the administrator needs roles.view; sign in again after the roles SQL)");process.exit(1)}' "$ROLES"

USERS=$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/users")

for spec in "PRE_SALES:Test Presales:presales" "SALES:Test Sales:sales" \
            "SALES_MANAGER:Test Sales Manager:salesmanager" "FINANCE:Test Finance:finance"; do
  IFS=: read -r ROLE NAME LOCAL <<<"$spec"
  ROLE_ID=$(node -e 'const r=JSON.parse(process.argv[1]);const x=r.find(x=>x.name===process.argv[2]);process.stdout.write(x?x.id:"")' "$ROLES" "$ROLE")
  if [ -z "$ROLE_ID" ]; then echo "$ROLE: role not found (apply the roles SQL first)"; continue; fi
  if node -e 'const u=JSON.parse(process.argv[1]);process.exit((Array.isArray(u)?u:[]).some(x=>String(x.email).toLowerCase()===process.argv[2])?0:1)' "$USERS" "$LOCAL@$DOMAIN"; then
    echo "$ROLE: $LOCAL@$DOMAIN already exists, left as it is"; continue
  fi
  CODE=$(curl -sS -o /tmp/create-user.out -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$(json fullName="$NAME" email="$LOCAL@$DOMAIN" password="$TEST_PASSWORD" roleId="$ROLE_ID")" \
    "$API/users")
  case "$CODE" in
    201) echo "$ROLE: created $LOCAL@$DOMAIN" ;;
    *)   echo "$ROLE: not created ($CODE) $(head -c 300 /tmp/create-user.out)" ;;
  esac
done
rm -f /tmp/create-user.out
echo "Done. Sign in as each test user in the app (all share the password you typed)."
