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

async function startLogin(uri = 'http://127.0.0.1:5000/callback', failures: Record<string, string> = {}) {
  jest.replaceProperty(process, 'env', { XERO_REDIRECT_URI: uri });
  let handler: any;
  const servers: any[] = [];
  jest.spyOn(http, 'createServer').mockImplementation(() => {
    const server = {
    listen: jest.fn((...args: any[]) => {
      const code = failures[args[1]];
      if (code) {
        server.once.mock.calls[0][1](Object.assign(new Error(code), { code }));
        return;
      }
      const callback = args[args.length - 1];
      if (typeof callback === 'function') callback();
    }),
    on: jest.fn((event: string, fn: any) => { if (event === 'request') handler = fn; }),
    once: jest.fn<void, [string, (error: Error) => void]>(), close: jest.fn(),
    };
    servers.push(server);
    return server as never;
  });
  const { XeroClientSession: session } = require('../XeroApiClient.js');
  const { AuthenticateTool: tool } = require('./Authenticate.js');
  const openBrowser = require('open').default;
  openBrowser.mockResolvedValue({ kill: jest.fn() });
  const result = tool.requestHandler().catch((error: Error) => error);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const state = new URL(await session.xeroClient.buildConsentUrl.mock.results[0].value).searchParams.get('state');
  return {
    result, state, session, server: servers[0], servers, tool, openBrowser,
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

it('listens on both loopback families for localhost and closes both after success', async () => {
  const login = await startLogin('http://localhost:5000/callback');
  expect(login.servers).toHaveLength(2);
  expect(login.servers.map(server => server.listen.mock.calls[0][1])).toEqual(['127.0.0.1', '::1']);
  expect(login.openBrowser).toHaveBeenCalledTimes(1);
  await login.callback({ code: 'synthetic-code', state: login.state! });
  await login.result;
  for (const server of login.servers) expect(server.close).toHaveBeenCalled();
});

it.each(['127.0.0.1', '::1'])('uses the other loopback family when %s is unavailable', async (host) => {
  const login = await startLogin('http://localhost:5000/callback', { [host]: 'EAFNOSUPPORT' });
  expect(login.openBrowser).toHaveBeenCalledTimes(1);
  await login.callback({ code: 'synthetic-code', state: login.state! });
  expect(await login.result).toMatchObject({ content: [{ text: 'Authenticated successfully' }] });
  for (const server of login.servers) expect(server.close).toHaveBeenCalled();
});

it('refuses a port conflict on either family without opening the browser', async () => {
  const login = await startLogin('http://localhost:5000/callback', { '::1': 'EADDRINUSE' });
  expect(await login.result).toMatchObject({ code: 'EADDRINUSE' });
  expect(login.openBrowser).not.toHaveBeenCalled();
  for (const server of login.servers) expect(server.close).toHaveBeenCalled();
});

it('fails and closes listeners when neither family is available', async () => {
  const login = await startLogin('http://localhost:5000/callback', { '127.0.0.1': 'EAFNOSUPPORT', '::1': 'EAFNOSUPPORT' });
  expect(await login.result).toBeInstanceOf(Error);
  expect(login.openBrowser).not.toHaveBeenCalled();
  for (const server of login.servers) expect(server.close).toHaveBeenCalled();
});

it('binds an explicit IPv6 redirect only to IPv6', async () => {
  const login = await startLogin('http://[::1]:5000/callback');
  expect(login.servers).toHaveLength(1);
  expect(login.server.listen).toHaveBeenCalledWith(5000, '::1', expect.any(Function));
  await login.callback({ code: 'synthetic-code', state: login.state! });
  await login.result;
});

it('serves the same callback over real IPv4 and IPv6 sockets and closes both', async () => {
  const reserve = http.createServer();
  await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  jest.replaceProperty(process, 'env', { XERO_REDIRECT_URI: `http://localhost:${port}/callback` });
  const servers: http.Server[] = [];
  const createServer = http.createServer;
  jest.spyOn(http, 'createServer').mockImplementation(() => {
    const server = createServer();
    servers.push(server);
    return server;
  });
  let opened!: (url: string) => void;
  const ready = new Promise<string>(resolve => { opened = resolve; });
  require('open').default.mockImplementation(async (url: string) => { opened(url); return { kill: jest.fn() }; });
  const { AuthenticateTool: tool } = require('./Authenticate.js');
  const result = tool.requestHandler();
  const request = (host: string, state: string) => new Promise<number | undefined>((resolve, reject) => {
    http.get({ host, port, path: `/callback?code=synthetic-code&state=${state}`, agent: false }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  try {
    const consentUrl = await Promise.race([ready, result.then(() => { throw new Error('Login ended before opening'); })]);
    const state = new URL(consentUrl).searchParams.get('state')!;
    expect(await request('127.0.0.1', 'wrong')).toBe(400);
    expect(await request('::1', 'wrong')).toBe(400);
    const closed = Promise.all(servers.map(server => new Promise<void>(resolve => server.once('close', resolve))));
    expect(await request('::1', state)).toBe(200);
    expect(await result).toMatchObject({ content: [{ text: 'Authenticated successfully' }] });
    await closed;
    for (const host of ['127.0.0.1', '::1']) {
      await expect(request(host, state)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    }
  } finally {
    if (servers.some(server => server.listening)) servers[0].emit('error', new Error('Test cleanup'));
    servers.forEach(server => server.close());
    await result.catch(() => {});
  }
});

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
