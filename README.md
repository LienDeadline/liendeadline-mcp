<div align="center">

<img src="https://raw.githubusercontent.com/LienDeadline/liendeadline-mcp/main/assets/icon.png" width="72" alt="LienDeadline">

# LienDeadline MCP

**US mechanics lien and preliminary notice deadlines, for AI agents.**

Statute-cited lien guides for all 50 states and DC. Calculated supplier deadlines where the state rules have been reviewed.

**[liendeadline.com](https://liendeadline.com)**

[![npm](https://img.shields.io/npm/v/liendeadline-mcp)](https://www.npmjs.com/package/liendeadline-mcp) [![LienDeadline/liendeadline-mcp MCP server](https://glama.ai/mcp/servers/LienDeadline/liendeadline-mcp/badges/score.svg)](https://glama.ai/mcp/servers/LienDeadline/liendeadline-mcp) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Quick start](#quick-start) · [Coverage](#coverage) · [Tools](#tools) · [Example](#example) · [Run locally](#run-locally) · [API key](#customer-api-key-optional) · [Privacy](#privacy-and-data)

</div>

---

Give it a supplier's delivery dates and project facts, and it returns the preliminary notice and
lien filing deadlines with their statute sources and warnings.

- **Nothing to install, no key.** The hosted endpoint serves the public tools over MCP Streamable HTTP.
- **Every date cites its statute.** Results carry the sections they were calculated from.
- **It does not guess.** Where a state's rules have not been reviewed, or a required fact is
  missing, the deadline comes back `review_required` with no date.
- **Read-only.** No tool sends notices, files liens or makes payments.

## Quick start

Claude Code:

```bash
claude mcp add --transport http liendeadline https://mcp.liendeadline.com/mcp
```

Claude on the web or desktop: add it as a custom connector under Settings → Connectors, with the
URL `https://mcp.liendeadline.com/mcp`.

<details>
<summary><b>VS Code, Cursor, Codex and other clients</b></summary>

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "liendeadline": { "type": "http", "url": "https://mcp.liendeadline.com/mcp" }
  }
}
```

Cursor and other clients that use an `mcpServers` JSON config:

```json
{
  "mcpServers": {
    "liendeadline": { "url": "https://mcp.liendeadline.com/mcp" }
  }
}
```

OpenAI Codex CLI:

```bash
codex mcp add liendeadline --url https://mcp.liendeadline.com/mcp
```

</details>

The hosted endpoint serves the three public tools: `calculate_supplier_deadlines`,
`get_state_lien_guide` and `list_state_lien_guides`. The customer tools run only in the
[local package](#run-locally).

## Coverage

| | Where | Key |
| --- | --- | --- |
| **Lien guides** | All 50 states and DC | None |
| **Calculated supplier deadlines** | Florida and Kansas private projects, the states whose supplier rules have been reviewed so far | None |
| **Customer invoice calculation** | 51 jurisdictions | LienDeadline customer API key |

For other states, public projects, or when a relevant Florida payment/termination or Kansas
extension answer is missing or unknown, the affected deadline is `review_required` (needs legal
review) instead of a guessed date.

## Tools

| Tool | Key | What it does |
| --- | --- | --- |
| `calculate_supplier_deadlines` | none | Supplier notice and lien filing baselines from explicit delivery-event answers (`supplier-events-v2`) |
| `get_state_lien_guide` | none | Editorial guide for one state or DC: rule summary, statute citations, deadline table, FAQs |
| `list_state_lien_guides` | none | Every available guide, by code and title |
| `calculate_lien_deadline` | customer | Customer API: deadlines for one invoice from its invoice date and state |
| `list_supported_states` | customer | Customer API: jurisdictions the invoice calculation accepts |

For agent instructions that pair with these tools, see the
[LienDeadline agent skill](https://github.com/LienDeadline/skills), which is also packaged as a
Claude Code plugin that installs this server.

## Example

`calculate_supplier_deadlines` with a Florida commercial project where a subcontractor ordered
the materials, deliveries ran from 2026-08-03 to 2026-09-10, and the owner confirms neither
final payment nor termination occurred:

```json
{
  "state": "FL",
  "first_delivery_date": "2026-08-03",
  "last_delivery_date": "2026-09-10",
  "project_type": "commercial",
  "hired_by": "subcontractor",
  "deliveries_complete": true,
  "florida_final_payment_status": "no",
  "florida_termination_status": "no"
}
```

returns, abbreviated:

```json
{
  "contract_version": "supplier-events-v2",
  "status": "calculated",
  "state_code": "FL",
  "preliminary_notice": { "name": "Notice to Owner", "deadline": "2026-09-17", "status": "calculated" },
  "lien_filing": { "name": "Claim of lien", "deadline": "2026-12-09", "status": "calculated" },
  "statute_citations": ["Fla. Stat. § 713.06(2)(a)", "Fla. Stat. § 713.08(5)"],
  "disclaimer": "This is an educational baseline, not legal advice ..."
}
```

The same facts with both Florida answers omitted return `"status": "review_required"` and
no dates. An unknown final-payment answer holds the notice date; an unknown termination answer
holds the lien date. For Kansas, `kansas_extension_status: "no"` permits the ordinary lien
baseline, while `"yes"`, `"unknown"`, or omission requires review and yields no lien date.
Supply a Florida event date only with the matching `"yes"` answer. A blanket
`special_events_reviewed` flag is not accepted. Texas and public projects also need review.
Ongoing deliveries return `awaiting_final_delivery` for the lien date when other facts permit it.
The server checks that the result echoes exactly what was submitted and that unresolved events
have no affected date; a mismatch is reported as an error, not as dates.

## Run locally

Requires Node.js 22 or newer. The package runs over stdio and serves all five tools, including
the customer tools. It ships `npm-shrinkwrap.json`, so `npx` installs the exact dependency
versions each release was tested with. It is listed in the
[official MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.LienDeadline/liendeadline-mcp`.

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=liendeadline&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImxpZW5kZWFkbGluZS1tY3AiXX0=)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522liendeadline%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522liendeadline-mcp%2522%255D%257D)

