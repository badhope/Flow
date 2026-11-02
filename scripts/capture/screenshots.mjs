#!/usr/bin/env node
/**
 * 全站截图（1440 宽全页）。
 *
 * 用法：npm run capture
 * 前置：应用已在 CAPTURE_BASE（默认 http://127.0.0.1:3300）运行，且已播种演示数据。
 * 说明：使用本机 Chrome（puppeteer-core，不下载浏览器）。
 *
 * 产出：docs/screenshots/*.png（覆盖买家端与卖家端全部主要页面）
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.CAPTURE_BASE ?? 'http://127.0.0.1:3300';
const OUT = path.resolve('docs/screenshots');
const VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const SELLER = { email: 'seller@example.com', password: 'seller123' };
const BUYER = { email: 'buyer@example.com', password: 'buyer123' };

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error('未找到浏览器，请设置 CHROME_PATH 环境变量');
  }
  return found;
}

/** 等页面主要请求静默（网络空闲） */
async function settle(page, ms = 1200) {
  await new Promise((r) => setTimeout(r, ms));
  try {
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 8000 });
  } catch {
    // 有轮询/长连接时忽略
  }
}

/**
 * Scroll through the document so lazy-loaded images below the fold decode,
 * then wait until every <img> settles. Without this a full-page screenshot
 * captures empty product tiles.
 */
async function hydrateLazyImages(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = await page.evaluate(() => Array.from(document.images).filter((img) => !img.complete).length);
    if (pending === 0) break;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Count images that failed to decode so a broken asset never ships silently. */
async function countBrokenImages(page) {
  return page.evaluate(
    () => Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute('src')).length,
  );
}

/** 每个角色只登录一次（认证端点有 5 次/分限流），随后复用会话 */
const loginCache = new Map();

async function login(page, creds, role) {
  if (loginCache.has(role)) {
    // 复用：把缓存的 cookie 注回页面
    const cookies = loginCache.get(role);
    await page.setCookie(...cookies);
    return true;
  }
  const status = await doLogin(page, creds);
  if (status) {
    loginCache.set(role, await page.cookies());
  }
  return status;
}

async function doLogin(page, creds) {
  const res = await page.evaluate(async (c) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      body: JSON.stringify(c),
    });
    return r.status;
  }, creds);
  return res === 200 || res === 201;
}

async function setLanguage(page, lang) {
  await page.evaluate((l) => {
    localStorage.setItem('flow_language', l);
    localStorage.setItem('globalecom_language', l);
  }, lang);
}

