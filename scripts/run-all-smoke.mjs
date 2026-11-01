import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

const PG_PORT = Number(process.env.E2E_PG_PORT ?? 5437);
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3121);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4870);
const repo = process.cwd();

export const loopbackEnv = Object.freeze({ HOST: '127.0.0.1', MOCK_HOST: '127.0.0.1' });

export function cleanEnv(source, dotenvPath) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  env.DOTENV_CONFIG_PATH = dotenvPath;
  return env;
}

export async function checkPorts(ports) {
  if (new Set(ports).size !== ports.length || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error('invalid or duplicate port');
  const servers = [];
  try {
    for (const port of ports) {
      for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
        const server = createServer();
        servers.push(server);
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen({ port, host, ipv6Only: host.includes(':'), exclusive: true }, resolve);
        });
        await new Promise((resolve) => server.close(resolve));
      }
    }
  } catch (error) {
    throw new Error(`port availability check failed: ${error.message}`);
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

export async function waitReady(child, marker, url, timeout = 60000, check = () => {}) {
  let output = '';
  let ready = false;
  let failure;
  const onData = (data) => { output = (output + data.toString()).slice(-8192); if (output.includes(marker)) ready = true; };
  const onExit = (code, signal) => { failure = new Error(`child exited before readiness (${code ?? signal})`); };
  const onError = (error) => { failure = error; };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', onExit);
  child.once('error', onError);
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      check();
      if (failure || child.exitCode !== null || child.signalCode !== null) throw failure ?? new Error('child exited before readiness');
      if (ready) {
        if (!url) return;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
          if (response.ok && child.exitCode === null && child.signalCode === null && !failure) return;
        } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('child readiness timed out');
  } finally {
    child.stdout.off('data', onData);
    child.stderr.off('data', onData);
    child.off('exit', onExit);
    child.off('error', onError);
  }
}

async function main() {
let pg;
let tempDir;
let baseProcessEnv;
const procs = [];
let childFailure;
function start(name, cmd, args, env) {
  const p = spawn(cmd, args, { cwd: repo, env: { ...baseProcessEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  p.on('error', (error) => { childFailure = error; });
  p.on('exit', (code, signal) => { childFailure = new Error(`${name} exited (${code ?? signal})`); });
  procs.push(p);
  return p;
}
function assertChildren() {
  if (childFailure) throw childFailure;
  if (pg?.process && (pg.process.exitCode !== null || pg.process.signalCode !== null)) throw new Error('postgres exited');
}
try {
  const serverBuild = await readFile(path.join(repo, 'dist-server/server/main.js'), 'utf8');
  if (!/process\.env\.HOST\b/.test(serverBuild)) throw new Error('server build does not support HOST; rebuild before running smoke');
  await checkPorts([PG_PORT, APP_PORT, APP_PORT + 1, MOCK_PORT]);
  tempDir = await mkdtemp(path.join(repo, '.e2e-smoke-'));
  baseProcessEnv = { ...cleanEnv(process.env, path.join(tempDir, 'no-dotenv')), ...loopbackEnv };
  let pgLog = '';
  pg = new EmbeddedPostgres({
    databaseDir: path.join(tempDir, 'postgres'),
    port: PG_PORT,
    user: 'flow',
    password: 'flow_pass',
    persistent: true,
    onLog: (message) => { pgLog = (pgLog + message).slice(-4096); },
    onError: (e) => console.error('[pg]', e),
  });
  console.log('[e2e] starting embedded postgres...');
  await pg.initialise();
  pgLog = '';
  try { await pg.start(); } catch (error) { throw new Error(`postgres start failed: ${error ?? pgLog}`); }
  await pg.createDatabase('flow');
  console.log('[e2e] postgres ready');

  const dbUrl = `postgresql://flow:flow_pass@127.0.0.1:${PG_PORT}/flow`;
  const migrate = spawn(process.execPath, ['scripts/db/migrate.mjs'], { cwd: repo, env: { ...baseProcessEnv, DATABASE_URL: dbUrl }, stdio: 'inherit' });
  await new Promise((res, rej) => { migrate.once('error', rej); migrate.once('exit', (c) => (c === 0 ? res() : rej(new Error('migrate failed ' + c)))); });
  assertChildren();

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
  const serverA = start('server-a', process.execPath, ['dist-server/server/main.js'], baseEnv);
  await waitReady(serverA, 'Flow server running on', `http://127.0.0.1:${APP_PORT}/api/health`, 60000, assertChildren);
  assertChildren();

  const run = async (script, env = {}) => {
    assertChildren();
    const p = spawn(process.execPath, [script], { cwd: repo, env: { ...baseProcessEnv, ...baseEnv, ...env }, stdio: 'inherit' });
    await new Promise((res, rej) => {
      const watched = [...procs, ...(pg?.process ? [pg.process] : [])];
      const failed = () => { if (p.exitCode === null && p.signalCode === null) p.kill('SIGTERM'); };
      for (const child of watched) child.once('exit', failed);
      const finish = (error) => {
        for (const child of watched) child.off('exit', failed);
        if (error) rej(error); else res();
      };
      p.once('error', finish);
      p.once('exit', (c) => finish(c === 0 && !childFailure ? null : new Error(`${script} failed (${c})`)));
    });
    assertChildren();
  };

  await run('scripts/smoke-workflows.mjs', { SMOKE_BASE: `http://127.0.0.1:${APP_PORT}` });
  await run('scripts/smoke-ai-degraded.mjs', { SMOKE_BASE: `http://127.0.0.1:${APP_PORT}` });
  await run('scripts/smoke.mjs', { SMOKE_BASE: `http://127.0.0.1:${APP_PORT}`, SMOKE_SELLER_CODE: 'smoke-secret' });

  // Instance B: mock providers + LLM
  const mock = start('mock', process.execPath, ['scripts/mock-providers.mjs'], {
    MOCK_PORT: String(MOCK_PORT),
    APP_WEBHOOK_BASE: `http://127.0.0.1:${APP_PORT + 1}`,
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    PAYPAL_WEBHOOK_ID: 'mock-wh',
  });
  await waitReady(mock, 'providers listening on', null, 60000, assertChildren);
  assertChildren();

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
  const serverB = start('server-b', process.execPath, ['dist-server/server/main.js'], llmEnv);
  await waitReady(serverB, 'Flow server running on', `http://127.0.0.1:${APP_PORT + 1}/api/health`, 60000, assertChildren);
  assertChildren();

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
  process.exitCode = 1;
} finally {
  await Promise.all(procs.map((p) => new Promise((resolve) => {
    if (p.exitCode !== null || p.signalCode !== null || !p.pid) return resolve();
    p.once('exit', resolve);
    p.kill('SIGTERM');
  })));
  try {
    if (pg?.process) {
      if (pg.process.exitCode === null && pg.process.signalCode === null) await pg.stop();
      else pg.process = undefined;
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error('[e2e] cleanup failed', error);
    process.exitCode = 1;
  }
}
return process.exitCode ?? 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const code = await main();
  process.exit(code);
}
