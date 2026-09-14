import { XeroAccountingApiSchema } from './xero_accounting.js';

describe('Accounting API resource examples', () => {
  test('JSON media examples contain structured values', () => {
    let examples = 0;
    function visit(value: unknown): void {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'application/json' && child && typeof child === 'object' && 'example' in child) {
          examples += 1;
          expect(typeof child.example).toBe('object');
          expect(child.example).not.toBeNull();
        }
        visit(child);
      }
    }
    visit(XeroAccountingApiSchema);
    expect(examples).toBeGreaterThan(0);
  });

  test('bank transaction requests use the wire field names', () => {
    const operations = XeroAccountingApiSchema.paths['/BankTransactions'];
    for (const operation of [operations.post, operations.put]) {
      const example = operation.requestBody.content['application/json'].example;
      const transaction = example.BankTransactions[0];
      expect(transaction.Type).toBe('SPEND');
      expect(transaction.LineItems).toHaveLength(1);
      expect(transaction).not.toHaveProperty('Lineitems');
      expect(transaction.LineItems[0].AccountCode).toEqual(expect.any(String));
    }
  });

  test('account code examples retain the declared string type', () => {
    const schemas = XeroAccountingApiSchema.components.schemas;
    for (const schema of [schemas.BudgetLine, schemas.JournalLine, schemas.ManualJournalLine]) {
      expect(schema.properties.AccountCode.type).toBe('string');
      expect(schema.properties.AccountCode.example).toEqual(expect.any(String));
    }
  });

  test('prepayment pagination describes prepayments', () => {
    const page = XeroAccountingApiSchema.paths['/Prepayments'].get.parameters.find(parameter => parameter.name === 'page');
    expect(page?.description).toContain('each prepayment');
    expect(page?.description).not.toContain('overpayment');
  });
});
