import {CallToolRequestSchema, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js';
import {XeroMcpServer} from './XeroMcpServer.js';
import {XeroAuthMiddleware} from './Middlewares/XeroAuthMiddleware.js';

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({setRequestHandler: jest.fn()})),
}));
jest.mock('./Tools/McpToolsFactory.js', () => ({
  McpToolsFactory: {getAllTools: () => [], findToolByName: () => undefined},
}));
jest.mock('./Middlewares/XeroAuthMiddleware.js', () => ({XeroAuthMiddleware: jest.fn()}));

it('rejects an unknown tool as a protocol error before authentication or error conversion', async () => {
  const server = new XeroMcpServer() as any;
  server.configureTools();
  const handler = server.mcpServer.setRequestHandler.mock.calls.find(([schema]: any[]) => schema === CallToolRequestSchema)[1];
  const result = handler({method: 'tools/call', params: {name: 'unknown'}});
  await expect(result).rejects.toBeInstanceOf(McpError);
  await expect(result).rejects.toMatchObject({code: ErrorCode.InvalidParams});
  expect(XeroAuthMiddleware).not.toHaveBeenCalled();
});
