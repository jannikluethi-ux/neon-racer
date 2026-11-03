#!/bin/sh
set -eu
# Resolve from this file, so `sh startup.sh` works from any working directory
# and from a checkout that is not the machine that first wrote the script.
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
nohup npm run dev >>/tmp/app-startup.log 2>&1 </dev/null &
