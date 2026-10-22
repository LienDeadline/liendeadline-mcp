#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${LIENDEADLINE_RUN_HOSTED_DRIFT:-}" != 1 ]]; then
  echo "Live check disabled. Set LIENDEADLINE_RUN_HOSTED_DRIFT=1 for an authorized hosted-version check." >&2
  exit 2
fi
node_executable="${NODE_EXECUTABLE:-node}"
node_executable="$(command -v "$node_executable")"
export PATH="$(dirname "$node_executable"):$PATH"
expected_ref="${EXPECTED_REF:-origin/main}"
MCP_URL="${MCP_URL:-https://mcp.liendeadline.com/mcp}"
GRACE_MINUTES="${GRACE_MINUTES:-45}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-30}"

expected=$(git show "$expected_ref:package.json" | node -e 'let s=""; process.stdin.on("data", c=>s+=c).on("end", ()=>console.log(JSON.parse(s).version));')
sha=$(git rev-parse "$expected_ref")
committed=$(git log -1 --format=%ct "$expected_ref")
age_minutes=$(( ($(date +%s) - committed) / 60 ))

# One attempt: an MCP initialize POST, printing result.serverInfo.version.
served_version() {
  local response
  response=$(curl -sS --fail --max-time 20 -X POST "$MCP_URL" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hosted-drift-check","version":"1"}}}') || return 1
  printf '%s' "$response" |
    node -e '
      let raw = "";
      process.stdin.on("data", c => raw += c).on("end", () => {
        let message;
        try { message = JSON.parse(raw); } catch {
          const data = raw.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5)).join("");
          try { message = JSON.parse(data); } catch { message = undefined; }
        }
        const version = message?.result?.serverInfo?.version;
        if (typeof version !== "string" || version === "") {
          console.error("The response has no result.serverInfo.version.");
          process.exit(1);
        }
        console.log(version);
      });'
}

if ! served=$(served_version); then
  echo "First request to $MCP_URL failed; retrying in ${RETRY_DELAY_SECONDS}s."
  sleep "$RETRY_DELAY_SECONDS"
  if ! served=$(served_version); then
    echo "ERROR: Could not read the hosted version from $MCP_URL after two attempts. main is $sha (version $expected)."
    exit 1
  fi
fi

echo "main $sha: $expected. Hosted: $served. Newest main commit is $age_minutes minutes old."
if [ "$served" = "$expected" ]; then
  echo "The hosted endpoint serves main's version."
elif [ "$age_minutes" -le "$GRACE_MINUTES" ]; then
  echo "Versions differ, but main changed $age_minutes minutes ago; a deploy may still be running."
else
  echo "ERROR: Hosted endpoint serves $served, but main $sha is $expected (committed $age_minutes minutes ago). The main deploy did not complete; re-run the main build through the private operations procedure."
  exit 1
fi
