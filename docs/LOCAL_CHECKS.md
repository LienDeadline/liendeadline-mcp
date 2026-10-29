# Local checks

Ordinary GitHub Actions checks remain retired. The release-only npm trusted-publishing
exception is described in [RELEASING.md](../RELEASING.md). Run source validation locally, using
the shared [Ops runner](../../liendeadline-ops/docs/local-ci.md) for isolated execution and receipts.
For a standalone checkout:

```bash
npm ci --ignore-scripts
bash scripts/check-local.sh
```

`npm-shrinkwrap.json` owns the dependency tree. Do not substitute a pnpm install.
The source gate builds, typechecks, runs the mocked HTTP/customer-key contract tests,
and checks whitespace. It makes no live API calls and requires no credentials.
`NODE_EXECUTABLE` and `NPM_EXECUTABLE` select the executables; Ops provides its locked
Node runtime. A standalone runtime must satisfy `package.json`'s Node requirement.

## Former jobs

| Former workflow/job | Local replacement | Execution |
| --- | --- | --- |
| `smoke.yml` / `smoke` | `bash scripts/check-local.sh`; explicit `npm ci --ignore-scripts` bootstrap | Default source gate |
| `hosted-drift.yml` / `drift` | `LIENDEADLINE_RUN_HOSTED_DRIFT=1 bash scripts/check-hosted-drift.sh` | Explicit live operation; no automatic schedule |
| `release.yml` / `release`: build, types, tests and tag consistency | Source gate, then `node scripts/check-release-metadata.mjs v<x.y.z>` | Offline preflight |
| `release.yml` / `release`: npm, MCP Registry, bundles and GitHub Release | [Manual release procedure](../RELEASING.md) | Separately authorized publishing |

No formatter, dependency audit or secret-scan job was defined in these workflows.
Bundle construction installs production dependencies and invokes pinned
`@anthropic-ai/mcpb@2.1.2`, so it remains outside the default offline source gate.
Source checks do not establish deployed version parity or publish a release.
