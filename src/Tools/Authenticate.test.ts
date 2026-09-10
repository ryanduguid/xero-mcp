import http from 'http';

jest.mock('../XeroApiClient.js', () => ({
  XeroClientSession: {
    xeroClient: {
      config: {},
      buildConsentUrl: jest.fn(async function (this: any) {
        return `https://example.invalid/consent?state=${this.config.state ?? ''}`;
      }),
      apiCallback: jest.fn(async () => ({ access_token: 'synthetic-token' })),
      setTokenSet: jest.fn(), updateTenants: jest.fn(), tenants: [{ tenantId: 'synthetic-tenant' }],
    },
    setActiveTenantId: jest.fn(), scheduleTokenRefresh: jest.fn(),
  },
}));
jest.mock('open', () => ({ __esModule: true, default: jest.fn() }));

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
  jest.useRealTimers();
});

it('rejects a portless redirect URI before creating a callback server', () => {
  jest.replaceProperty(process, 'env', { XERO_REDIRECT_URI: 'http://localhost/callback' });
  const createServer = jest.spyOn(http, 'createServer');
  expect(() => require('./Authenticate.js')).toThrow(
    'XERO_REDIRECT_URI must include an explicit port, e.g. http://localhost:5000/callback',
  );
  expect(createServer).not.toHaveBeenCalled();
});

it('accepts a redirect URI with an explicit callback port', () => {
  jest.replaceProperty(process, 'env', { XERO_REDIRECT_URI: 'http://localhost:5000/callback' });
  expect(() => require('./Authenticate.js')).not.toThrow();
});

it.each(['http://0.0.0.0:5000/callback', 'http://example.invalid:5000/callback', 'https://localhost:5000/callback'])(
  'rejects a redirect that cannot use a local HTTP callback: %s', (uri) => {
    jest.replaceProperty(process, 'env', { XERO_REDIRECT_URI: uri });
    expect(() => require('./Authenticate.js')).toThrow(/loopback/);
  },
);

async function startLogin() {
  jest.replaceProperty(process, 'env', { XERO_REDIRECT_URI: 'http://localhost:5000/callback' });
  let handler: any;
  const server = {
    listen: jest.fn((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') callback();
    }),
    on: jest.fn((event: string, fn: any) => { if (event === 'request') handler = fn; }),
    once: jest.fn(), close: jest.fn(),
  };
  jest.spyOn(http, 'createServer').mockReturnValue(server as never);
  const { XeroClientSession: session } = require('../XeroApiClient.js');
  const { AuthenticateTool: tool } = require('./Authenticate.js');
  const openBrowser = require('open').default;
  openBrowser.mockResolvedValue({ kill: jest.fn() });
  const result = tool.requestHandler().catch((error: Error) => error);
  for (let i = 0; i < 10 && !handler; i++) await Promise.resolve();
  const state = new URL(await session.xeroClient.buildConsentUrl.mock.results[0].value).searchParams.get('state');
  return {
    result, state, session, server, tool,
    request: async (url: string) => {
      const response = { writeHead: jest.fn(), end: jest.fn() };
      await handler({ url }, response);
      return response;
    },
    callback: async (params: Record<string, string>) => {
      const response = { writeHead: jest.fn(), end: jest.fn() };
      await handler({ url: `/callback?${new URLSearchParams(params)}` }, response);
      return response;
    },
  };
}

it('binds fresh state to the SDK and refuses absent and wrong callback state', async () => {
  const login = await startLogin();
  expect(login.state).toMatch(/^[a-f0-9]{64}$/);
  expect(login.server.listen).toHaveBeenCalledWith(5000, '127.0.0.1', expect.any(Function));
  const malformed = await login.request('http://[invalid');
  expect(malformed.writeHead.mock.calls[0][0]).toBe(400);
  for (const state of [undefined, 'wrong-state']) {
    const response = await login.callback({ code: 'synthetic-code', ...(state ? { state } : {}) });
    expect(response.writeHead.mock.calls[0][0]).toBe(400);
    expect(login.session.xeroClient.apiCallback).not.toHaveBeenCalled();
  }
  await login.callback({ code: 'synthetic-code', state: login.state! });
  expect(await login.result).toMatchObject({ content: [{ text: 'Authenticated successfully' }] });
  expect(login.session.setActiveTenantId).toHaveBeenCalledWith('synthetic-tenant');
});

it('refuses a second login while one is pending and rejects its consumed state on the next attempt', async () => {
  const first = await startLogin();
  await expect(first.tool.requestHandler()).rejects.toThrow(/already in progress/);
  await first.callback({ code: 'synthetic-code', state: first.state! });
  await first.result;
  first.session.xeroClient.buildConsentUrl.mockClear();
  first.session.xeroClient.apiCallback.mockClear();
  const second = await startLogin();
  expect(second.state).not.toBe(first.state);
  const response = await second.callback({ code: 'synthetic-code', state: first.state! });
  expect(response.writeHead.mock.calls[0][0]).toBe(400);
  expect(second.session.xeroClient.apiCallback).not.toHaveBeenCalled();
  await second.callback({ code: 'synthetic-code', state: second.state! });
  await second.result;
});

it('accepts only one callback per login while the code exchange is pending', async () => {
  const login = await startLogin();
  let complete!: (value: unknown) => void;
  login.session.xeroClient.apiCallback.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const first = login.callback({ code: 'synthetic-code', state: login.state! });
  const repeated = await login.callback({ code: 'synthetic-code', state: login.state! });
  expect(repeated.writeHead.mock.calls[0][0]).toBe(400);
  expect(login.session.xeroClient.apiCallback).toHaveBeenCalledTimes(1);
  complete({ access_token: 'synthetic-token' });
  await first;
  await login.result;
});

it('expires an unanswered attempt and closes its listener', async () => {
  jest.useFakeTimers();
  const login = await startLogin();
  await jest.advanceTimersByTimeAsync(120_000);
  expect(await login.result).toEqual(new Error('Xero authentication timed out after 2 minutes.'));
  expect(login.server.close).toHaveBeenCalled();
  const expired = await login.callback({ code: 'synthetic-code', state: login.state! });
  expect(expired.writeHead.mock.calls[0][0]).toBe(400);
  expect(login.session.xeroClient.apiCallback).not.toHaveBeenCalled();
});

it('invalidates the attempt after a callback server error', async () => {
  const login = await startLogin();
  login.server.once.mock.calls[0][1](new Error('Synthetic listener error'));
  expect(await login.result).toEqual(new Error('Synthetic listener error'));
  const late = await login.callback({ code: 'synthetic-code', state: login.state! });
  expect(late.writeHead.mock.calls[0][0]).toBe(400);
  expect(login.session.xeroClient.apiCallback).not.toHaveBeenCalled();
});
