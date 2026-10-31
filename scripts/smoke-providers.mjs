#!/usr/bin/env node
/**
 * 渠道模拟器全链路冒烟（CI/联调用）：
 *   - AI：5 个 Agent 全链路（文案 JSON / 翻译 / 选品 / 趋势落库回看 / 客服会话落库 / 用量统计）
 *   - Stripe：真实 payment_intent → mock 签名回打 webhook → 幂等入账 → 全额退款（渠道退款调用断言）
 *   - PayPal：下单 → 模拟 capture（webhook 验签由单测覆盖）→ 退款出款路径（渠道退款调用断言）
 *
 * 前置：
 *   1) node scripts/mock-providers.mjs（监听 4880）
 *   2) 应用实例带以下环境启动（见 CI 的 providers job / README 联调章节）：
 *      LLM_BASE_URL=http://127.0.0.1:4880/llm  LLM_API_KEY=mock-key
 *      STRIPE_SECRET_KEY=sk_test_mock  STRIPE_WEBHOOK_SECRET=whsec_mock  STRIPE_API_BASE=http://127.0.0.1:4880/stripe
 *      PAYPAL_CLIENT_ID=mock-cid  PAYPAL_CLIENT_SECRET=mock-sec  PAYPAL_WEBHOOK_ID=mock-wh  PAYPAL_API_BASE=http://127.0.0.1:4880/paypal
 *      SELLER_REGISTRATION_CODE=smoke-secret  DATABASE_URL=...  NODE_ENV=development
 * 用法：SMOKE_BASE=http://127.0.0.1:3130 MOCK_BASE=http://127.0.0.1:4880 DATABASE_URL=... node scripts/smoke-providers.mjs
 */
import postgres from 'postgres';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3130';
const MOCK = process.env.MOCK_BASE ?? 'http://127.0.0.1:4880';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[providers-smoke] DATABASE_URL is required');
  process.exit(1);
}

const runId = Date.now().toString(36);
const startedAt = new Date().toISOString();
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
let step = 0;

