jest.mock('dotenv/config', () => ({}));
jest.mock('../Tools/Authenticate.js', () => ({
  AuthenticateTool: { requestSchema: { name: 'authenticate' }, requestHandler: jest.fn() },
}));
jest.mock('xero-node', () => ({ XeroClient: jest.fn().mockImplementation((config) => {
  let tokenSet = {};
  return {
    config,
    readTokenSet: () => tokenSet,
    setTokenSet: jest.fn((value) => { tokenSet = value; }),
    refreshToken: jest.fn(),
  };
}) }));

const fixtureTokenSet = (access_token: string, expires_at: number) => ({
  access_token, expires_at, expired: () => expires_at <= Date.now() / 1000,
});
const request = { method: 'tools/call' as const, params: { name: 'list_invoices', arguments: {} } };
const authenticateFirst = {
  isError: true,
  content: [{
    type: 'text',
    text: 'You must authenticate with Xero first. Call the authenticate tool to open the Xero login page.',
  }],
};

let session: any;
let XeroAuthMiddleware: any;
let next: jest.Mock;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000_000);
  jest.replaceProperty(process, 'env', {
    XERO_CLIENT_ID: 'synthetic', XERO_CLIENT_SECRET: 'synthetic',
    XERO_REDIRECT_URI: 'http://localhost:5000/callback',
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ({ XeroClientSession: session } = require('../XeroApiClient.js'));
  ({ XeroAuthMiddleware } = require('./XeroAuthMiddleware.js'));
  next = jest.fn(async () => ({
    content: [{ type: 'text', text: session.xeroClient.readTokenSet().access_token }],
  }));

  // Log in, then stay idle until the scheduled refresh stops and the access token expires.
  const login = fixtureTokenSet('synthetic-first', 1_000_000 + 1800);
  session.xeroClient.setTokenSet(login);
  session.setActiveTenantId('fixture-tenant');
  session.scheduleTokenRefresh(login);
  await jest.advanceTimersByTimeAsync(2000 * 1000);
  expect(jest.getTimerCount()).toBe(0);
  expect(session.xeroClient.refreshToken).not.toHaveBeenCalled();
  expect(session.xeroClient.readTokenSet().expired()).toBe(true);
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); jest.useRealTimers(); });

const refreshed = () => fixtureTokenSet('synthetic-second', Date.now() / 1000 + 1800);

it('refreshes an expired token after the idle stop and proceeds', async () => {
  session.xeroClient.refreshToken.mockImplementation(async () => refreshed());
  await expect(XeroAuthMiddleware(request, next)).resolves.toEqual({
    content: [{ type: 'text', text: 'synthetic-second' }],
  });
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(1);
});

it('asks for authentication when the refresh fails, then refreshes afresh on the next call', async () => {
  session.xeroClient.refreshToken
    .mockRejectedValueOnce(new Error('synthetic invalid_grant'))
    .mockImplementation(async () => refreshed());
  await expect(XeroAuthMiddleware(request, next)).resolves.toEqual(authenticateFirst);
  expect(next).not.toHaveBeenCalled();
  await expect(XeroAuthMiddleware(request, next)).resolves.toEqual({
    content: [{ type: 'text', text: 'synthetic-second' }],
  });
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(2);
});

// An unhandled rejection here crashes the Jest run, so it needs no assertion.
it('asks every caller sharing a failed refresh to authenticate', async () => {
  const pending: (() => void)[] = [];
  session.xeroClient.refreshToken.mockImplementation(
    () => new Promise((_, reject) => { pending.push(() => reject(new Error('synthetic invalid_grant'))); }),
  );
  const calls = Promise.all([XeroAuthMiddleware(request, next), XeroAuthMiddleware(request, next)]);
  await jest.advanceTimersByTimeAsync(0);
  pending.forEach(fail => fail());
  await expect(calls).resolves.toEqual([authenticateFirst, authenticateFirst]);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
});

it('shares one refresh between concurrent calls', async () => {
  const pending: (() => void)[] = [];
  session.xeroClient.refreshToken.mockImplementation(
    () => new Promise(resolve => { pending.push(() => resolve(refreshed())); }),
  );
  const calls = Promise.all([XeroAuthMiddleware(request, next), XeroAuthMiddleware(request, next)]);
  await jest.advanceTimersByTimeAsync(0);
  pending.forEach(finish => finish());
  const results = await calls;
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(1);
  expect(results.map((result: any) => result.content[0].text)).toEqual(['synthetic-second', 'synthetic-second']);
});
