// Validate the exact tarball that the release workflow will publish.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [packFile, tag] = process.argv.slice(2);
const [pack] = JSON.parse(readFileSync(packFile, 'utf8'));
if (pack.name !== 'liendeadline-mcp' || `v${pack.version}` !== tag) throw new Error('Packed package identity/version mismatch');
const actualIntegrity = `sha512-${createHash('sha512').update(readFileSync(pack.filename)).digest('base64')}`;
if (pack.integrity !== actualIntegrity) throw new Error('Packed tarball integrity mismatch');
const required = ['package.json', 'README.md', 'npm-shrinkwrap.json', 'dist/index.js', 'dist/http.js'];
const files = new Set(pack.files.map(({ path }) => path));
for (const file of required) if (!files.has(file)) throw new Error(`Missing release file: ${file}`);
for (const file of files) {
  if (!file.startsWith('dist/') && !['package.json', 'README.md', 'npm-shrinkwrap.json', 'LICENSE'].includes(file)) {
    throw new Error(`Unexpected release file: ${file}`);
  }
}
const pkg = JSON.parse(execFileSync('tar', ['-xOf', pack.filename, 'package/package.json'], { encoding: 'utf8' }));
const lock = JSON.parse(execFileSync('tar', ['-xOf', pack.filename, 'package/npm-shrinkwrap.json'], { encoding: 'utf8' }));
if (pkg.name !== pack.name || pkg.version !== pack.version || pkg.mcpName !== 'io.github.LienDeadline/liendeadline-mcp' ||
    lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('Packed metadata mismatch');
console.log(`OK: ${pack.filename} ${actualIntegrity}`);
