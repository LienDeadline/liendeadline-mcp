# Customer API tools

Two invoice tools call LienDeadline's customer API and need a customer API key. Supplier discovery
and calculations also require a dedicated caller key; completed calculations consume API plan
allowance. State-guide tools remain public without a key.

| Tool | Key scope | What it does |
| --- | --- | --- |
| `calculate_lien_deadline` | `deadline:calculate` | Deadlines for one invoice, from its invoice date and state |
| `list_supported_states` | `states:read` | The jurisdictions the invoice calculation accepts |

These invoice tools run only in the local npm package. The hosted endpoint,
`https://mcp.liendeadline.com/mcp`, never registers the invoice tools. For supplier tools, hosted
requests may carry the caller's dedicated `Authorization: Bearer <key>` header; that key is
forwarded only for that exchange. A shared server environment key is not used in hosted mode.

The invoice calculation is a separate contract from the supplier delivery-event tools. A key
doesn't add states to the supplier calculation.

## Get a key

Ask for API access at [support@liendeadline.com](mailto:support@liendeadline.com) or
[liendeadline.com/contact](https://liendeadline.com/contact). Keys come through an approved
issuance process, not self-service.

A browser session, a QuickBooks or Procore token, or a legacy API key isn't a customer key and
won't work.

## Add the key

For the local invoice tools, set `LIENDEADLINE_API_KEY` in the MCP server's environment, ideally
from a local secret launcher. Local supplier tools use the same dedicated environment key.
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

The placeholder isn't a credential. In Claude Desktop, the `.mcpb` bundle asks for the key as an
optional, sensitive setting.

Treat any config that holds a real key as a secret. Don't commit it, share it or paste it into
support requests. Keys must never appear in URLs or browser storage. Invoice tools take their
key only from the server environment, never tool arguments. Supplier calls use the caller-key
path described in [the hosted guide](HOSTED.md); never paste key values into prompts.

To rotate or revoke a key, replace it and restart the MCP server.

## How the key is sent

- The invoice tools send `Authorization: Bearer <key>` only to
  `https://secure-api-v1.liendeadline.com`, through `POST /api/v1/calculate-deadline` and
  `GET /api/v1/supported-states`.
- There's no anonymous demo fallback. A missing or malformed key fails locally, before any
  request is made.
- `LIENDEADLINE_API_URL` can point public state-guide tools at another bare HTTP(S) origin.
  Protected invoice and supplier tools refuse every origin except the production API, including
  staging, other ports and plain HTTP.
- Origins with credentials, paths, queries or fragments are rejected. No request follows a
  redirect.
- State-guide tools never send credentials. Supplier calls send only the caller-scoped key to
  the pinned API origin; discovery does not consume a calculation unit.

## Errors

| Status | Meaning | What to do |
| --- | --- | --- |
| `401` | The key is expired, rotated or revoked | Replace the key and restart the server |
| `403` | The key lacks this endpoint's scope, or the account lost access | Check the key's scopes and the account |
| `402` | API plan or calculation allowance is unavailable | Check the plan or remaining allowance |
| `429` | Rate limit reached | Retry later |
| `503` | The customer API is unavailable | Retry later |

Each tool returns an MCP error with a safe message. Response bodies from denied requests and
network error details are never echoed.

## Response size

The calculate endpoint returns the same result object three times. The tool keeps one copy.
