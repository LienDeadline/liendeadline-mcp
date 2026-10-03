#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BASE_URL } from "./api.js";
import { buildServer } from "./server.js";

export { buildServer } from "./server.js";

async function main() {
  // The local stdio server serves all five tools; the customer key stays in this process.
  const server = buildServer({
    includeCustomerTools: true,
    baseUrl: process.env.LIENDEADLINE_API_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL,
    customerApiKey: process.env.LIENDEADLINE_API_KEY,
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("liendeadline-mcp failed to start:", error);
  process.exit(1);
});
