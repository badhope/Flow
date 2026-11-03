#!/usr/bin/env node
/**
 * Spin up a disposable local stack for QA / manual review:
 *   1. reset a disposable PostgreSQL database (name must contain e2e/smoke/test)
 *   2. apply migrations
 *   3. start the production server (serves dist/ as static + /api)
 *   4. seed demo data
 *
 * The stack keeps running until Ctrl+C. Use it for browser walk-throughs,
 * screenshots and manual acceptance.
 *
 * Usage:
 *   QA_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/flow_qa_e2e npm run qa:stack
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { assertDisposableDatabase } from '../run-all-smoke.mjs';

const PORT = Number(process.env.QA_PORT ?? 3400);
const DATABASE_URL = process.env.QA_DATABASE_URL?.trim() || '';

if (!DATABASE_URL) {
  console.error('[qa:stack] QA_DATABASE_URL is required (disposable database name)');
  process.exit(1);
}
const dbName = assertDisposableDatabase(DATABASE_URL);
console.log(`[qa:stack] database "${dbName}"`);

const repo = process.cwd();
const postgres = (await import('postgres')).default;

const reset = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await reset`DROP SCHEMA IF EXISTS public CASCADE`;
  await reset`CREATE SCHEMA public`;
} finally {
  await reset.end({ timeout: 5 });
}

const run = (script, env = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { cwd: repo, env: { ...process.env, DATABASE_URL, ...env }, stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });

await run('scripts/db/migrate.mjs');

const server = spawn(process.execPath, ['dist-server/server/main.js'], {
  cwd: repo,
  env: {
    ...process.env,
    DATABASE_URL,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    APP_URL: `http://127.0.0.1:${PORT}`,
    JWT_SECRET: 'local-qa-secret-key-at-least-32-characters',
    SELLER_REGISTRATION_CODE: 'smoke-secret',
    SEED_DEMO_DATA: 'true',
  },
  stdio: 'inherit',
});

const healthy = await (async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})();
if (!healthy) {
  server.kill('SIGTERM');
  throw new Error('server did not become healthy');
}

await run('scripts/capture/seed-demo.mjs', {
  BASE: `http://127.0.0.1:${PORT}`,
  SELLER_REGISTRATION_CODE: 'smoke-secret',
});

console.log(`[qa:stack] ready at http://127.0.0.1:${PORT}  (Ctrl+C to stop)`);
const shutdown = () => {
  server.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => process.exit(code ?? 0));
