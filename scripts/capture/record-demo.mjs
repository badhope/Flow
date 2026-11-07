#!/usr/bin/env node
/**
 * 使用演示视频：CDP screencast 抓帧 → ffmpeg 合成 mp4，并导出 README 用 GIF。
 *
 * 用法：npm run capture:video
 * 前置：应用已运行（VIDEO_BASE，默认 http://127.0.0.1:3300）且已播种演示数据（scripts/capture/seed-demo.mjs）。
 * 需要：本机 Chrome + ffmpeg（PATH 或 FFMPEG_PATH）。
 *
 * 产出：docs/video/demo.mp4（H.264 1280×720）+ docs/video/demo.gif（关键片段）
 *
 * GIF 仅供本地预览（README 链的是 mp4）：它体积大（~1.3MB）且内容与 mp4 重复，
 * 不适合入版本库，已在 .gitignore 中排除。
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.VIDEO_BASE ?? 'http://127.0.0.1:3300';
const OUT_DIR = path.resolve('docs/video');
const FRAMES_DIR = path.resolve('.capture-frames');
const VIEWPORT = { width: 1280, height: 720 };
const SELLER = { email: 'seller@example.com', password: 'seller123' };
const BUYER = { email: 'buyer@example.com', password: 'buyer123' };

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('未找到浏览器，请设置 CHROME_PATH');
  return found;
}

function findFfmpeg() {
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg', 'C:/Users/X1882/ffmpeg/ffmpeg.exe'];
  return candidates.find((c) => c === 'ffmpeg' || existsSync(c)) ?? 'ffmpeg';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 平滑滚动（便于录制出自然的运镜） */
async function smoothScroll(page, toY, durationMs = 900) {
  await page.evaluate(
    (target, dur) =>
      new Promise((resolve) => {
        const start = window.scrollY;
        const delta = target - start;
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0) / dur);
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, start + delta * eased);
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    toY,
    durationMs,
  );
}

