import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ErrorCode, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { ObjectSerializer } from 'xero-node/dist/gen/model/accounting/models.js';
import { XeroMcpServer } from './XeroMcpServer.js';
import { XeroClientSession } from './XeroApiClient.js';
import { Auditor } from './Auditor.js';
import { McpToolsFactory } from './Tools/McpToolsFactory.js';
import { validateToolArguments } from './Utils/validateToolArguments.js';

jest.mock('./XeroApiClient.js', () => ({
  XeroClientSession: {
    isAuthenticated: jest.fn(() => true),
    activeTenantId: jest.fn(() => 'fixture-tenant'),
    xeroClient: {
      accountingApi: {
        getPayments: jest.fn(async () => ({ body: { payments: [] } })),
        getInvoices: jest.fn(async () => ({ body: { invoices: [] } })),
        getContacts: jest.fn(async () => ({ body: { contacts: [] } })),
        getInvoice: jest.fn(async () => ({ body: { invoices: [] } })),
        updateInvoice: jest.fn(async () => ({ body: { invoices: [] } })),
        createContacts: jest.fn(async () => ({ body: { contacts: [] } })),
        createBankTransactions: jest.fn(async () => ({ body: { bankTransactions: [] } })),
        updateBankTransaction: jest.fn(async () => ({ body: { bankTransactions: [] } })),
      },
    },
  },
}));
jest.mock('./Tools/Authenticate.js', () => ({
  AuthenticateTool: {
    requestSchema: { name: 'authenticate', inputSchema: { type: 'object' } },
    requestHandler: jest.fn(),
  },
}));
jest.mock('./Auditor.js', () => ({ Auditor: { record: jest.fn() } }));

const cases: [string, string, Record<string, unknown>][] = [
  ...[NaN, Infinity, -Infinity, 1.5, -0.5, '1', null, true].map(
    (page): [string, string, Record<string, unknown>] => [
      `page ${String(page)}`, 'list_payments', { page },
    ],
  ),
  ['missing invoice ID', 'get_invoice', {}],
  ['numeric invoice ID', 'get_invoice', { invoiceID: 1 }],
  ['wrong unitdp type', 'get_invoice', { invoiceID: 'fixture-invoice', unitdp: '4' }],
  ['infinite nested amount', 'update_invoice', {
    invoiceID: 'fixture-invoice',
    invoices: { Invoices: [{ LineItems: [{ UnitAmount: Infinity }] }] },
  }],
  ['encoded array overflow', 'update_invoice', {
    invoiceID: 'fixture-invoice',
    invoices: { Invoices: '[{"LineItems":[{"UnitAmount":1e400}]}]' },
  }],
  ['wrong camelCase amount type', 'update_invoice', {
    invoiceID: 'fixture-invoice',
    invoices: { invoices: [{ lineItems: [{ unitAmount: 'private-fixture-value' }] }] },
  }],
  ['malformed encoded array', 'update_invoice', {
    invoiceID: 'fixture-invoice', invoices: { Invoices: '[invalid]' },
  }],
  ['colliding array aliases', 'update_invoice', {
    invoiceID: 'fixture-invoice', invoices: { Invoices: [{ LineItems: [], lineItems: [] }] },
  }],
  ['colliding snake-case amount aliases', 'update_invoice', {
    invoiceID: 'fixture-invoice',
    invoices: { Invoices: [{ LineItems: [{ unitAmount: 1, unit_amount: 2 }] }] },
  }],
  ['unsupported array decoding on a read tool', 'list_invoices', { contactIDs: '["fixture-contact"]' }],
  ['wrong boolean type', 'list_contacts', { includeArchived: 'false' }],
  ...['ContactID', 'contactID'].flatMap((key): [string, string, Record<string, unknown>][] =>
    [42, 'not-a-uuid'].map((value) => [
      `invalid ${key}: ${value}`, 'update_invoice', {
        invoiceID: 'fixture-invoice', invoices: { invoices: [{ contact: { [key]: value } }] },
      },
    ]),
  ),
];

beforeEach(() => jest.clearAllMocks());

async function withClient(run: (client: Client) => Promise<void>) {
  const instance = new XeroMcpServer('1.0.0');
  instance['configureTools']();
  const server = instance['mcpServer'];
  const client = new Client({ name: 'fixture-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function expectNoEffects() {
  expect(XeroClientSession.isAuthenticated).not.toHaveBeenCalled();
  expect(XeroClientSession.activeTenantId).not.toHaveBeenCalled();
  expect(Auditor.record).not.toHaveBeenCalled();
  for (const method of Object.values(XeroClientSession.xeroClient.accountingApi)) {
    expect(method).not.toHaveBeenCalled();
  }
}

function expectValidationError(result: unknown) {
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: expect.stringContaining('Invalid arguments for tool') }],
  });
  expect(JSON.stringify(result)).not.toContain('private-fixture-value');
}

