import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkPorts, cleanEnv, loopbackEnv, waitReady, assertDisposableDatabase } from './run-all-smoke.mjs';

test('external database guard only accepts disposable names', () => {
  assert.equal(assertDisposableDatabase('postgresql://u:p@127.0.0.1:5432/flow_e2e'), 'flow_e2e');
  assert.equal(assertDisposableDatabase('postgresql://u:p@127.0.0.1:5432/smoke_test'), 'smoke_test');
  assert.throws(() => assertDisposableDatabase('postgresql://u:p@127.0.0.1:5432/flow'), /refusing to reset/);
  assert.throws(() => assertDisposableDatabase('postgresql://u:p@127.0.0.1:5432/production'), /refusing to reset/);
});

test('occupied ports fail without contacting or stopping their owner', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(checkPorts([server.address().port]), /port/i);
    assert.equal(server.listening, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('free port passes availability check', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await checkPorts([port]);
});

test('clean environment keeps Windows system root and excludes inherited credentials', () => {
  const env = cleanEnv({ SystemRoot: 'C:\\Windows', PATH: 'path', LLM_API_KEY: 'secret', OTHER_TOKEN: 'secret', NODE_OPTIONS: 'unsafe' }, 'missing-env');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.LLM_API_KEY, undefined);
  assert.equal(env.OTHER_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.DOTENV_CONFIG_PATH, 'missing-env');
});

test('real Node children receive loopback host and isolated environment', async () => {
  const env = { ...cleanEnv({ ...process.env, HOST: '0.0.0.0', MOCK_HOST: '0.0.0.0', LLM_API_KEY: 'secret' }, 'missing-env'), ...loopbackEnv };
  const child = spawn(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({host:process.env.HOST,mock:process.env.MOCK_HOST,secret:process.env.LLM_API_KEY,root:process.env.SystemRoot || process.env.SYSTEMROOT}))'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0);
  const result = JSON.parse(output);
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.mock, '127.0.0.1');
  assert.equal(result.secret, undefined);
  if (process.platform === 'win32') assert.equal(result.root?.toLowerCase(), (process.env.SystemRoot || process.env.SYSTEMROOT)?.toLowerCase());
});

test('runner rejects a server build without HOST support', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.flow-build-test-'));
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(root, 'dist-server', 'server'), { recursive: true });
    await writeFile(path.join(root, 'dist-server', 'server', 'main.js'), 'process.env.PORT');
    const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts/run-all-smoke.mjs')], { cwd: root, env: cleanEnv(process.env, path.join(root, 'missing-env')), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (data) => { output += data; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.notEqual(code, 0);
    assert.match(output, /server build does not support HOST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dotenv ignores a real project env file in clean child environment', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.flow-dotenv-test-'));
  try {
    await writeFile(path.join(root, '.env'), 'E2E_DOTENV_PROBE=loaded\n');
    const dotenv = createRequire(import.meta.url).resolve('dotenv/config');
    const probe = (env) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-r', dotenv, '-e', 'process.stdout.write(process.env.E2E_DOTENV_PROBE || "absent")'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (data) => { output += data; });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`probe failed ${code}`)));
    });
    const env = cleanEnv(process.env, path.join(root, 'missing-env'));
    assert.equal(await probe({ ...env, DOTENV_CONFIG_PATH: path.join(root, '.env') }), 'loaded');
    assert.equal(await probe(env), 'absent');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('readiness fails when child exits even when another service answers', async () => {
  let requests = 0;
  const server = (await import('node:http')).createServer((_req, res) => { requests++; res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await assert.rejects(waitReady(child, 'never-ready', `http://127.0.0.1:${server.address().port}`, 2000));
    assert.equal(requests, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('test fixture cleanup leaves a preexisting .e2e-pg untouched', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.flow-smoke-test-'));
  const dir = path.join(root, '.e2e-pg');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir);
  await mkdir(path.join(root, 'dist-server', 'server'), { recursive: true });
  await writeFile(path.join(root, 'dist-server', 'server', 'main.js'), 'process.env.HOST');
  await writeFile(path.join(dir, 'sentinel'), 'keep');
  try {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts/run-all-smoke.mjs')], { cwd: root, env: { ...process.env, E2E_APP_PORT: String(server.address().port) }, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    await new Promise((resolve) => server.close(resolve));
    assert.notEqual(code, 0);
    assert.equal(await readFile(path.join(dir, 'sentinel'), 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});
