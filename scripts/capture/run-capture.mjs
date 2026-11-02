#!/usr/bin/env node
/**
 * Demo asset generator: PostgreSQL + migrations + production build + seed data + screenshots + recording.
 *
 * Usage: npm run capture:all
 * Env:
 *   CAPTURE_DATABASE_URL  reuse an existing PostgreSQL (database name must look disposable)
 *   CAPTURE_PORT          app port (default 3300)
 *   CHROME_PATH           browser binary override
 * Dependencies: a Chrome/Edge build and, for recording, ffmpeg.
 * The production build is created automatically when dist/ is missing.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';

const APP_PORT = Number(process.env.CAPTURE_PORT ?? 3300);
const EXTERNAL_DATABASE_URL = process.env.CAPTURE_DATABASE_URL?.trim() || '';
const repo = process.cwd();

const procs = [];
function start(name, args, env) {
  const p = spawn('node', args, { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await wait(1000);
  }
  return false;
}
function run(script, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [script], { cwd: repo, env: { ...process.env, ...env }, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}
/** Run npm-like binaries (Windows needs the .cmd shim). */
function runBin(command, args) {
  const bin = process.platform === 'win32' ? `${command}.cmd` : command;
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: repo, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  });
}

let pg;
let tempDir;
try {
  // Screenshots run against the production build; create it up front so a missing
  // artifact never turns into "cannot find dist-server/server/main.js".
  if (!existsSync(path.join(repo, 'dist-server/server/main.js')) || !existsSync(path.join(repo, 'dist/index.html'))) {
    console.log('[capture] no production build found, running npm run build ...');
    await runBin('npm', ['run', 'build']).catch(() => {
      throw new Error('build failed: run npm run build manually first');
    });
  }

  let dbUrl;
  if (EXTERNAL_DATABASE_URL) {
    const { assertDisposableDatabase } = await import('../run-all-smoke.mjs');
    assertDisposableDatabase(EXTERNAL_DATABASE_URL);
    console.log('[capture] using external postgres');
    const { default: postgres } = await import('postgres');
    const reset = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await reset`DROP SCHEMA IF EXISTS public CASCADE`;
      await reset`CREATE SCHEMA public`;
    } finally {
      await reset.end({ timeout: 5 });
    }
    dbUrl = EXTERNAL_DATABASE_URL;
  } else {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    tempDir = await mkdtemp(path.join(repo, '.capture-pg-'));
    pg = new EmbeddedPostgres({
      databaseDir: path.join(tempDir, 'postgres'),
      port: Number(process.env.CAPTURE_PG_PORT ?? 5439),
      user: 'flow',
      password: 'flow_pass',
      persistent: false,
      onLog: () => {},
      onError: (e) => console.error('[pg]', e),
    });
    console.log('[capture] starting embedded postgres...');
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('flow');
    dbUrl = `postgresql://flow:flow_pass@127.0.0.1:${process.env.CAPTURE_PG_PORT ?? 5439}/flow`;
  }

  await run('scripts/db/migrate.mjs', { DATABASE_URL: dbUrl });

  const env = {
    DATABASE_URL: dbUrl,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(APP_PORT),
    APP_URL: `http://127.0.0.1:${APP_PORT}`,
    JWT_SECRET: 'capture-secret-key-at-least-32-characters',
    SELLER_REGISTRATION_CODE: 'smoke-secret',
    SEED_DEMO_DATA: 'true',
  };
  start('server', ['dist-server/server/main.js'], env);
  if (!(await waitHealth(`http://127.0.0.1:${APP_PORT}/api/health`))) {
    throw new Error('server did not become healthy');
  }

  await run('scripts/capture/seed-demo.mjs', {
    DATABASE_URL: dbUrl,
    BASE: `http://127.0.0.1:${APP_PORT}`,
    SELLER_REGISTRATION_CODE: 'smoke-secret',
  });

  await mkdir(path.join(repo, 'docs/screenshots'), { recursive: true });
  await run('scripts/capture/screenshots.mjs', { CAPTURE_BASE: `http://127.0.0.1:${APP_PORT}` });
  await run('scripts/capture/record-demo.mjs', { VIDEO_BASE: `http://127.0.0.1:${APP_PORT}` });

  console.log('[capture] ALL DONE');
} catch (err) {
  console.error('[capture] FAILED', err);
  process.exitCode = 1;
} finally {
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch {}
  }
  if (pg) { try { await pg.stop(); } catch {} }
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
