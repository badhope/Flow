#!/usr/bin/env node
/**
 * 本地渠道模拟器（联调/CI 专用，不属于生产代码）：
 *   - Stripe：/stripe/*（payment_intents、refunds），并可签名回打应用的 stripe-webhook
 *   - PayPal：/paypal/*（oauth2 token、checkout orders、captures refunds）
 *   - LLM：/llm/v1/chat/completions（OpenAI 兼容，确定性输出，供 5 个 Agent 链路断言）
 *   - 观测：GET /_mock/state 返回全部调用记录；POST /_mock/reset 清空
 *
 * 用法：
 *   STRIPE_WEBHOOK_SECRET=whsec_mock APP_WEBHOOK_BASE=http://127.0.0.1:3000 \
 *   node scripts/mock-providers.mjs            # 默认监听 4880
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4880);
const APP_WEBHOOK_BASE = process.env.APP_WEBHOOK_BASE ?? 'http://127.0.0.1:3000';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_mock';

const state = {
  stripe: { intents: [], refunds: [] },
  paypal: { orders: [], refunds: [], tokens: 0 },
  llm: { calls: 0, agents: {} },
  webhook: { received: [] },
};

const seq = { stripe: 0, paypal: 0, event: 0 };
const intentsByOrder = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function classifyAgent(body) {
  const messages = body?.messages ?? [];
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  // 副驾提示词含「AI 运营副驾」与工具协议，优先识别（其上下文里也会出现订单/商品字样）
  if (system.includes('AI 运营副驾')) return 'copilot';
  if (system.includes('AI 导购')) return 'shopper';
  // 特征键取各 Agent 提示词中的独有输出字段（select 的数据上下文里也含 titleEn 字样，不能作判别键）
  if (user.includes('"bulletPoints"') || user.includes('"longDescription"')) return 'copywriter';
  if (user.includes('"keyword"') && user.includes('"confidence"')) return 'select';
  if (system.includes('翻译')) return 'translation';
  if (system.includes('市场分析师') || user.includes('市场趋势分析报告')) return 'trend';
  if (system.includes('智能客服')) return 'support';
  return 'unknown';
}

/**
 * 副驾模拟决策：按卖家最后一条消息中的指令关键字驱动，覆盖
 * 读工具 → 写工具待审批 → 最终答复 的完整协议；无指令时直接 final。
 */
