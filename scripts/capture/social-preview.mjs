#!/usr/bin/env node
/**
 * Render the repository social preview card (1280x640) as English-primary,
 * matching the README language policy. Output: docs/social-preview.png
 *
 * Usage: node scripts/capture/social-preview.mjs
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('docs/social-preview.png');

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('no Chrome/Edge found; set CHROME_PATH');
  return found;
}

const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 640px; overflow: hidden;
    font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    background: #071a2b; color: #e8f1f8; position: relative;
  }
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
    background-size: 64px 64px;
  }
  .glow {
    position: absolute; width: 900px; height: 900px; right: -320px; top: -380px;
    background: radial-gradient(circle, rgba(0,194,184,.30) 0%, rgba(0,194,184,0) 62%);
  }
  .wrap { position: relative; padding: 64px 72px; height: 100%; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .mark {
    width: 62px; height: 62px; border-radius: 16px;
    background: linear-gradient(135deg, #00c2b8, #0f9b8e);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 32px; color: #04222e;
  }
  .brand h1 { font-size: 40px; font-weight: 700; letter-spacing: -.5px; }
  .brand p { font-size: 14px; letter-spacing: 3.2px; color: #7fa6bd; margin-top: 4px; }
  .headline { margin-top: 64px; font-size: 60px; font-weight: 800; line-height: 1.14; letter-spacing: -1.2px; max-width: 1020px; }
  .headline em { font-style: normal; color: #00e0d2; }
  .sub { margin-top: 24px; font-size: 21px; line-height: 1.55; color: #a9c4d6; max-width: 880px; }
  .chips { margin-top: 34px; display: flex; align-items: center; gap: 14px; }
  .chip {
    border: 1px solid rgba(160,200,220,.28); border-radius: 999px;
    padding: 9px 18px; font-size: 15px; color: #b6cfdf;
  }
  .url { margin-left: auto; font-size: 15px; color: #5f8ea8; }
</style></head>
<body>
  <div class="grid"></div><div class="glow"></div>
  <div class="wrap">
    <div class="brand">
      <div class="mark">F</div>
      <div>
        <h1>Flow</h1>
        <p>AI-NATIVE CROSS-BORDER COMMERCE</p>
      </div>
    </div>
    <div class="headline">One codebase.<br/>A storefront and an <em>AI workbench</em>.</div>
    <div class="sub">
      Buyer storefront plus seller AI workbench. Five specialist agents, a copilot that
      acts only after human approval, and real payment and refund loops.
    </div>
    <div class="chips">
      <div class="chip">React 19 · NestJS 12</div>
      <div class="chip">PostgreSQL · Drizzle</div>
      <div class="chip">OpenAI-compatible</div>
      <div class="url">gitcode.com/badhope/Flow</div>
    </div>
  </div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 640, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT });
await browser.close();
console.log('[social] wrote', OUT);
