#!/usr/bin/env bash
# Loads the demo story into the DEMO copy (127.0.0.1:3002) as the four test users.
# Asks for the test users' password at a hidden prompt. Safe to run again: it stops
# if the story is already there.
set -euo pipefail
cd "$(dirname "$0")/../.."
read -rsp "Test users' password: " DEMO_PASSWORD; echo
DEMO_PASSWORD="$DEMO_PASSWORD" API=http://127.0.0.1:3002 node deploy/demo/seed-demo-data.mjs
echo
echo "Open it from your PC:  ssh -L 3102:127.0.0.1:3102 root@<server>   then  http://localhost:3102"
