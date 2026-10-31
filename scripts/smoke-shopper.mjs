#!/usr/bin/env node
/**
 * 买家端 AI 导购冒烟（mock LLM）：
 *   1) 匿名会话：搜索 → 详情 → 加购待确认（审批前购物车为空）
 *   2) 确认后购物车真实写入（复用 CartService）
 *   3) 工具集隔离：买家拿不到卖家工具，调用卖家工具会被拒绝
 *   4) 会话隔离：另一个 session 打不开别人的会话
 *
 * 前置：node scripts/mock-providers.mjs；应用 LLM_* 指向 mock；SELLER_REGISTRATION_CODE
 * 用法：SMOKE_BASE=... MOCK_BASE=... DATABASE_URL=... node scripts/smoke-shopper.mjs
 */
import postgres from 'postgres';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3105';
const MOCK = process.env.MOCK_BASE ?? 'http://127.0.0.1:4880';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[shopper-smoke] DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const runId = Date.now().toString(36);
const SESSION = `shopper-${runId}-session-0001`;
let step = 0;

function ok(msg) {
  step += 1;
  console.log(`[shopper-smoke] ${String(step).padStart(2, '0')}. ${msg}`);
}
function assert(condition, message) {
  if (!condition) {
    console.error(`[shopper-smoke] ASSERT FAILED: ${message}`);
    process.exit(1);
  }
}

/** 认证类请求遇到 429（登录/注册限流 5 次/分）时等待重试，避免多套冒烟连跑互相打扰 */
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

async function api(method, path, { sessionId = SESSION, cookie, json, expect = [200, 201] } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body = await res.json().catch(() => null);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const nextCookie = setCookie.length > 0 ? setCookie.map((c) => c.split(';')[0]).join('; ') : cookie;
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return { status: res.status, body, cookie: nextCookie };
}