function copilotContent(body) {
  const messages = body?.messages ?? [];
  const userMessages = messages.filter((m) => m.role === 'user');
  const last = userMessages[userMessages.length - 1]?.content ?? '';
  const seenTools = messages
    .filter((m) => m.role === 'user')
    .map((m) => /^\[工具 ([a-z_]+) 的执行结果\]/.exec(m.content)?.[1])
    .filter(Boolean);
  const sawConfirmHint = messages.some((m) => m.role === 'user' && m.content.startsWith('[系统] 动作已提交卖家确认'));

  const directive = (() => {
    const markers = userMessages.filter((m) => !m.content.startsWith('['));
    for (let i = markers.length - 1; i >= 0; i -= 1) {
      const text = markers[i].content;
      if (text.includes('订单') || text.includes('概况') || text.includes('库存') || text.includes('退款') || text.includes('优惠券') || text.includes('咨询') || text.includes('促销')) {
        return text;
      }
    }
    return last;
  })();

  // 多步计划：清库存促销 = 建券 + 下架商品（同一轮两个写动作 → 一个批次）
  if (directive.includes('促销') || directive.includes('清库存')) {
    const confirmHints = messages.filter(
      (m) => m.role === 'user' && m.content.startsWith('[系统] 动作已提交卖家确认'),
    ).length;
    if (!seenTools.includes('list_low_stock')) {
      return JSON.stringify({ tool: 'list_low_stock', args: { threshold: 20 }, thought: '促销第 1 步：先查低库存商品' });
    }
    if (confirmHints === 0) {
      return JSON.stringify({
        tool: 'create_coupon',
        args: { code: 'CLEAR10', type: 'percent', value: 10, minOrderAmount: 50, totalQuantity: 100, expiresInDays: 14 },
        thought: '促销第 2 步：创建清仓优惠券',
      });
    }
    if (confirmHints === 1) {
      // 取最近一次低库存查询结果里的最后一个商品 id（最新数据，避免误用历史会话里的旧 id）
      const toolResults = messages
        .filter((m) => m.role === 'user' && m.content.startsWith('[工具 list_low_stock 的执行结果]'))
        .map((m) => m.content);
      const latest = toolResults[toolResults.length - 1] ?? '';
      const ids = [...latest.matchAll(/id=([0-9a-f-]{36})/gi)].map((match) => match[1]);
      if (ids.length > 0) {
        return JSON.stringify({
          tool: 'update_product_status',
          args: { productId: ids[0], status: 'inactive' },
          thought: '促销第 3 步：下架清仓商品',
        });
      }
    }
    return JSON.stringify({ final: '已提交清库存促销计划，等待你整批确认。' });
  }

  if (directive.includes('变更为') || directive.includes('发货')) {
    if (sawConfirmHint) return JSON.stringify({ final: '已提交订单状态变更，等待你确认后执行。' });
    const status = directive.includes('已送达') ? 'delivered' : 'shipped';
    const m = /ORD[A-Z0-9]+/.exec(directive);
    const orderNo = m ? m[0] : (process.env.MOCK_COPILOT_ORDER_NO ?? 'ORD0000000000000000');
    return JSON.stringify({
      tool: 'update_order_status',
      args: { orderNo, status, carrier: 'MOCK-EXPRESS', trackingNumber: 'MOCK-TRACK-001' },
      thought: '卖家要求变更订单状态',
    });
  }

  if (directive.includes('优惠券')) {
    if (sawConfirmHint) return JSON.stringify({ final: '已提交建券动作，等待你确认后执行。' });
    const codeMatch = /[A-Z][A-Z0-9_-]{2,29}/.exec(directive.replace(/优惠券/g, ' '));
    return JSON.stringify({
      tool: 'create_coupon',
      args: {
        code: codeMatch ? codeMatch[0] : 'MOCK10',
        type: 'percent',
        value: 10,
        minOrderAmount: 50,
        totalQuantity: 100,
        expiresInDays: 30,
      },
      thought: '卖家要求创建优惠券',
    });
  }

  if (directive.includes('退款')) {
    if (seenTools.includes('list_pending_refunds')) {
      return JSON.stringify({ final: '已列出待审批退款，请在下方核对后决定。' });
    }
    return JSON.stringify({ tool: 'list_pending_refunds', args: {}, thought: '先查询待审批退款' });
  }

  if (directive.includes('库存')) {
    if (seenTools.includes('list_low_stock')) {
      return JSON.stringify({ final: '已列出低库存商品。' });
    }
    return JSON.stringify({ tool: 'list_low_stock', args: { threshold: 20 }, thought: '查询低库存商品' });
  }

  if (directive.includes('订单')) {
    if (seenTools.includes('list_orders')) {
      return JSON.stringify({ final: '已列出订单。' });
    }
    return JSON.stringify({ tool: 'list_orders', args: { limit: 5 }, thought: '查询最近订单' });
  }

  if (directive.includes('概况')) {
    if (seenTools.includes('get_store_overview')) {
      return JSON.stringify({ final: '已读取店铺概况。' });
    }
    return JSON.stringify({ tool: 'get_store_overview', args: {}, thought: '读取店铺概况' });
  }

  return JSON.stringify({ final: `MOCK-COPILOT: ${directive.slice(0, 80)}` });
}

/**
 * 买家导购模拟决策：搜索 → 详情 → 加购待确认 → final。
 */
function shopperContent(body) {
  const messages = body?.messages ?? [];
  const userMessages = messages.filter((m) => m.role === 'user' && !m.content.startsWith('['));
  const lastUser = userMessages[userMessages.length - 1]?.content ?? '';
  const toolResults = messages
    .filter((m) => m.role === 'user' && m.content.startsWith('[工具 '))
    .map((m) => m.content);
  const seen = toolResults.map((text) => /^\[工具 ([a-z_]+) 的执行结果\]/.exec(text)?.[1]).filter(Boolean);
  const sawConfirm = messages.some((m) => m.role === 'user' && m.content.startsWith('[系统] 动作已提交买家确认'));

  const searchResult = [...toolResults].reverse().find((text) => text.startsWith('[工具 search_products'));
  const productId = searchResult ? /id=([0-9a-f-]{36})/i.exec(searchResult)?.[1] : undefined;

  if (lastUser.includes('购物车') && seen.includes('get_my_cart')) {
    return JSON.stringify({ final: '你的购物车内容已在上面列出。' });
  }
  if (lastUser.includes('购物车') && !seen.includes('get_my_cart') && !lastUser.includes('加入')) {
    return JSON.stringify({ tool: 'get_my_cart', args: {}, thought: '查看买家购物车' });
  }

  if (lastUser.includes('加入购物车') || lastUser.includes('加购')) {
    if (sawConfirm) return JSON.stringify({ final: '已提交加购确认，等你确认后生效。' });
    if (!productId) {
      return JSON.stringify({ tool: 'search_products', args: { keyword: '耳机', limit: 3 }, thought: '先搜索商品' });
    }
    return JSON.stringify({ tool: 'add_to_cart', args: { productId, quantity: 1 }, thought: '把搜索到的商品加入购物车' });
  }

  // 明确要"没有的商品"时用该词搜索，制造零结果 → 记录需求缺口
  const missingMatch = /没有的(?:商品)?[：:]?\s*([^\s，。,]{2,10})/.exec(lastUser);
  if (missingMatch) {
    if (seen.includes('search_products')) {
      return JSON.stringify({ final: '抱歉，店里暂时没有这类商品，我已记下你的需求。' });
    }
    return JSON.stringify({ tool: 'search_products', args: { keyword: missingMatch[1], limit: 3 }, thought: '搜索买家指定商品' });
  }

  if (lastUser.includes('耳机') || lastUser.includes('推荐') || lastUser.includes('找')) {
    if (seen.includes('search_products') && productId && !seen.includes('get_product_detail')) {
      return JSON.stringify({ tool: 'get_product_detail', args: { productId }, thought: '查看首条结果详情' });
    }
    if (seen.includes('get_product_detail')) {
      return JSON.stringify({ final: '已查到商品详情，含价格、规格与库存，供你参考。' });
    }
    return JSON.stringify({ tool: 'search_products', args: { keyword: '耳机', limit: 3 }, thought: '搜索耳机' });
  }


  if (lastUser.includes('分类') || lastUser.includes('卖什么')) {
    if (seen.includes('list_categories')) return JSON.stringify({ final: '以上是店铺分类。' });
    return JSON.stringify({ tool: 'list_categories', args: {}, thought: '列出分类' });
  }

  return JSON.stringify({ final: `MOCK-SHOPPER: ${lastUser.slice(0, 60)}` });
}

