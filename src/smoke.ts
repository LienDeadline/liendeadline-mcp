/** End-to-end check: launches the built server over stdio and calls every tool. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("./index.js", import.meta.url).pathname],
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length}`);
for (const t of tools) console.log(`  - ${t.name}: ${t.title ?? ""}`);

const text = (r: unknown) =>
  ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("");

console.log("\ncalculate_lien_deadline TX 2026-07-01 Commercial:");
const calc = await client.callTool({
  name: "calculate_lien_deadline",
  arguments: { state: "TX", invoice_date: "2026-07-01", project_type: "Commercial" },
});
console.log(text(calc));

console.log("\nlist_supported_states:");
const states = JSON.parse(text(await client.callTool({ name: "list_supported_states", arguments: {} })));
console.log(`  count=${states.count} first=${states.states.slice(0, 5).join(",")}`);

console.log("\nget_state_lien_guide TX (size check):");
const guide = text(await client.callTool({ name: "get_state_lien_guide", arguments: { state: "TX" } }));
console.log(`  ${guide.length} chars returned (raw API guide is ~16000)`);
const parsed = JSON.parse(guide);
console.log(`  statute in rules: ${JSON.stringify(parsed.rules?.preliminary_notice?.statute)}`);
console.log(`  source_url: ${parsed.source_url}`);

console.log("\nerror path, bad state code:");
const bad = await client.callTool({ name: "calculate_lien_deadline", arguments: { state: "ZZ", invoice_date: "2026-07-01" } });
console.log(`  isError=${(bad as { isError?: boolean }).isError} msg=${text(bad).slice(0, 90)}`);

await client.close();
console.log("\nOK");