function ok(msg) {
  step += 1;
  console.log(`[providers-smoke] ${String(step).padStart(2, '0')}. ${msg}`);
}
function assert(cond, msg) {
  if (!cond) {
    console.error(`[providers-smoke] ASSERT FAILED: ${msg}`);
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

async function api(method, path, { cookie, json, expect = [200, 201] } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const body = await res.json().catch(() => null);
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} (expected ${expect}): ${JSON.stringify(body)}`);
  }
  return { status: res.status, body, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}

async function mock(path, json) {
  const res = await fetch(`${MOCK}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function mockState() {
  const res = await fetch(`${MOCK}/_mock/state`);
  return res.json();
}

try {
  await mock('/_mock/reset');

  // ---------- 基础：账号与商品 ----------
  const seller = await withAuthRetry(() => api('POST', '/api/auth/register', {
    json: { email: `prov-seller-${runId}@test.dev`, password: 'Passw0rd1', name: 'Prov Seller', role: 'seller', sellerCode: 'smoke-secret' },
  }));
  const buyer = await withAuthRetry(() => api('POST', '/api/auth/register', {
    json: { email: `prov-buyer-${runId}@test.dev`, password: 'Passw0rd1', name: 'Prov Buyer' },
  }));

  const [category] = await sql`
    INSERT INTO categories (name_zh, name_en, slug)
    VALUES ('联调类目', 'Providers Category', ${'prov-cat-' + runId}) RETURNING id`;
  const [product] = await sql`
    INSERT INTO products (seller_id, title_zh, title_en, category_id, status)
    VALUES (${seller.body.user.id}, '联调商品', ${'Providers Item ' + runId}, ${category.id}, 'active') RETURNING id`;
  const [variant] = await sql`
    INSERT INTO product_variants (product_id, sku, price, stock, status)
    VALUES (${product.id}, ${'PROV-SKU-' + runId}, 10.00, 100, 'active') RETURNING id`;
  await api('POST', '/api/shipping-templates', {
    cookie: seller.cookie,
    json: { name: `prov-tpl-${runId}`, isDefault: true, baseFee: '5.00', extraFeePerUnit: '2.00', freeShippingThreshold: '100.00', unitType: 'quantity' },
  });
  ok('账号/商品/运费模板就绪');

  // ---------- AI 全链路（mock LLM） ----------
  const aiStatus = await api('GET', '/api/ai/status');
  assert(aiStatus.body?.configured === true, 'AI 应处于已配置状态');
  ok('AI 状态：configured（Mock LLM 端点）');

  // ---------- 模型设置（UI 设置优先于环境变量；清除可回退） ----------
  const settingsBefore = await api('GET', '/api/ai/settings', { cookie: seller.cookie });
  assert(settingsBefore.body?.source === 'env', `初始配置来源应为 env，实际 ${settingsBefore.body?.source}`);
  assert(settingsBefore.body?.configured === true, '环境变量 mock Key 应使 AI 可用');

  const settingsSaved = await api('PUT', '/api/ai/settings', {
    cookie: seller.cookie,
    json: { baseUrl: `${MOCK}/llm`, apiKey: 'sk-db-mock-1234', model: 'deepseek-chat' },
  });
  assert(settingsSaved.body?.source === 'db', `保存后来源应为 db，实际 ${settingsSaved.body?.source}`);
  assert(settingsSaved.body?.apiKeyMasked === 'sk-****1234', `掩码应为 sk-****1234，实际 ${settingsSaved.body?.apiKeyMasked}`);

  const settingsTest = await api('POST', '/api/ai/settings/test', { cookie: seller.cookie });
  assert(settingsTest.body?.ok === true, `连通测试应通过: ${JSON.stringify(settingsTest.body)}`);
  ok('模型设置：env 引导 → UI 保存（db 优先）→ Key 掩码回显 → 连通测试通过');

  const settingsCleared = await api('PUT', '/api/ai/settings', { cookie: seller.cookie, json: { apiKey: '' } });
  assert(settingsCleared.body?.source === 'env', '清除界面 Key 后应回退 env（诚实降级）');
  await api('PUT', '/api/ai/settings', { cookie: seller.cookie, json: { apiKey: 'sk-db-mock-1234' } });
  ok('模型设置：清除回退 env → 重新保存，链路可逆且无残留');

  const copy = await api('POST', '/api/ai/copywriter', {
    cookie: seller.cookie,
    json: { productNameZh: '联调商品', targetMarket: 'US' },
  });
  assert(copy.body?.titleEn === 'Mock Title EN', `文案标题应为 Mock Title EN，实际 ${copy.body?.titleEn}`);
  ok('CopywriterAgent：强制 JSON 解析通过');

  const translated = await api('POST', '/api/ai/translate', { cookie: seller.cookie, json: { text: '你好世界', targetLang: 'th' } });
  assert(translated.body?.translatedText === 'MOCK-TRANSLATED: 你好世界', `翻译结果异常: ${translated.body?.translatedText}`);
  ok('TranslationAgent：目标语言 th 路由通过');

  const select = await api('POST', '/api/ai/select/generate', { cookie: seller.cookie });
  assert(select.body?.items?.[0]?.keyword === 'Mock Keyword', 'SelectAgent JSON 解析异常');
  ok('SelectAgent：结构化推荐解析通过');

  const trend = await api('POST', '/api/ai/trend/generate', { cookie: seller.cookie });
  assert(/^[0-9a-f-]{36}$/.test(trend.body?.id ?? ''), `趋势报告应落库返回 UUID，实际 ${trend.body?.id}`);
  assert((trend.body?.content ?? '').includes('## 行动建议'), '趋势报告内容缺失章节');
  const reports = await api('GET', '/api/ai/reports?type=trend', { cookie: seller.cookie });
  assert(reports.body?.some((r) => r.id === trend.body.id), '历史报告列表应包含刚生成的报告');
  const reportDetail = await api('GET', `/api/ai/reports/${trend.body.id}`, { cookie: seller.cookie });
  assert((reportDetail.body?.content ?? '').includes('Mock'), '报告详情内容不匹配');
  ok('TrendAgent：报告落库 + 历史回看闭环');

  const aiSession = `prov-ai-${runId}`;
  const support = await api('POST', '/api/ai/support/chat', {
    cookie: buyer.cookie,
    json: { message: '物流多久到？', sessionId: aiSession, language: 'zh' },
  });
  assert((support.body?.reply ?? '').includes('MOCK-REPLY'), '客服回复异常');
  const chatRows = await sql`SELECT role FROM inquiry_messages WHERE session_id = ${aiSession} ORDER BY created_at`;
  assert(chatRows.length === 2, `客服对话应落库 2 条（user+assistant），实际 ${chatRows.length}`);
  ok('SupportAgent：回复返回 + 会话落库（卖家咨询管理可回看）');

  const usage = await api('GET', `/api/ai/usage-stats?startDate=${encodeURIComponent(startedAt)}`, { cookie: seller.cookie });
  // 租户隔离后 seller 只能看到自己触发的 4 个 seller Agent；Support 是 buyer 会话，单独按 buyer 统计。
  assert(usage.body?.totalCalls >= 4, `卖家用量统计应 >= 4 次，实际 ${usage.body?.totalCalls}`);
  assert(usage.body?.successRate === 1, `卖家成功率应为 1，实际 ${usage.body?.successRate}`);
  for (const agent of ['copywriter', 'translation', 'select', 'trend']) {
    assert(usage.body?.byAgent?.some((a) => a.agent === agent), `卖家用量统计缺少 agent: ${agent}`);
  }
  ok('AI 用量统计：seller 4 个 Agent 按租户隔离入账（buyer Support 通过会话落库验证）');

  // ---------- 自定义 Agent：默认 5 内置 + 自定义 CRUD / 运行 ----------
  const agentsRes = await api('GET', '/api/ai/agents', { cookie: seller.cookie });
  assert(agentsRes.body?.builtin?.length === 5, `内置 Agent 应为 5 个，实际 ${agentsRes.body?.builtin?.length}`);

  const customSlug = `review-${runId}`;
  const created = await api('POST', '/api/ai/agents', {
    cookie: seller.cookie,
    json: {
      name: '差评回复助手',
      slug: customSlug,
      description: '联调自定义 Agent',
      systemPrompt: '你是资深跨境卖家，擅长礼貌专业地回复买家差评。',
      userPromptTemplate: '请根据以下买家反馈写一段回复：\n{{input}}',
      responseFormat: 'text',
      temperature: 0.5,
      maxTokens: 500,
    },
  });
  assert(created.body?.slug === customSlug, `创建应返回 slug=${customSlug}`);

  const run = await api('POST', `/api/ai/agents/${created.body.id}/run`, {
    cookie: seller.cookie,
    json: { input: '买家给了差评说物流慢' },
  });
  assert((run.body?.content ?? '').includes('MOCK-REPLY'), '运行应走 Mock LLM');
  assert((run.body?.content ?? '').includes('买家给了差评说物流慢'), '模板 {{input}} 应被渲染并送达模型（贯穿）');
  ok('自定义 Agent：创建 → 模板渲染运行（输入贯穿到模型）');

  const jsonAgent = await api('POST', '/api/ai/agents', {
    cookie: seller.cookie,
    json: {
      name: '结构化提取',
      slug: `extract-${runId}`,
      systemPrompt: '你是信息提取助手，输出 JSON。',
      userPromptTemplate: '{{input}}',
      responseFormat: 'json',
      maxTokens: 300,
    },
  });
  const jsonRun = await api('POST', `/api/ai/agents/${jsonAgent.body.id}/run`, {
    cookie: seller.cookie,
    json: { input: '订单号 A123 金额 45 美元' },
  });
  assert(jsonRun.body?.parsed?.mock === true, 'JSON 格式 Agent 应返回已解析对象');
  assert((jsonRun.body?.parsed?.echo ?? '').includes('A123'), 'JSON 回显应包含输入内容');

  const usageAfterCustom = await api('GET', '/api/ai/usage-stats', { cookie: seller.cookie });
  assert(
    usageAfterCustom.body?.byAgent?.some((a) => a.agent === `custom:${customSlug}`),
    `用量统计应包含 custom:${customSlug}`,
  );
  ok('自定义 Agent：JSON 输出解析 + 用量独立入账（custom:<slug>）');

  await api('PUT', `/api/ai/agents/${created.body.id}`, { cookie: seller.cookie, json: { enabled: false } });
  const disabledRun = await api('POST', `/api/ai/agents/${created.body.id}/run`, {
    cookie: seller.cookie,
    json: { input: 'x' },
    expect: [409],
  });
  assert(typeof disabledRun.body?.message === 'string', '停用后运行应被拒绝（409）');

  await api('DELETE', `/api/ai/agents/${created.body.id}`, { cookie: seller.cookie });
  await api('DELETE', `/api/ai/agents/${jsonAgent.body.id}`, { cookie: seller.cookie });
  const agentsFinal = await api('GET', '/api/ai/agents', { cookie: seller.cookie });
  assert(!agentsFinal.body?.custom?.some((a) => a.slug === customSlug), '删除后不应出现在列表');
  ok('自定义 Agent：停用拒绝运行 → 删除清理');

  // ---------- Stripe 全链路 ----------
  const stripeOrder = await api('POST', '/api/orders', {
    cookie: buyer.cookie,
    json: {
      buyerName: 'Prov Buyer', shippingAddress: '3 Mock Ave', shippingCity: 'Seattle', shippingCountry: 'US',
      paymentMethod: 'stripe',
      items: [{ productId: product.id, variantId: variant.id, quantity: 2 }],
    },
  });
  assert(stripeOrder.body?.totalAmount === '27.00', `订单总额应为 27.00，实际 ${stripeOrder.body?.totalAmount}`);

  const stripePay = await api('POST', '/api/payments/pay', {
    cookie: buyer.cookie,
    json: { orderId: stripeOrder.body.id, provider: 'stripe' },
  });
  assert(stripePay.body?.payment?.status === 'pending', 'Stripe 支付应先生成 pending 意图');
  assert((stripePay.body?.payment?.transactionId ?? '').startsWith('pi_mock_'), '意图 ID 应来自 Mock Stripe');
  const afterIntent = await mockState();
  assert(afterIntent.stripe.intents?.[0]?.amountCents === 2700, `Mock 应收到 2700 分意图，实际 ${afterIntent.stripe.intents?.[0]?.amountCents}`);
  ok('Stripe：payment_intent 创建（金额 2700 分，pending 流水）');

  const webhook = await mock('/trigger/stripe/pay', { orderId: stripeOrder.body.id, amountCents: 2700 });
  assert(webhook.body?.status >= 200 && webhook.body?.status < 300 && webhook.body?.body?.received === true, `webhook 回调应被接受: ${JSON.stringify(webhook.body)}`);
  const [stripeOrderRow] = await sql`SELECT status FROM orders WHERE id = ${stripeOrder.body.id}`;
  assert(stripeOrderRow.status === 'paid', `webhook 后订单应为 paid，实际 ${stripeOrderRow.status}`);
  const stripePayments = await sql`SELECT status, transaction_id FROM payments WHERE order_id = ${stripeOrder.body.id}`;
  assert(stripePayments.length === 1 && stripePayments[0].status === 'paid', `pending 流水应就地升级为 paid 且仅 1 条，实际 ${JSON.stringify(stripePayments)}`);
  ok('Stripe：签名 webhook 幂等入账（pending 流水升级，无重复记账）');

  const stripeRefundReq = await api('POST', `/api/orders/${stripeOrder.body.id}/refunds`, {
    cookie: buyer.cookie,
    json: { amount: '27.00', reason: 'other', reasonDetail: 'providers smoke' },
  });
  await api('POST', `/api/refunds/${stripeRefundReq.body.id}/approve`, { cookie: seller.cookie, json: { reply: 'ok' } });
  const afterStripeRefund = await mockState();
  assert(afterStripeRefund.stripe.refunds?.[0]?.amountCents === 2700, `Mock Stripe 应收到 2700 分退款，实际 ${afterStripeRefund.stripe.refunds?.[0]?.amountCents}`);
  const [stripeOrderAfter] = await sql`SELECT status FROM orders WHERE id = ${stripeOrder.body.id}`;
  const [stripePaymentAfter] = await sql`SELECT status FROM payments WHERE order_id = ${stripeOrder.body.id}`;
  assert(stripeOrderAfter.status === 'refunded' && stripePaymentAfter.status === 'refunded', '全退后订单与支付行均应为 refunded');
  ok('Stripe：全额退款渠道调用 + 状态闭环');

  // ---------- PayPal 退款出款路径 ----------
  // 说明：PayPal webhook 验签依赖官方域证书（E2E 不可 mock），验签与回调逻辑由单测覆盖；
  // 这里模拟"capture 已完成"（更新为 paid）以覆盖退款出款的真实 API 调用路径。
  const ppOrder = await api('POST', '/api/orders', {
    cookie: buyer.cookie,
    json: {
      buyerName: 'Prov Buyer', shippingAddress: '4 Mock Ave', shippingCity: 'Seattle', shippingCountry: 'US',
      paymentMethod: 'paypal',
      items: [{ productId: product.id, variantId: variant.id, quantity: 1 }],
    },
  });
  assert(ppOrder.body?.totalAmount === '15.00', `PayPal 订单总额应为 15.00，实际 ${ppOrder.body?.totalAmount}`);
  const ppPay = await api('POST', '/api/payments/pay', {
    cookie: buyer.cookie,
    json: { orderId: ppOrder.body.id, provider: 'paypal' },
  });
  assert((ppPay.body?.approveUrl ?? '').includes('PPO-MOCK'), '应返回 Mock PayPal 审批链接');
  ok('PayPal：checkout order 创建（审批链接返回）');

  await sql`UPDATE payments SET status = 'paid', transaction_id = 'CAP-MOCK-1' WHERE order_id = ${ppOrder.body.id}`;
  await sql`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = ${ppOrder.body.id}`;

  const ppRefundReq = await api('POST', `/api/orders/${ppOrder.body.id}/refunds`, {
    cookie: buyer.cookie,
    json: { amount: '15.00', reason: 'other', reasonDetail: 'providers smoke paypal' },
  });
  await api('POST', `/api/refunds/${ppRefundReq.body.id}/approve`, { cookie: seller.cookie, json: { reply: 'ok' } });
  const afterPp = await mockState();
  const ppRefund = afterPp.paypal.refunds?.[0];
  assert(ppRefund?.captureId === 'CAP-MOCK-1', `退款应对 capture CAP-MOCK-1 发起，实际 ${ppRefund?.captureId}`);
  assert(ppRefund?.amount === '15.00' && ppRefund?.currency === 'USD', `退款金额/币种异常: ${JSON.stringify(ppRefund)}`);
  assert(ppRefund?.auth === 'Bearer MOCK-PAYPAL-AT', '退款应携带 OAuth Bearer');
  ok('PayPal：capture 退款出款（金额/币种/鉴权头符合 REST 规范）');

  const finalState = await mockState();
  console.log(`[providers-smoke] LLM 调用分布: ${JSON.stringify(finalState.llm.agents)}`);
  console.log('[providers-smoke] ALL PASSED');
} catch (err) {
  console.error('[providers-smoke] FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
