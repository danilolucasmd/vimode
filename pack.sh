#!/usr/bin/env bash
# Builds the zip to upload to the Chrome Web Store: dist/vimode-<version>.zip.
#
# The manifest's "key" pins the extension ID for an unpacked load; the store
# rejects a manifest that carries one and assigns its own ID, so it is
# stripped from the packed copy only. Bump "version" in manifest.json before
# each upload: the store refuses a version it already has.
set -euo pipefail
cd "$(dirname "$0")"

version=$(jq -r .version manifest.json)
out="dist/vimode-$version.zip"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

jq 'del(.key)' manifest.json > "$stage/manifest.json"
cp background.js commands.js content.js "$stage/"
cp -r defaults "$stage/"
mkdir "$stage/icons"
cp icons/icon-*.png "$stage/icons/"

mkdir -p dist
rm -f "$out"
(cd "$stage" && zip -qr "$OLDPWD/$out" .)
echo "$out"
