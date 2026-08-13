#!/usr/bin/env bash
#
# Installs the ergo IRC server the end-to-end and Rust jobs test against.
#
# The download is the one step in CI that depends on a host outside the run, and
# a release asset served as an error page is still a 200 with a body: plain
# `curl -sSL | tar xzf` wrote that body to the tarball and failed several
# minutes later with "gzip: stdin: not in gzip format", which reads as a broken
# build rather than a bad fetch. So the fetch fails on an HTTP error, retries a
# transient one, and the archive is checked before anything is unpacked.
set -euo pipefail

version="${ERGO_VERSION:?ERGO_VERSION must be set}"
archive="ergo-${version}-linux-x86_64.tar.gz"
url="https://github.com/ergochat/ergo/releases/download/v${version}/${archive}"

curl --fail --silent --show-error --location \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --output "${archive}" "${url}"

if ! gzip --test "${archive}"; then
  echo "::error::${url} did not return a gzip archive. Its first bytes were:" >&2
  head -c 200 "${archive}" >&2
  exit 1
fi

tar xzf "${archive}"
sudo install -m 755 "ergo-${version}-linux-x86_64/ergo" /usr/local/bin/ergo
