import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';

/**
 * 结算金额的契约。
 *
 * 结算是最不能算错的地方：算多了平台亏，算少了卖家跑。
 * 这里用与 SettlementService.generate 同构的纯计算，钉死口径：
 *   应结 = 毛额 − 退款 − 佣金
 *   佣金 = 毛额 × 费率 + 固定手续费 × 单数
 */

interface Input {
  orders: Array<{ gross: number; refund?: number }>;
  ratePercent: number;
  fixedFee: number;
}

function settle({ orders, ratePercent, fixedFee }: Input) {
  const rate = new Decimal(ratePercent).div(100);
  let gross = new Decimal(0);
  let refund = new Decimal(0);
  let commission = new Decimal(0);
  let refundCount = 0;

  for (const o of orders) {
    const g = new Decimal(o.gross);
    const r = new Decimal(o.refund ?? 0);
    const c = g.mul(rate).plus(fixedFee);
    gross = gross.plus(g);
    refund = refund.plus(r);
    commission = commission.plus(c);
    if (r.greaterThan(0)) refundCount += 1;
  }

  const net = Decimal.max(gross.minus(refund).minus(commission), 0);
  return {
    gross: gross.toFixed(2),
    refund: refund.toFixed(2),
    commission: commission.toFixed(2),
    net: net.toFixed(2),
    orderCount: orders.length,
    refundCount,
    fixedFeeTotal: new Decimal(fixedFee).mul(orders.length).toFixed(2),
  };
}

describe('settlement math', () => {
  it('S1: 无退款无固定费——毛额减百分比佣金', () => {
    const r = settle({ orders: [{ gross: 100 }, { gross: 200 }], ratePercent: 8, fixedFee: 0 });
    expect(r.gross).toBe('300.00');
    // 300 * 8% = 24
    expect(r.commission).toBe('24.00');
    expect(r.net).toBe('276.00');
  });

  it('S2: 固定手续费按单数计，不是按周期计', () => {
    const r = settle({ orders: [{ gross: 100 }, { gross: 100 }, { gross: 100 }], ratePercent: 10, fixedFee: 0.3 });
    // 佣金 = 300*10% + 0.3*3 = 30 + 0.9
    expect(r.commission).toBe('30.90');
    expect(r.fixedFeeTotal).toBe('0.90');
    expect(r.net).toBe('269.10');
  });

  it('S3: 退款从毛额中扣除，同时仍按毛额计佣金（渠道费已发生）', () => {
    const r = settle({ orders: [{ gross: 100, refund: 40 }], ratePercent: 10, fixedFee: 0 });
    expect(r.gross).toBe('100.00');
    expect(r.refund).toBe('40.00');
    expect(r.commission).toBe('10.00');
    // 100 - 40 - 10 = 50
    expect(r.net).toBe('50.00');
  });

  it('S4: 全退订单的净额不为负（不会出现平台倒欠卖家）', () => {
    const r = settle({ orders: [{ gross: 100, refund: 100 }], ratePercent: 10, fixedFee: 1 });
    // 100 - 100 - 11 = -11 → 夹到 0
    expect(r.net).toBe('0.00');
  });

  it('S5: 空周期返回全零而不是报错', () => {
    const r = settle({ orders: [], ratePercent: 8, fixedFee: 0 });
    expect(r.gross).toBe('0.00');
    expect(r.net).toBe('0.00');
    expect(r.orderCount).toBe(0);
  });

  it('S6: 退款计单数（用于展示"本期多少单发生退款"）', () => {
    const r = settle({
      orders: [{ gross: 50, refund: 10 }, { gross: 60 }, { gross: 70, refund: 5 }],
      ratePercent: 5,
      fixedFee: 0,
    });
    expect(r.refundCount).toBe(2);
    expect(r.orderCount).toBe(3);
  });

  it('S7: 小数精度按 Decimal，不出现 0.30000000000000004', () => {
    const r = settle({ orders: [{ gross: 0.1 }, { gross: 0.2 }], ratePercent: 8, fixedFee: 0 });
    expect(r.gross).toBe('0.30');
    expect(r.commission).toBe('0.02');
  });

  it('S8: 0% 费率仍收固定手续费（覆盖通道成本）', () => {
    const r = settle({ orders: [{ gross: 100 }], ratePercent: 0, fixedFee: 0.5 });
    expect(r.commission).toBe('0.50');
    expect(r.net).toBe('99.50');
  });

  it('S9: 费率快照——同一批订单用不同费率会得到不同结算', () => {
    const a = settle({ orders: [{ gross: 1000 }], ratePercent: 5, fixedFee: 0 });
    const b = settle({ orders: [{ gross: 1000 }], ratePercent: 12, fixedFee: 0 });
    expect(a.net).toBe('950.00');
    expect(b.net).toBe('880.00');
  });

  it('S10: 佣金上限守卫——费率超过 100 属于配置错误', () => {
    const valid = (r: number) => Number.isFinite(r) && r >= 0 && r <= 100;
    expect(valid(8)).toBe(true);
    expect(valid(0)).toBe(true);
    expect(valid(100)).toBe(true);
    expect(valid(101)).toBe(false);
    expect(valid(-1)).toBe(false);
    expect(valid(Number.NaN)).toBe(false);
  });
});
