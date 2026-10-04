# Hosted endpoint

`src/http.ts` serves the public LienDeadline tools over MCP Streamable HTTP, so directories and
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

Only the three public, keyless tools are registered: `calculate_supplier_deadlines`
(`supplier-events-v2`), `get_state_lien_guide` and `list_state_lien_guides`. They are defined by
the same `buildServer()` as the stdio server, so titles, descriptions, schemas and annotations
match. Hosted mode never registers `calculate_lien_deadline` or `list_supported_states`, never
uses `LIENDEADLINE_API_KEY` (if it is set, the server logs a warning and ignores it) and sends no
`Authorization` header upstream. Each POST gets a fresh server and transport; nothing is kept
between requests.

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
  restricted because the tools are public and keyless. With no session or credential to protect,
  DNS-rebinding protection would add nothing.
- **No secrets:** the image holds `package.json`, `npm-shrinkwrap.json`, production
  `node_modules` and `dist`, and runs as `node`. The service needs no Secret Manager entry and no
  Google Cloud permissions.

Every tool call makes at most one upstream request, and `initialize` and `tools/list` make none.
The endpoint therefore adds no capacity against the API beyond calling the public API directly.

## Deploy plan

The LienDeadline GCP project (set `PROJECT` to its ID, recorded in the Ops repository), region
`us-central1`, service `liendeadline-mcp`, minimum instances 0.

Project identifiers, IAM bindings, trigger configuration and deployment receipts belong in
the private operations control plane. Keep credentials and secret-bearing files out of this
public repository and the Cloud Build upload.

1. **Image.** Create the Artifact Registry repository once, then build the `http` target from a
   clean checkout of the reviewed commit. Cloud Build records the digest and build ID:

   ```bash
   gcloud artifacts repositories create liendeadline-mcp --project="$PROJECT" \
     --location=us-central1 --repository-format=docker
   gcloud builds submit --project="$PROJECT" --region=us-central1 \
     --config=cloudbuild.hosted.yaml \
     --substitutions=_IMAGE=us-central1-docker.pkg.dev/$PROJECT/liendeadline-mcp/server:$(git rev-parse --short HEAD) .
   ```

   `gcloud run deploy --source .` would build the default stage, the stdio server, which does
   not listen on a port.

2. **Service.** Use a dedicated service account with no roles, so a compromise of this public
   service grants nothing in the project. Deploy by digest:

   ```bash
   gcloud iam service-accounts create liendeadline-mcp --project="$PROJECT" \
     --display-name="Hosted LienDeadline MCP (no roles)"
   gcloud run deploy liendeadline-mcp --project="$PROJECT" --region=us-central1 \
     --image=us-central1-docker.pkg.dev/$PROJECT/liendeadline-mcp/server@sha256:<digest> \
     --service-account=liendeadline-mcp@$PROJECT.iam.gserviceaccount.com \
     --allow-unauthenticated --min-instances=0 --max-instances=3 \
     --cpu=1 --memory=512Mi --concurrency=80 --timeout=60
   ```

   The default TCP startup probe is enough. An HTTP probe should use `/health`.

3. **Domain.** Map the hostname in the service's region, then add the DNS record Cloud Run
   asks for in Cloudflare:

   ```bash
   gcloud beta run domain-mappings create --project="$PROJECT" --region=us-central1 \
     --service=liendeadline-mcp --domain=mcp.liendeadline.com
   ```

   The record is `mcp CNAME ghs.googlehosted.com`. The Google-managed certificate is issued after
   it resolves.

4. **Cloudflare.** Keep `mcp` **DNS-only**. Cloudflare's Bot Fight Mode, WAF, AI-bot blocking and rate limiting
   then do not apply, so SmitheryBot, Claude, ChatGPT and other MCP clients reach Cloud Run
   directly. The image default `MCP_TRUST_PROXY_HOPS=1` fits this setup, assuming Google's front
   end appends only the client address; step 5 checks that.

   If the record must be proxied:

   - Bot Fight Mode on the Free plan
     [cannot be skipped for a path](https://developers.cloudflare.com/waf/feature-interoperability/).
     Either turn it off for the zone, or use Super Bot Fight Mode (Pro and above) with a custom
     rule that skips it:
     `http.host eq "mcp.liendeadline.com" and starts_with(http.request.uri.path, "/mcp")`.
   - Allow MCP clients in AI Crawl Control / "Block AI bots" for this hostname.
   - Set `--set-env-vars=MCP_TRUST_PROXY_HOPS=2`, use SSL mode Full (strict) and add a per-IP rate
     limiting rule for `/mcp` at the edge.
   - Issue the certificate while the record is DNS-only, then switch to proxied. Renewals can stall
     while it is proxied.
   - The origin stays reachable directly (the `run.app` URL and `ghs.googlehosted.com`), so
     `X-Forwarded-For` entries left of Google's can be forged by bypassing Cloudflare. In this setup
     the edge rule is the authoritative limit, and the app limit is a backstop.

5. **Verify.**

   ```bash
   curl -s https://mcp.liendeadline.com/health
   LIENDEADLINE_RUN_LIVE_SMOKE=1 LIENDEADLINE_MCP_URL=https://mcp.liendeadline.com/mcp npm run smoke
   ```

   The smoke requires exactly the three public tools, then runs the Florida supplier call with
   explicit `no` answers, a guide fetch and an error path.

   To confirm the rate-limit key, send 125 `initialize` requests within a minute, with a
   different forged `X-Forwarded-For` value on each. Requests past 120 must get `429`; the limit
   is per instance, so a few more may pass if Cloud Run started a second instance. Then a request
   from another network, such as Cloud Shell, must still get `200`.

## Delivery pipeline

A secret-backed GitHub push webhook starts Cloud Build only for this repository's `main` branch;
pull-request CI has no deployment credentials. The webhook authentication material, inline build
configuration and dedicated build identity are managed privately, outside this public repository.
The runtime identity has no project roles or secrets. The build identity can write only this
service's image repository, update only this Cloud Run service, and use only its runtime identity.

Each run clones only `main` and records its exact commit, installs the locked dependencies,
compiles, typechecks and tests, builds the Dockerfile's
`http` target, pushes the image and deploys its immutable digest with no traffic. The candidate
must pass health, MCP tool discovery, representative tool calls and CORS checks before that
named revision receives traffic. Promotion also requires the tested commit to remain current
`main`. A failed candidate leaves the serving revision in place.

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
directory, Smithery by URL (close #7 once its scan lists the three tools) and remote-only lists.
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
