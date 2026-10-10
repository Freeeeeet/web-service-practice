import http from 'node:http';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

export class ValidationError extends Error {}
export const DEMO_URLS = new Set([
  'http://web-service:4000/demo/ok',
  'http://web-service:4000/demo/error',
  'http://web-service:4000/demo/slow',
]);
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');

export function isPublicAddress(address) {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

export function validateUrl(value, { allowDemo = true } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || !value.trim()) throw new ValidationError('Введите полный адрес сайта, например https://example.com.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new ValidationError('Некорректный URL. Укажите http:// или https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ValidationError('Разрешены только HTTP/HTTPS URL без логина и пароля.');
  url.hash = '';
  if (allowDemo && DEMO_URLS.has(url.href)) return url;
  if (url.port || url.hostname.startsWith('[')) throw new ValidationError('Используйте стандартный порт HTTP/HTTPS и сайт с IPv4-адресом.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (!hostname.includes('.') && !isIP(hostname))) throw new ValidationError('Локальные адреса недоступны для проверки.');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new ValidationError('Приватные и служебные IP-адреса недоступны для проверки.');
  return url;
}

export async function resolvePublicAddress(hostname, signal) {
  signal.throwIfAborted();
  if (isIP(hostname)) return hostname;
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const addresses = await resolver.resolve4(hostname);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new ValidationError('DNS сайта указывает на приватный или служебный адрес.');
    return addresses[0];
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export function requestHeaders(url, address, signal) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET', signal, agent: false,
      // Pin the validated DNS address; keep the original hostname for Host and TLS.
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
      headers: { 'User-Agent': 'UptimePractice/1.0', Accept: '*/*' },
      maxHeaderSize: 16_384,
    }, response => {
      resolve({ status: response.statusCode, location: response.headers.location });
      response.destroy(); // Stop after headers; do not download the entire site.
    });
    request.on('error', reject);
    request.end();
  });
}

export async function checkWebsite(value, {
  timeoutMs = 8_000, resolveAddress = resolvePublicAddress, request = requestHeaders,
} = {}) {
  const original = validateUrl(value);
  const isDemo = DEMO_URLS.has(original.href);
  const started = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let current = original;
  const result = { url: original.href, final_url: original.href, status: 'down', http_status: null, response_time_ms: 0, error: null, is_demo: isDemo };
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      signal.throwIfAborted();
      const address = isDemo && DEMO_URLS.has(current.href) ? '127.0.0.1' : await resolveAddress(current.hostname, signal);
      if (!(isDemo && DEMO_URLS.has(current.href)) && !isPublicAddress(address)) throw new ValidationError('Приватные адреса недоступны.');
      const response = await request(current, address, signal);
      result.http_status = response.status;
      result.final_url = current.href;
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
        if (redirects === 3) throw new Error('TOO_MANY_REDIRECTS');
        // Public websites cannot redirect into the private network or local demo.
        current = validateUrl(new URL(response.location, current).href, { allowDemo: false });
        continue;
      }
      result.status = response.status >= 200 && response.status < 400 ? 'up' : 'down';
      result.error = result.status === 'down' ? `HTTP ${response.status}` : null;
      break;
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    result.http_status = null;
    result.error = signal.aborted ? 'Время ожидания истекло (8 секунд).'
      : error.message === 'TOO_MANY_REDIRECTS' ? 'Слишком много перенаправлений.'
        : ['ENOTFOUND', 'ENODATA', 'EAI_AGAIN'].includes(error.code) ? 'Не удалось определить IPv4-адрес сайта.'
          : error.code?.includes('CERT') || error.code?.includes('TLS') ? 'Ошибка TLS-сертификата.'
            : 'Не удалось подключиться к сайту.';
  }
  result.response_time_ms = Math.max(0, Math.round(performance.now() - started));
  return result;
}
