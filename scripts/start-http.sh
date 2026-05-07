#!/usr/bin/env bash
# Start the OmniFocus MCP server over HTTP for LAN/Tailscale access.
#
# - Generates and persists a bearer token in .env.local on first run.
# - Builds dist/ if it's missing.
# - Defaults: bind 0.0.0.0, port 3000, path /mcp.
# - Override any of MCP_HTTP_PORT, MCP_BIND, MCP_HTTP_PATH, MCP_AUTH_TOKEN
#   via .env.local or the environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

cd "$ROOT_DIR"

# Source .env.local if present (KEY=VALUE lines).
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Generate and persist a token on first run.
if [[ -z "${MCP_AUTH_TOKEN:-}" ]]; then
  MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
  printf 'MCP_AUTH_TOKEN=%s\n' "$MCP_AUTH_TOKEN" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Generated bearer token and saved to $ENV_FILE"
fi

# Build if dist is missing.
if [[ ! -f "$ROOT_DIR/dist/index.js" ]]; then
  echo "dist/ not found — building..."
  npm run build
fi

export MCP_TRANSPORT="${MCP_TRANSPORT:-http}"
export MCP_HTTP_PORT="${MCP_HTTP_PORT:-3000}"
export MCP_BIND="${MCP_BIND:-0.0.0.0}"
export MCP_HTTP_PATH="${MCP_HTTP_PATH:-/mcp}"
export MCP_AUTH_TOKEN

# Best-effort: show local + Tailscale URLs the client can use.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
TS_HOST="$(command -v tailscale >/dev/null 2>&1 && tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -n1 || true)"

echo
echo "Starting MCP HTTP server"
echo "  Bind:   $MCP_BIND:$MCP_HTTP_PORT"
echo "  Path:   $MCP_HTTP_PATH"
echo "  Token:  $MCP_AUTH_TOKEN"
echo
echo "Reachable at:"
echo "  http://127.0.0.1:$MCP_HTTP_PORT$MCP_HTTP_PATH"
[[ -n "$LAN_IP" ]]  && echo "  http://$LAN_IP:$MCP_HTTP_PORT$MCP_HTTP_PATH"
[[ -n "$TS_HOST" ]] && echo "  http://${TS_HOST%.}:$MCP_HTTP_PORT$MCP_HTTP_PATH  (Tailscale)"
echo
echo "Client (mcp-remote) snippet:"
cat <<EOF
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "http://${TS_HOST:-${LAN_IP:-<host>}}:$MCP_HTTP_PORT$MCP_HTTP_PATH",
        "--header", "Authorization: Bearer $MCP_AUTH_TOKEN"
      ]
    }
  }
}
EOF
echo

exec node "$ROOT_DIR/dist/index.js"
