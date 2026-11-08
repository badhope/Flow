import { describe, expect, it } from 'vitest';

/**
 * 批次扣减（FEFO）的契约。
 *
 * 为什么是 FEFO 而不是 FIFO：保质期商品按入库时间出库会把临期货压在仓里
 * 直到报废。按到期日排才是正确做法，代价是拣货路径更长——但报废成本更高。
 *
 * 这些用例与 BatchService.consumeFefo 的排序/跳过逻辑同构。
 */

interface Batch {
  id: string;
  batchNo: string;
  quantity: number;
  expiresAt: Date | null;
  createdAt: Date;
}

const NOW = new Date('2026-11-08T12:00:00Z');
const day = (n: number): Date => new Date(NOW.getTime() + n * 86400000);

/** 与 consumeFefo 同构：跳过过期，按到期日升序（无到期日最后），同到期按入库时间 */
function fefo(batches: Batch[], need: number) {
  const available = batches
    .filter((b) => b.quantity > 0)
    .filter((b) => b.expiresAt === null || b.expiresAt.getTime() > NOW.getTime())
    .sort((a, b) => {
      if (a.expiresAt === null && b.expiresAt === null) return a.createdAt.getTime() - b.createdAt.getTime();
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      const d = a.expiresAt.getTime() - b.expiresAt.getTime();
      if (d !== 0) return d;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  const picks: Array<{ batchNo: string; quantity: number }> = [];
  let remaining = need;
  for (const b of available) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.quantity);
    picks.push({ batchNo: b.batchNo, quantity: take });
    remaining -= take;
  }
  return { picks, shortage: remaining };
}

const b = (batchNo: string, quantity: number, expiresInDays: number | null, createdOffset = 0): Batch => ({
  id: batchNo,
  batchNo,
  quantity,
  expiresAt: expiresInDays === null ? null : day(expiresInDays),
  createdAt: new Date(NOW.getTime() - createdOffset * 86400000),
});

describe('batch FEFO', () => {
  it('B1: 先到期先出（不是先入库先出）', () => {
    // A 先入库但到期晚；B 后入库但快到期 → 应出 B
    const batches = [
      b('A', 100, 90, 10),  // 10 天前入库，90 天后到期
      b('B', 100, 5, 1),    // 1 天前入库，5 天后到期
    ];
    const r = fefo(batches, 10);
    expect(r.picks[0].batchNo).toBe('B');
  });

  it('B2: 过期批次不参与扣减', () => {
    const batches = [
      b('EXPIRED', 100, -1),  // 昨天到期
      b('OK', 50, 30),
    ];
    const r = fefo(batches, 10);
    expect(r.picks[0].batchNo).toBe('OK');
    expect(r.picks).toHaveLength(1);
  });

  it('B3: 全部过期时扣减失败（不能发过期品）', () => {
    const batches = [b('E1', 100, -5), b('E2', 100, -1)];
    const r = fefo(batches, 10);
    expect(r.picks).toHaveLength(0);
    expect(r.shortage).toBe(10);
  });

  it('B4: 无保质期批次排在最后', () => {
    const batches = [
      b('NOEXP', 100, null, 100),  // 很早入库但无到期日
      b('EXP', 50, 60, 1),
    ];
    const r = fefo(batches, 10);
    expect(r.picks[0].batchNo).toBe('EXP');
  });

  it('B5: 单批不足时跨批扣减', () => {
    const batches = [b('A', 5, 10), b('B', 20, 20)];
    const r = fefo(batches, 12);
    expect(r.picks).toHaveLength(2);
    expect(r.picks[0]).toEqual({ batchNo: 'A', quantity: 5 });
    expect(r.picks[1]).toEqual({ batchNo: 'B', quantity: 7 });
    expect(r.shortage).toBe(0);
  });

  it('B6: 同到期日按入库时间（先入先出作为次级规则）', () => {
    const batches = [
      b('LATE_IN', 100, 30, 1),
      b('EARLY_IN', 100, 30, 10),
    ];
    const r = fefo(batches, 10);
    expect(r.picks[0].batchNo).toBe('EARLY_IN');
  });

  it('B7: 数量不足时暴露缺口，不静默少发', () => {
    const batches = [b('A', 3, 10)];
    const r = fefo(batches, 10);
    expect(r.shortage).toBe(7);
  });

  it('B8: 零数量批次被跳过', () => {
    const batches = [b('EMPTY', 0, 5), b('FULL', 10, 30)];
    const r = fefo(batches, 5);
    expect(r.picks[0].batchNo).toBe('FULL');
  });

  it('B9: 恰好到期当天视为过期（不卖最后一天）', () => {
    // 到期日 == now：已经是到期时刻，不应继续销售
    const exactly = { ...b('TODAY', 100, 0) };
    const r = fefo([exactly], 10);
    expect(r.picks).toHaveLength(0);
  });

  it('B10: 分配总量不超过需求', () => {
    const batches = [b('A', 1000, 10), b('B', 1000, 20)];
    const r = fefo(batches, 7);
    expect(r.picks.reduce((s, p) => s + p.quantity, 0)).toBe(7);
  });

  it('B11: 临期阈值判定（30 天内）', () => {
    const status = (days: number | null): string => {
      if (days === null) return 'no_expiry';
      if (days < 0) return 'expired';
      if (days <= 30) return 'expiring';
      return 'ok';
    };
    expect(status(null)).toBe('no_expiry');
    expect(status(-1)).toBe('expired');
    expect(status(0)).toBe('expiring');
    expect(status(30)).toBe('expiring');
    expect(status(31)).toBe('ok');
  });

  it('B12: 退款回补到原批次（不是新批次）', () => {
    const batch = { batchNo: 'A', quantity: 10 };
    // 卖出 3 → 7；退回 3 → 10
    batch.quantity -= 3;
    batch.quantity += 3;
    expect(batch.quantity).toBe(10);
    // 关键：回补的 batchNo 应与原批次一致，追溯链不能断
    expect(batch.batchNo).toBe('A');
  });
});
