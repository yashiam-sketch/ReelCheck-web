#!/bin/sh
# Rebuilds web/vendor/anthropic-sdk.mjs: the official Anthropic TypeScript SDK bundled into one
# browser ES module, so the site needs no build step and loads nothing from third-party CDNs.
set -eu
VERSION="${1:-0.128.0}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor/anthropic-sdk.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --silent "@anthropic-ai/sdk@$VERSION" esbuild@0.25.10
cat > entry.mjs <<'JS'
export { default, Anthropic, APIError, APIUserAbortError, APIConnectionError, APIConnectionTimeoutError, AuthenticationError, PermissionDeniedError, RateLimitError } from "@anthropic-ai/sdk";
JS
npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020,safari16 \
  --minify --legal-comments=eof --outfile=bundle.mjs
{ echo "// @anthropic-ai/sdk $VERSION (MIT), bundled for the browser by web/scripts/vendor-sdk.sh — do not edit."; cat bundle.mjs; } > "$OUT"
echo "Wrote $OUT"
