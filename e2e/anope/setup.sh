#!/usr/bin/env bash
# Prepares the Anope-backed InspIRCd used by the second half of Phase 6's
# acceptance run.
#
# Both daemons resolve paths against their own compiled-in directories rather
# than against the config they were handed, so the configs in this directory
# carry an `@ROOT@` placeholder and are rendered into `.run/` with absolute
# paths. Nothing in `.run/` is committed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
here="$root/e2e/anope"
run="$here/.run"

# Anope resolves its config as `<dir>/conf/services.conf` and will not take a
# path, so it gets a directory laid out the way it expects.
mkdir -p "$run/conf" "$run/logs" "$run/data"

sed "s|@ROOT@|$root|g" "$here/inspircd.conf" > "$run/inspircd.conf"
sed "s|@ROOT@|$root|g" "$here/services.conf" > "$run/conf/services.conf"

# Anope resolves an `include` against its own conf directory, so the packaged
# service definitions are linked in beside it rather than restated.
for packaged in modules nickserv chanserv hostserv operserv global; do
  ln -sf "/etc/anope/$packaged.conf" "$run/conf/$packaged.conf"
done

echo "rendered $run/inspircd.conf and $run/conf/services.conf"
