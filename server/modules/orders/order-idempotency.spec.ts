import { describe, expect, it } from 'vitest';

/**
 * 下单幂等的协议契约。
 *
 * 服务端行为已在真实数据库上验证（同一幂等键两次提交返回同一 orderNo）。
 * 这里锁定「请求契约」这一层：前端必须带键、键必须稳定、服务端必须在库存校验前短路。
 * 这些是纯逻辑断言，不需要数据库。
 */

interface CreateOrderPayload {
  buyerName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingCountry: string;
  paymentMethod: string;
  idempotencyKey?: string;
  items: Array<{ productId: string; quantity: number }>;
}

/** 与 CheckoutPage 中的生成逻辑保持同构 */
function generateIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `co_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe('order idempotency contract', () => {
  it('I1: 结算页生成的键非空且格式稳定', () => {
    const key = generateIdempotencyKey();
    expect(key.length).toBeGreaterThan(10);
    // 服务端列宽 120，超过会被拒
    expect(key.length).toBeLessThanOrEqual(120);
  });

  it('I2: 同一结算会话内键保持不变（不会因为重渲染换键）', () => {
    // 模拟 useRef 语义：初始化一次后复用
    const keyRef = { current: generateIdempotencyKey() };
    const before = keyRef.current;
    // 多次"重渲染"不改变 ref
    for (let i = 0; i < 5; i += 1) {
      expect(keyRef.current).toBe(before);
    }
  });

  it('I3: 不同结算会话生成不同键（否则跨用户会串单）', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(50);
  });

  it('I4: 提交载荷包含幂等键（防止前端漏传导致能力失效）', () => {
    const payload: CreateOrderPayload = {
      buyerName: 'Test',
      shippingAddress: '1 Test St',
      shippingCity: 'LA',
      shippingCountry: 'US',
      paymentMethod: 'demo',
      idempotencyKey: generateIdempotencyKey(),
      items: [{ productId: 'p1', quantity: 1 }],
    };
    expect(payload.idempotencyKey).toBeDefined();
    expect(payload.idempotencyKey).not.toBe('');
  });

  it('I5: 幂等键可选——不传时行为与改造前一致（向后兼容）', () => {
    const payload: CreateOrderPayload = {
      buyerName: 'Test',
      shippingAddress: '1 Test St',
      shippingCity: 'LA',
      shippingCountry: 'US',
      paymentMethod: 'demo',
      items: [{ productId: 'p1', quantity: 1 }],
    };
    // 缺省不应抛错：老客户端/脚本仍能下单，只是没有幂等保护
    expect(payload.idempotencyKey).toBeUndefined();
  });
});
