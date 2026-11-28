#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pin="fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c"
work="$(mktemp -d "${TMPDIR:-/tmp}/apex-native.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/pinned/lease"
if [[ -n "${XAUCLOUD_REPO:-}" ]]; then
  source_repo="$XAUCLOUD_REPO"
elif git -C "$HOME/XauAI-Sniper" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  source_repo="$HOME/XauAI-Sniper"
else
  source_repo="$work/xaucloud"
  git init -q "$source_repo"
  git -C "$source_repo" remote add origin "${XAUCLOUD_GIT_URL:-https://github.com/Lamarrsdrip/XauAI-Sniper.git}"
fi
if ! git -C "$source_repo" cat-file -e "$pin^{commit}" 2>/dev/null; then
  git -C "$source_repo" fetch --depth=1 origin "$pin"
fi
for name in XauCloud.mq5 lease/XauCloudLeaseClient.mqh lease/XauCloudLeaseCrypto.mqh lease/XauCloudLeaseSha256.mqh; do
  git -C "$source_repo" show "$pin:backend/ea_code/$name" > "$work/pinned/$name"
done
node "$root/scripts/build-apex4-native-basket.mjs" "$work/pinned" "$work/generated"
# Preserve the editable source and its includes before the temporary build is removed.
dest="${APEX_COMPILE_OUTPUT_DIR:-$HOME/Downloads}"
mkdir -p "$dest"
bundle="$(mktemp -d "$dest/Apex4-native-source.XXXXXX")"
cp "$work/generated/XauCloud-Apex-v4-NativeBasket-TESTER.mq5" "$work/generated/Apex4-NativeBasket-Tester.mqh" "$work/generated/Apex4-M10-Observer-Safety.mqh" "$bundle/"
cp -R "$work/generated/lease" "$bundle/lease"
printf 'MQ5 source and includes: %s\n' "$bundle"
APEX_COMPILE_OUTPUT_DIR="${APEX_COMPILE_OUTPUT_DIR:-$HOME/Downloads}" \
APEX_COMPILE_SOURCE="$work/generated/XauCloud-Apex-v4-NativeBasket-TESTER.mq5" \
bash "$root/scripts/compile-apex4-mac.sh"
printf '%s\n' 'Use the checksum-stamped EX5 from Downloads in the MT5 Strategy Tester. Native pullbacks require no backend, license, or replay CSV.'