it('rejects an unknown tool as a protocol error before error conversion or effects', async () => {
  await withClient(async (client) => {
    await expect(client.callTool({ name: 'unknown' })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expectNoEffects();
  });
});

it.each(cases)('rejects %s before audit, authentication or API calls', async (_case, name, args) => {
  await withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    expectValidationError(result);
    expectNoEffects();
  });
});

it('preserves a valid payment listing through actual MCP dispatch', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: 'list_payments', arguments: { page: 1 } });
    expect(result.isError).not.toBe(true);
    expect(XeroClientSession.xeroClient.accountingApi.getPayments).toHaveBeenCalledWith(
      'fixture-tenant', undefined, undefined, undefined, 1,
    );
    expect(Auditor.record).toHaveBeenCalledWith('list_payments_begin');
    expect(Auditor.record).toHaveBeenCalledWith('list_payments_end');
  });
});

it.each([undefined, {}, { page: -1 }, { page: 0 }, { extra: 'unchanged' }])(
  'preserves omitted arguments, existing integer rules and additional fields: %j', async (args) => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'list_payments', arguments: args });
      expect(result.isError).not.toBe(true);
      expect(XeroClientSession.xeroClient.accountingApi.getPayments).toHaveBeenCalledWith(
        'fixture-tenant', undefined, undefined, undefined, args?.page,
      );
    });
  },
);

const bankTransaction = {
  Type: 'SPEND',
  LineItems: [{ Description: '["A","B"]', Quantity: 1, UnitAmount: -2.5, AccountCode: '400' }],
  BankAccount: { Code: '090' },
};
const bankPayload = {
  bankTransactions: [{
    type: 'SPEND',
    lineItems: [{ description: '["A","B"]', quantity: 1, unitAmount: -2.5, accountCode: '400' }],
    bankAccount: { code: '090' },
  }],
};
const api = XeroClientSession.xeroClient.accountingApi;
it('preserves typed arrays and false boolean arguments on read tools', async () => {
  await withClient(async (client) => {
    const contacts = await client.callTool({ name: 'list_contacts', arguments: { includeArchived: false } });
    expect(contacts.isError).not.toBe(true);
    expect(api.getContacts).toHaveBeenCalledWith(
      'fixture-tenant', undefined, undefined, undefined, undefined, undefined, false, undefined, undefined,
    );
    const invoices = await client.callTool({ name: 'list_invoices', arguments: { contactIDs: ['fixture-contact'] } });
    expect(invoices.isError).not.toBe(true);
    expect(api.getInvoices).toHaveBeenCalledWith(
      'fixture-tenant', undefined, undefined, undefined, undefined, undefined, ['fixture-contact'], undefined, undefined, undefined,
    );
  });
});
const writeCases = [
  {
    name: 'create_contacts',
    args: { Contacts: '[{"Name":"[1,2]","AccountNumber":"001"}]' },
    method: api.createContacts,
    sent: ['fixture-tenant', { contacts: [{ name: '[1,2]', accountNumber: '001' }] }],
  },
  {
    name: 'create_bank_transactions',
    args: { bankTransactions: JSON.stringify([bankTransaction]) },
    method: api.createBankTransactions,
    sent: ['fixture-tenant', bankPayload],
  },
  {
    name: 'update_bank_transaction',
    args: {
      bankTransactionID: 'fixture-transaction',
      bankTransactions: { BankTransactions: JSON.stringify([bankTransaction]) },
      unitdp: 4, idempotencyKey: 'fixture-idempotency',
    },
    method: api.updateBankTransaction,
    sent: ['fixture-tenant', 'fixture-transaction', bankPayload, 4, 'fixture-idempotency'],
  },
  {
    name: 'update_invoice',
    args: {
      invoiceID: 'fixture-invoice',
      invoices: { invoices: JSON.stringify([{ Reference: '[1,2]', LineItems: JSON.stringify([{ UnitAmount: -2.5 }]) }]) },
    },
    method: api.updateInvoice,
    sent: ['fixture-tenant', 'fixture-invoice', { invoices: [{ reference: '[1,2]', lineItems: [{ unitAmount: -2.5 }] }] }, undefined, undefined],
  },
];

