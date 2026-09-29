// Builds the .mcpb bundles attached to each GitHub Release: one for Claude Desktop and a
// variant without the static tools list, which Smithery's upload currently rejects.
// Run after `npm run build`. Usage: node scripts/pack-mcpb.mjs [outDir]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const MCPB = "@anthropic-ai/mcpb@2.1.2";
const root = resolve(import.meta.dirname, "..");
const outDir = resolve(process.argv[2] ?? join(root, "build"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const stage = join(outDir, "stage");

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const file of ["package.json", "package-lock.json", "LICENSE", "README.md"]) {
  cpSync(join(root, file), join(stage, file));
}
cpSync(join(root, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(root, "assets", "icon.png"), join(stage, "icon.png"));
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit" });

const run = (...args) => execFileSync("npx", ["-y", MCPB, ...args], { cwd: stage, stdio: "inherit" });
for (const [suffix, data] of [["", manifest], ["-smithery", { ...manifest, tools: undefined }]]) {
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(data, null, 2) + "\n");
  run("validate", "manifest.json");
  run("pack", ".", join(outDir, `liendeadline-mcp-${manifest.version}${suffix}.mcpb`));
}
rmSync(stage, { recursive: true, force: true });