Claude Code:

```bash
claude mcp add liendeadline -- npx -y liendeadline-mcp
```

Claude Desktop: download `liendeadline-mcp-<version>.mcpb` from the
[latest release](https://github.com/LienDeadline/liendeadline-mcp/releases/latest) and open it.

<details>
<summary><b>Cursor, Windsurf, VS Code and Codex</b></summary>

Claude Desktop, Cursor, Windsurf and other clients that use an `mcpServers` JSON config:

```json
{
  "mcpServers": {
    "liendeadline": {
      "command": "npx",
      "args": ["-y", "liendeadline-mcp"]
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "liendeadline": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "liendeadline-mcp"]
    }
  }
}
```

OpenAI Codex CLI:

```bash
codex mcp add liendeadline -- npx -y liendeadline-mcp
```

</details>

## Customer API key (optional)

Only `calculate_lien_deadline` and `list_supported_states` need a key. Request API access
through [support@liendeadline.com](mailto:support@liendeadline.com) or
[liendeadline.com/contact](https://liendeadline.com/contact); keys are issued through the approved
issuance process, not self-service. `calculate_lien_deadline` needs
`deadline:calculate`; `list_supported_states` needs `states:read`. Set `LIENDEADLINE_API_KEY`
in the MCP process environment using your local secret launcher. A browser session,
QuickBooks/Procore token or legacy API key is not a customer credential. Rotation or
revocation requires replacing the key and restarting the MCP process.

In a JSON config, the key goes in the server's `env` block:

```json
{
  "mcpServers": {
    "liendeadline": {
      "command": "npx",
      "args": ["-y", "liendeadline-mcp"],
      "env": { "LIENDEADLINE_API_KEY": "REPLACE_WITH_DEDICATED_CUSTOMER_KEY" }
    }
  }
}
```

The placeholder above is not a credential. Protect a configuration containing a real key as a
secret; do not commit, share or include it in support logs. Keys must never appear in URLs,
tool arguments or browser storage. Missing or malformed keys fail locally before an HTTP
request; the public tools work without a key.

## Notes

- **Responses are trimmed.** A state guide is ~16 KB of which roughly 7 KB is rendered HTML;
  it is collapsed to the structured fields, which takes it to ~4,300 characters. The customer
  calculate endpoint returns the same object three times and is collapsed to one.
- **Guides are not calculations.** Guide day counts are editorial summaries. Filing dates come
  only from `calculate_supplier_deadlines`; anything it does not calculate needs qualified
  review.
- **API origin:** customer tools send `Authorization: Bearer <key>` only to
  `https://secure-api-v1.liendeadline.com`, using `POST /api/v1/calculate-deadline` and
  `GET /api/v1/supported-states`. There is no anonymous demo fallback. `LIENDEADLINE_API_URL`
  accepts a bare HTTP(S) origin for the public tools; customer tools reject every other origin,
  including staging, alternate ports and insecure HTTP. URL credentials, paths, queries and
  fragments are rejected. All requests reject redirects. Public tools never send credentials.
- **Denials:** `401` means check expiry/rotation/revocation, `403` means check endpoint scope
  and current account access, `429` means retry later, and `503` means the customer API is
  unavailable. Tools return an MCP error with a safe message; denial bodies and network
  exception details are not echoed.

## Privacy and data

The server has no telemetry and stores nothing. Each tool call makes at most one HTTPS request
to `https://secure-api-v1.liendeadline.com`:

- `calculate_supplier_deadlines` sends the submitted project facts (state, delivery dates,
  project type, who hired the supplier and the review answers). The endpoint is stateless and
  does not save them.
- The guide tools send only the state code.
- The customer tools send the invoice facts and the customer key as a Bearer header.

The hosted endpoint makes the same requests on your behalf and stores nothing between requests.
Its own log records only the HTTP method, status and latency of each request, never tool
arguments; the hosting platform's request log also records the URL, client IP address and user
agent.

LienDeadline's [privacy policy](https://liendeadline.com/privacy) covers the API.

## Development

<details>
<summary><b>Build, test and smoke checks</b></summary>

With Node 22.23 or newer, run `npm ci --ignore-scripts`, `npm run typecheck`, and `npm test`.
Tests use synthetic credentials and mocked HTTP without API/provider access. Hosted CI also
compiles the package. Pull requests and scheduled checks do not call the live API or require
secrets.

`npm run smoke` is an explicit live stdio check against the production API. It requires
`LIENDEADLINE_RUN_LIVE_SMOKE=1`, runs the public tools, and runs the customer tools only when
`LIENDEADLINE_API_KEY` is also set. Do not use a real customer key for routine CI or unapproved
live acceptance. Releases follow [RELEASING.md](RELEASING.md).

`npm run start:http` runs the hosted Streamable HTTP server (`POST /mcp`), which serves only the
public tools; [docs/HOSTED.md](docs/HOSTED.md) covers its limits and deployment. With
`LIENDEADLINE_MCP_URL` set, `npm run smoke` checks that endpoint instead of launching the stdio
server and requires exactly the public tools.

</details>

## Not legal advice

Results are calculated baselines from published state rules. Statutes change and facts vary
between projects. Verify critical deadlines with counsel before relying on them. This is not a
law firm and does not file anything on your behalf.

## Licence

MIT
