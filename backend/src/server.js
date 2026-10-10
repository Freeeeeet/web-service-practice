import { createServer } from 'node:http';
import pg from 'pg';
import { createHandler } from './app.js';

const pool = new pg.Pool({
  max: 10,
  connectionTimeoutMillis: 3_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 5_000,
});
pool.on('error', (error) => console.error('Database connection error:', error.code));

const server = createServer(createHandler(pool));
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log(`Backend listening on port ${process.env.PORT ?? 3000}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8_000).unref();
  });
}
