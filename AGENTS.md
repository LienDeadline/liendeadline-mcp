# LienDeadline MCP

This repository owns the stdio/HTTP MCP server, tool schemas and package manifests. Preserve caller-key isolation, mocked source tests and the distinction between guides, discovery and allowance-consuming calculations.

## Local checks and delivery

1. Run checks locally from now on. Do not add or depend on GitHub Actions. Shared execution, locked tools, isolated environments and receipts belong to [LienDeadline Ops local CI](../liendeadline-ops/docs/local-ci.md).
2. From this root, install the locked dependency tree explicitly with `npm ci --ignore-scripts`, then run `bash scripts/check-local.sh`. The script accepts `NODE_EXECUTABLE` and `NPM_EXECUTABLE`; Ops supplies its locked runtime. Details and former job coverage are in [docs/LOCAL_CHECKS.md](docs/LOCAL_CHECKS.md).
3. Complete the requested changes and local validation through the authorized delivery boundary. Publishing, hosted checks and deployment use the separate procedures in [RELEASING.md](RELEASING.md) and [docs/HOSTED.md](docs/HOSTED.md); local checks do not grant external-write authority.

## Code Review Rules

Flag only concrete production paths that expose a caller key or project facts, mix credentials between requests, or emit an incorrect supplier result. Authoring guidance alone is not a blocking finding. Avoid hypothetical and aesthetic findings; on re-review flag only new P0/P1 issues.
