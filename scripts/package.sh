#!/usr/bin/env bash
#
# Build the Chrome Web Store upload: unraveler-<version>.zip in the repo root.
#
# Runs the tests, checks that every file the manifest references made it into
# the zip, and only then replaces any older unraveler-*.zip — a failed build
# never costs you the last good one.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -t 1 ]; then
  GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m' BOLD=$'\033[1m' RESET=$'\033[0m'
else
  GREEN='' YELLOW='' RED='' BOLD='' RESET=''
fi

ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

command -v zip >/dev/null || die "zip not found."
command -v zipinfo >/dev/null || die "zipinfo not found."

# --- Version ------------------------------------------------------------

version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
# Chrome allows one to four dot-separated integers.
[[ "$version" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]] ||
  die "Couldn't read a valid version from manifest.json (got '$version')."

zip_name="unraveler-$version.zip"
printf '%sUnraveler %s%s\n' "$BOLD" "$version" "$RESET"

# --- Uncommitted changes ------------------------------------------------

if command -v git >/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  changes=$(git status --porcelain)
  if [ -n "$changes" ]; then
    warn "Uncommitted changes:"
    printf '%s\n' "$changes" | sed 's/^/   /' >&2
  fi
fi

# --- Tests --------------------------------------------------------------

if command -v bun >/dev/null; then
  runner=(bun run)
elif command -v deno >/dev/null; then
  runner=(deno run --allow-read)
else
  die "Neither bun nor deno found, so the tests can't run."
fi

passed=''
for test_file in test/engine.test.js test/latest.test.js; do
  if ! out=$("${runner[@]}" "$test_file" 2>&1); then
    printf '%s\n' "$out" >&2
    die "Tests failed in $test_file."
  fi
  count=$(printf '%s\n' "$out" | sed -n 's/^\([0-9][0-9]*\) passed.*/\1/p' | tail -n 1)
  passed="${passed:+$passed + }${count:-?}"
done
ok "Tests passed ($passed)"

# --- Build into a temp dir ----------------------------------------------

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
tmp_zip="$tmp_dir/$zip_name"

zip -r -X -q "$tmp_zip" manifest.json src icons -x '*.DS_Store'

# --- Every manifest-referenced file is in the zip -----------------------
#
# Every manifest string ending in a file extension is a path; match patterns
# like "*://*.atlassian.net/*" never are. Checked against the zip itself, so a
# file outside src/ and icons/ is caught too.

entries=$(zipinfo -1 "$tmp_zip")
refs=$( (grep -oE '"[^"*]+\.(js|html|css|png)"' manifest.json || true) | tr -d '"' | sort -u)

ref_count=0
missing=''
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  ref_count=$((ref_count + 1))
  grep -qxF "$ref" <<<"$entries" || missing="$missing   $ref"$'\n'
done <<<"$refs"

if [ -n "$missing" ]; then
  printf '%s' "$missing" >&2
  die "Manifest references files missing from the zip (listed above)."
fi
[ "$ref_count" -gt 0 ] || die "Found no file references in manifest.json."
ok "All $ref_count manifest files present"

# --- Replace older zips -------------------------------------------------

for old in unraveler-*.zip; do
  [ -e "$old" ] || continue
  rm -f "$old"
  ok "Removed $old"
done

mv "$tmp_zip" "$zip_name"

entry_count=$(zipinfo -1 "$zip_name" | wc -l | tr -d ' ')
size_kb=$((($(wc -c <"$zip_name") + 1023) / 1024))
ok "Built $zip_name ($entry_count entries, $size_kb KB)"
