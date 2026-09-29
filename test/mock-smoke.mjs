// Exercise the actual smoke orchestration with SDK doubles, never spawning an API caller.
import { registerHooks } from 'node:module';
const transportModule = `
export class StdioClientTransport {
  constructor(options) {
    const env = options.env;
    if (!env || env.LIENDEADLINE_API_KEY !== process.env.LIENDEADLINE_API_KEY ||
        env.LIENDEADLINE_API_URL !== process.env.LIENDEADLINE_API_URL ||
        Object.keys(env).some(k => !['LIENDEADLINE_API_KEY', 'LIENDEADLINE_API_URL'].includes(k))) {
      throw new Error('Smoke child credential configuration mismatch');
    }
    this.isMockTransport = true;
  }
}`;
const clientModule = `
export class Client {
  async connect(transport) {
    if (!transport.isMockTransport) throw new Error('Expected mocked smoke transport');
  }
  async listTools() { return { tools: Array.from({length: 4}, (_, i) => ({name: 'mock-tool-' + i})) }; }
  async callTool({name, arguments: args}) {
    if (args.state === 'ZZ') return {isError: true, content: [{text: 'Unsupported state'}]};
    if (process.env.MCP_TEST_STATUS) return {isError: true, content: [{text: process.env.LIENDEADLINE_API_KEY}]};
    const body = name === 'calculate_supplier_deadlines'
      ? {status: 'calculated', preliminary_notice: {deadline: '2026-09-17'}, lien_filing: {deadline: '2026-12-09'}}
      : name === 'list_supported_states' ? {count: 2, states: ['TX', 'CA']}
      : name === 'get_state_lien_guide' ? {rules: {preliminary_notice: {statute: 'Synthetic statute'}}, source_url: 'https://liendeadline.com/state-lien-guides/texas'}
      : {state: 'TX', invoice_date: '2026-07-01', lien_deadline: '2026-10-15'};
    return {content: [{text: JSON.stringify(body)}]};
  }
  async close() {}
}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/smoke.ts')) {
      const source = specifier === '@modelcontextprotocol/sdk/client/stdio.js' ? transportModule
        : specifier === '@modelcontextprotocol/sdk/client/index.js' ? clientModule : null;
      if (source) return {url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true};
    }
    return nextResolve(specifier, context);
  },
});
globalThis.fetch = async () => { throw new Error('Unexpected network call in smoke test'); };
