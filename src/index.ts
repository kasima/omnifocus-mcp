#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CacheManager } from './cache/CacheManager.js';
import { PermissionChecker } from './utils/permissions.js';
import { createLogger } from './utils/logger.js';
import { createMcpServer } from './server-factory.js';
import { startHttpServer } from './http-server.js';

const logger = createLogger('server');

async function runStdio(cacheManager: CacheManager) {
  const server = await createMcpServer(cacheManager);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  const cacheManager = new CacheManager();

  // Permission check is non-blocking; tools surface errors when invoked without permission.
  PermissionChecker.getInstance()
    .checkPermissions()
    .then(result => {
      if (!result.hasPermission) {
        logger.warn('OmniFocus permissions not granted. Tools will provide instructions when used.');
        if (result.instructions) {
          logger.info('Permission instructions:', result.instructions);
        }
      } else {
        logger.info('OmniFocus permissions verified');
      }
    })
    .catch(error => {
      logger.error('Failed to check permissions:', error);
    });

  const transport = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
  if (transport === 'http') {
    await startHttpServer(cacheManager);
  } else if (transport === 'stdio') {
    await runStdio(cacheManager);
  } else {
    throw new Error(`Unknown MCP_TRANSPORT: ${transport}. Expected "stdio" or "http".`);
  }
}

main().catch((error) => {
  console.error('Server startup error:', error);
  process.exit(1);
});
