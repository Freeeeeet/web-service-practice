import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../src/app.js';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('rejects malformed input before calling database', async t => {
  const url = await serve(t, createHandler({ query: () => { throw new Error('Unexpected DB call'); } }));
  for (const body of ['null', '[]', '{', '{}', '{"url":42}']) {
    const response = await fetch(`${url}/api/checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400, body);
  }
  const wrongType = await fetch(`${url}/api/checks`, { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  assert.equal((await fetch(`${url}/api/checks?status=invalid`)).status, 400);
});

test('saves checker result with SQL parameters and returns created record', async t => {
  const check = { url: 'https://example.com/', final_url: 'https://example.com/', status: 'up', http_status: 200, response_time_ms: 25, error: null, is_demo: false };
  const service = await serve(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(check)); });
  let parameters;
  const api = await serve(t, createHandler({ query: async (_sql, params) => { parameters = params; return { rows: [{ id: '1', ...check }] }; } }, service));
  const response = await fetch(`${api}/api/checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: check.url }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).check.id, '1');
  assert.deepEqual(parameters, [check.url, check.final_url, 'up', 200, 25, null, false]);
});

test('upstream failure does not create a fake website result', async t => {
  const service = await serve(t, (_req, res) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Service failed"}'); });
  let writes = 0;
  const api = await serve(t, createHandler({ query: () => { writes++; } }, service));
  const response = await fetch(`${api}/api/checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://example.com"}' });
  assert.equal(response.status, 502);
  assert.equal(writes, 0);
});