it.each(writeCases)('preserves decoded payloads and original input for $name', async ({ name, args, method, sent }) => {
  const original = structuredClone(args);
  await withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(method).toHaveBeenCalledTimes(1);
    expect(method).toHaveBeenCalledWith(...sent);
    expect(args).toEqual(original);
  });
});

it.each(['ContactID', 'contactID'])('preserves %s through SDK serialisation', async (key) => {
  const id = '00000000-0000-0000-0000-000000000000';
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'update_invoice',
      arguments: { invoiceID: 'fixture-invoice', invoices: { invoices: [{ contact: { [key]: id } }] } },
    });
    expect(result.isError).not.toBe(true);
    const payload = jest.mocked(api.updateInvoice).mock.calls[0][2];
    expect(ObjectSerializer.serialize(payload, 'Invoices')).toMatchObject({
      Invoices: [{ Contact: { ContactID: id } }],
    });
  });
});

it.each([
  ['create_contacts', undefined, api.createContacts, 1, 'Contacts'],
  ['create_bank_transactions', undefined, api.createBankTransactions, 1, 'BankTransactions'],
  ['update_bank_transaction', 'bankTransactions', api.updateBankTransaction, 2, 'BankTransactions'],
  ['update_invoice', 'invoices', api.updateInvoice, 2, 'Invoices'],
] as const)('accepts the published JSON payload for %s', async (name, property, method, position, model) => {
  const tool = McpToolsFactory.findToolByName(name)!;
  const schema = tool.requestSchema.inputSchema;
  const example = property
    ? (schema.properties![property] as { example: string }).example
    : schema.example;
  const payload = JSON.parse(example as string);
  const args = property ? {
    [property === 'invoices' ? 'invoiceID' : 'bankTransactionID']: 'fixture-id',
    [property]: payload,
  } : payload;
  await withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(method).toHaveBeenCalledTimes(1);
    const serialised = ObjectSerializer.serialize(jest.mocked(method).mock.calls[0][position], model);
    if (name !== 'create_contacts') {
      expect(serialised[model][0].Contact.ContactID).toBe('00000000-0000-0000-0000-000000000000');
    }
  });
});

it('compiles every registered schema and accepts complete synthetic fixtures', () => {
  const fixtures: Record<string, Record<string, unknown>> = {
    authenticate: {},
    create_contacts: { Contacts: [{ Name: 'Fixture' }] },
    create_bank_transactions: { BankTransactions: [bankTransaction] },
    get_bank_transaction: { bankTransactionID: 'fixture-transaction' },
    get_invoice: { invoiceID: 'fixture-invoice' },
    update_bank_transaction: {
      bankTransactionID: 'fixture-transaction', bankTransactions: { BankTransactions: [bankTransaction] },
    },
    update_invoice: { invoiceID: 'fixture-invoice', invoices: { Invoices: [{ Reference: 'Updated' }] } },
    get_balance_sheet: {},
    list_accounts: {},
    list_bank_transactions: {},
    list_contacts: {},
    list_invoices: {},
    list_organisations: {},
    list_payments: {},
    list_quotes: {},
  };
  const tools = McpToolsFactory.getAllTools();
  expect(tools.map((tool) => tool.requestSchema.name).sort()).toEqual(Object.keys(fixtures).sort());
  for (const tool of tools) {
    expect(() => validateToolArguments(tool, fixtures[tool.requestSchema.name])).not.toThrow();
  }
});

it.each(['1e400', '-1e400'])('rejects raw stdio overflow %s and keeps the connection usable', async (token) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = createInterface({ input: output });
  const replies = lines[Symbol.asyncIterator]();
  const instance = new XeroMcpServer('1.0.0');
  instance['configureTools']();
  const server = instance['mcpServer'];
  const exchange = async (request: string) => {
    input.write(request + '\n');
    const reply = await replies.next();
    expect(reply.done).toBe(false);
    return JSON.parse(reply.value!);
  };
  try {
    await server.connect(new StdioServerTransport(input, output));
    const initial = await exchange(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'fixture', version: '1.0.0' } },
    }));
    expect(initial.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const invalid = await exchange(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_payments","arguments":{"page":${token}}}}`);
    expect(invalid.id).toBe(2);
    expectValidationError(invalid.result);
    expectNoEffects();
    const valid = await exchange(JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_payments', arguments: { page: 1 } },
    }));
    expect(valid.id).toBe(3);
    expect(valid.result.isError).not.toBe(true);
    expect(api.getPayments).toHaveBeenCalledWith('fixture-tenant', undefined, undefined, undefined, 1);
  } finally {
    await server.close();
    lines.close();
    input.destroy();
    output.destroy();
  }
});
