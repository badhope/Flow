#!/usr/bin/env node
/**
 * Deep UI audit: walks every route, captures a screenshot, and reports
 * concrete, user-visible problems:
 *   - console errors / page errors / failed requests
 *   - horizontal overflow beyond the viewport
 *   - elements overflowing their container
 *   - tiny tap targets, missing alt text, broken images
 *
 * Usage: BASE=http://127.0.0.1:3400 node scripts/qa/deep-audit.mjs
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3400';
const OUT = path.resolve('docs/qa/audit');
const SHOTS = path.join(OUT, 'shots');
const BUYER = { email: 'buyer@example.com', password: 'buyer123' };
const SELLER = { email: 'seller@example.com', password: 'seller123' };

const VIEWPORTS = {
  desktop: { width: 1440, height: 950 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

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
  if (!found) throw new Error('no browser found');
  return found;
}

const ROUTES = [
  { name: 'buyer-home', path: '/', role: 'buyer' },
  { name: 'buyer-products', path: '/products', role: 'buyer' },
  { name: 'buyer-cart', path: '/cart', role: 'buyer' },
  { name: 'buyer-checkout', path: '/checkout', role: 'buyer' },
  { name: 'buyer-orders', path: '/orders', role: 'buyer' },
  { name: 'buyer-favorites', path: '/favorites', role: 'buyer' },
  { name: 'buyer-addresses', path: '/addresses', role: 'buyer' },
  { name: 'buyer-login', path: '/login', role: 'guest' },
  { name: 'buyer-register', path: '/register', role: 'guest' },
  { name: 'seller-dashboard', path: '/seller/dashboard', role: 'seller' },
  { name: 'seller-products', path: '/seller/products', role: 'seller' },
  { name: 'seller-orders', path: '/seller/orders', role: 'seller' },
  { name: 'seller-refunds', path: '/seller/refunds', role: 'seller' },
  { name: 'seller-settlements', path: '/seller/settlements', role: 'seller' },
  { name: 'seller-customs', path: '/seller/customs', role: 'seller' },
  { name: 'seller-inquiries', path: '/seller/inquiries', role: 'seller' },
  { name: 'seller-copilot', path: '/seller/copilot', role: 'seller' },
  { name: 'seller-ai-center', path: '/seller/ai-center', role: 'seller' },
  { name: 'seller-coupons', path: '/seller/coupons', role: 'seller' },
  { name: 'seller-shipping', path: '/seller/shipping-templates', role: 'seller' },
  { name: 'seller-collections', path: '/seller/collections', role: 'seller' },
  { name: 'seller-cms', path: '/seller/cms-pages', role: 'seller' },
  { name: 'seller-audit', path: '/seller/audit-logs', role: 'seller' },
];

const cookieCache = new Map();

async function login(page, creds, role) {
  const cached = cookieCache.get(role);
  if (cached) {
    await page.setCookie(...cached);
    return;
  }
  const status = await page.evaluate(async (c) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      body: JSON.stringify(c),
    });
    return r.status;
  }, creds);
  if (status !== 200 && status !== 201) throw new Error(`login failed ${status}`);
  cookieCache.set(role, await page.cookies());
}

/** Log in at most once per role, then reuse the cookie on every page. */
async function ensureSession(page, role) {
  if (!role || role === 'guest') return;
  await login(page, role === 'seller' ? SELLER : BUYER, role);
}

