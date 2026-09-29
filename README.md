# liendeadline-mcp

MCP server for US mechanics lien and preliminary notice deadlines. Covers all 50 states plus
the District of Columbia.

Give it an invoice date and a state, get the statutory deadlines back. It wraps the
[LienDeadline](https://liendeadline.com) API. Calculation and supported-state tools require a
dedicated customer API key; state-guide tools remain public.

## Install and configure

Obtain an active dedicated customer key through the approved issuance process. The
`calculate_lien_deadline` tool needs `deadline:calculate`; `list_supported_states` needs
`states:read`. Set `LIENDEADLINE_API_KEY` in the MCP process environment using your local
secret launcher. A browser session, QuickBooks/Procore token or legacy API key is not a
customer credential. Rotation or revocation requires replacing the key and restarting
the MCP process.

Claude Code (launch from the environment containing the key):

```bash
claude mcp add liendeadline -- npx -y liendeadline-mcp
```

Claude Desktop, in `claude_desktop_config.json`:

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

The placeholder above is not a credential. Protect a Desktop configuration containing a
real key as a secret; do not commit, share or include it in support logs. Prefer a local
secret launcher when available. Keys must never appear in URLs, tool arguments or browser
storage. Missing or malformed keys fail locally before an HTTP request; guide tools still
work without a key.

This source change does not publish a new npm artifact. The release owner must attest the
packaged revision containing this change before relying on the `npx` install command for
customer-key compatibility.

## Tools

| Tool | What it does |
| --- | --- |
| `calculate_lien_deadline` | Preliminary notice and lien filing deadlines from an invoice date and state |
| `list_supported_states` | The 51 jurisdictions with rules available |
| `get_state_lien_guide` | The underlying rule for one state, with its statute citation |
| `list_state_lien_guides` | Every available guide, by code and title |

### Example

`calculate_lien_deadline` with `state: "TX"`, `invoice_date: "2026-07-01"`,
`project_type: "Commercial"`:

```json
{
  "state": "TX",
  "invoice_date": "2026-07-01",
  "preliminary_notice_deadline": "2026-09-15",
  "lien_deadline": "2026-10-15",
  "prelim_deadline_days": 18,
  "lien_deadline_days": 48,
  "warnings": ["If 15th falls on weekend/holiday, extends to next business day"]
}
```

`get_state_lien_guide` returns the rule behind that date, including
`"statute": "Texas Property Code § 53.056"`, so an answer can be checked rather than trusted.

## Notes

Two deliberate choices worth knowing about:

- **Responses are trimmed.** The calculate endpoint returns the same object three times, and a
  state guide is ~16 KB of which roughly 7 KB is rendered HTML. Both are collapsed to the
  fields an agent can act on, which takes a guide from ~16,000 to ~4,300 characters.
- **API origin:** customer tools send `Authorization: Bearer <key>` only to
  `https://secure-api-v1.liendeadline.com`, using `POST /api/v1/calculate-deadline` and
  `GET /api/v1/supported-states`. There is no anonymous demo fallback. `LIENDEADLINE_API_URL`
  accepts a bare HTTP(S) origin for public guide tools; customer tools reject every other
  origin, including staging, alternate ports and insecure HTTP. URL credentials, paths,
  queries and fragments are rejected. All requests reject redirects.
- **Denials:** `401` means check expiry/rotation/revocation, `403` means check endpoint scope
  and current account access, `429` means retry later, and `503` means the customer API is
  unavailable. Tools return an MCP error with a safe message; denial bodies and network
  exception details are not echoed.

## Validation and release

1. With Node 22.23 or newer, run `npm ci --ignore-scripts`, `npm run typecheck`, and
   `npm test`. Tests use synthetic credentials and mocked HTTP without API/provider access.
   Hosted CI also compiles the package. Pull requests and scheduled checks do not call the
   live API or require secrets.
2. `npm run smoke` remains an explicit live stdio check for the release owner after the
   packaged revision, API serving revision and approved customer credential are confirmed.
   It requires `LIENDEADLINE_RUN_LIVE_SMOKE=1` plus `LIENDEADLINE_API_KEY`. Do not use a real
   customer key for routine CI or unapproved live acceptance.
3. Source merge, npm publication/installed-artifact compatibility and actual issued-key
   calculation/state acceptance are separate gates. API #240 retains migration, key
   issuance/replacement, attribution, limits, rotation and revocation acceptance. This PR
   performs no publication, deployment, staging action or credential issuance.

## Not legal advice

Results are calculated estimates from published state rules, reviewed quarterly. Statutes
change and facts vary between projects. Verify critical deadlines with counsel before relying
on them. This is not a law firm and does not file anything on your behalf.

## Licence

MIT