function llmContent(agent, body) {
  const user = (body?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  if (agent === 'copilot') return copilotContent(body);
  if (agent === 'shopper') return shopperContent(body);
  // 自定义 Agent（unknown）要求 JSON 时返回合法 JSON 并回显输入，供断言模板渲染贯穿
  if (agent === 'unknown' && body?.response_format?.type === 'json_object') {
    return JSON.stringify({ mock: true, echo: user.slice(0, 200) });
  }
  switch (agent) {
    case 'copywriter':
      return JSON.stringify({
        titleEn: 'Mock Title EN',
        bulletPoints: ['Mock point 1', 'Mock point 2'],
        longDescription: 'Mock long description for smoke testing.',
        seoKeywords: 'mock, smoke, test',
      });
    case 'select':
      return JSON.stringify({
        items: [
          {
            keyword: 'Mock Keyword',
            estimatedDemand: 'high',
            suggestedPriceRange: '$19.99 - $29.99',
            reason: 'Mock reason for smoke testing.',
            confidence: 0.9,
          },
        ],
      });
    case 'translation': {
      const text = user.includes('：\n\n') ? user.split('：\n\n').slice(1).join('：\n\n').trim() : user;
      return `MOCK-TRANSLATED: ${text}`;
    }
    case 'trend':
      return [
        '# 市场趋势分析报告（Mock）',
        '## 热搜词分析',
        '- mock 热搜词',
        '## 价格带分析',
        '- mock 价格带',
        '## 季节性趋势建议',
        '- mock 季节建议',
        '## 行动建议',
        '1. mock 行动建议',
      ].join('\n');
    case 'support':
      return 'MOCK-REPLY: 已收到您的咨询，这是模拟客服回复。';
    default:
      return `MOCK-REPLY: ${user.slice(0, 500)}`;
  }
}

async function triggerStripeWebhook(orderId, amountCents) {
  const intent = intentsByOrder.get(orderId);
  seq.event += 1;
  const payload = JSON.stringify({
    id: `evt_mock_${seq.event}`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: intent?.id ?? `pi_mock_manual_${seq.event}`,
        amount_received: amountCents ?? intent?.amountCents ?? 0,
        currency: 'usd',
        metadata: { orderId },
      },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');

  const resp = await fetch(`${APP_WEBHOOK_BASE}/api/payments/stripe-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${t},v1=${v1}`,
    },
    body: payload,
  });
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  try {
    // ---------- 观测接口 ----------
    if (method === 'GET' && path === '/_mock/state') {
      return json(res, 200, state);
    }
    if (method === 'POST' && path === '/_mock/reset') {
      state.stripe.intents = [];
      state.stripe.refunds = [];
      state.paypal.orders = [];
      state.paypal.refunds = [];
      state.llm.calls = 0;
      state.llm.agents = {};
      state.webhook.received = [];
      return json(res, 200, { ok: true });
    }

    // ---------- Stripe ----------
    if (method === 'POST' && path === '/stripe/v1/payment_intents') {
      const form = new URLSearchParams(await readBody(req));
      seq.stripe += 1;
      const intent = {
        id: `pi_mock_${seq.stripe}`,
        amountCents: Number(form.get('amount') ?? 0),
        currency: form.get('currency') ?? 'usd',
        orderId: form.get('metadata[orderId]') ?? null,
      };
      if (intent.orderId) intentsByOrder.set(intent.orderId, intent);
      state.stripe.intents.push(intent);
      return json(res, 200, { id: intent.id, client_secret: `${intent.id}_secret_mock`, status: 'requires_payment_method' });
    }
    if (method === 'POST' && path === '/stripe/v1/refunds') {
      const form = new URLSearchParams(await readBody(req));
      seq.stripe += 1;
      const refund = {
        id: `re_mock_${seq.stripe}`,
        paymentIntent: form.get('payment_intent'),
        amountCents: form.get('amount') ? Number(form.get('amount')) : null,
      };
      state.stripe.refunds.push(refund);
      return json(res, 200, { id: refund.id, status: 'succeeded' });
    }
    if (method === 'POST' && path === '/trigger/stripe/pay') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.orderId) return json(res, 400, { error: 'orderId required' });
      const result = await triggerStripeWebhook(body.orderId, body.amountCents);
      return json(res, 200, result);
    }

    // ---------- PayPal ----------
    if (method === 'POST' && path === '/paypal/v1/oauth2/token') {
      state.paypal.tokens += 1;
      return json(res, 200, { access_token: 'MOCK-PAYPAL-AT', token_type: 'Bearer', expires_in: 3600 });
    }
    if (method === 'POST' && path === '/paypal/v2/checkout/orders') {
      const body = JSON.parse((await readBody(req)) || '{}');
      seq.paypal += 1;
      const order = {
        id: `PPO-MOCK-${seq.paypal}`,
        customId: body?.purchase_units?.[0]?.custom_id ?? null,
        amount: body?.purchase_units?.[0]?.amount?.value ?? null,
      };
      state.paypal.orders.push(order);
      return json(res, 200, {
        id: order.id,
        status: 'CREATED',
        links: [
          { rel: 'approve', href: `http://127.0.0.1:${PORT}/paypal/approve/${order.id}` },
          { rel: 'self', href: `http://127.0.0.1:${PORT}/paypal/v2/checkout/orders/${order.id}` },
        ],
      });
    }
    if (method === 'POST' && path.startsWith('/paypal/v2/checkout/orders/') && path.endsWith('/capture')) {
      const paypalOrderId = path.split('/')[4];
      const stored = state.paypal.orders.find((o) => o.id === paypalOrderId);
      if (!stored) return json(res, 404, { error: 'order not found' });
      seq.paypal += 1;
      const captureId = `CAP-MOCK-${seq.paypal}`;
      stored.captureId = captureId;
      return json(res, 200, {
        id: stored.id,
        status: 'COMPLETED',
        purchase_units: [{
          amount: { value: stored.amount, currency_code: 'USD' },
          payments: { captures: [{ id: captureId, status: 'COMPLETED' }] },
        }],
      });
    }
    if (method === 'POST' && path.startsWith('/paypal/v2/payments/captures/') && path.endsWith('/refunds')) {
      const captureId = path.split('/')[5];
      const body = JSON.parse((await readBody(req)) || '{}');
      seq.paypal += 1;
      const refund = {
        id: `PPRF-MOCK-${seq.paypal}`,
        captureId,
        amount: body?.amount?.value ?? null,
        currency: body?.amount?.currency_code ?? null,
        auth: req.headers.authorization ?? null,
      };
      state.paypal.refunds.push(refund);
      return json(res, 200, { id: refund.id, status: 'COMPLETED' });
    }
    if (method === 'GET' && path.startsWith('/paypal/approve/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body>Mock PayPal approve page</body></html>');
    }

    // ---------- LLM（OpenAI 兼容） ----------
    // ---------- 通知 webhook 收集器（供巡检通知冒烟断言） ----------
    if (method === 'POST' && path === '/webhook/notify') {
      const body = JSON.parse((await readBody(req)) || '{}');
      state.webhook.received.push(body);
      return json(res, 200, { ok: true });
    }

    if (method === 'POST' && path === '/llm/v1/chat/completions') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const agent = classifyAgent(body);
      state.llm.calls += 1;
      state.llm.agents[agent] = (state.llm.agents[agent] ?? 0) + 1;
      const content = llmContent(agent, body);
      return json(res, 200, {
        id: `chatcmpl-mock-${state.llm.calls}`,
        object: 'chat.completion',
        model: body.model ?? 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 24, total_tokens: 66 },
      });
    }

    return json(res, 404, { error: `no mock route: ${method} ${path}` });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

const onListen = () => {
  console.log(`[mock] providers listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock] webhook callback base: ${APP_WEBHOOK_BASE}`);
};
if (process.env.MOCK_HOST) {
  server.listen(PORT, process.env.MOCK_HOST, onListen);
} else {
  server.listen(PORT, onListen);
}
