import { AuditMiddleware } from './AuditMiddleware.js';
import { Auditor } from '../Auditor.js';

it('records the end of a failed call and preserves its error', async () => {
  const record = jest.spyOn(Auditor, 'record').mockImplementation(() => {});
  const failure = new Error('synthetic failure');
  try {
    await expect(AuditMiddleware({ method: 'tools/call', params: { name: 'test' } }, async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(record.mock.calls).toEqual([['test_begin'], ['test_end']]);
  } finally { record.mockRestore(); }
});
