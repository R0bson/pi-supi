#!/usr/bin/env bash
# Prepare one checkout; no services, credentials, or shared Git hooks are created.
set -euo pipefail

if (( $# > 1 )); then
  printf 'Usage: %s [checkout-root]\n' "$0" >&2
  exit 2
fi
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
target=$(cd -- "${1:-${ORCA_WORKTREE_PATH:-$script_root}}" && pwd -P)
step='validate checkout'
trap 'printf "worktree setup failed at %s; fix the prerequisite and rerun for this checkout.\n" "$step" >&2' ERR
cd -- "$target"
[[ "$(git rev-parse --show-toplevel)" == "$target" ]]
[[ -f pnpm-workspace.yaml && -f pnpm-lock.yaml ]]
command -v node >/dev/null
command -v pnpm >/dev/null
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.name !== "@mrclrchtr/supi-workspace") {
    throw new Error("Expected the SuPi workspace root");
  }
'
expected=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).packageManager.replace(/^pnpm@/, "")')
if [[ "$(pnpm --version)" != "$expected" ]]; then
  printf 'Use pnpm %s from package.json (see .mise.toml), then retry.\n' "$expected" >&2
  exit 1
fi

step='install locked workspace dependencies'
pnpm install --frozen-lockfile
step='check local tool availability'
pnpm exec tsc --version
pnpm exec vitest --version
step='check vendored WASM readiness'
pnpm --filter @mrclrchtr/supi-tree-sitter check:all-wasm
printf 'worktree ready: %s (dependencies and WASM checked; no services started)\n' "$target"
