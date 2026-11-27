#!/usr/bin/env bash
# Registers host/vimode_host.py as the "vimode" native messaging host for every
# Chromium-family browser config found in ~/.config. Re-runnable. The manifest
# names the host by absolute path, which is why it is written here rather than
# shipped: the repo can live anywhere.
#
# The extension ID is fixed by the "key" in manifest.json, so it is the same
# on every machine and for every path the extension is loaded from.
set -euo pipefail

EXTENSION_ID=clpilnbgbnbaognjhhcdnnkcgdcohkbn
host="$(cd "$(dirname "$0")" && pwd)/vimode_host.py"
chmod +x "$host"

installed=0
for browser in BraveSoftware/Brave-Browser chromium google-chrome; do
	dir="$HOME/.config/$browser"
	[[ -d "$dir" ]] || continue
	mkdir -p "$dir/NativeMessagingHosts"
	cat > "$dir/NativeMessagingHosts/vimode.json" <<EOF
{
  "name": "vimode",
  "description": "vimode config watcher",
  "path": "$host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
	echo "registered for $browser"
	installed=1
done

[[ $installed == 1 ]] || { echo "no Chromium-family browser config found in ~/.config" >&2; exit 1; }
