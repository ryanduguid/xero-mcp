jest.mock('dotenv/config', () => ({}));
jest.mock('open', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('xero-node', () => ({
  XeroClient: jest.fn().mockImplementation((config) => ({ config })),
}));

process.env.XERO_CLIENT_ID = 'synthetic';
process.env.XERO_CLIENT_SECRET = 'synthetic';
process.env.XERO_REDIRECT_URI = 'http://localhost:5000/callback';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { McpToolsFactory } = require('./McpToolsFactory.js');

const collectRefs = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      found.push(value);
      continue;
    }
    collectRefs(value, found);
  }
  return found;
};

const resolvePointer = (root: unknown, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined;
  let node: any = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = node[segment];
  }
  return node;
};

describe('tool input schemas', () => {
  const tools = McpToolsFactory.getAllTools();

  it('registers tools', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  // F106: a client that resolves the returned schema must not be left with
  // dangling "#/components/schemas/..." pointers.
  it('resolves every local reference inside each tool schema', () => {
    for (const tool of tools as any[]) {
      const schema = tool.requestSchema.inputSchema;
      for (const ref of collectRefs(schema)) {
        expect([tool.requestSchema.name, typeof resolvePointer(schema, ref)]).toEqual([
          tool.requestSchema.name,
          'object',
        ]);
      }
    }
  });

  it('carries the referenced component definitions for the four copied schemas', () => {
    const copied = [
      'create_contacts',
      'create_bank_transactions',
      'update_bank_transaction',
      'update_invoice',
    ];
    for (const name of copied) {
      const tool = McpToolsFactory.findToolByName(name);
      expect(tool).toBeDefined();
      const schema = tool.requestSchema.inputSchema as Record<string, any>;
      expect(collectRefs(schema).length).toBeGreaterThan(0);
      expect(Object.keys(schema.components?.schemas ?? {}).length).toBeGreaterThan(0);
    }
  });
});
