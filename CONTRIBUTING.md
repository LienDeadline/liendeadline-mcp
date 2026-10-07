# Contributing

Thanks for helping improve the LienDeadline MCP server. Bug reports, documentation fixes and
pull requests are welcome.

## Report a problem

- **Bugs and feature requests:** open a
  [GitHub issue](https://github.com/LienDeadline/liendeadline-mcp/issues). Say which client you
  use, whether you're on the hosted endpoint or the npm package, and the tool name.
- **A deadline looks wrong:** email [support@liendeadline.com](mailto:support@liendeadline.com)
  with the state, project type, who hired you and the dates you entered. Leave out anything
  confidential.
- **Security issues:** email [support@liendeadline.com](mailto:support@liendeadline.com) instead
  of opening a public issue.

Never include an API key, customer data or a config file that holds a key in an issue, pull
request or log.

## Develop locally

You need Node.js 22.23 or newer.

```bash
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
```

Tests use synthetic credentials and mocked HTTP. They don't call the LienDeadline API or need
secrets, and neither do pull-request CI and the scheduled checks.

To run the local stdio server from a build, point an MCP client at `node dist/index.js`.

### Live smoke test

`npm run smoke` runs the built server against the production API. It needs an explicit opt-in:

```bash
LIENDEADLINE_RUN_LIVE_SMOKE=1 npm run smoke
```

It runs the public tools, and runs the customer tools only when `LIENDEADLINE_API_KEY` is also
set. Don't use a real customer key for routine CI or unapproved live checks.

With `LIENDEADLINE_MCP_URL` set, the smoke checks that Streamable HTTP endpoint instead of
starting the stdio server, and requires exactly the five public tools.

### Hosted server

`npm run start:http` runs the Streamable HTTP server (`POST /mcp`), which serves only the public
tools. [docs/HOSTED.md](docs/HOSTED.md) covers its limits, logging, analytics and deployment.

## Project layout

| Path | What's there |
| --- | --- |
| `src/server.ts` | Tool definitions, shared by the stdio and hosted servers |
| `src/api.ts`, `src/supplier-v3.ts` | LienDeadline API client, response checks and trimming |
| `src/index.ts` | stdio entry point (the npm `bin`) |
| `src/http.ts`, `src/analytics.ts` | Hosted Streamable HTTP server and its analytics filter |
| `src/smoke.ts` | Live smoke test |
| `test/` | Unit and contract tests, with mocked HTTP |
| `docs/` | [Tool reference](docs/TOOLS.md), [customer API](docs/CUSTOMER-API.md), [hosted endpoint](docs/HOSTED.md) |
| `assets/readme/` | README images, each with a light and a dark SVG |
| `openai-plugin/` | ChatGPT and Codex plugin package |
| `server.json`, `manifest.json`, `well-known/mcp.json` | MCP Registry, `.mcpb` and discovery metadata |

## Pull requests

- Keep each change focused, and run `npm run typecheck` and `npm test` before you push.
- Tool titles, descriptions and schemas are what AI assistants read. Keep them accurate, and
  don't describe coverage that isn't live.
- Every tool must stay read-only.
- Don't change version numbers in a feature PR. Releases bump them together.
- Update [docs/TOOLS.md](docs/TOOLS.md) when a tool's inputs or outputs change.

## Releases

Maintainers cut releases by tagging `main`. [RELEASING.md](RELEASING.md) lists every file that
carries the version, and the publishing steps for npm, the MCP Registry and the `.mcpb` bundles.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
