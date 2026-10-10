import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkWebsite, isPublicAddress, requestHeaders, validateUrl, ValidationError } from '../src/checker.js';

test('accepts public HTTP(S) URLs and strips fragments', () => {
  assert.equal(validateUrl('https://example.com/path#top').href, 'https://example.com/path');
  assert.equal(validateUrl('http://8.8.8.8').hostname, '8.8.8.8');
});

for (const value of ['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'http://localhost', 'http://localhost.', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://10.1.2.3', 'http://169.254.169.254', 'http://192.168.1.1', 'http://[::1]', 'https://example.com:1234', 'http://db', 'http://web-service:4000/health']) {
  test(`rejects unsafe target ${value}`, () => assert.throws(() => validateUrl(value), ValidationError));
}

test('blocks non-public IPv4 ranges', () => {
  for (const address of ['100.64.0.1', '172.16.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});

test('allows only exact demo URLs and rejects them on public redirects', () => {
  assert.equal(validateUrl('http://web-service:4000/demo/ok').pathname, '/demo/ok');
  assert.throws(() => validateUrl('http://web-service:4000/demo/ok?x=1'), ValidationError);
  assert.throws(() => validateUrl('http://web-service:4000/demo/ok', { allowDemo: false }), ValidationError);
});

const publicDns = async () => '8.8.8.8';
test('records HTTP failure and success independently of transport success', async () => {
  for (const code of [200, 204, 304, 404, 503]) {
    const result = await checkWebsite('https://example.com', { resolveAddress: publicDns, request: async () => ({ status: code }) });
    assert.equal(result.http_status, code);
    assert.equal(result.status, code < 400 ? 'up' : 'down');
    assert.equal(result.is_demo, false);
  }
});
test('rejects DNS results that resolve to a private address before sending HTTP', async () => {
  let called = false;
  await assert.rejects(checkWebsite('https://example.com', { resolveAddress: async () => '10.0.0.1', request: async () => { called = true; } }), ValidationError);
  assert.equal(called, false);
});
test('rejects redirects to private targets and local demo', async () => {
  for (const location of ['http://127.0.0.1', 'http://web-service:4000/demo/ok']) {
    await assert.rejects(checkWebsite('https://example.com', { resolveAddress: publicDns, request: async () => ({ status: 302, location }) }), ValidationError);
  }
});
test('follows relative redirects with a fresh validated resolution', async () => {
  let resolutions = 0;
  const result = await checkWebsite('https://example.com/start', {
    resolveAddress: async () => { resolutions++; return '8.8.8.8'; },
    request: async url => url.pathname === '/start' ? { status: 302, location: '/end' } : { status: 200 },
  });
  assert.equal(result.final_url, 'https://example.com/end');
  assert.equal(result.status, 'up');
  assert.equal(resolutions, 2);
});
test('bounds redirect loops', async () => {
  let calls = 0;
  const result = await checkWebsite('https://example.com', { resolveAddress: publicDns, request: async () => { calls++; return { status: 302, location: '/' }; } });
  assert.equal(calls, 4);
  assert.equal(result.status, 'down');
  assert.match(result.error, /перенаправлений/);
});
test('stores DNS/network failures as down', async () => {
  const result = await checkWebsite('https://not-found.example', { resolveAddress: async () => { throw Object.assign(new Error('DNS failure'), { code: 'ENOTFOUND' }); } });
  assert.equal(result.status, 'down');
  assert.equal(result.http_status, null);
  assert.match(result.error, /IPv4/);
});
test('HTTP transport pins the address and preserves the original Host', async (t) => {
  let host;
  const fixture = createServer((req, res) => { host = req.headers.host; res.writeHead(200); res.end('ok'); });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fixture.close(resolve)));
  const port = fixture.address().port;
  const result = await requestHeaders(new URL(`http://unresolvable.example:${port}/`), '127.0.0.1', AbortSignal.timeout(1_000));
  assert.equal(result.status, 200);
  assert.equal(host, `unresolvable.example:${port}`);
});
test('global timeout interrupts a slow HTTP request', async (t) => {
  const fixture = createServer((_req, _res) => {});
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => { fixture.closeAllConnections(); fixture.close(); });
  const port = fixture.address().port;
  const result = await checkWebsite('https://example.com', {
    timeoutMs: 40, resolveAddress: publicDns,
    request: (_url, _address, signal) => requestHeaders(new URL(`http://127.0.0.1:${port}`), '127.0.0.1', signal),
  });
  assert.equal(result.status, 'down');
  assert.match(result.error, /ожидания/);
});
