jest.mock('dotenv/config', () => ({}));

const tokenSet: Record<string, unknown> = {};

jest.mock('xero-node', () => ({
  XeroClient: jest.fn().mockImplementation((config) => ({
    config,
    readTokenSet: () => tokenSet,
    refreshToken: jest.fn(),
    setTokenSet: jest.fn(),
  })),
}));

beforeEach(() => {
  jest.replaceProperty(process, 'env', {
    XERO_CLIENT_ID: 'synthetic',
    XERO_CLIENT_SECRET: 'synthetic',
    XERO_REDIRECT_URI: 'http://localhost:5000/callback',
  });
  for (const key of Object.keys(tokenSet)) delete tokenSet[key];
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// F108: the SDK hands back an empty token set before any login.
it('reports no authentication for the initial empty token set', () => {
  const { XeroClientSession: session } = require('./XeroApiClient.js');
  expect(session.isAuthenticated()).toBe(false);
});

it('reports authentication once an access token is present', () => {
  const { XeroClientSession: session } = require('./XeroApiClient.js');
  tokenSet.access_token = 'synthetic-access-token';
  expect(session.isAuthenticated()).toBe(true);
});
