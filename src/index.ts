#!/usr/bin/env node
import { XeroMcpServer } from "./XeroMcpServer.js";
import { getPackageVersion } from "./Utils/getPackageVersion.js";

const server = new XeroMcpServer(getPackageVersion(import.meta.url));
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});