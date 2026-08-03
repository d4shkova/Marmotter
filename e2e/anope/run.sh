#!/usr/bin/env bash
# Runs the Anope-backed InspIRCd for the end-to-end suite.
#
# Two daemons in a fixed order, because Anope cannot link to an ircd that is
# not listening yet. InspIRCd runs in the foreground so that killing this
# script takes the whole thing down with it.
#
# Everything both daemons say goes to stderr rather than into a log file.
# Playwright pipes a web server's stderr into the test output, and the first
# version of this hid a startup failure in a file nobody could reach from a CI
# log — the job failed with a bare exit code and no reason.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run="$here/.run"

"$here/setup.sh" > /dev/null

# `--runasroot` only matters when this runs as root, which is true in some
# containers and not on a CI runner. InspIRCd refuses the flag from a normal
# user, so it is passed only when it applies.
root_flag=()
if [ "$(id -u)" -eq 0 ]; then
  root_flag=(--runasroot)
fi

inspircd --config "$run/inspircd.conf" --nofork "${root_flag[@]}" >&2 &
ircd=$!
trap 'kill $ircd 2>/dev/null || true' EXIT

# Wait for the ircd's server port before starting services.
for _ in $(seq 1 40); do
  if (exec 3<>/dev/tcp/127.0.0.1/17001) 2>/dev/null; then
    exec 3<&- 3>&-
    break
  fi
  if ! kill -0 "$ircd" 2>/dev/null; then
    echo "e2e: InspIRCd exited before it started listening" >&2
    wait "$ircd"
    exit 1
  fi
  sleep 0.5
done

anope --confdir="$run/conf" --dbdir="$run/data" --logdir="$run/logs" \
  --modulesdir=/usr/lib/anope --nofork >&2 &

wait $ircd
