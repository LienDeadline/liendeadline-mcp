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
  assert.equal(read('well-known/mcp.json').serverInfo.version, pkg.version);
  for (const entry of server.packages) assert.equal(entry.version, pkg.version);
});

test('registry manifest lists the hosted Streamable HTTP endpoint next to the npm package', () => {
  assert.deepEqual(server.remotes, [{ type: 'streamable-http', url: 'https://mcp.liendeadline.com/mcp' }]);
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

test('the published package locks its dependency tree with npm-shrinkwrap.json', () => {
  // npx honors a published shrinkwrap; pinning only the top-level version would not lock transitive deps.
  const shrinkwrap = read('npm-shrinkwrap.json');
  assert.ok(pkg.files.includes('npm-shrinkwrap.json'));
  assert.equal(shrinkwrap.version, pkg.version);
  assert.equal(shrinkwrap.packages[''].version, pkg.version);
  for (const dep of Object.keys(pkg.dependencies)) {
    assert.ok(shrinkwrap.packages[`node_modules/${dep}`]?.version, `${dep} is locked`);
  }
});

test('the ChatGPT plugin package points at the hosted endpoint and stays within the listing limits', () => {
  const plugin = read('openai-plugin/plugin.json');
  const mcp = read('openai-plugin/mcp.json');
  const servers = Object.values(mcp.mcpServers);
  assert.equal(servers.length, 1, 'OpenAI connects exactly one MCP server per plugin');
  assert.deepEqual(servers[0], { type: 'streamable-http', url: server.remotes[0].url });
  const ui = plugin.extensions['com.openai'].interface;
  assert.ok(ui.displayName.length <= 30 && ui.shortDescription.length <= 30 && ui.longDescription.length <= 4000);
  assert.ok(ui.defaultPrompt.every(p => p.length <= 128));
  for (const url of [ui.websiteURL, ui.supportURL, ui.privacyPolicyURL, ui.termsOfServiceURL]) assert.match(url, /^https:\/\//);
  const review = plugin.extensions['com.openai'].review.test_cases;
  assert.equal(review.positive.length, 5);
  assert.equal(review.negative.length, 3);
  const icon = readFileSync(new URL('../assets/icon.png', import.meta.url));
  for (const file of [ui.logo, ui.composerIcon]) {
    assert.deepEqual(readFileSync(new URL(`../openai-plugin/${file.replace(/^\.\//, '')}`, import.meta.url)), icon, file);
  }
});
