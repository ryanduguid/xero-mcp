import http from 'http';

jest.mock('../XeroApiClient.js', () => ({ XeroClientSession: {} }));
jest.mock('open', () => ({ __esModule: true, default: jest.fn() }));

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
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