try {
  // 准备：卖家 + 分类 + 商品（带 active 变体）
  const seller = await withAuthRetry(() => api('POST', '/api/auth/register', {
    sessionId: '',
    json: {
      email: `shopper-seller-${runId}@test.dev`,
      password: 'Passw0rd1',
      name: 'Shopper Seller',
      role: 'seller',
      sellerCode: process.env.SELLER_REGISTRATION_CODE ?? 'smoke-secret',
    },
  }));
  const [category] = await sql`
    INSERT INTO categories (name_zh, name_en, slug)
    VALUES ('数码配件', 'Digital Accessories', ${'shopper-cat-' + runId}) RETURNING id`;
  const [product] = await sql`
    INSERT INTO products (seller_id, title_zh, title_en, desc_zh, desc_en, category_id, status, total_stock)
    VALUES (${seller.body.user.id}, '无线蓝牙耳机', ${'Wireless Earbuds ' + runId}, '降噪蓝牙耳机', 'Noise cancelling earbuds', ${category.id}, 'active', 25)
    RETURNING id`;
  await sql`
    INSERT INTO product_variants (product_id, sku, price, stock, status)
    VALUES (${product.id}, ${'SHOP-SKU-' + runId}, 39.90, 25, 'active')`;

  const settings = await api('PUT', '/api/ai/settings', {
    sessionId: '',
    cookie: seller.cookie,
    json: { baseUrl: `${MOCK}/llm`, apiKey: 'mock-key', model: 'mock-shopper' },
  });
  assert(settings.body.configured === true, '模型设置应已生效');
  ok('卖家/分类/商品/模型设置就绪');

  const tools = await api('GET', '/api/shopper/tools');
  const toolNames = tools.body.tools.map((tool) => tool.name);
  assert(toolNames.includes('search_products'), '应有 search_products');
  assert(!toolNames.includes('update_order_status'), '买家不应看到卖家工具 update_order_status');
  assert(!toolNames.includes('create_coupon'), '买家不应看到 create_coupon');
  ok(`工具隔离：${toolNames.length} 个买家工具，无卖家工具`);

  const conversation = await api('POST', '/api/shopper/conversations', { json: {} });
  const conversationId = conversation.body.id;
  assert(!!conversationId, '应创建匿名会话');

  // 搜索 → 详情
  const search = await api('POST', `/api/shopper/conversations/${conversationId}/messages`, {
    json: { content: '帮我推荐耳机' },
  });
  assert(search.body.toolTrace.some((t) => t.tool === 'search_products' && t.kind === 'read'), '应执行 search_products');
  assert(search.body.toolTrace.some((t) => t.tool === 'get_product_detail'), '应继续读取详情');
  ok('导购：搜索 → 详情链路');

  // 加购待确认
  const addRes = await api('POST', `/api/shopper/conversations/${conversationId}/messages`, {
    json: { content: '把这个加入购物车' },
  });
  const action = addRes.body.actions.find((a) => a.toolName === 'add_to_cart');
  assert(action && action.status === 'pending', '加购应生成 pending 动作');
  const cartBefore = await api('GET', '/api/cart');
  assert(cartBefore.body.itemCount === 0, `确认前购物车应为空，实际 ${cartBefore.body.itemCount}`);
  ok('加购：待确认，购物车未变');

  // 确认
  const confirmed = await api('POST', `/api/shopper/actions/${action.id}/resolve`, { json: { approve: true } });
  assert(confirmed.body.ok === true, `确认应成功：${confirmed.body.message}`);
  const cartAfter = await api('GET', '/api/cart');
  assert(cartAfter.body.itemCount === 1, `确认后购物车应有 1 件，实际 ${cartAfter.body.itemCount}`);
  assert(cartAfter.body.items[0].productId === product.id, '购物车应是刚加的商品');
  ok('加购：确认后真实写入购物车');

  // 漏斗：viewed / recommended / cart_confirmed 都应被记录并去重
  const funnel = await (async () => {
    const res = await fetch(`${BASE}/api/copilot/shopper-funnel?days=30`, {
      headers: { Cookie: seller.cookie },
    });
    return { status: res.status, body: await res.json() };
  })();
  assert(funnel.status === 200, `漏斗接口应 200，实际 ${funnel.status}`);
  const stageMap = Object.fromEntries(funnel.body.stages.map((stage) => [stage.stage, stage.sessions]));
  assert(stageMap.viewed >= 1, `打开导购会话数应 ≥1，实际 ${stageMap.viewed}`);
  assert(stageMap.recommended >= 1, `获得推荐会话数应 ≥1，实际 ${stageMap.recommended}`);
  assert(stageMap.cart_confirmed >= 1, `确认加购会话数应 ≥1，实际 ${stageMap.cart_confirmed}`);
  assert(funnel.body.topQueries.some((item) => item.keyword.includes('耳机')), '热搜词应包含"耳机"');
  assert(typeof funnel.body.overallConversion === 'number', '应有整体转化率');

  // 下单阶段：为这个匿名会话造一笔真实订单，漏斗的 ordered 应变为 1
  await sql`
    INSERT INTO orders (order_no, seller_id, status, subtotal, total_amount, payment_method, address_snapshot)
    VALUES (
      ${'ORDSHOP' + runId.toUpperCase()},
      ${seller.body.user.id},
      'paid',
      39.90,
      39.90,
      'demo',
      ${JSON.stringify({ receiverName: 'Shopper Buyer', addressLine1: '1 Test Rd', city: 'Testville', country: 'US', sessionId: SESSION })}
    )`;
  const funnelAfterOrder = await (async () => {
    const res = await fetch(`${BASE}/api/copilot/shopper-funnel?days=30`, { headers: { Cookie: seller.cookie } });
    return res.json();
  })();
  const orderedAfter = funnelAfterOrder.stages.find((stage) => stage.stage === 'ordered')?.sessions ?? 0;
  assert(orderedAfter >= 1, `下单阶段应识别到该会话订单，实际 ${orderedAfter}`);
  ok(`导购漏斗：打开 ${stageMap.viewed} → 推荐 ${stageMap.recommended} → 加购 ${stageMap.cart_confirmed} → 下单 ${orderedAfter}`);

  // 零结果搜索 → 需求缺口（不污染 recommended 阶段）
  // 用新会话：同一会话已有 search_products 历史，会干扰"首轮搜索"判定
  const missConversation = await api('POST', '/api/shopper/conversations', { json: {} });
  const missKeyword = `机械键盘${runId.slice(-4)}`;
  const missRes = await api('POST', `/api/shopper/conversations/${missConversation.body.id}/messages`, {
    json: { content: `帮我找一下没有的商品：${missKeyword}` },
    expect: [200, 201],
  });
  assert(missRes.status === 201, `零结果搜索应正常返回，实际 ${missRes.status}`);

  const gaps = await (async () => {
    const res = await fetch(`${BASE}/api/copilot/shopper-demand-gaps?days=90`, {
      headers: { Cookie: seller.cookie },
    });
    return res.json();
  })();
  assert(Array.isArray(gaps), '需求缺口接口应返回数组');
  // 零结果事件没有商品归属，seller 视角必须 fail-closed，不能看到平台级搜索词。
  assert(!gaps.some((gap) => gap.keyword === missKeyword), `卖家不应看到未归属的全局需求词 ${missKeyword}`);
  assert(gaps.every((gap) => typeof gap.keyword === 'string' && gap.misses > 0), '每条缺口应有关键词与次数');
  if (gaps.length > 1) {
    assert(gaps[0].misses >= gaps[1].misses, '缺口应按搜索次数降序');
  }
  ok(`需求缺口：seller 仅看到可归属商品的 ${gaps.length} 个零结果关键词`);

  // 商品级漏斗：本次加购的商品应出现在"被推荐→加购"里，转化率 100%
  const productFunnel = await (async () => {
    const res = await fetch(`${BASE}/api/copilot/shopper-product-funnel?days=30`, {
      headers: { Cookie: seller.cookie },
    });
    return res.json();
  })();
  assert(Array.isArray(productFunnel.items), '商品级漏斗应返回 items');
  const funnelItem = productFunnel.items.find((item) => item.productId === product.id);
  assert(funnelItem, '刚加购的商品应出现在商品级漏斗里');
  assert(funnelItem.recommendedSessions >= 1, `推荐会话数应 ≥1，实际 ${funnelItem.recommendedSessions}`);
  assert(funnelItem.cartSessions >= 1, `加购会话数应 ≥1，实际 ${funnelItem.cartSessions}`);
  assert(funnelItem.cartRate > 0, '加购转化率应大于 0');
  ok(`商品级漏斗：${funnelItem.title} 推荐 ${funnelItem.recommendedSessions} → 加购 ${funnelItem.cartSessions}（${(funnelItem.cartRate * 100).toFixed(0)}%）`);

  // 会话隔离
  const foreign = await api('GET', `/api/shopper/conversations/${conversationId}`, {
    sessionId: `other-${runId}-session-9999`,
    expect: [404],
  });
  assert(foreign.status === 404, '其他 session 应打不开该会话');
  ok('会话隔离：其他 session 404');

  console.log('[shopper-smoke] ALL PASSED');
} catch (error) {
  console.error('[shopper-smoke] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
