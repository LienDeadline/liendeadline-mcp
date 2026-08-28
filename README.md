# liendeadline-mcp

MCP server for US mechanics lien and preliminary notice deadlines. Covers all 50 states plus
the District of Columbia.

Give it an invoice date and a state, get the statutory deadlines back. It wraps the public
[LienDeadline](https://liendeadline.com) API, which needs no API key for these endpoints.

## Install

Claude Code:

```bash
claude mcp add liendeadline -- npx -y liendeadline-mcp
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "liendeadline": { "command": "npx", "args": ["-y", "liendeadline-mcp"] }
  }
}
```

No account or API key required.

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
- **Point it elsewhere** with `LIENDEADLINE_API_URL` if you need staging.

## Not legal advice

Results are calculated estimates from published state rules, reviewed quarterly. Statutes
change and facts vary between projects. Verify critical deadlines with counsel before relying
on them. This is not a law firm and does not file anything on your behalf.

## Licence

MIT
