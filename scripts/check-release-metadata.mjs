// Offline release preflight. Publishing remains a separate authorized operation.
import { readFileSync } from "node:fs";
const tag = process.argv[2];
if (typeof tag !== "string" || !tag.startsWith("v") || tag.length === 1) {
  throw new Error("Usage: node scripts/check-release-metadata.mjs v<version>");
}
for (const file of ["package.json", "server.json", "manifest.json"]) {
  const { version } = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  if (`v${version}` !== tag) throw new Error(`${file} is ${version}, tag is ${tag}`);
}
console.log(`OK: ${tag} matches package, registry and bundle manifests`);
