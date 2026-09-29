/** End-to-end check: launches the built server over stdio and calls every tool. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.env.LIENDEADLINE_RUN_LIVE_SMOKE !== "1" || !process.env.LIENDEADLINE_API_KEY) {
  throw new Error("Live smoke requires explicit LIENDEADLINE_RUN_LIVE_SMOKE=1 and an approved LIENDEADLINE_API_KEY. Use npm test for isolated checks.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("./index.js", import.meta.url).pathname],
  env: {
    LIENDEADLINE_API_KEY: process.env.LIENDEADLINE_API_KEY,
    ...(process.env.LIENDEADLINE_API_URL ? { LIENDEADLINE_API_URL: process.env.LIENDEADLINE_API_URL } : {}),
  },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length}`);
for (const t of tools) console.log(`  - ${t.name}: ${t.title ?? ""}`);

const text = (r: unknown) => {
  if ((r as { isError?: boolean }).isError) {
    throw new Error("Live smoke tool failed. Check customer-key scope/status and API availability; response details omitted.");
  }
  return ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("");
};

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
if (!(bad as { isError?: boolean }).isError) throw new Error("Expected unsupported state to return an MCP error.");
console.log("  isError=true (response details omitted)");

await client.close();
console.log("\nOK");
