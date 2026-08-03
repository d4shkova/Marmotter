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

# The service definitions and command mappings come from the packaged config
# rather than being restated here — a hand-written subset silently loses
# whichever commands it forgets.
#
# Copied rather than symlinked, and checked rather than assumed: Debian ships
# these as `root:irc 0640`, so anybody who is not root cannot read them. That
# is every CI runner, and what it produces is Anope refusing to start with no
# hint as to why.
packaged_dir="${ANOPE_CONF_DIR:-/etc/anope}"
for packaged in modules nickserv chanserv hostserv operserv global; do
  source_file="$packaged_dir/$packaged.conf"
  if [ ! -r "$source_file" ]; then
    echo "e2e: cannot read $source_file" >&2
    echo "     Anope's packaged configuration is root:irc 0640 by default." >&2
    echo "     Run: sudo chmod a+r $packaged_dir/*.conf" >&2
    exit 1
  fi
  cp "$source_file" "$run/conf/$packaged.conf"
done

echo "rendered $run/inspircd.conf and $run/conf/services.conf"
