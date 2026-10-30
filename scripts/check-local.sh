#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

node_executable="${NODE_EXECUTABLE:-node}"
npm_executable="${NPM_EXECUTABLE:-npm}"
node_executable="$(command -v "$node_executable")"
export PATH="$(dirname "$node_executable"):$PATH"
"$node_executable" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 22)) throw new Error("Node >=22.22 is required");'
"$npm_executable" run build
"$npm_executable" run typecheck
"$npm_executable" test
git diff --check
