# Releasing

Releases are manual operations from an approved `v<version>` tag on `main`.
GitHub Actions are removed: pushing a tag does not publish npm, the MCP Registry
or GitHub Release assets. A release does not deploy the hosted endpoint; that
separate operation is documented in [docs/HOSTED.md](docs/HOSTED.md).

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
account access. The former GitHub OIDC/trusted-publisher flow is unavailable locally;
use an approved npm and MCP Registry publishing identity. Do not weaken package
security or create credentials merely to bypass that prerequisite.

1. Check whether npm already has the exact version. Publish only if it is absent:

   ```bash
   npm view liendeadline-mcp@<x.y.z> version
   npm publish --access public
   npm view liendeadline-mcp@<x.y.z> mcpName
   ```

   The package must resolve with `io.github.LienDeadline/liendeadline-mcp` as its
   `mcpName` before registry publication. Registry propagation can lag; preserve the
   former bounded wait of 30 attempts at 10-second intervals when retrying this lookup.

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
