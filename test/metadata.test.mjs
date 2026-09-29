import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/api.ts';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const pkg = read('package.json');
const server = read('server.json');
const bundle = read('manifest.json');

test('release version is identical in package.json, the server and every manifest', () => {
  assert.equal(VERSION, pkg.version);
  assert.equal(server.version, pkg.version);
  assert.equal(bundle.version, pkg.version);
  for (const entry of server.packages) assert.equal(entry.version, pkg.version);
});

test('registry description fits the 100-character registry limit', () => {
  assert.ok(server.description.length <= 100, `${server.description.length} characters`);
});

test('the .mcpb bundle runs the built entry point and keeps the key optional and masked', () => {
  assert.equal(bundle.server.entry_point, 'dist/index.js');
  assert.deepEqual(bundle.server.mcp_config.args, ['${__dirname}/dist/index.js']);
  assert.equal(bundle.server.mcp_config.env.LIENDEADLINE_API_KEY, '${user_config.api_key}');
  assert.equal(bundle.user_config.api_key.sensitive, true);
  assert.equal(bundle.user_config.api_key.required, false);
});

test('registry manifest names the npm package that proves ownership', () => {
  // The MCP registry only accepts an npm package whose package.json mcpName equals the server name.
  assert.equal(pkg.mcpName, server.name);
  const [npm] = server.packages;
  assert.equal(npm.registryType, 'npm');
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.transport.type, 'stdio');
  assert.equal(server.repository.url, 'https://github.com/LienDeadline/liendeadline-mcp');
});

test('the customer key is optional and marked secret wherever it is declared', () => {
  const [npm] = server.packages;
  const key = npm.environmentVariables.find(v => v.name === 'LIENDEADLINE_API_KEY');
  assert.equal(key.isSecret, true);
  assert.equal(key.isRequired, false);
});