const SHOTS = [
  // 买家端
  { file: '01-homepage-zh.png', path: '/', lang: 'zh', as: 'buyer' },
  { file: '02-homepage-en.png', path: '/', lang: 'en', as: 'buyer' },
  { file: '03-product-list.png', path: '/products', lang: 'en', as: 'buyer' },
  { file: '04-product-detail-zh.png', path: '/products/:first', lang: 'zh', as: 'buyer' },
  { file: '05-product-detail-en.png', path: '/products/:first', lang: 'en', as: 'buyer' },
  { file: '06-cart.png', path: '/cart', lang: 'en', as: 'buyer', seedCart: true },
  { file: '07-checkout.png', path: '/checkout', lang: 'en', as: 'buyer' },
  { file: '08-orders.png', path: '/orders', lang: 'en', as: 'buyer' },
  { file: '09-favorites.png', path: '/favorites', lang: 'en', as: 'buyer' },
  { file: '10-addresses.png', path: '/addresses', lang: 'en', as: 'buyer' },
  { file: '11-collection-floor.png', path: '/', lang: 'en', as: 'buyer', scrollTo: 'floor' },
  { file: '12-collection-detail.png', path: '/collections/:first', lang: 'en', as: 'buyer' },
  { file: '13-cms-page.png', path: '/page/about', lang: 'en', as: 'buyer' },
  { file: '14-login.png', path: '/login', lang: 'en', as: 'guest' },
  { file: '15-register.png', path: '/register', lang: 'en', as: 'guest' },
  // 卖家端
  { file: '16-seller-dashboard-zh.png', path: '/seller/dashboard', lang: 'zh', as: 'seller' },
  { file: '17-seller-dashboard-en.png', path: '/seller/dashboard', lang: 'en', as: 'seller' },
  { file: '18-seller-products.png', path: '/seller/products', lang: 'en', as: 'seller' },
  { file: '19-seller-orders.png', path: '/seller/orders', lang: 'en', as: 'seller' },
  { file: '20-seller-refunds.png', path: '/seller/refunds', lang: 'en', as: 'seller' },
  { file: '21-seller-inquiries.png', path: '/seller/inquiries', lang: 'en', as: 'seller' },
  { file: '22-ai-center.png', path: '/seller/ai-center', lang: 'en', as: 'seller' },
  { file: '23-seller-coupons.png', path: '/seller/coupons', lang: 'en', as: 'seller' },
  { file: '24-seller-shipping-templates.png', path: '/seller/shipping-templates', lang: 'en', as: 'seller' },
  { file: '25-seller-collections.png', path: '/seller/collections', lang: 'en', as: 'seller' },
  { file: '26-seller-cms.png', path: '/seller/cms-pages', lang: 'en', as: 'seller' },
  { file: '27-seller-audit-logs.png', path: '/seller/audit-logs', lang: 'en', as: 'seller' },
  { file: '28-seller-copilot.png', path: '/seller/copilot', lang: 'zh', as: 'seller' },
  { file: '29-seller-copilot-en.png', path: '/seller/copilot', lang: 'en', as: 'seller' },
  { file: '30-mobile-home.png', path: '/', lang: 'zh', as: 'buyer', mobile: true },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1'],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // 预热：确认服务可用
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settle(page, 1500);

  // 取一个商品 id 与集合 slug 用于动态路由
  const context = await page.evaluate(async () => {
    const products = await fetch('/api/products?page=1&pageSize=1').then((r) => r.json()).catch(() => null);
    const collections = await fetch('/api/collections/storefront').then((r) => r.json()).catch(() => []);
    return {
      productId: products?.items?.[0]?.id ?? null,
      collectionSlug: Array.isArray(collections) && collections[0]?.slug ? collections[0].slug : null,
    };
  });
  console.log('[capture] context:', JSON.stringify(context));

  let ok = 0;
  const failures = [];
  const brokenImages = [];

  for (const shot of SHOTS) {
    let url = shot.path;
    if (url.includes(':first')) {
      if (!context.productId && url.includes('/products/')) continue;
      url = url.replace(':first', context.productId ?? '');
    }
    if (url.includes('collections/:first')) continue;

    try {
      await page.setViewport(shot.mobile ? MOBILE_VIEWPORT : VIEWPORT);
      // 登录态（按角色缓存，仅在角色切换时重新登录）
      if (shot.as === 'seller') {
        const logged = await login(page, SELLER, 'seller');
        if (!logged) throw new Error('卖家登录失败（演示数据是否已播种？）');
      } else if (shot.as === 'buyer') {
        const logged = await login(page, BUYER, 'buyer');
        if (!logged) throw new Error('买家登录失败');
      } else if (shot.as === 'guest') {
        // 访客：清掉登录 cookie 与本地用户
        const cookies = await page.cookies();
        const authCookies = cookies.filter((c) => c.name.includes('auth'));
        if (authCookies.length > 0) await page.deleteCookie(...authCookies);
        await page.evaluate(() => localStorage.removeItem('flow_user'));
      }

      if (shot.lang) await setLanguage(page, shot.lang);

      await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settle(page, 1500);
      await hydrateLazyImages(page);

      if (shot.scrollTo === 'floor') {
        await page.evaluate(() => {
          const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
            /featured|collection|精选/i.test(h.textContent ?? ''),
          );
          heading?.scrollIntoView({ block: 'start' });
        });
        await settle(page, 600);
      }

      const broken = await countBrokenImages(page);
      if (broken > 0) {
        brokenImages.push(`${shot.file}: ${broken}`);
        console.warn(`[capture] ! ${shot.file} 有 ${broken} 张图片未能解码`);
      }

      const file = path.join(OUT, shot.file);
      await page.screenshot({ path: file, fullPage: true });
      ok += 1;
      console.log(`[capture] ✓ ${shot.file}`);
    } catch (err) {
      failures.push(`${shot.file}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[capture] ✗ ${shot.file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 集合详情（slug 由数据决定，单独处理）
  if (context.collectionSlug) {
    try {
      await login(page, BUYER, 'buyer');
      await setLanguage(page, 'en');
      await page.goto(`${BASE}/collections/${context.collectionSlug}`, { waitUntil: 'domcontentloaded' });
      await settle(page, 1500);
      await hydrateLazyImages(page);
      await page.screenshot({ path: path.join(OUT, '12-collection-detail.png'), fullPage: true });
      ok += 1;
      console.log('[capture] ✓ 12-collection-detail.png');
    } catch (err) {
      failures.push(`12-collection-detail.png: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await browser.close();

  console.log(`\n[capture] 完成：成功 ${ok} 张，失败 ${failures.length} 张`);
  if (failures.length > 0) {
    console.log('[capture] 失败明细：');
    for (const f of failures) console.log('  -', f);
    process.exitCode = 1;
  }
  if (brokenImages.length > 0) {
    console.error('[capture] 图片解码失败：');
    for (const item of brokenImages) console.error('  -', item);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[capture] 致命错误:', err);
  process.exit(1);
});
