#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="${APEX_MT5_APP:-/Applications/MetaTrader 5.app}"
prefix="${APEX_MT5_PREFIX:-$HOME/Library/Application Support/net.metaquotes.wine.metatrader5}"
terminal="${APEX_MT5_TERMINAL_DIR:-$prefix/drive_c/Program Files/MetaTrader 5}"
wine="$app/Contents/SharedSupport/wine/bin/wine"
source="$repo_root/ea/XauCloud-Apex-v4.0.0-DEMO-Candidate.mq5"
if [[ ! -x "$wine" || ! -f "$terminal/MetaEditor64.exe" || ! -d "$terminal/MQL5/Include/Trade" ]]; then
  printf '%s\n' 'MetaTrader 5 Wine, MetaEditor or the standard MQL5 headers are missing.' >&2
  exit 1
fi

build_dir="$(mktemp -d "$prefix/drive_c/Apex4Compile.XXXXXX")"
build_id="$(basename "$build_dir")"
win_dir="C:\\$build_id"
mkdir -p "$build_dir/MQL5/Experts"
cp "$terminal/MetaEditor64.exe" "$build_dir/MetaEditor64.exe"
cp -R "$terminal/MQL5/Include" "$build_dir/MQL5/Include"
name="$(basename "$source" .mq5)"
cp "$source" "$build_dir/MQL5/Experts/$name.mq5"

# MetaEditor does not consistently return zero after a clean compile in Wine.
# Both the compiler report and the freshly created candidate bytes must pass.
(
  cd "$build_dir"
  WINEPREFIX="$prefix" WINEDEBUG=-all "$wine" "$win_dir\\MetaEditor64.exe" /portable \
    "/compile:$win_dir\\MQL5\\Experts\\$name.mq5" "/inc:$win_dir\\MQL5" \
    "/log:$win_dir\\compile.log" > "$build_dir/wine.log" 2>&1
) || true

report="$build_dir/compile.log"
binary="$build_dir/MQL5/Experts/$name.ex5"
for ((attempt=0; attempt<60; attempt++)); do
  if [[ -s "$report" ]]; then
    iconv -f UTF-16LE -t UTF-8 "$report" > "$build_dir/report.txt"
    if grep -q '^Result:' "$build_dir/report.txt"; then break; fi
  fi
  sleep 1
done

dest="${APEX_COMPILE_OUTPUT_DIR:-$HOME/Downloads}"
mkdir -p "$dest"
source_stamp="$(shasum -a 256 "$build_dir/MQL5/Experts/$name.mq5" | cut -c1-12)"
output="$dest/$name-$source_stamp"
[[ -s "$build_dir/report.txt" ]] && cp "$build_dir/report.txt" "$output.compile.log"
if [[ ! -s "$binary" ]] || ! grep -q '^Result: 0 errors, 0 warnings,' "$build_dir/report.txt"; then
  printf 'Compilation did not finish cleanly. Build folder: %s\n' "$build_dir" >&2
  exit 1
fi
cp "$binary" "$output.ex5"
grep '^Result:' "$output.compile.log"
shasum -a 256 "$output.ex5"
printf 'EX5 %s\nLog %s\n' "$output.ex5" "$output.compile.log"
