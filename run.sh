#!/usr/bin/env bash
# The one command graders run:  ./run.sh <input_dir> <output.json>
# Must finish in 30 minutes on a clean Linux machine.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: ./run.sh <input_dir> <output.json>" >&2
  exit 2
fi

cd "$(dirname "$0")"

# Install deps if needed (clean machine). Prefer a fast, reproducible install.
if [ ! -d node_modules ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  else
    npm ci || npm install
  fi
fi

# tsx runs the TypeScript entry point directly, no build step.
npx tsx src/main.ts "$1" "$2"
