import express, { type Request, type Response, type NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CacheManager } from './cache/CacheManager.js';
import { createMcpServer } from './server-factory.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('http');

export async function startHttpServer(cacheManager: CacheManager): Promise<void> {
  const port = Number(process.env.MCP_HTTP_PORT ?? 3000);
  const bind = process.env.MCP_BIND ?? '0.0.0.0';
  const token = process.env.MCP_AUTH_TOKEN;
  const path = process.env.MCP_HTTP_PATH ?? '/mcp';

  if (!token && bind !== '127.0.0.1' && bind !== 'localhost') {
    throw new Error(
      'Refusing to bind on a non-loopback address without MCP_AUTH_TOKEN set. ' +
      'Either set MCP_AUTH_TOKEN, or set MCP_BIND=127.0.0.1 for localhost-only.'
    );
  }

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const requireBearer = (req: Request, res: Response, next: NextFunction) => {
    if (!token) return next();
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || match[1] !== token) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
      return;
    }
    next();
  };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Stateless mode: spin up a fresh Server + transport per request.
  // Cache and permissions remain shared via the module-level singletons.
  app.post(path, requireBearer, async (req, res) => {
    try {
      const server = await createMcpServer(cacheManager);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode does not support GET (SSE) or DELETE (session teardown).
  app.get(path, requireBearer, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method Not Allowed' },
      id: null,
    });
  });
  app.delete(path, requireBearer, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method Not Allowed' },
      id: null,
    });
  });

  await new Promise<void>((resolve) => {
    app.listen(port, bind, () => {
      logger.info(`MCP HTTP server listening on http://${bind}:${port}${path}`);
      if (!token) {
        logger.warn('MCP_AUTH_TOKEN is not set — endpoint is unauthenticated (loopback only).');
      }
      resolve();
    });
  });
}
