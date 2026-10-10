import { createServer } from 'node:http';
import { checkWebsite, ValidationError } from './checker.js';

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}
let activeChecks = 0;
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { status: 'ok' });
  if (request.method === 'GET' && request.url === '/demo/ok') return json(response, 200, { message: 'Demo website is available.' });
  if (request.method === 'GET' && request.url === '/demo/error') return json(response, 503, { message: 'Demo website is unavailable.' });
  if (request.method === 'GET' && request.url === '/demo/slow') {
    const timer = setTimeout(() => json(response, 200, { message: 'Slow demo' }), 12_000);
    response.on('close', () => clearTimeout(timer));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/check') return json(response, 404, { error: 'Маршрут не найден.' });
  if (activeChecks >= 5) return json(response, 429, { error: 'Сервис занят. Повторите запрос немного позже.' });
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(response, 415, { error: 'Требуется application/json.' });
  activeChecks++;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 16_384) return json(response, 413, { error: 'Слишком большой запрос.' });
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ValidationError('Некорректный JSON.'); }
    json(response, 200, await checkWebsite(body?.url));
  } catch (error) {
    if (error instanceof ValidationError) return json(response, 400, { error: error.message });
    console.error('Check failed:', error.code ?? error.name);
    json(response, 500, { error: 'Ошибка сервиса проверки.' });
  } finally { activeChecks--; }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 4000), '0.0.0.0', () => console.log('Web service listening on port 4000'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8_000).unref();
});
