import { HttpError, readJson, sendJson } from './http.js';

export function createHandler(pool, serviceUrl = process.env.WEB_SERVICE_URL ?? 'http://web-service:4000') {
  return async (request, response) => {
    try {
      const url = new URL(request.url, 'http://backend');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await pool.query('SELECT 1 FROM checks LIMIT 1');
        const health = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(2_000) });
        if (!health.ok) throw new Error('Web service unavailable');
        return sendJson(response, 200, { status: 'ok', database: 'connected', web_service: 'connected' });
      }

      if (request.method === 'GET' && url.pathname === '/api/checks') {
        const status = url.searchParams.get('status');
        if (status !== null && status !== 'up' && status !== 'down') throw new HttpError(400, 'Статус должен быть up или down.');
        const { rows } = await pool.query(
          'SELECT * FROM checks WHERE ($1::text IS NULL OR status = $1) ORDER BY checked_at DESC, id DESC LIMIT 100', [status],
        );
        const summary = await pool.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'up')::int AS up,
          COUNT(*) FILTER (WHERE status = 'down')::int AS down,
          COALESCE(ROUND(AVG(response_time_ms)), 0)::int AS average_ms FROM checks`);
        return sendJson(response, 200, { checks: rows, summary: summary.rows[0] });
      }

      if (request.method === 'POST' && url.pathname === '/api/checks') {
        const body = await readJson(request);
        if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 2048) throw new HttpError(400, 'Введите URL длиной до 2048 символов.');
        let result;
        try {
          const upstream = await fetch(`${serviceUrl}/check`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: body.url.trim() }), signal: AbortSignal.timeout(10_000),
          });
          result = await upstream.json();
          if (!upstream.ok) throw new HttpError(upstream.status >= 500 ? 502 : upstream.status, result.error ?? 'Ошибка сервиса проверки.');
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(502, 'Сервис проверки недоступен. Попробуйте ещё раз.');
        }
        const { rows } = await pool.query(
          `INSERT INTO checks (url, final_url, status, http_status, response_time_ms, error, is_demo)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [result.url, result.final_url, result.status, result.http_status, result.response_time_ms, result.error, result.is_demo],
        );
        return sendJson(response, 201, { check: rows[0] });
      }
      throw new HttpError(404, 'Маршрут не найден.');
    } catch (error) {
      if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
      console.error('Request failed:', error.code ?? error.name);
      sendJson(response, 503, { error: 'Не удалось обратиться к базе данных или сервису проверки. Попробуйте ещё раз.' });
    }
  };
}
