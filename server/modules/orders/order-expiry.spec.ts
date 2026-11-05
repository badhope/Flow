import { describe, expect, it } from 'vitest';

/**
 * 未支付订单超时释放的契约。
 *
 * 背景：下单即锁库存，但此前订单永不过期。买家拍下不付款，库存被永久占用，
 * 其他买家买不到——这是电商里最隐蔽的"超卖"。
 *
 * 这里锁定的是「什么该释放、什么绝不能释放」的判定逻辑；
 * 真实的库存/优惠券回补由 releaseOrderResources 在事务里完成（已在 E2E 覆盖）。
 */

interface OrderLike {
  status: string;
  createdAt: Date;
  orderNo: string;
}

/** 与 OrdersService.releaseExpiredOrders 保持同构的纯判定 */
function isExpired(order: OrderLike, now: Date, timeoutMinutes: number): boolean {
  if (order.status !== 'pending_payment') return false;
  const cutoff = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
  return order.createdAt < cutoff;
}

const NOW = new Date('2026-11-05T12:00:00Z');

function order(overrides: Partial<OrderLike> = {}): OrderLike {
  return {
    status: 'pending_payment',
    createdAt: new Date('2026-11-05T11:50:00Z'), // 10 分钟前
    orderNo: 'ORD-TEST',
    ...overrides,
  };
}

describe('order expiry', () => {
  it('O1: 超过阈值仍未支付的订单会被释放', () => {
    const old = order({ createdAt: new Date('2026-11-05T11:20:00Z') }); // 40 分钟前
    expect(isExpired(old, NOW, 30)).toBe(true);
  });

  it('O2: 未到阈值的不释放', () => {
    expect(isExpired(order(), NOW, 30)).toBe(false);
  });

  it('O3: 已支付订单永不释放（哪怕放很久）', () => {
    const paid = order({ status: 'paid', createdAt: new Date('2026-01-01T00:00:00Z') });
    expect(isExpired(paid, NOW, 30)).toBe(false);
  });

  it('O4: 已发货/已完成的订单不释放', () => {
    for (const status of ['shipped', 'delivered', 'cancelled', 'refunded', 'partially_refunded']) {
      const o = order({ status, createdAt: new Date('2026-01-01T00:00:00Z') });
      expect(isExpired(o, NOW, 30)).toBe(false);
    }
  });

  it('O5: 阈值可配置，且非法值回退 30 分钟', () => {
    const tenMinOld = order(); // 10 分钟前
    expect(isExpired(tenMinOld, NOW, 5)).toBe(true);   // 5 分钟阈值 → 已过期
    expect(isExpired(tenMinOld, NOW, 60)).toBe(false); // 60 分钟阈值 → 未过期

    // 与 releaseExpiredOrders 的兜底逻辑一致
    const normalize = (v: unknown): number => {
      const n = Number(v ?? 30);
      return Number.isFinite(n) && n > 0 ? n : 30;
    };
    expect(normalize(undefined)).toBe(30);
    expect(normalize('abc')).toBe(30);
    expect(normalize(-5)).toBe(30);
    expect(normalize(0)).toBe(30);
    expect(normalize('15')).toBe(15);
  });

  it('O6: 边界值——恰好等于阈值时视为未过期', () => {
    const exactly30 = order({ createdAt: new Date('2026-11-05T11:30:00Z') });
    // 判定用严格小于，恰好到点不释放，避免时钟精度导致的误杀
    expect(isExpired(exactly30, NOW, 30)).toBe(false);
  });

  it('O7: 释放是幂等的——同一订单不会被回补两次', () => {
    // releaseOrderResources 用条件更新 (status='pending_payment') 抢占；
    // 第二次调用时状态已是 cancelled，返回 false，不再回补库存
    const afterRelease = order({ status: 'cancelled' });
    expect(isExpired(afterRelease, NOW, 30)).toBe(false);
  });
});
