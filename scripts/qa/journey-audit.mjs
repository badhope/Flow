#!/usr/bin/env node
/**
 * Black-box user-journey audit.
 *
 * Drives a real browser through the buyer and seller journeys against a running
 * production build, records console errors / failed requests / page errors and
 * writes a JSON report. Any error aborts with exit code 1 so it can gate CI.
 *
 * Usage:
 *   BASE=http://127.0.0.1:3300 node scripts/qa/journey-audit.mjs
 *   BASE=... HEADED=1 for a visible run.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3300';
const OUT = path.resolve('docs/qa');
const BROWSER = process.env.CHROME_PATH || findBrowser();
const BUYER = { email: 'buyer@example.com', password: 'buyer123' };
const SELLER = { email: 'seller@example.com', password: 'seller123' };

function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('no Chrome/Edge found; set CHROME_PATH');
  return found;
}

/** Pages that always poll or stream and are allowed to be noisy. */
const NOISE = [/favicon/i, /\.map$/i, /\/api\/health/i];

function isNoise(text) {
  return NOISE.some((re) => re.test(text));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: process.env.HEADED ? false : true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const findings = [];
  const consoleErrors = [];
  const failedRequests = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNoise(msg.text())) {
      consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 400) });
    }
  });
  page.on('requestfailed', (req) => {
    if (!isNoise(req.url())) {
      failedRequests.push({ url: page.url(), target: req.url().slice(0, 200), reason: req.failure()?.errorText });
    }
  });
  page.on('pageerror', (err) => pageErrors.push({ url: page.url(), text: String(err).slice(0, 400) }));

  const visit = async (route, expect) => {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(async () => {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });
    await new Promise((r) => setTimeout(r, 700));
    const body = await page.evaluate(() => document.body.innerText.slice(0, 4000));
    if (expect && !expect.test(body)) {
      findings.push({ route, issue: `expected /${expect.source}/ not found in rendered text`, sample: body.slice(0, 300) });
    }
    return body;
  };

  const login = async (creds) => {
    const status = await page.evaluate(async (c) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
        body: JSON.stringify(c),
      });
      return r.status;
    }, creds);
    if (status !== 200 && status !== 201) throw new Error(`login failed: ${status}`);
  };

  // ---------- Buyer journey ----------
  await visit('/', /Flow|商品|shop/i);
  await login(BUYER);
  await visit('/products', /./);
  await visit('/cart', /./);
  await visit('/checkout', /./);
  await visit('/orders', /./);
  await visit('/favorites', /./);
  await visit('/addresses', /./);

  // Real interaction: open the first product from the listing.
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));
  const productHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href*="/products/"]')).find((el) => !el.getAttribute('href')?.endsWith('/products'));
    return a ? a.getAttribute('href') : null;
  });
  if (!productHref) {
    findings.push({ route: '/products', issue: 'no product link rendered' });
  } else {
    await visit(productHref, /./);
  }

  // ---------- Seller journey ----------
  await login(SELLER);
  for (const route of [
    '/seller/dashboard',
    '/seller/products',
    '/seller/orders',
    '/seller/refunds',
    '/seller/inquiries',
    '/seller/copilot',
    '/seller/ai-center',
    '/seller/coupons',
    '/seller/shipping-templates',
    '/seller/collections',
    '/seller/cms-pages',
    '/seller/audit-logs',
  ]) {
    await visit(route, /./);
  }

  // ---------- Mobile buyer ----------
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await visit('/', /./);
  await page.setViewport({ width: 1440, height: 900 });

  await browser.close();

  const report = {
    base: BASE,
    checkedAt: new Date().toISOString(),
    findings,
    consoleErrors,
    failedRequests,
    pageErrors,
  };
  await writeFile(path.join(OUT, 'journey-report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(`[qa] findings=${findings.length} consoleErrors=${consoleErrors.length} failedRequests=${failedRequests.length} pageErrors=${pageErrors.length}`);
  for (const item of findings) console.log('[qa] finding:', item.route, item.issue);
  for (const item of consoleErrors.slice(0, 10)) console.log('[qa] console:', item.url, item.text);
  for (const item of failedRequests.slice(0, 10)) console.log('[qa] request:', item.target, item.reason);
  for (const item of pageErrors.slice(0, 10)) console.log('[qa] pageerror:', item.url, item.text);

  if (findings.length || consoleErrors.length || pageErrors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[qa] fatal', err);
  process.exit(1);
});
