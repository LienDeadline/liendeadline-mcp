<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/LienDeadline/liendeadline-mcp/main/assets/readme/hero-dark.svg">
  <img alt="LienDeadline: mechanics lien and notice deadlines for AI assistants" src="https://raw.githubusercontent.com/LienDeadline/liendeadline-mcp/main/assets/readme/hero-light.svg" width="100%">
</picture>

<p align="center">
  <a href="https://claude.ai/directory/connectors/liendeadline"><img alt="Listed in Claude's Connectors directory" src="https://img.shields.io/badge/Claude-Connectors_directory-D97757"></a>
  <a href="https://registry.modelcontextprotocol.io/?q=liendeadline"><img alt="Listed in the official MCP Registry" src="https://img.shields.io/badge/MCP_Registry-listed-205E4E"></a>
  <a href="https://www.npmjs.com/package/liendeadline-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/liendeadline-mcp?color=205E4E"></a>
  <a href="https://glama.ai/mcp/servers/LienDeadline/liendeadline-mcp"><img alt="Glama score" src="https://glama.ai/mcp/servers/LienDeadline/liendeadline-mcp/badges/score.svg"></a>
  <a href="https://github.com/LienDeadline/liendeadline-mcp/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

**Ask your AI assistant when your preliminary notice and mechanics lien deadlines fall, and get the statute behind every date.**
This MCP server connects Claude, ChatGPT, Cursor, VS Code and any other MCP client to
[LienDeadline](https://liendeadline.com), the deadline engine for US construction material suppliers.
There is nothing to install: add one URL.

<p align="center">
  <a href="#quick-start"><b>Quick start</b></a> ·
  <a href="#what-you-can-ask">What you can ask</a> ·
  <a href="#coverage">Coverage</a> ·
  <a href="#tools">Tools</a> ·
  <a href="#privacy-and-safety">Privacy</a> ·
  <a href="https://liendeadline.com">liendeadline.com</a>
</p>

## Why LienDeadline

Miss a preliminary notice or a lien filing deadline and a supplier can lose its lien rights on the
job, and with them the leverage to get paid. The rules change with the state, the project type and
who hired you. LienDeadline turns your delivery dates into those deadlines and shows its work.

- **Deadlines from delivery dates.** Preliminary notice and lien filing deadlines from your first
  and last delivery and a few yes, no or unknown questions.
- **The statute behind every date.** Each deadline cites its source, so your team and your
  counsel can check it.
- **Never a guessed date.** Missing facts, states that aren't covered yet and public projects come
  back as "needs review", with the reason.
- **Lien guides for all 50 states and DC.** Rule summaries, deadline tables and common questions,
  with statute citations.
- **Safe by design.** Every tool is read-only. Nothing sends notices, files liens or makes payments,
  and you need no account or API key.

<a name="hosted-endpoint"></a>
## Quick start

The hosted server needs no install, account or key:

```
https://mcp.liendeadline.com/mcp
```

| Client | How to add it |
| --- | --- |
| **Claude** (web, desktop, mobile) | Open [LienDeadline in Claude's Connectors directory](https://claude.ai/directory/connectors/liendeadline) and connect it. |
| **Claude Code** | `claude mcp add --transport http liendeadline https://mcp.liendeadline.com/mcp` |
| **Cursor** | [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=liendeadline&config=eyJ1cmwiOiJodHRwczovL21jcC5saWVuZGVhZGxpbmUuY29tL21jcCJ9) |
| **VS Code** | [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_LienDeadline-0098FF)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522liendeadline%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fmcp.liendeadline.com%252Fmcp%2522%257D) |
| **ChatGPT** | Open **Plugins**, select **+** → **Add custom MCP server**, paste the URL above and choose **No authentication**. |
| **Codex CLI** | `codex mcp add liendeadline --url https://mcp.liendeadline.com/mcp` |
| **Any MCP client** | Streamable HTTP at the URL above, no authentication. |

Want your agent to ask the right questions too? The
[LienDeadline agent skill](https://github.com/LienDeadline/skills) teaches it which facts to collect.
The Claude Code plugin adds the skill and this server in one step:

```bash
claude plugin marketplace add LienDeadline/skills
claude plugin install liendeadline@liendeadline
```

<details>
<summary><b>Run it locally instead (npm, stdio)</b></summary>

The local server needs Node.js 22.22 or newer and serves every tool, including the two
[customer API tools](https://github.com/LienDeadline/liendeadline-mcp/blob/main/docs/CUSTOMER-API.md). It ships `npm-shrinkwrap.json`, so `npx` installs the
exact dependency versions each release was tested with.

**Claude Desktop:** download `liendeadline-mcp-<version>.mcpb` from the
[latest release](https://github.com/LienDeadline/liendeadline-mcp/releases/latest) and open it.

**Claude Code:**

```bash
claude mcp add liendeadline -- npx -y liendeadline-mcp
```

**Codex CLI:**

```bash
codex mcp add liendeadline -- npx -y liendeadline-mcp
```

**Cursor, Windsurf and other `mcpServers` clients:**

```json
{
  "mcpServers": {
    "liendeadline": { "command": "npx", "args": ["-y", "liendeadline-mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "liendeadline": { "type": "stdio", "command": "npx", "args": ["-y", "liendeadline-mcp"] }
  }
}
```

</details>

## What you can ask

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/LienDeadline/liendeadline-mcp/main/assets/readme/example-dark.svg">
  <img alt="A Florida supplier asks for its deadlines; LienDeadline returns the Notice to Owner deadline, Sep 17, 2026, under Fla. Stat. § 713.06(2)(a), and the claim of lien deadline, Dec 9, 2026, under Fla. Stat. § 713.08(5)" src="https://raw.githubusercontent.com/LienDeadline/liendeadline-mcp/main/assets/readme/example-light.svg" width="100%">
</picture>

Try asking:

- "We delivered to a Florida commercial job for a subcontractor from Aug 3 to Sep 10, 2026. No
  final payment, no termination. When are our notice and lien deadlines?"
- "Same job, but I don't know whether the owner made final payment. What can you tell me?"
- "Walk me through Texas mechanics lien rules for a material supplier and cite the statutes."
- "Which states do you have lien guides for? Show me Georgia's."

## Coverage

| What | Where | Needs |
| --- | --- | --- |
| Calculated supplier deadlines | Florida and Kansas private projects | Nothing |
| More states (v3 tools) | Added as each state's reviewed rules are released. Until then, the v3 tools return an error and no date. | Nothing |
| Lien guides | All 50 states and DC | Nothing |
| Invoice-based deadlines | 51 jurisdictions | A [customer API key](https://github.com/LienDeadline/liendeadline-mcp/blob/main/docs/CUSTOMER-API.md) |

When LienDeadline can't calculate a date, because of a public project, a state that isn't covered
or a fact you don't know, it returns `review_required` with the reason instead of a date.

## How it works

1. You ask your AI assistant about a job.
2. The assistant calls LienDeadline's tools over MCP with the state, the dates and your answers.
3. LienDeadline applies that state's rules and returns each deadline with its statute, or
   "needs review" with the reason.
4. Before showing a supplier deadline, the server checks that the result echoes exactly the facts
   you sent. A mismatch is reported as an error, never as a date.

## Tools

| Tool | What it does | Key |
| --- | --- | --- |
| `calculate_supplier_deadlines` | Preliminary notice and lien filing deadlines from delivery dates and yes, no or unknown event answers | None |
| `get_supplier_questions` | Whether v3 covers a state, project type and hiring relationship, with its questions, sources and rule versions | None |
| `calculate_supplier_deadlines_v3` | Deadlines from the facts gathered with `get_supplier_questions` | None |
| `get_state_lien_guide` | One state's lien guide: rules, statute citations, deadline table and FAQs | None |
| `list_state_lien_guides` | Every guide (50 states and DC) with its code, title and slug | None |
| `calculate_lien_deadline` | Invoice-based deadlines (local server only) | Customer |
| `list_supported_states` | Jurisdictions the invoice calculation accepts (local server only) | Customer |

Inputs, outputs and statuses are in the [tool reference](https://github.com/LienDeadline/liendeadline-mcp/blob/main/docs/TOOLS.md).

## Privacy and safety

- **No account, no key.** The public tools work anonymously, and nothing is stored between
  requests.
- **What's sent.** The facts you give (state, dates, project type, who hired you and your yes, no
  or unknown answers) go to the LienDeadline API to calculate. Guide lookups send only a state code.
- **Hosted server.** Its logs record the method, status and response time of each request, never
  your inputs. Google Cloud's own request log also records
  the URL, client IP address and user agent. The
  server may count usage anonymously in PostHog: tool name, success, duration and client family,
  with no inputs, results or IP addresses.
- **Local server.** It has no telemetry of its own.

Details: [LienDeadline privacy policy](https://liendeadline.com/privacy).

## Not legal advice

Results are educational baselines calculated from published state rules. Statutes change and
every project is different, so verify critical deadlines with counsel before relying on them.
LienDeadline is not a law firm and does not file anything on your behalf.

## Links

- **Website:** [liendeadline.com](https://liendeadline.com)
- **Agent skill and plugins:** [LienDeadline/skills](https://github.com/LienDeadline/skills)
- **Support:** [support@liendeadline.com](mailto:support@liendeadline.com) or
  [liendeadline.com/contact](https://liendeadline.com/contact)
- **Terms of service:** [liendeadline.com/terms](https://liendeadline.com/terms)
- **Privacy policy:** [liendeadline.com/privacy](https://liendeadline.com/privacy)
- **Help center:** [liendeadline.com/help](https://liendeadline.com/help)
- **Security:** report issues privately as described in
  [SECURITY.md](https://github.com/LienDeadline/liendeadline-mcp/blob/main/SECURITY.md)
- **Contributing and development:** [CONTRIBUTING.md](https://github.com/LienDeadline/liendeadline-mcp/blob/main/CONTRIBUTING.md)
- **License:** [MIT](https://github.com/LienDeadline/liendeadline-mcp/blob/main/LICENSE)
