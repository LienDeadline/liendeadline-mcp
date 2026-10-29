# Releasing

Releases start from an approved stable `v<major>.<minor>.<patch>` tag whose commit
is reachable from `main`. The release-only [npm workflow](.github/workflows/release.yml)
publishes npm automatically on a newly created tag. Ordinary source checks remain
local. MCP Registry publication and GitHub Release assets remain separate operations.
A release does not deploy the hosted endpoint; that separate operation is documented in [docs/HOSTED.md](docs/HOSTED.md).

## Offline preflight

1. Bump `package.json`, the top-level and package-entry versions in `server.json`,
   `manifest.json`, `well-known/mcp.json`, the top-level/root-package versions in
   `npm-shrinkwrap.json`, and `VERSION` in `src/api.ts`. The metadata tests enforce consistency.
2. Install with `npm ci --ignore-scripts`, then run `bash scripts/check-local.sh`.
3. Before tagging or publishing, run the former release-tag check locally:

   ```bash
   node scripts/check-release-metadata.mjs v<x.y.z>
   ```

Complete the authorized commit/merge/tag boundary separately. Confirm the tag resolves
to the reviewed commit before any publication; do not publish from a dirty checkout.

## Authorized publishing

These commands contact external services and are excluded from local source checks.
Run them only when the release itself is authorized and the publisher has the required
account access. npm publication uses the existing GitHub OIDC trusted publisher
described below; MCP Registry publication uses an approved local identity. Do not weaken package
security or create credentials merely to bypass that prerequisite.

1. Use the release-only npm workflow after the offline source gate passes on the
   exact release commit. New approved stable tags trigger it automatically. The workflow
   requires the tag/package version to match and the tag commit to be reachable from
   `main`; branch refs, prereleases, moved tags and dispatches from other branches fail.
   It checks package manifests, installs the shrinkwrap with `npm ci --ignore-scripts`,
   runs `prepack` (the TypeScript build), validates the packed tarball, and publishes
   that exact tarball with `--access public --provenance` through OIDC. It does not run
   the full test suite or call OpenAI. Only the publishing job has `id-token: write`;
   its GitHub environment is `release`. Both official actions are pinned to verified
   commit SHAs, Node is locked to 24.20.0, npm must be at least 11.5.1, and dependency
   caching is disabled.

   Reuse the existing npm trusted publisher for `liendeadline-mcp`:

   | Field | Exact value |
   | --- | --- |
   | Provider | GitHub Actions |
   | Organization or user | `LienDeadline` |
   | Repository | `liendeadline-mcp` |
   | Workflow filename | `release.yml` |
   | Environment name | `release` |
   | Required allowed action | `npm publish` (existing `npm stage publish` grant can remain) |

   Do not add an npm token or recreate the existing publisher. See the official
   [npm trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/).
   GitHub Actions must be enabled for this repository and the existing `release`
   environment must permit this workflow. Ordinary PR/push checks stay local.

   **Initial existing-tag bootstrap (v0.5.6):** its immutable tag predates this workflow.
   After merging the workflow to `main`, run the workflow **on `main`** with the existing
   tag as input; do not move or recreate the tag:

   ```bash
   gh workflow run release.yml --ref main -f tag=v0.5.6
   gh run list --workflow release.yml --limit 5
   ```

   The workflow helpers come from the invocation commit; package files come from the
   separately checked out, verified tag commit. For a dispatch, npm provenance records
   the workflow invocation on `main`, so retain the run's resolved `sha` output as
   the tagged package source evidence. Normal new-tag runs use the tagged invocation.

   Concurrency is serialized per tag. If npm already contains the version, the workflow
   **fails closed** and publishes nothing; it does not claim that an existing artifact
   came from this source. Independently compare its tarball integrity and provenance
   before recording it as published. HTTP errors other than an exact version 404 also
   stop publication. After a successful publish, the workflow verifies version,
   `mcpName`, exact tarball integrity and provenance presence with a bounded wait.
   Registry publication requires npm to resolve the package with
   `io.github.LienDeadline/liendeadline-mcp` as its `mcpName`.

2. Check the exact MCP Registry version:

   ```bash
   curl --fail --silent --show-error \
     "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.LienDeadline%2Fliendeadline-mcp/versions/<x.y.z>"
   ```

   If absent, use pinned `mcp-publisher` v1.8.1 with an authorized local
   authentication method shown by `mcp-publisher login --help`, then run
   `mcp-publisher publish server.json`. The former Linux amd64 archive checksum is
   `a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc`;
   it applies only to the [official Linux amd64 archive](https://github.com/modelcontextprotocol/registry/releases/download/v1.8.1/mcp-publisher_linux_amd64.tar.gz). Verify the matching official release
   artifact before running a publisher on another platform. Do not use `github-oidc`
   outside its hosted identity environment.

3. Build both bundles locally. This installs locked production dependencies and
   downloads/runs pinned `@anthropic-ai/mcpb@2.1.2`; it is a release operation:

   ```bash
   node scripts/pack-mcpb.mjs build
   ```

4. Create the GitHub Release for the existing verified tag, or upload to an existing
   release instead of recreating it:

   ```bash
   gh release view v<x.y.z>
   gh release create v<x.y.z> build/*.mcpb --title v<x.y.z> --generate-notes --verify-tag
   # For an existing release, use this instead of release create:
   gh release upload v<x.y.z> build/*.mcpb --clobber
   ```

   Assets are `liendeadline-mcp-<version>.mcpb` for Claude Desktop and
   `liendeadline-mcp-<version>-smithery.mcpb` without the static tool list.

Registry versions and metadata are immutable. Fix a bad published version with a new
version. Update the exact MCP pin in [LienDeadline/skills](https://github.com/LienDeadline/skills)
only after the release is available. Any live smoke or directory submission is a
separate authorized action; see [CONTRIBUTING.md](CONTRIBUTING.md).

`npm-shrinkwrap.json` is published and locks transitive dependencies for `npx` users.
After an authorized dependency update, consumers receive it through a new release.
The npm Dependabot configuration remains; its obsolete GitHub Actions updater is removed.

## Directory listings

| Venue | Manual operation | Notes |
| --- | --- | --- |
| Official MCP Registry | Publisher procedure above | Feeds PulseMCP and the GitHub/VS Code MCP gallery |
| Glama | Claim listing with an authorized maintainer account | Separate directory action |
| Smithery | `smithery mcp publish ./liendeadline-mcp-<version>-smithery.mcpb -n <namespace>/liendeadline-mcp` | Requires authorized account access |
| Anthropic plugin directory / Cursor Marketplace | Submit the plugin in LienDeadline/skills | Separate from package publication |
