import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { getPackageVersion } from './getPackageVersion.js';

// F111: the MCP initialise response must identify the installed package.
it('returns the version declared in package.json', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf-8'));
  const entryUrl = pathToFileURL('src/index.ts').href;
  expect(getPackageVersion(entryUrl)).toBe(manifest.version);
});

it('falls back to a placeholder when the manifest cannot be read', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const entryUrl = pathToFileURL('no-such-directory/nested/index.js').href;
  expect(getPackageVersion(entryUrl)).toBe('0.0.0');
  jest.restoreAllMocks();
});
