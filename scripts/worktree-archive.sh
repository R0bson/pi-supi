#!/usr/bin/env bash
# Setup owns no daemons, ports, reservations, or persistent service data.
# Leave files and caches untouched; the caller owns checkout removal.
set -euo pipefail

if (( $# > 1 )); then
  printf 'Usage: %s [checkout-root]\n' "$0" >&2
  exit 2
fi
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
target=$(cd -- "${1:-${ORCA_WORKTREE_PATH:-$script_root}}" && pwd -P)
cd -- "$target"
if [[ "$(git rev-parse --show-toplevel)" != "$target" || ! -f pnpm-workspace.yaml ]]; then
  printf 'Archive requires a workspace checkout root; no files or processes were changed.\n' >&2
  exit 1
fi
printf 'worktree archive ready: %s (no managed services; files and caches retained)\n' "$target"
