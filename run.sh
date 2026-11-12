#!/usr/bin/env bash
# The one command graders run:  ./run.sh <input_dir> <output.json>
# Runs pre-bundled dist/main.cjs — only requires Node.js, no install needed.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: ./run.sh <input_dir> <output.json>" >&2
  exit 2
fi

cd "$(dirname "$0")"

# Use pre-bundled file if available (no install needed)
if [ -f dist/main.cjs ]; then
  node dist/main.cjs "$1" "$2"
  exit $?
fi

# Fallback: install deps and run via tsx
echo "dist/main.cjs not found, falling back to tsx..." >&2
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
else
  npm install
fi
npx tsx src/main.ts "$1" "$2"
