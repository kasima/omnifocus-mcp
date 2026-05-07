import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools } from './tools/index.js';
import { CacheManager } from './cache/CacheManager.js';

export async function createMcpServer(cacheManager: CacheManager): Promise<Server> {
  const server = new Server(
    {
      name: 'omnifocus-mcp-cached',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  await registerTools(server, cacheManager);
  return server;
}
