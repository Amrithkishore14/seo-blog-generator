#!/usr/bin/env bash
# scripts/seed-kv.sh
#
# Seeds the production Cloudflare KV namespace with blog entries from the
# local .data/blogs/ directory populated by `npm run seed`.
#
# unstorage's fs driver writes files without extensions, so this script
# handles both <slug> (no extension) and <slug>.json files.
#
# Prerequisites:
#   1. npm run seed           — generates .data/blogs/ with blog JSON files
#   2. wrangler login         — must be authenticated
#   3. wrangler.toml          — must have real KV namespace id (not REPLACE_WITH...)
#
# Usage:
#   bash scripts/seed-kv.sh
#   bash scripts/seed-kv.sh --preview    # seed the preview namespace instead
#
set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/.data/blogs"
BINDING="BLOGS"
NAMESPACE_FLAG=""

if [[ "${1:-}" == "--preview" ]]; then
  NAMESPACE_FLAG="--preview"
  echo "Seeding PREVIEW KV namespace..."
else
  NAMESPACE_FLAG="--preview false"
  echo "Seeding PRODUCTION KV namespace..."
fi

if [[ ! -d "$DATA_DIR" ]]; then
  echo "Error: $DATA_DIR not found. Run \`npm run seed\` first."
  exit 1
fi

count=0
for file in "$DATA_DIR"/*; do
  [[ -f "$file" ]] || continue

  # Key is the bare filename (unstorage fs driver omits extensions)
  key="$(basename "$file")"
  # Strip .json extension if present
  key="${key%.json}"

  echo "  Uploading: $key"
  npx wrangler kv key put \
    --binding="$BINDING" \
    $NAMESPACE_FLAG \
    --remote \
    "$key" \
    "$(cat "$file")"
  count=$((count + 1))
done

if [[ $count -eq 0 ]]; then
  echo "No blog files found in $DATA_DIR. Run \`npm run seed\` first."
  exit 1
fi

echo ""
echo "Done — uploaded $count blog(s) to KV."
echo "Visit /blog/<slug> on your Pages URL to verify."
