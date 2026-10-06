# Releasing

A release is a `v<version>` tag on `main`. The [release workflow](.github/workflows/release.yml)
then publishes, in order:

1. `liendeadline-mcp@<version>` to npm through trusted publishing, with provenance.
2. `server.json` to the [official MCP Registry](https://registry.modelcontextprotocol.io) as
   `io.github.LienDeadline/liendeadline-mcp`, authenticated with GitHub OIDC. The registry
   checks that the npm version exists and carries the same `mcpName`.
3. Two `.mcpb` bundles on the GitHub Release: `liendeadline-mcp-<version>.mcpb` for Claude
   Desktop and `liendeadline-mcp-<version>-smithery.mcpb` without the static tool list, which
   Smithery's upload currently rejects.

Each step skips a target that already has the version, so a failed run can be re-run.

A release does not redeploy the hosted Streamable HTTP endpoint; that service is built and
deployed separately (see [docs/HOSTED.md](docs/HOSTED.md)).

## Cutting a release

1. Bump the version in `package.json` (`npm version <x.y.z> --no-git-tag-version`),
   `server.json` (top-level and package entry), `manifest.json`, `well-known/mcp.json`,
   `npm-shrinkwrap.json` (top-level and root package entry) and `VERSION` in `src/api.ts`. `npm test` fails until they all match.
2. Update the pinned `liendeadline-mcp@<version>` in
   [LienDeadline/skills](https://github.com/LienDeadline/skills) after the release is live.
3. Merge to `main`, then tag the merge commit and push the tag:

   ```bash
   git tag v<x.y.z> && git push origin v<x.y.z>
   ```

4. Check npm, the registry entry and the release assets:

   ```bash
   npm view liendeadline-mcp@<x.y.z> mcpName
   curl -s "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.LienDeadline%2Fliendeadline-mcp/versions/<x.y.z>"
   LIENDEADLINE_RUN_LIVE_SMOKE=1 npm run smoke
   ```

Registry versions and metadata are immutable; fix a bad release with a new version.

`npm-shrinkwrap.json` is published with the package and locks every transitive dependency for
`npx` users, so a dependency update, including a security fix, reaches users only through a new
release. `npm ci` installs from the same file. Dependabot opens grouped weekly update PRs and
security-fix PRs; after merging one that changes `npm-shrinkwrap.json`, cut a patch release.

## One-time setup

1. **First npm publish.** npm can only trust a workflow for a package that already exists,
   so the first version is published by an npm account owner from a clean checkout of the
   release commit:

   ```bash
   npm login
   npm ci && npm test
   npm publish --access public
   ```

2. **Trusted publisher.** On npmjs.com, open the package's Settings, add a GitHub Actions
   trusted publisher for `LienDeadline/liendeadline-mcp`, workflow `release.yml`,
   environment `release`. Then set Publishing access to require two-factor authentication
   and disallow tokens.
3. **GitHub environment.** The workflow runs in the `release` environment, which GitHub
   creates on first use. Add required reviewers there to gate releases.

## Directory listings

These venues are one-time submissions and pick up later versions on their own:

| Venue | How | Notes |
| --- | --- | --- |
| Official MCP Registry | This workflow | Feeds PulseMCP and the GitHub/VS Code MCP gallery |
| Glama | Sign in with GitHub as a `glama.json` maintainer and claim the listing | Already indexed from this repo |
| Smithery | `smithery mcp publish ./liendeadline-mcp-<version>-smithery.mcpb -n <namespace>/liendeadline-mcp` | Needs a Smithery account |
| punkpeye/awesome-mcp-servers | PR adding a line under Legal with the Glama badge | Bot checks the badge and emoji |
| mcpservers.org, MCP Market | Web forms | Free queues take weeks |
| Anthropic plugin directory, Cursor Marketplace | Submit the plugin in [LienDeadline/skills](https://github.com/LienDeadline/skills) | Local servers are listed as plugins |

## Pending 0.5.0 release candidate

The local candidate adds the two public supplier-v3 discovery/evaluation tools, bringing the
hosted tool count to five and stdio to seven. It does not activate additional legal policies
or prove hosted deployment. The OpenAI plugin metadata candidate is 1.0.1.

The corresponding Skills plugin candidate is 1.4.0. Its local MCP package pin intentionally
remains `liendeadline-mcp@0.4.2` until 0.5.0 is published and verified. After that release,
update the Skills pins and validate the published package and hosted service separately.
No release tag, package publication or hosted deployment is implied by these version edits.
