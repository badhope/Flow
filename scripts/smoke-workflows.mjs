#!/usr/bin/env node
/**
 * 全工作流冒烟（不依赖任何模型/渠道凭据，可在无 Key 实例上运行）：
 *   认证（刷新/登出/重登）· 购物车（增改→迁移码→恢复→登录合并）· 收藏切换 · 地址簿 CRUD
 *   卖家分类/商品（含变体）· CSV 批量导入 · 搜索 · 发货+物流 · 带图评价 · 集合 · CMS · 咨询会话
 *   看板聚合 · 审计日志 · 角色越权拦截
 * 用法：SMOKE_BASE=http://127.0.0.1:3000 DATABASE_URL=... node scripts/smoke-workflows.mjs
 */
import postgres from 'postgres';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[workflows] DATABASE_URL is required');
  process.exit(1);
}

const runId = Date.now().toString(36);
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
let step = 0;

function ok(msg) {
  step += 1;
  console.log(`[workflows] ${String(step).padStart(2, '0')}. ${msg}`);
}
function assert(cond, msg) {
  if (!cond) {
    console.error(`[workflows] ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

/** 认证类请求遇到 429（认证限流 5 次/分）时等待重试，避免多脚本连跑互相打扰 */
async function withAuthRetry(fn, maxAttempts = 6) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const status = Number((err && err.message && err.message.match(/-> (\d+)/) || [])[1] || 0);
      if (status !== 429 || attempt >= maxAttempts) throw err;
      const waitMs = 15000;
      console.warn(`[smoke] 命中认证限流，${waitMs / 1000}s 后重试（第 ${attempt} 次）`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function api(method, path, { cookie, sessionId, json, form, expect = [200, 201] } = {}) {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
  };
  let body;
  if (form) {
    body = form; // FormData：不要手动设 Content-Type
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const parsed = await res.json().catch(() => null);
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} (expected ${expect}): ${JSON.stringify(parsed)}`);
  }
  return { status: res.status, body: parsed, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}

try {
  await api('GET', '/api/health');

  // ---------- 账号 ----------
  const seller = await withAuthRetry(() => api('POST', '/api/auth/register', {
    json: { email: `wf-seller-${runId}@test.dev`, password: 'Passw0rd1', name: 'WF Seller', role: 'seller', sellerCode: 'smoke-secret' },
   }));
  const buyer = await withAuthRetry(() => api('POST', '/api/auth/register', {
    json: { email: `wf-buyer-${runId}@test.dev`, password: 'Passw0rd1', name: 'WF Buyer' },
   }));
  ok('账号就绪（卖家 + 买家）');

  // ---------- 认证工作流：刷新 / 登出 / 重登 ----------
  const refreshed = await api('POST', '/api/auth/refresh', { cookie: buyer.cookie });
  assert(refreshed.body?.user?.id === buyer.body.user.id, '刷新应返回同一用户');
  const logoutRes = await api('POST', '/api/auth/logout', { cookie: buyer.cookie });
  // 用登出响应中"作废后的 Cookie"继续请求（等价浏览器行为）
  const meAfterLogout = await api('GET', '/api/auth/me', { cookie: logoutRes.cookie });
  assert(meAfterLogout.body === null, `登出后 me 应为 null，实际 ${JSON.stringify(meAfterLogout.body)}`);
  const relogin = await api('POST', '/api/auth/login', { json: { email: `wf-buyer-${runId}@test.dev`, password: 'Passw0rd1' } });
  assert(relogin.body?.user?.email === `wf-buyer-${runId}@test.dev`, '重登应成功');
  ok('认证工作流：refresh → logout → me=null → 重登 全通');

  // ---------- 卖家：分类 + 商品（含变体）----------
  const categoryRes = await api('POST', '/api/categories', {
    cookie: seller.cookie,
    json: { nameZh: '工作流类目', nameEn: `Workflow Cat ${runId}`, slug: `wf-cat-${runId}`, sortOrder: 9 },
  });
  const categoryId = categoryRes.body?.id;
  assert(categoryId, '分类创建失败');

  const productRes = await api('POST', '/api/products', {
    cookie: seller.cookie,
    json: {
      titleZh: '工作流折叠水杯',
      titleEn: `WF Folding Cup ${runId}`,
      descZh: '工作流测试商品',
      descEn: 'Workflow test product',
      categoryId,
      price: 15,
      stock: 0,
      status: 'active',
      coverImage: `https://example.com/wf-${runId}.png`,
      descEn: 'Workflow test product description',
      variants: [
        { sku: `WF-${runId}-R`, optionValues: ['红'], price: 15, stock: 20, status: 'active' },
        { sku: `WF-${runId}-B`, optionValues: ['蓝'], price: 18, stock: 10, status: 'active' },
      ],
    },
  });
  const product = productRes.body;
  assert(product?.variants?.length === 2, `商品应含 2 个变体，实际 ${product?.variants?.length}`);
  assert(product?.totalStock === 30, `聚合库存应为 30，实际 ${product?.totalStock}`);
  const variantId = product.variants.find((v) => v.sku?.endsWith('-R'))?.id;
  assert(variantId, '未找到红色变体');

  const patched = await api('PATCH', `/api/products/${product.id}`, {
    cookie: seller.cookie,
    json: { titleZh: '工作流折叠水杯（已改）' },
  });
  assert(patched.body?.titleZh?.includes('已改'), '商品更新未生效');
  ok('卖家商品工作流：分类 → 商品(2 变体/聚合库存 30) → 更新 全通');

  // ---------- 界面路径：不带 variants 创建 → 默认变体自动生成 → 可下单（历史断裂点） ----------
  await api('POST', '/api/shipping-templates', {
    cookie: seller.cookie,
    json: { name: `wf-tpl-${runId}`, isDefault: true, baseFee: '5.00', extraFeePerUnit: '2.00', freeShippingThreshold: '1000.00', unitType: 'quantity' },
  });

  const uiProduct = await api('POST', '/api/products', {
    cookie: seller.cookie,
    json: { titleZh: '界面路径商品', titleEn: `UI Path Item ${runId}`, categoryId, price: 9.9, stock: 7, status: 'active', coverImage: `https://example.com/ui-${runId}.png`, descEn: 'UI path product description' },
  });
  assert(uiProduct.body?.variants?.length === 1, `界面路径创建应自动生成默认变体，实际 ${uiProduct.body?.variants?.length}`);
  assert(Number(uiProduct.body?.totalStock) === 7, `聚合库存应为 7，实际 ${uiProduct.body?.totalStock}`);
  const uiVariantId = uiProduct.body.variants[0].id;

  const uiUpdated = await api('PATCH', `/api/products/${uiProduct.body.id}`, {
    cookie: seller.cookie,
    json: { price: 12.5, stock: 9 },
  });
  assert(Number(uiUpdated.body?.variants?.[0]?.price) === 12.5, `编辑价格应同步到变体，实际 ${uiUpdated.body?.variants?.[0]?.price}`);
  assert(Number(uiUpdated.body?.variants?.[0]?.stock) === 9, `编辑库存应同步到变体，实际 ${uiUpdated.body?.variants?.[0]?.stock}`);

  const uiOrder = await api('POST', '/api/orders', {
    cookie: relogin.cookie,
    json: {
      buyerName: 'WF Buyer', shippingAddress: '1 Workflow Rd', shippingCity: 'Shanghai', shippingCountry: 'CN',
      paymentMethod: 'demo',
      items: [{ productId: uiProduct.body.id, variantId: uiVariantId, quantity: 1 }],
    },
  });
  // 订单发往 CN：跨境电商零售进口综合税率 9.1%，税基 = 货值 + 运费
  // (12.50 + 5.00) * 9.1% = 1.59 → 总额 17.50 + 1.59 = 19.09
  assert(uiOrder.body?.totalAmount === '19.09', `界面路径商品应可下单（12.50 + 5 + 税 1.59 = 19.09），实际 ${uiOrder.body?.totalAmount}`);
  assert(Number(uiOrder.body?.taxAmount) === 1.59, `CN 订单应计 9.1% 跨境税（1.59），实际 ${uiOrder.body?.taxAmount}`);
  ok('界面路径：无变体创建→默认变体自动生成→价格/库存同步→真实下单 19.09（含 1.59 跨境税）');

  // ---------- CSV 批量导入 ----------
  const csv = [
    'nameZh,nameEn,category,price,stock,descriptionZh,descriptionEn,images',
    `CSV杯A,CSV Cup A,wf-cat-${runId},19.90,12,描述A,Desc A,`,
    `CSV杯B,CSV Cup B,wf-cat-${runId},29.90,8,描述B,Desc B,https://example.com/a.png`,
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
  const imported = await api('POST', '/api/products/import', { cookie: seller.cookie, form });
  assert(imported.body?.successCount === 2, `CSV 导入应成功 2 行，实际 ${JSON.stringify(imported.body)}`);

  const search = await api('GET', `/api/products?keyword=${encodeURIComponent(`CSV Cup A`)}`);
  assert(search.body?.items?.some((p) => p.titleEn === 'CSV Cup A'), 'CSV 导入的商品应可被搜索到');
  const featured = await api('GET', '/api/products/featured');
  assert(Array.isArray(featured.body), 'featured 应返回数组');
  ok('CSV 批量导入 2 行 → 搜索命中 → featured 列表可用');

  // ---------- 购物车：游客增改 → 迁移码 → 恢复 → 登录合并 ----------
  const sid1 = `wf-guest1-${runId}`;
  const sid2 = `wf-guest2-${runId}`;
  const added = await api('POST', '/api/cart/items', {
    sessionId: sid1,
    json: { productId: product.id, variantId, quantity: 2 },
  });
  const cartItem = added.body?.items?.find((i) => i.productId === product.id);
  assert(cartItem, '加购失败');

  const updatedCart = await api('PATCH', `/api/cart/items/${cartItem.id}`, { sessionId: sid1, json: { quantity: 3 } });
  const updatedItem = updatedCart.body?.items?.find((i) => i.id === cartItem.id);
  assert(updatedItem?.quantity === 3, `改量应为 3，实际 ${updatedItem?.quantity}`);

  const recovery = await api('GET', '/api/cart/export-code', { sessionId: sid1 });
  assert(typeof recovery.body?.code === 'string' && recovery.body.code.length >= 4, '迁移码导出失败');

  const importedCart = await api('POST', '/api/cart/import-code', { sessionId: sid2, json: { code: recovery.body.code } });
  assert(importedCart.body?.items?.some((i) => i.productId === product.id && i.quantity === 3), '迁移码恢复购物车失败');

  await api('POST', '/api/auth/merge-cart', { cookie: relogin.cookie, json: { sessionId: sid2 } });
  const buyerCart = await api('GET', '/api/cart', { cookie: relogin.cookie });
  assert(buyerCart.body?.items?.some((i) => i.productId === product.id), '登录合并后买家购物车应含商品');
  const guestCartAfter = await api('GET', '/api/cart', { sessionId: sid2 });
  assert((guestCartAfter.body?.items ?? []).length === 0, '合并后游客购物车应清空');
  ok('购物车工作流：加购→改量→迁移码导出/恢复→登录合并（游客车清空）全通');

  // ---------- 收藏（toggle） ----------
  const favOn = await api('POST', `/api/favorites/${product.id}`, { cookie: relogin.cookie, json: {} });
  assert(favOn.body?.favorited === true, '收藏应生效');
  const favList = await api('GET', '/api/favorites', { cookie: relogin.cookie });
  assert(favList.body?.some((f) => f.productId === product.id || f.id === product.id), '收藏列表应包含商品');
  const favCheck = await api('GET', `/api/favorites/check/${product.id}`, { cookie: relogin.cookie });
  assert(favCheck.body?.favorited === true, 'check 应为已收藏');
  const favOff = await api('POST', `/api/favorites/${product.id}`, { cookie: relogin.cookie, json: {} });
  assert(favOff.body?.favorited === false, '再次 toggle 应取消收藏');
  ok('收藏工作流：toggle 收藏 → 列表/check 一致 → toggle 取消');

  // ---------- 地址簿 CRUD ----------
  const addr = await api('POST', '/api/addresses', {
    cookie: relogin.cookie,
    json: { receiverName: 'WF Buyer', phone: '+8613800000000', addressLine1: '1 Workflow Rd', city: 'Shanghai', country: 'CN', zipCode: '200000', isDefault: true },
  });
  const addrId = addr.body?.id;
  assert(addrId, '地址创建失败');
  const addrList = await api('GET', '/api/addresses', { cookie: relogin.cookie });
  assert(addrList.body?.some((a) => a.id === addrId), '地址列表应包含新地址');
  const addrUpdated = await api('PUT', `/api/addresses/${addrId}`, {
    cookie: relogin.cookie,
    json: { receiverName: 'WF Buyer 2', phone: '+8613800000001', addressLine1: '2 Workflow Rd', city: 'Beijing', country: 'CN', zipCode: '100000', isDefault: true },
  });
  assert(addrUpdated.body?.city === 'Beijing', '地址更新未生效');
  await api('PUT', `/api/addresses/${addrId}/default`, { cookie: relogin.cookie });
  await api('DELETE', `/api/addresses/${addrId}`, { cookie: relogin.cookie });
  const addrAfter = await api('GET', '/api/addresses', { cookie: relogin.cookie });
  assert(!addrAfter.body?.some((a) => a.id === addrId), '地址删除未生效');
  ok('地址簿工作流：创建 → 列表 → 更新 → 设默认 → 删除 全通');

  // ---------- 下单 → 发货 → 物流 ----------
  const order = await api('POST', '/api/orders', {
    cookie: relogin.cookie,
    json: {
      buyerName: 'WF Buyer', shippingAddress: '1 Workflow Rd', shippingCity: 'Shanghai', shippingCountry: 'CN',
      paymentMethod: 'demo',
      items: [{ productId: product.id, variantId, quantity: 1 }],
    },
  });
  // CN 订单：(15 + 5) * 9.1% = 1.82 → 20.00 + 1.82 = 21.82
  assert(order.body?.totalAmount === '21.82', `订单应为 15 + 5 + 税 1.82 = 21.82，实际 ${order.body?.totalAmount}`);
  await api('POST', '/api/payments/pay', { cookie: relogin.cookie, json: { orderId: order.body.id, provider: 'demo' } });

  const shipped = await api('PATCH', `/api/orders/${order.body.id}/status`, {
    cookie: seller.cookie,
    json: { status: 'shipped', trackingNumber: `WFTRK${runId}`, carrier: 'DHL' },
  });
  assert(shipped.body?.status === 'shipped', '发货状态未生效');
  await api('POST', '/api/logistics', {
    cookie: seller.cookie,
    json: { orderId: order.body.id, carrier: 'DHL', trackingNumber: `WFTRK${runId}` },
  });
  // 买家带身份查询自己订单的轨迹（无身份的裸查被服务端正确拒绝，下面的负例验证这一点）
  const tracking = await api('GET', `/api/logistics/${order.body.id}`, { cookie: relogin.cookie });
  assert(JSON.stringify(tracking.body).includes(`WFTRK${runId}`), `物流应可查询到运单号，实际 ${JSON.stringify(tracking.body)}`);
  await api('GET', `/api/logistics/${order.body.id}`, { expect: [400] });
  ok('物流越权保护：无身份裸查被拒（400），买家带身份可查自己的轨迹');
  ok('履约工作流：下单 20.00 → 支付 → 发货(DHL/运单号) → 物流查询命中');

  // ---------- 评价 ----------
  const review = await api('POST', `/api/products/${product.id}/reviews`, {
    cookie: relogin.cookie,
    json: { rating: 5, comment: '工作流测试：质量不错' },
  });
  assert(review.body?.rating === 5, '评价创建失败');
  const reviewList = await api('GET', `/api/products/${product.id}/reviews`);
  assert(reviewList.body?.items?.some((r) => r.content?.includes('工作流测试')), '评价列表应包含新评价（items 包装）');
  assert(reviewList.body?.totalCount >= 1, '评价统计 totalCount 应 ≥ 1');
  const myReview = await api('GET', `/api/products/${product.id}/reviews/my`, { cookie: relogin.cookie });
  assert(myReview.body?.review?.rating === 5 && myReview.body?.hasPurchased === true, '我的评价/已购标记异常');
  ok('评价工作流：购买后可评 → 列表可见 → my(hasPurchased=true)');

  // ---------- 集合 ----------
  const collection = await api('POST', '/api/collections', {
    cookie: seller.cookie,
    json: {
      titleZh: '工作流精选',
      titleEn: `Workflow Featured ${runId}`,
      slug: `wf-col-${runId}`,
      descriptionZh: 'workflow',
      isFeatured: true,
      status: 'active',
    },
  });
  const collectionId = collection.body?.id;
  assert(collectionId, `集合创建失败: ${JSON.stringify(collection.body)}`);

  await api('POST', `/api/collections/${collectionId}/products`, {
    cookie: seller.cookie,
    json: { productId: product.id },
  });
  const featuredCols = await api('GET', '/api/collections/featured');
  assert(featuredCols.body?.some((c) => c.slug === `wf-col-${runId}`), 'featured 集合应包含新集合');
  const colDetail = await api('GET', `/api/collections/${collectionId}`, { cookie: seller.cookie });
  const colProducts = colDetail.body?.products ?? [];
  assert(
    colProducts.some((p) => p.productId === product.id && p.titleZh === '工作流折叠水杯（已改）'),
    `集合详情应包含该商品，实际 ${JSON.stringify(colProducts).slice(0, 200)}`,
  );
  const renamed = await api('PUT', `/api/collections/${collectionId}`, {
    cookie: seller.cookie,
    json: { titleZh: '工作流精选（改）' },
  });
  assert(renamed.body?.titleZh?.includes('改'), '集合更新未生效');

  // 首页店铺楼层（买家公开接口）：精选集合 + 完整商品
  const storefront = await api('GET', '/api/collections/storefront');
  const floor = storefront.body?.find((s) => s.slug === `wf-col-${runId}`);
  assert(floor, '首页楼层应包含该精选集合');
  assert(floor.products?.length >= 1, '楼层应带回集合内完整商品');
  assert(
    floor.products.some((p) => p.id === product.id && p.variants?.length === 2),
    '楼层商品应为完整对象（含变体，供购买）',
  );

  // 集合详情（买家公开，按 slug）
  const bySlug = await api('GET', `/api/collections/by-slug/wf-col-${runId}`);
  assert(bySlug.body?.titleZh === '工作流精选（改）', '按 slug 获取集合详情失败');

  // 批量商品接口（楼层/详情复用）
  const byIds = await api('GET', `/api/products/by-ids?ids=${product.id}`);
  assert(byIds.body?.length === 1 && byIds.body[0].id === product.id, '批量商品接口异常');

  await api('DELETE', `/api/collections/${collectionId}`, { cookie: seller.cookie });
  ok('集合工作流：创建 → 加商品 → 首页楼层(完整商品) → slug 详情 → 批量商品 → 删除');

  // ---------- CMS ----------
  const page = await api('POST', '/api/cms/pages', {
    cookie: seller.cookie,
    json: {
      slug: `wf-about-${runId}`,
      titleZh: '工作流 About',
      titleEn: 'Workflow About',
      contentZh: '<p>hello workflow</p>',
      contentEn: '<p>english workflow</p>',
      isPublished: true,
    },
  });
  assert(page.body?.id, `CMS 页面创建失败: ${JSON.stringify(page.body)}`);
  const publicPage = await api('GET', `/api/pages/wf-about-${runId}`);
  assert(publicPage.body?.contentZh?.includes('hello workflow'), '公开页面应可访问（中文内容）');
  await api('PUT', `/api/cms/pages/${page.body.id}`, { cookie: seller.cookie, json: { contentZh: '<p>updated workflow</p>' } });
  const updatedPage = await api('GET', `/api/pages/wf-about-${runId}`);
  assert(updatedPage.body?.contentZh?.includes('updated workflow'), '页面更新未生效');

  const cmsList = await api('GET', '/api/cms/pages?page=1&pageSize=50&status=published', { cookie: seller.cookie });
  assert(cmsList.body?.items?.some((p) => p.slug === `wf-about-${runId}`), 'status=published 过滤应命中新页面');
  const cmsSearch = await api('GET', `/api/cms/pages?page=1&pageSize=50&keyword=${encodeURIComponent('Workflow About')}`, { cookie: seller.cookie });
  assert(cmsSearch.body?.items?.some((p) => p.slug === `wf-about-${runId}`), '关键词搜索应命中新页面');
  const draftList = await api('GET', '/api/cms/pages?page=1&pageSize=50&status=draft', { cookie: seller.cookie });
  assert(!draftList.body?.items?.some((p) => p.slug === `wf-about-${runId}`), '草稿过滤不应包含已发布页面');

  await api('DELETE', `/api/cms/pages/${page.body.id}`, { cookie: seller.cookie });
  ok('CMS 工作流：创建(双语) → 公开访问 → 更新 → 发布态/关键词过滤 → 删除');

  // ---------- 咨询会话（买家 → 卖家回复 → 买家可见） ----------
  const sid3 = `wf-inq-${runId}`;
  await api('POST', '/api/inquiry/sessions', { sessionId: sid3, json: { sessionId: sid3 } });
  await api('POST', '/api/inquiry/messages', {
    sessionId: sid3,
    json: { sessionId: sid3, content: '请问这款有水货吗？', role: 'user' },
  });
  const sessions = await api('GET', '/api/inquiry/sessions?page=1&pageSize=50', { cookie: seller.cookie });
  assert(sessions.body?.items?.some((s) => s.sessionId === sid3), '卖家会话列表应包含该会话');
  const msgs1 = await api('GET', `/api/inquiry/sessions/${sid3}/messages`, { cookie: seller.cookie });
  assert(msgs1.body?.length === 1, '卖家应看到买家 1 条消息');
  await api('POST', '/api/inquiry/messages', {
    cookie: seller.cookie,
    json: { sessionId: sid3, content: '正品现货，今天可发。', role: 'seller' },
  });
  const msgs2 = await api('GET', `/api/inquiry/sessions/${sid3}/messages`, { sessionId: sid3 });
  assert(msgs2.body?.length === 2 && msgs2.body[1]?.role === 'seller', '买家应能看到卖家回复');
  ok('咨询工作流：买家提问 → 卖家可见并回复 → 买家看到回复');

  // ---------- 看板 & 审计 ----------
  const dashboard = await api('GET', '/api/dashboard/stats', { cookie: seller.cookie });
  assert(Number(dashboard.body?.stats?.orderCount) >= 1, '看板订单数应 ≥ 1');
  assert(Number(dashboard.body?.stats?.gmv) > 0, '看板 GMV 应 > 0');
  assert(Array.isArray(dashboard.body?.salesTrend) && dashboard.body.salesTrend.length === 30, '销售趋势应为 30 天序列');

  const audit = await api('GET', '/api/audit-logs?page=1&pageSize=50', { cookie: seller.cookie });
  assert((audit.body?.items ?? []).length > 0, '审计日志应有记录');
  assert(
    audit.body.items.some((l) => /order\.|coupon\.|product|payment\./.test(String(l.action))),
    '审计日志应包含交易/商品类动作',
  );
  ok('看板：orderCount/GMV/30 天趋势真实聚合；审计日志可回溯业务动作');

  // ---------- 角色越权拦截 ----------
  await api('GET', '/api/audit-logs', { cookie: relogin.cookie, expect: [403] });
  await api('GET', '/api/coupons', { cookie: relogin.cookie, expect: [403] });
  await api('PATCH', `/api/orders/${order.body.id}/status`, {
    cookie: relogin.cookie,
    json: { status: 'delivered' },
    expect: [403],
  });
  ok('越权拦截：买家访问卖家端点一律 403（审计/优惠券/订单流转）');

  console.log('[workflows] ALL PASSED —— 全部业务工作流端到端可运行');
} catch (err) {
  console.error('[workflows] FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
