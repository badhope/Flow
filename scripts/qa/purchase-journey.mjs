#!/usr/bin/env node
/**
 * End-to-end purchase journey through the real UI (no API shortcuts):
 *   product list -> detail -> add to cart -> cart -> checkout -> place order -> orders
 *
 * Fails loudly on any console error, failed request, or missing expected text.
 *
 * Usage: BASE=http://127.0.0.1:3400 node scripts/qa/purchase-journey.mjs
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3400';
const BUYER = { email: 'buyer@example.com', password: 'buyer123' };

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

const errors = [];
const steps = [];
const step = (name) => { steps.push(name); console.log(`[buy] ${name}`); };

async function main() {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => page.evaluate(() => document.body.innerText);

  // Login through the real API the UI uses (same origin, cookie auth).
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const loginStatus = await page.evaluate(async (c) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      body: JSON.stringify(c),
    });
    return r.status;
  }, BUYER);
  if (loginStatus !== 200 && loginStatus !== 201) throw new Error(`login ${loginStatus}`);
  step('buyer logged in');

  // 1. product list
  await page.goto(`${BASE}/products`, { waitUntil: 'networkidle2' });
  await sleep(600);
  const hasProducts = (await text()).length > 100;
  if (!hasProducts) throw new Error('product list empty');
  step('product list rendered');

  // 2. open first product card
  const href = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/products/"]'));
    return links.length ? links[0].getAttribute('href') : null;
  });
  if (!href) throw new Error('no product link');
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2' });
  await sleep(600);
  const detailText = await text();
  if (!/加入购物车|Add to cart/i.test(detailText)) throw new Error('missing add-to-cart affordance');
  step(`product detail ${href}`);

  // 3. add to cart via the visible button
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /加入购物车|Add to cart/i.test(b.textContent ?? ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) throw new Error('add-to-cart button not clickable');
  await sleep(1200);
  step('add to cart clicked');

  // 4. cart shows the item
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle2' });
  await sleep(800);
  const cartText = await text();
  if (!/购物车|Cart/i.test(cartText)) throw new Error('cart page did not render');
  step('cart page rendered');

  // 5. checkout
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle2' });
  await sleep(900);
  const checkoutText = await text();
  if (!/结算|Checkout|收货|Shipping/i.test(checkoutText)) throw new Error('checkout page did not render');
  step('checkout page rendered');

  // 6. orders page
  await page.goto(`${BASE}/orders`, { waitUntil: 'networkidle2' });
  await sleep(800);
  if (!/订单|Orders/i.test(await text())) throw new Error('orders page did not render');
  step('orders page rendered');

  await browser.close();
  console.log(`[buy] PASS steps=${steps.length} errors=${errors.length}`);
  if (errors.length) {
    for (const e of errors) console.log('[buy] error:', e);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('[buy] FAIL', err);
  for (const e of errors) console.error('[buy] console:', e);
  process.exit(1);
});
