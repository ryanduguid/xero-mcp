import { CreateContactsTool } from './Contacts.js';
import { XeroClientSession } from '../../XeroApiClient.js';
import { parseArrayValues } from '../../Utils/parseArrayValues.js';
import { convertToCamelCase } from '../../Utils/convertToCamelCase.js';

jest.mock('../../XeroApiClient.js', () => ({
  XeroClientSession: {
    activeTenantId: () => 'test-tenant',
    xeroClient: {
      accountingApi: {
        createContacts: jest.fn(async (_tenant, payload) => ({ body: payload })),
      },
    },
  },
}));

const input = { Contacts: [{ Name: "O'Brien & Sons" }] };

it('preserves the contact name through array parsing and camel-case conversion', () => {
  const payload = convertToCamelCase(
    parseArrayValues(input, CreateContactsTool.requestSchema.inputSchema)
  );
  expect(Buffer.from(payload.contacts[0].name)).toEqual(Buffer.from(input.Contacts[0].Name));
});

it('sends the original contact name to the typed Xero client', async () => {
  await CreateContactsTool.requestHandler({
    method: 'tools/call',
    params: { name: 'create_contacts', arguments: input },
  });
  expect(XeroClientSession.xeroClient.accountingApi.createContacts).toHaveBeenCalledWith(
    'test-tenant', { contacts: [{ name: "O'Brien & Sons" }] },
  );
});
