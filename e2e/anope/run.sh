#!/usr/bin/env bash
# Runs the Anope-backed InspIRCd for the end-to-end suite.
#
# Two daemons in a fixed order, because Anope cannot link to an ircd that is
# not listening yet. InspIRCd runs in the foreground so that killing this
# script takes the whole thing down with it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run="$here/.run"

"$here/setup.sh" > /dev/null

inspircd --config "$run/inspircd.conf" --nofork --runasroot > "$run/inspircd.log" 2>&1 &
ircd=$!
trap 'kill $ircd 2>/dev/null || true' EXIT

# Wait for the ircd's server port before starting services.
for _ in $(seq 1 30); do
  if (exec 3<>/dev/tcp/127.0.0.1/17001) 2>/dev/null; then
    exec 3<&- 3>&-
    break
  fi
  sleep 0.5
done

anope --confdir="$run/conf" --dbdir="$run/data" --logdir="$run/logs" \
  --modulesdir=/usr/lib/anope --nofork >> "$run/anope.log" 2>&1 &

wait $ircd
