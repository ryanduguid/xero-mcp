jest.mock('dotenv/config', () => ({}));
jest.mock('xero-node', () => ({ XeroClient: jest.fn().mockImplementation((config) => ({
  config, refreshToken: jest.fn(), setTokenSet: jest.fn(),
})) }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(100_000);
  jest.replaceProperty(process, 'env', {
    XERO_CLIENT_ID: 'synthetic', XERO_CLIENT_SECRET: 'synthetic',
    XERO_REDIRECT_URI: 'http://localhost:5000/callback',
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); jest.useRealTimers(); });

it.each([0.1, 1, 120, 180])('refreshes a token with %s seconds remaining before expiry', async (remaining) => {
  const { XeroClientSession: session } = require('./XeroApiClient.js');
  session.xeroClient.refreshToken.mockResolvedValue({});
  session.scheduleTokenRefresh({ expires_at: 100 + remaining });
  await jest.advanceTimersByTimeAsync(remaining * 1000 - 1);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(1);
});

it('backs off after a failure and replaces the retry timer after success', async () => {
  const { XeroClientSession: session } = require('./XeroApiClient.js');
  session.xeroClient.refreshToken.mockRejectedValueOnce(new Error('synthetic network failure')).mockResolvedValue({});
  session.scheduleTokenRefresh({ expires_at: 102 });
  await jest.advanceTimersByTimeAsync(1000);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(999);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(10000);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(2);
});

it('stops after three retries and cancels a pending retry on a new schedule', async () => {
  const { XeroClientSession: session } = require('./XeroApiClient.js');
  session.xeroClient.refreshToken.mockRejectedValue(new Error('synthetic network failure'));
  session.scheduleTokenRefresh({ expires_at: 102 });
  await jest.advanceTimersByTimeAsync(20000);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(4);
  session.scheduleTokenRefresh({ expires_at: 122 });
  await jest.advanceTimersByTimeAsync(1000);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(5);
  session.scheduleTokenRefresh({});
  await jest.advanceTimersByTimeAsync(20000);
  expect(session.xeroClient.refreshToken).toHaveBeenCalledTimes(5);
});

it('creates a separate authentication client and ignores refresh results from the previous client', async () => {
  const { XeroClientSession: session } = require('./XeroApiClient.js');
  const previous = session.xeroClient;
  const next = session.createAuthenticationClient();
  expect(next).not.toBe(previous);
  let finish!: (value: unknown) => void;
  previous.refreshToken.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  session.scheduleTokenRefresh({ expires_at: 102 });
  await jest.advanceTimersByTimeAsync(1000);
  session.xeroClient = next;
  finish({ expires_at: 500 });
  await jest.advanceTimersByTimeAsync(0);
  expect(next.setTokenSet).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
