import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import {
  createPublicModelFetch,
  normalizeModelBaseUrl,
} from '../packages/model-network/src/index.ts';

test('custom endpoints reject private URLs, credentials, fragments and full operation paths', () => {
  assert.equal(
    normalizeModelBaseUrl(' https://Gateway.EXAMPLE.com:8443/v1/// '),
    'https://gateway.example.com:8443/v1',
  );
  for (const url of [
    'http://gateway.example.com/v1',
    'https://localhost/v1',
    'https://10.0.0.1/v1',
    'https://127.1/v1',
    'https://0x7f000001/v1',
    'https://2130706433/v1',
    'https://169.254.169.254',
    'https://[::1]/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://192.168.0.1',
    'https://100.64.0.1',
    'https://user:secret@gateway.example.com/v1',
    'https://gateway.example.com/v1?key=secret',
    'https://gateway.example.com/v1#secret',
    'https://gateway.internal/v1',
    'https://metadata.google.internal',
    'https://gateway.example.com/v1/chat/completions',
    'https://gateway.example.com/v1/responses',
  ])
    assert.throws(() => normalizeModelBaseUrl(url), Error, url);
});

test('custom model fetch pins public DNS, streams responses and rejects rebinding, redirects, oversized bodies and cancellation', async () => {
  let status = 200,
    oversized = false,
    stalled = false;
  let calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    for await (const _ of req) {
      /* consume fixture request */
    }
    if (stalled) return;
    res.writeHead(status, {
      'content-type': 'text/event-stream',
      ...(status === 302 ? { location: 'http://169.254.169.254/' } : {}),
    });
    res.write('data: OK\n\n');
    res.end(oversized ? 'x'.repeat(100) : 'data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  let answers = [{ address: '8.8.8.8', family: 4 }];
  let pinned = '';
  const guarded = createPublicModelFetch('https://model.example.com/v1', {
    resolveDns: async () => answers,
    maxBytes: 64,
    request: ((url: URL, options: any, callback: any) => {
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.servername, 'model.example.com');
      assert.equal(options.agent, false);
      assert.equal(options.headers.host, undefined);
      options.lookup('model.example.com', {}, (_err: unknown, address: string) => {
        pinned = address;
      });
      return httpRequest(
        `http://127.0.0.1:${port}${url.pathname}`,
        { method: options.method, headers: options.headers, signal: options.signal, agent: false },
        callback,
      );
    }) as any,
  });
  const post = (signal?: AbortSignal) =>
    guarded('https://model.example.com/v1/chat/completions', {
      method: 'POST',
      body: '{}',
      signal,
    });
  try {
    assert.equal(await (await post()).text(), 'data: OK\n\ndata: [DONE]\n\n');
    assert.equal(pinned, '8.8.8.8');
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
      answers = [
        { address: '8.8.8.8', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ];
      await assert.rejects(post(), /DNS/);
    }
    assert.equal(calls, 1);
    answers = [{ address: '8.8.4.4', family: 4 }];
    await (await post()).text();
    assert.equal(pinned, '8.8.4.4'); // No cached validation or second, unpinned DNS lookup.
    await assert.rejects(
      guarded('https://evil.example.com/v1/chat/completions', { method: 'POST' }),
      /端点/,
    );
    await assert.rejects(guarded('https://model.example.com/admin', { method: 'POST' }), /端点/);
    await assert.rejects(guarded('https://model.example.com/v1/models'), /端点/);
    status = 302;
    await assert.rejects(post(), /重定向/);
    status = 200;
    oversized = true;
    const response = await post();
    await assert.rejects(response.text(), /大小限制/);
    oversized = false;
    stalled = true;
    const abort = new AbortController();
    const pending = post(abort.signal);
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(pending, { name: 'AbortError' });
    const dnsTimeout = createPublicModelFetch('https://model.example.com/v1', {
      resolveDns: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    await assert.rejects(
      dnsTimeout('https://model.example.com/v1/chat/completions', { method: 'POST' }),
      { name: 'TimeoutError' },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