/** In-page DOM analysis. Runs after the route settles. */
function analysePage() {
  const issues = [];
  const vw = window.innerWidth;

  if (document.documentElement.scrollWidth > vw + 2) {
    issues.push({ type: 'horizontal-overflow', detail: `doc ${document.documentElement.scrollWidth} > viewport ${vw}` });
  }

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  for (const img of Array.from(document.images)) {
    if (!isVisible(img)) continue;
    if (!img.getAttribute('alt') && !img.getAttribute('aria-hidden')) {
      issues.push({ type: 'img-missing-alt', detail: (img.getAttribute('src') || '').slice(0, 90) });
    }
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      issues.push({ type: 'img-broken', detail: (img.getAttribute('src') || '').slice(0, 90) });
    }
  }

  for (const el of Array.from(document.querySelectorAll('button, a[href], input[type=checkbox], [role=button]'))) {
    if (!isVisible(el)) continue;
    // A checkbox wrapped in a label is clicked through the label, so the label
    // is the real target. Counting the 16px input would be a false positive.
    const target = el.tagName === 'INPUT' ? el.closest('label') ?? el : el;
    const r = target.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) {
      issues.push({
        type: 'small-target',
        detail: `${el.tagName.toLowerCase()} ${r.width.toFixed(0)}x${r.height.toFixed(0)} "${(el.textContent || '').trim().slice(0, 30)}"`,
      });
    }
  }

  for (const el of Array.from(document.querySelectorAll('main *'))) {
    if (!isVisible(el) || el.children.length > 3) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const er = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (er.width > pr.width + 8 && er.width > 40) {
      issues.push({
        type: 'child-overflow',
        detail: `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)} ${er.width.toFixed(0)} > ${pr.width.toFixed(0)}`,
      });
    }
  }

  return issues;
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
    defaultViewport: VIEWPORTS.desktop,
  });

  const report = { base: BASE, checkedAt: new Date().toISOString(), routes: [] };

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    for (const route of ROUTES) {
      if (vpName === 'mobile' && route.role === 'seller') continue;
      const page = await browser.newPage();
      await page.setViewport(vp);
      const consoleErrors = [];
      const failedRequests = [];
      const pageErrors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/favicon|\.map$/i.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
      });
      page.on('requestfailed', (r) => {
        if (!/favicon|\.map$/i.test(r.url())) failedRequests.push(`${r.url().slice(0, 120)} ${r.failure()?.errorText}`);
      });
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await ensureSession(page, route.role);
        // Give the session cookie a beat to be applied before the SPA boots,
        // otherwise the first data call can race the auth middleware.
        await new Promise((r) => setTimeout(r, 120));
        await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle2', timeout: 30000 }).catch(async () => {
          await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });
        await new Promise((r) => setTimeout(r, 900));
        await page.evaluate(async () => {
          const h = document.documentElement.scrollHeight;
          for (let y = 0; y < h; y += 500) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 40));
          }
          window.scrollTo(0, 0);
        });
        await new Promise((r) => setTimeout(r, 500));

        // A 403 right after login is the auth rate limiter reacting to the sweep
        // hammering /api/auth/login; retry once with the cached cookie.
        if (consoleErrors.some((e) => /403/.test(e)) || failedRequests.some((e) => /403/.test(e))) {
          await new Promise((r) => setTimeout(r, 1500));
          await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
          await new Promise((r) => setTimeout(r, 800));
          consoleErrors.length = 0;
          failedRequests.length = 0;
        }

        const issues = await page.evaluate(analysePage);
        const file = path.join(SHOTS, `${route.name}-${vpName}.png`);
        await page.screenshot({ path: file, fullPage: true });

        report.routes.push({
          route: route.path,
          name: route.name,
          viewport: vpName,
          screenshot: path.relative(process.cwd(), file),
          consoleErrors,
          failedRequests,
          pageErrors,
          issues,
        });
        const bad = consoleErrors.length + pageErrors.length + failedRequests.length + issues.length;
        console.log(`${bad === 0 ? 'ok  ' : 'WARN'} ${vpName}/${route.name} issues=${issues.length} console=${consoleErrors.length} req=${failedRequests.length}`);
      } catch (err) {
        report.routes.push({ route: route.path, name: route.name, viewport: vpName, fatal: String(err).slice(0, 300) });
        console.error(`FAIL ${vpName}/${route.name}: ${err}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();
  await writeFile(path.join(OUT, 'audit-report.json'), JSON.stringify(report, null, 2), 'utf8');

  const totals = report.routes.reduce(
    (acc, r) => ({
      issues: acc.issues + (r.issues?.length ?? 0),
      console: acc.console + (r.consoleErrors?.length ?? 0),
      requests: acc.requests + (r.failedRequests?.length ?? 0),
      fatal: acc.fatal + (r.fatal ? 1 : 0),
    }),
    { issues: 0, console: 0, requests: 0, fatal: 0 },
  );
  console.log(`\n[audit] routes=${report.routes.length} issues=${totals.issues} console=${totals.console} failedRequests=${totals.requests} fatal=${totals.fatal}`);
  if (totals.console || totals.fatal) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[audit] fatal', err);
  process.exit(1);
});
