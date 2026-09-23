import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { createWorkerServices } from './service.ts';
export function createWorkerServer(worker: ReturnType<typeof createWorkerServices>, token: string) {
  if (token.length < 32) throw new Error('MYPI_WORKER_TOKEN must contain at least 32 characters');
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? ''),
      expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/rpc') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 15 * 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (
        !body ||
        typeof body.method !== 'string' ||
        !Array.isArray(body.args) ||
        body.args.length > 5 ||
        !Object.hasOwn(worker.services, body.method)
      )
        throw Object.assign(new Error('Invalid worker method'), {
          statusCode: 400,
          code: 'INVALID_INPUT',
        });
      if (body.method !== 'importProject' && bytes > 128 * 1024)
        throw Object.assign(new Error('Worker command too large'), {
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
        });
      const fn = (worker.services as Record<string, (...args: any[]) => Promise<unknown>>)[
        body.method
      ];
      const data = await fn(...body.args);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data }));
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; message?: string };
      res.writeHead(e.statusCode ?? 500, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          error: {
            code: e.code ?? 'INTERNAL_ERROR',
            message: e.statusCode ? e.message : 'Worker operation failed',
            statusCode: e.statusCode ?? 500,
          },
        }),
      );
    }
  });
  server.requestTimeout = 30000;
  return server;
}
