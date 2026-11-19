# Hosted endpoint

`src/http.ts` serves the LienDeadline guide and supplier tools over MCP Streamable HTTP, so directories and
clients that only accept an HTTPS URL can use them: the claude.ai Connectors directory, the
ChatGPT and Codex app directory, Smithery's live tool scan (it lists 0 tools for the stdio
bundle; see [#7](https://github.com/LienDeadline/liendeadline-mcp/issues/7)) and remote-only MCP
lists.

**Hosted URL:** `https://mcp.liendeadline.com/mcp`. Deployment configuration and receipts are
managed privately; this document describes the interface and operating procedure. Verify
`/health` and run the remote smoke before configuring a client. Registry releases and directory
submissions are separate from endpoint deployment.

## What it serves

| Route | Behaviour |
| --- | --- |
| `POST /mcp` | MCP Streamable HTTP, stateless, JSON responses (no SSE, no session ID) |
| `GET /mcp`, `DELETE /mcp` | `405`: there is no server-initiated stream and no session to end |
| `OPTIONS /mcp` | CORS preflight for browser-based MCP clients |
| `GET /healthz`, `GET /health` | `200 {"status":"ok"}` |

Cloud Run's front end answers [paths ending in `z`](https://cloud.google.com/run/docs/known-issues)
itself, so external checks against a Cloud Run URL must use `/health`. `/healthz` answers locally,
in Docker and behind other hosts.

Only the five guide/supplier tools are registered: `calculate_supplier_deadlines`
(`supplier-events-v2`), `get_supplier_questions`, `calculate_supplier_deadlines_v3`,
`get_state_lien_guide` and `list_state_lien_guides`. The additive v3 tools depend on a
promoted canonical source; discovery reports current jurisdiction-specific scope support beyond
the separate Florida/Kansas v2 baseline. Tool registration alone does not establish coverage. They are defined by
the same `buildServer()` as the stdio server, so titles, descriptions, schemas and annotations
match. Hosted mode never registers `calculate_lien_deadline` or `list_supported_states`, never
uses `LIENDEADLINE_API_KEY` (if it is set, the server logs a warning and ignores it).
Supplier discovery and calculations require the caller's dedicated `Authorization: Bearer <customer-key>`
header on every exchange. Only that key is forwarded to the pinned API origin; guides carry no
credentials. Each POST gets a fresh server and transport; nothing is kept between requests.
Discovery consumes no calculation allowance. Completed calculations consume the caller's API plan allowance.

Clients must send `Content-Type: application/json` and `Accept: application/json,
text/event-stream`, as the transport requires. A raw check:

```bash
curl -s https://mcp.liendeadline.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

## Safety controls

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8080` | Listen port. Cloud Run sets it. |
| `HOST` | `127.0.0.1`; the image sets `0.0.0.0` | Bind address. |
| `MCP_MAX_BODY_BYTES` | `65536` | Larger bodies get `413`, from `Content-Length` or while streaming. |
| `MCP_REQUEST_TIMEOUT_MS` | `30000` | A call still running gets `504`, and its late result is dropped. The same value bounds slow uploads. Upstream API requests time out after 20 seconds. |
| `MCP_RATE_LIMIT_MAX`, `MCP_RATE_LIMIT_WINDOW_MS` | `120`, `60000` | `POST /mcp` per client address, in a fixed window per instance. Excess requests get `429` with `Retry-After`. IPv6 counts per /64. |
| `MCP_TRUST_PROXY_HOPS` | `0`; the image sets `1` | Proxies that append the client address to `X-Forwarded-For`. Entries further left are client-supplied and ignored. |
| `LIENDEADLINE_API_URL` | production API | Upstream origin, as for stdio. |
| `OPENAI_APPS_CHALLENGE` | unset | OpenAI's app-directory domain token, served as plain text at `GET /.well-known/openai-apps-challenge`. Unset, that path is `404`. Printable ASCII only, at most 512 characters. |

- **Logs:** one JSON line per request with `severity`, `method`, `status` and `latencyMs`. No
  paths, bodies, tool arguments, client addresses or user agents. Cloud Run's own request log
  (`run.googleapis.com/requests`) still records URL, client IP and user agent at the platform
  level.
- **CORS:** `Access-Control-Allow-Origin: *`, preflight for `Content-Type`, `Accept`,
  `Authorization`, `Mcp-Session-Id`, `Mcp-Protocol-Version` and `Last-Event-ID`. Origins are not
  restricted; callers must supply an explicit dedicated Bearer key for supplier tools.
  Cookies do not authenticate this endpoint. Credentials are never shared across exchanges.
- **Configuration:** the image holds `package.json`, `npm-shrinkwrap.json`, production
  `node_modules` and `dist`, and runs as `node`. No global customer secret or Google Cloud permission is used. Supplier clients supply their own keys.
  Optional analytics uses a project capture token supplied through the private operations control plane.

Every tool call makes at most one upstream request, and `initialize` and `tools/list` make none.
API access and plan budgets remain authoritative for every supplier call. Public guide calls remain free.

Timeout handling closes the transport before replying, aborting the tool handler so a late result
cannot write to a completed response. Oversized streaming bodies are drained after rejection;
address churn evicts the oldest rate-limit window to bound memory. Shutdown finishes in-flight
requests on SIGTERM. Collector failures never log payloads or exception bodies and cannot prevent
tool execution or shutdown. The image includes `assets/icon.png` for the host's favicon; without
that asset the favicon routes return 404.

## PostHog analytics

Analytics is disabled unless all four values are set:

| Variable | Value |
| --- | --- |
| `POSTHOG_ENABLED` | `true` |
| `POSTHOG_PROJECT_TOKEN` | The existing LienDeadline PostHog project's `phc_` capture token, supplied through private runtime configuration. |
| `POSTHOG_HOST` | `https://us.i.posthog.com` (or the allowlisted EU collector for an EU project). |
| `POSTHOG_ENVIRONMENT` | `production`, `staging`, `local` or `test`, matching the actual deployment. |

The hosted entry point uses `@posthog/mcp` with a bounded `posthog-node` queue: at most 1,000
events, two-second collector requests, no retries and a three-second shutdown drain. Delivery
is best effort; a collector outage can leave counts incomplete. The stdio entry point does not
load this integration. Its upstream API requests can still be attributed as MCP requests.

The send filter constructs a new payload from allowlisted fields, including tool name, success,
duration, a fixed client-family bucket, server version, environment, and a fixed intent label
and source. Each event has a new random identifier. Person profiles and GeoIP are disabled.
Tool parameters, results, model, session and conversation IDs, raw client metadata, headers and
exception details are removed.

Errored tool calls retain only a fixed `$mcp_error_type` category. The pinned SDK uses
`Error` for returned tool failures, so the filter classifies known local message prefixes:
missing/malformed customer keys and upstream 401/403 are `permission`, input validation is
`validation`, upstream 429 is `rate_limited`, and other upstream 4xx/5xx responses are
`api_4xx`/`api_5xx`. Already recognized SDK categories are preserved; unrecognized failures
remain `unknown`. This is coarse classification, not a diagnosis of the specific cause.
Messages are examined locally but never sent, and neither raw status fields nor additional
caller data are retained. These labels do not change tool results or calculation policy,
and cannot backfill categories omitted from previously collected events.

The SDK advertises a `context` field with a short list of approved goals. Exact matches are
recorded with `$mcp_intent_source = context_parameter`. If the field is omitted, blank, or
outside the approved list, the event uses a goal based on the tool name with source `inferred`.
The SDK strips `context` before the handler runs, and the send filter discards free text.
The HTTP boundary also suppresses the SDK's optional session-correlation response header,
preserving the endpoint's existing stateless interface.

This supports PostHog's [native MCP Analytics](https://posthog.com/docs/mcp-analytics/start-here)
for tool volume, failures, latency and coarse intent. `review_required` counts as a successful
calculation. Per-event identifiers keep usage aggregates anonymous.

Usage dashboards live in the private PostHog project. They compare native tool calls, API
requests attributed to MCP and skills, and skill-document requests, using production events.
Source attribution is self-reported; document requests are not installs or runs.

## Upstream coordination

All hosted tool calls reach `https://secure-api-v1.liendeadline.com` from this service's egress.
Coordinate the per-source limit with the API owner before listing the endpoint.

- If a per-source limit is added in the API or at Cloudflare, hosted traffic counts as one
  source, or a few, and every hosted user shares that budget.
- Cloud Run egress has no fixed address by default. A stable source the API can raise or exempt
  needs a separately approved egress configuration. The User-Agent
  (`liendeadline-mcp/<version>`) is shared with local installs and can be spoofed, so it is not a
  basis for an exemption.
- Until then, the hosted limits cap what one client can drive: 120 calls a minute on each of at
  most 3 instances.

## Registry and directories

Since 0.4.0, `server.json` lists the endpoint under `remotes` next to the npm package, so the
official MCP Registry and the directories it feeds offer both. `test/metadata.test.mjs` keeps the
URL in place. The registry requires a publicly reachable URL, so keep the endpoint serving before
each release.

Directory submissions are separate: the claude.ai Connectors directory, the ChatGPT/Codex app
directory, Smithery by URL (close #7 once its scan lists the five hosted tools) and remote-only lists.
Use `support@liendeadline.com` as the contact, and keep submission text coverage-neutral.

OpenAI verifies the endpoint's domain before review. Set the token it issues as
`OPENAI_APPS_CHALLENGE` on the service; that creates a new revision, which then needs the usual
promotion before the token is served.

## Local run

```bash
npm run build
PORT=8787 npm run start:http
LIENDEADLINE_RUN_LIVE_SMOKE=1 LIENDEADLINE_MCP_URL=http://127.0.0.1:8787/mcp npm run smoke
```

The container image runs the same server:

```bash
docker build --target http -t liendeadline-mcp:http .
docker run --rm -p 127.0.0.1:8080:8080 liendeadline-mcp:http
```

`npm test` covers the hosted server against mocked HTTP, without network access or secrets.