async function login(page, creds) {
  return page.evaluate(async (c) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      body: JSON.stringify(c),
    });
    return r.ok;
  }, creds);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // ---------- 启动 screencast 抓帧 ----------
  const frames = [];
  const client = await page.createCDPSession();
  client.on('Page.screencastFrame', async (f) => {
    const file = path.join(FRAMES_DIR, `f-${String(frames.length).padStart(6, '0')}.jpg`);
    await writeFile(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, ts: f.metadata.timestamp ?? Date.now() / 1000 });
    try {
      await client.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    } catch {
      // 会话已关闭
    }
  });

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 82,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });

  const record = async (label, fn) => {
    process.stdout.write(`[video] ${label} ... `);
    await fn();
    console.log('ok');
  };

  try {
    // ============ 买家视角 ============
    await record('买家：打开首页', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
      await sleep(2200);
    });

    await record('买家：浏览运营楼层', async () => {
      await smoothScroll(page, 820, 1400);
      await sleep(1200);
      await smoothScroll(page, 1650, 1400);
      await sleep(1000);
    });

    await record('买家：查看商品详情', async () => {
      const href = await page.evaluate(() => {
        const a = document.querySelector('a[href^="/products/"]');
        return a ? a.getAttribute('href') : null;
      });
      if (href) await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
      await sleep(2200);
      await smoothScroll(page, 520, 1200);
      await sleep(900);
    });

    await record('买家：加入购物车', async () => {
      const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) =>
          /加入购物车|Add to Cart/i.test(b.textContent ?? ''),
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
      await sleep(2000);
      if (!clicked) console.log('(未找到加购按钮，跳过)');
    });

    await record('买家：查看购物车', async () => {
      await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle2' });
      await sleep(2400);
    });

    await record('买家：结算页（地址簿预填）', async () => {
      await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle2' });
      await sleep(2600);
      await smoothScroll(page, 300, 1000);
      await sleep(900);
    });

    await record('买家：我的订单', async () => {
      await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle2' });
      await sleep(2400);
      await smoothScroll(page, 400, 1000);
      await sleep(900);
    });

    // ============ 卖家视角 ============
    await record('卖家：登录并看数据看板', async () => {
      await login(page, SELLER);
      await page.goto(`${BASE}/seller/dashboard`, { waitUntil: 'networkidle2' });
      await sleep(3000);
    });

    await record('卖家：商品管理（变体/库存）', async () => {
      await page.goto(`${BASE}/seller/products`, { waitUntil: 'networkidle2' });
      await sleep(2600);
      await smoothScroll(page, 420, 1000);
      await sleep(900);
    });

    await record('卖家：AI 分析中心（模型设置 + 我的 Agent）', async () => {
      await page.goto(`${BASE}/seller/ai-center`, { waitUntil: 'networkidle2' });
      await sleep(2600);
      await smoothScroll(page, 700, 1400);
      await sleep(1500);
    });

    await record('卖家：订单与发货', async () => {
      await page.goto(`${BASE}/seller/orders`, { waitUntil: 'networkidle2' });
      await sleep(2400);
      await smoothScroll(page, 380, 1000);
      await sleep(900);
    });

    await record('卖家：退款审批', async () => {
      await page.goto(`${BASE}/seller/refunds`, { waitUntil: 'networkidle2' });
      await sleep(2400);
    });

    await record('卖家：咨询管理（AI 客服会话）', async () => {
      await page.goto(`${BASE}/seller/inquiries`, { waitUntil: 'networkidle2' });
      await sleep(2600);
    });

    await record('卖家：集合管理（首页楼层）', async () => {
      await page.goto(`${BASE}/seller/collections`, { waitUntil: 'networkidle2' });
      await sleep(2200);
    });

    await record('收尾：回到首页', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
      await sleep(2600);
    });
  } finally {
    try {
      await client.send('Page.stopScreencast');
    } catch {
      // ignore
    }
    await browser.close();
  }

  console.log(`[video] 抓到 ${frames.length} 帧`);

  // ---------- ffmpeg 合成 ----------
  const ffmpeg = findFfmpeg();
  const mp4 = path.join(OUT_DIR, 'demo.mp4');

  // 依据帧时间戳生成 concat 清单，保持真实节奏
  const listFile = path.join(FRAMES_DIR, 'frames.txt');
  const lines = [];
  for (let i = 0; i < frames.length; i += 1) {
    const dur = i < frames.length - 1 ? Math.max(0.02, frames[i + 1].ts - frames[i].ts) : 0.3;
    lines.push(`file '${frames[i].file.replace(/\\/g, '/')}'`);
    lines.push(`duration ${dur.toFixed(3)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
  await writeFile(listFile, lines.join('\n'), 'utf8');

  const run = (args) =>
    new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d.toString(); });
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-800)))));
    });

  console.log('[video] 合成 mp4 ...');
  await run([
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=15,scale=${VIEWPORT.width}:${VIEWPORT.height}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', mp4,
  ]);
  console.log('[video] ✓', path.relative(process.cwd(), mp4));

  // ---------- GIF（取第 2-12 秒的浏览片段，供 README 内联）----------
  const gif = path.join(OUT_DIR, 'demo.gif');
  console.log('[video] 生成 gif ...');
  await run([
    '-y', '-ss', '4', '-t', '9', '-i', mp4,
    // 720p / 8fps / 96 色：README 内联预览足够，且体积约为原来一半（2.6MB → 1.3MB），
    // 对大文件托管与加载速度都更友好。
    '-vf', 'fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer',
    gif,
  ]);
  console.log('[video] ✓', path.relative(process.cwd(), gif));

  // 清理帧缓存
  await rm(FRAMES_DIR, { recursive: true, force: true });
  console.log('[video] DONE');
}

main().catch((err) => {
  console.error('[video] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
