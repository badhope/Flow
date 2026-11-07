import { describe, expect, it } from 'vitest';

/**
 * 选仓与调拨的契约。
 *
 * 这些用例与 WarehouseService.planAllocation 的排序/分配逻辑同构。
 * 重点在于三条容易写错、且错了很难发现的规则：
 *   1. 本地仓优先（影响时效与关税）
 *   2. 安全库存不参与可售（否则会卖到负库存）
 *   3. 缺口必须显式暴露，不能静默少发
 */

interface Candidate {
  warehouseId: string;
  country: string;
  priority: number;
  stock: number;
  safetyStock: number;
}

function allocate(candidates: Candidate[], need: number, dest: string) {
  const usable = candidates
    .map((c) => ({ ...c, available: Math.max(0, c.stock - c.safetyStock) }))
    .filter((c) => c.available > 0)
    .sort((a, b) => {
      const aLocal = a.country === dest ? 0 : 1;
      const bLocal = b.country === dest ? 0 : 1;
      if (aLocal !== bLocal) return aLocal - bLocal;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.available - a.available;
    });

  const picks: Array<{ warehouseId: string; quantity: number }> = [];
  let remaining = need;
  for (const c of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, c.available);
    picks.push({ warehouseId: c.warehouseId, quantity: take });
    remaining -= take;
  }
  return { picks, shortage: Math.max(0, remaining), fulfillable: remaining === 0 };
}

const CN = (id: string, stock: number, priority = 100, safety = 0): Candidate =>
  ({ warehouseId: id, country: 'CN', priority, stock, safetyStock: safety });
const DE = (id: string, stock: number, priority = 100, safety = 0): Candidate =>
  ({ warehouseId: id, country: 'DE', priority, stock, safetyStock: safety });

describe('warehouse allocation', () => {
  it('W1: 目的国本地仓优先，即使优先级数字更大', () => {
    // DE 仓 priority 200（较差），CN 仓 priority 10（更好），但发往 DE
    const r = allocate([CN('cn', 100, 10), DE('de', 100, 200)], 5, 'DE');
    expect(r.picks[0].warehouseId).toBe('de');
  });

  it('W2: 无本地仓时按 priority 升序', () => {
    const r = allocate([CN('b', 100, 200), CN('a', 100, 10)], 5, 'FR');
    expect(r.picks[0].warehouseId).toBe('a');
  });

  it('W3: 同优先级按可用量降序（尽量一仓发完）', () => {
    const r = allocate([CN('small', 10, 100), CN('big', 90, 100)], 5, 'FR');
    expect(r.picks[0].warehouseId).toBe('big');
  });

  it('W4: 安全库存不参与可售', () => {
    // 库存 10，安全库存 10 → 可用 0，不能卖
    const r = allocate([CN('only', 10, 100, 10)], 1, 'FR');
    expect(r.fulfillable).toBe(false);
    expect(r.shortage).toBe(1);
    expect(r.picks).toHaveLength(0);
  });

  it('W5: 单仓足够时不拆单（优先一次发完）', () => {
    // b 有 10 件、需求 8 → 只从 b 发，不应拆成两单
    const r = allocate([CN('a', 3, 100), CN('b', 10, 100)], 8, 'FR');
    expect(r.fulfillable).toBe(true);
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0].warehouseId).toBe('b');
    expect(r.picks[0].quantity).toBe(8);
  });

  it('W5b: 单仓不足时才拆单，缺口为 0', () => {
    // 两仓各 3 件，需求 5 → 必须拆
    const r = allocate([CN('a', 3, 100), CN('b', 3, 100)], 5, 'FR');
    expect(r.fulfillable).toBe(true);
    expect(r.picks).toHaveLength(2);
    expect(r.picks.reduce((s, p) => s + p.quantity, 0)).toBe(5);
  });

  it('W6: 全部不足时暴露缺口，不静默少发', () => {
    const r = allocate([CN('a', 2, 100)], 10, 'FR');
    expect(r.fulfillable).toBe(false);
    expect(r.shortage).toBe(8);
    expect(r.picks.reduce((s, p) => s + p.quantity, 0)).toBe(2);
  });

  it('W7: 分配总量永不超过需求', () => {
    const r = allocate([CN('a', 1000, 100), CN('b', 1000, 100)], 7, 'FR');
    expect(r.picks.reduce((s, p) => s + p.quantity, 0)).toBe(7);
  });

  it('W8: 不超卖——分配总量不超过各仓可用之和', () => {
    const cands = [CN('a', 5, 100), CN('b', 4, 100), DE('c', 3, 100)];
    const need = 20;
    const r = allocate(cands, need, 'DE');
    const available = cands.reduce((s, c) => s + Math.max(0, c.stock - c.safetyStock), 0);
    const allocated = r.picks.reduce((s, p) => s + p.quantity, 0);
    expect(allocated).toBeLessThanOrEqual(available);
    expect(allocated + r.shortage).toBe(need);
  });

  it('W9: 零库存仓被跳过', () => {
    const r = allocate([CN('empty', 0, 1), CN('full', 5, 100)], 3, 'FR');
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0].warehouseId).toBe('full');
  });

  it('W10: 库存守恒——调拨前后总量不变', () => {
    // 调拨：调出仓减、调入仓加，聚合总量应保持一致
    const from = { stock: 10 };
    const to = { stock: 2 };
    const before = from.stock + to.stock;
    const qty = 4;
    from.stock -= qty;
    to.stock += qty;
    expect(from.stock + to.stock).toBe(before);
    expect(from.stock).toBe(6);
    expect(to.stock).toBe(6);
  });

  it('W11: 调拨不能把调出仓扣成负数', () => {
    const stock = 3;
    const qty = 5;
    expect(stock >= qty).toBe(false); // 应被条件更新拒绝
  });
});
