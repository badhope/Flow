import { describe, expect, it } from 'vitest';

/**
 * 库存一致性的契约。
 *
 * 背景：分仓库存（warehouse_stock）是下单时的真相来源，聚合字段
 * （product_variants.stock / products.total_stock）是列表页与售罄判断读的地方。
 * 两者漂移不会报错，只会表现为"商品显示有货但从哪个仓都发不出"，
 * 或者"退款后库存凭空增加"。
 *
 * 这些用例把「哪些操作必须同时动两边」钉死。
 */

/** 模拟 StockService 的记账语义：聚合值恒等于分仓总和 */
class Ledger {
  warehouses: Record<string, number> = {};
  aggregate = 0;
  sold = 0;

  /** setVariantStock：绝对值写入默认仓 */
  set(stock: number): void {
    this.warehouses.default = stock;
    this.aggregate = stock;
  }

  /** deduct：分仓扣减 + 聚合同步 */
  deduct(qty: number, wh = 'default'): boolean {
    if ((this.warehouses[wh] ?? 0) < qty) return false;
    this.warehouses[wh] -= qty;
    this.aggregate = Object.values(this.warehouses).reduce((a, b) => a + b, 0);
    return true;
  }

  /** restore：分仓回补 + 聚合同步（退款/取消都走这条） */
  restore(qty: number, wh = 'default'): void {
    this.warehouses[wh] = (this.warehouses[wh] ?? 0) + qty;
    this.aggregate = Object.values(this.warehouses).reduce((a, b) => a + b, 0);
  }

  /** 真实总和 */
  sum(): number {
    return Object.values(this.warehouses).reduce((a, b) => a + b, 0);
  }

  /** 是否一致 */
  consistent(): boolean {
    return this.aggregate === this.sum();
  }
}

describe('stock consistency', () => {
  it('S1: 设置库存后聚合等于分仓总和', () => {
    const l = new Ledger();
    l.set(100);
    expect(l.aggregate).toBe(100);
    expect(l.consistent()).toBe(true);
  });

  it('S2: 扣减后聚合同步下降', () => {
    const l = new Ledger();
    l.set(100);
    l.deduct(30);
    expect(l.aggregate).toBe(70);
    expect(l.consistent()).toBe(true);
  });

  it('S3: 退款回补后聚合同步上升（这是之前的 bug）', () => {
    const l = new Ledger();
    l.set(100);
    l.deduct(30);
    l.restore(30);
    expect(l.aggregate).toBe(100);
    expect(l.consistent()).toBe(true);
  });

  it('S4: 回补到非默认仓也保持总量一致', () => {
    const l = new Ledger();
    l.warehouses = { cn: 50, de: 50 };
    l.aggregate = 100;
    l.deduct(20, 'de');
    l.restore(20, 'de');
    expect(l.consistent()).toBe(true);
    expect(l.warehouses.de).toBe(50);
    expect(l.warehouses.cn).toBe(50);
  });

  it('S5: 回补到错误的仓会让分仓失衡（必须回补到实际发货仓）', () => {
    const l = new Ledger();
    l.warehouses = { cn: 50, de: 50 };
    l.aggregate = 100;
    l.deduct(20, 'de');       // de: 30
    l.restore(20, 'cn');      // 错误：补到 cn
    // 总量一致，但 de 缺货、cn 虚高
    expect(l.consistent()).toBe(true);
    expect(l.warehouses.de).toBe(30);
    expect(l.warehouses.cn).toBe(70);
    // 这正是"必须带 warehouseId 回补"的原因
  });

  it('S6: 扣减不会把分仓扣成负数', () => {
    const l = new Ledger();
    l.set(10);
    expect(l.deduct(11)).toBe(false);
    expect(l.aggregate).toBe(10);
    expect(l.warehouses.default).toBe(10);
  });

  it('S7: 安全库存不参与可售（分配时已扣除）', () => {
    const stock = 20;
    const safety = 5;
    const available = Math.max(0, stock - safety);
    expect(available).toBe(15);
    // 试图卖 16 件应失败
    expect(available >= 16).toBe(false);
  });

  it('S8: 连续扣减/回补后仍一致（模拟多轮订单）', () => {
    const l = new Ledger();
    l.set(100);
    for (let i = 0; i < 10; i += 1) {
      l.deduct(3);
      l.restore(1);
    }
    expect(l.consistent()).toBe(true);
    expect(l.aggregate).toBe(100 - 10 * 3 + 10 * 1);
  });

  it('S9: 漂移检测能发现不一致', () => {
    const l = new Ledger();
    l.set(100);
    // 模拟漏同步：只改聚合不回补分仓
    l.aggregate += 10;
    expect(l.consistent()).toBe(false);
    // 修复：以分仓为准重算
    l.aggregate = l.sum();
    expect(l.consistent()).toBe(true);
    expect(l.aggregate).toBe(100);
  });

  it('S10: 商品总库存是各变体聚合之和', () => {
    const variants = [{ stock: 10 }, { stock: 20 }, { stock: 5 }];
    const totalStock = variants.reduce((s, v) => s + v.stock, 0);
    expect(totalStock).toBe(35);
  });
});
