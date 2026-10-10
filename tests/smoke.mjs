// Runs inside the existing backend container against frontend -> backend -> checker + PostgreSQL.
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL ?? 'http://frontend';
async function get(path) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}
async function post(url, expectedCode = 201) {
  const response = await fetch(`${base}/api/checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  assert.equal(response.status, expectedCode, url);
  return response.json();
}
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /Пульс/);
assert.equal((await get('/api/health')).web_service, 'connected');
const before = (await get('/api/checks')).summary.total;
const { check: ok } = await post('http://web-service:4000/demo/ok');
assert.equal(ok.status, 'up'); assert.equal(ok.http_status, 200); assert.equal(ok.is_demo, true);
const { check: bad } = await post('http://web-service:4000/demo/error');
assert.equal(bad.status, 'down'); assert.equal(bad.http_status, 503);
const { check: slow } = await post('http://web-service:4000/demo/slow');
assert.equal(slow.status, 'down'); assert.equal(slow.http_status, null);
assert.ok(slow.response_time_ms >= 7_900 && slow.response_time_ms < 11_000);
await post('http://127.0.0.1', 400);
await post('file:///etc/passwd', 400);
await post('http://db:5432', 400);
const journal = await get('/api/checks');
assert.equal(journal.summary.total, before + 3);
assert.ok(journal.checks.some(row => row.id === ok.id));
const down = await get('/api/checks?status=down');
assert.ok(down.checks.length > 0 && down.checks.every(row => row.status === 'down'));
console.log('PASS: frontend, health, HTTP 200/503, timeout, private URL rejection, DB persistence and filtering.');
console.log(`Created demo records: ${ok.id}, ${bad.id}, ${slow.id}`);
