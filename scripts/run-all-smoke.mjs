import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { rm } from 'node:fs/promises';

const PG_PORT = Number(process.env.E2E_PG_PORT ?? 5437);
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3121);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4870);
const repo = process.cwd();

const pg = new EmbeddedPostgres({
  databaseDir: path.join(repo, '.e2e-pg'),
  port: PG_PORT,
  user: 'flow',
  password: 'flow_pass',
  persistent: false,
  onLog: () => {},
  onError: (e) => console.error('[pg]', e),
});

const procs = [];
function start(name, cmd, args, env) {
  const p = spawn(cmd, args, { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}
async function waitHealth(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

try {
  console.log('[e2e] starting embedded postgres...');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('flow');
  console.log('[e2e] postgres ready');

  const dbUrl = `postgresql://flow:flow_pass@127.0.0.1:${PG_PORT}/flow`;
  const migrate = spawn('node', ['scripts/db/migrate.mjs'], { cwd: repo, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });
  await new Promise((res, rej) => migrate.on('exit', (c) => (c === 0 ? res() : rej(new Error('migrate failed ' + c)))));

  const baseEnv = {
    DATABASE_URL: dbUrl,
    NODE_ENV: 'development',
    PORT: String(APP_PORT),
    APP_URL: `http://127.0.0.1:${APP_PORT}`,
    JWT_SECRET: 'e2e-test-secret-key-at-least-32-characters',
    SELLER_REGISTRATION_CODE: 'smoke-secret',
    SEED_DEMO_DATA: 'true',
  };

  // Instance A: no LLM keys (workflows / degraded / transaction)
  start('server-a', 'node', ['dist-server/server/main.js'], baseEnv);
  if (!(await waitHealth(`http://127.0.0.1:${APP_PORT}/api/health`))) throw new Error('server A not healthy');

  const run = (script, env = {}) => new Promise((res, rej) => {
    const p = spawn('node', [script], { cwd: repo, env: { ...process.env, ...baseEnv, ...env }, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${script} failed (${c})`))));
  });

  await run('scripts/smoke-workflows.mjs', { SMOKE_BASE: `http://127.0.0.1:${APP_PORT}` });
  await run('scripts/smoke-ai-degraded.mjs', { SMOKE_BASE: `http://127.0.0.1:${APP_PORT}` });
  await run('scripts/smoke.mjs', { SMOKE_BASE: `http://127.0.0.1:${APP_PORT}`, SMOKE_SELLER_CODE: 'smoke-secret' });

  // Instance B: mock providers + LLM
  start('mock', 'node', ['scripts/mock-providers.mjs'], {
    MOCK_PORT: String(MOCK_PORT),
    APP_WEBHOOK_BASE: `http://127.0.0.1:${APP_PORT + 1}`,
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    PAYPAL_WEBHOOK_ID: 'mock-wh',
  });
  await new Promise((r) => setTimeout(r, 1500));

  const llmEnv = {
    ...baseEnv,
    PORT: String(APP_PORT + 1),
    APP_URL: `http://127.0.0.1:${APP_PORT + 1}`,
    LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/llm`,
    LLM_API_KEY: 'mock-key',
    LLM_MODEL: 'mock-model',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    STRIPE_API_BASE: `http://127.0.0.1:${MOCK_PORT}/stripe`,
    PAYPAL_CLIENT_ID: 'mock-cid',
    PAYPAL_CLIENT_SECRET: 'mock-sec',
    PAYPAL_WEBHOOK_ID: 'mock-wh',
    PAYPAL_API_BASE: `http://127.0.0.1:${MOCK_PORT}/paypal`,
  };
  start('server-b', 'node', ['dist-server/server/main.js'], llmEnv);
  if (!(await waitHealth(`http://127.0.0.1:${APP_PORT + 1}/api/health`))) throw new Error('server B not healthy');

  await run('scripts/smoke-providers.mjs', {
    SMOKE_BASE: `http://127.0.0.1:${APP_PORT + 1}`,
    MOCK_BASE: `http://127.0.0.1:${MOCK_PORT}`,
  });
  await run('scripts/smoke-copilot.mjs', {
    SMOKE_BASE: `http://127.0.0.1:${APP_PORT + 1}`,
    MOCK_BASE: `http://127.0.0.1:${MOCK_PORT}`,
  });
  await run('scripts/smoke-shopper.mjs', {
    SMOKE_BASE: `http://127.0.0.1:${APP_PORT + 1}`,
    MOCK_BASE: `http://127.0.0.1:${MOCK_PORT}`,
  });

  console.log('[e2e] ALL PASSED');
} catch (err) {
  console.error('[e2e] FAILED', err instanceof Error ? err.stack ?? err.message : String(err));
  for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
  try { await pg.stop(); } catch {}
  await rm(path.join(repo, '.e2e-pg'), { recursive: true, force: true }).catch(() => {});
  // 显式退出：embedded-postgres 的 exit hook 可能覆盖 process.exitCode，不能假绿。
  process.exit(1);
} finally {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
  try { await pg.stop(); } catch {}
  await rm(path.join(repo, '.e2e-pg'), { recursive: true, force: true }).catch(() => {});
}
