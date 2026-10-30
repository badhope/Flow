import { describe, expect, it } from 'vitest';
import { computeRefundableQuantity, computeItemRefundAmount } from './refund-items';
import { assertRefundWithinOrderCap } from './refund-cap';

describe('refund-items R10: 行项可退数量与金额', () => {
  it('R10: 可退数量 = 购买数量 - 已退数量', () => {
    expect(computeRefundableQuantity({ purchased: 5, alreadyRefunded: 2 })).toBe(3);
    expect(computeRefundableQuantity({ purchased: 5, alreadyRefunded: 0 })).toBe(5);
  });

  it('R10: 已退满时不可再退', () => {
    expect(computeRefundableQuantity({ purchased: 3, alreadyRefunded: 3 })).toBe(0);
  });

  it('R10: 已退数量超过购买（脏数据）时兜底为 0，不产生负数可退', () => {
    expect(computeRefundableQuantity({ purchased: 2, alreadyRefunded: 5 })).toBe(0);
  });

  it('R10: 行项退款金额 = 单价 × 数量（字符串单价保持精度）', () => {
    expect(
      computeItemRefundAmount({ unitPrice: '19.99', quantity: 3 }).toFixed(2),
    ).toBe('59.97');
  });

  it('R10: 浮点边界 0.1+0.2 场景不产生二进制误差', () => {
    expect(
      computeItemRefundAmount({ unitPrice: '0.1', quantity: 3 }).toFixed(2),
    ).toBe('0.30');
  });
});

describe('refund-cap R11: 累计退款封顶', () => {
  it('R11: 本次退款 + 已完成退款 <= 订单总额时放行', () => {
    expect(() =>
      assertRefundWithinOrderCap({
        orderTotal: '100.00',
        completedRefunded: '30.00',
        refundAmount: '70.00',
      }),
    ).not.toThrow();
  });

  it('R11: 超出剩余可退时拒绝并报出剩余金额', () => {
    expect(() =>
      assertRefundWithinOrderCap({
        orderTotal: '100.00',
        completedRefunded: '40.00',
        refundAmount: '61.00',
      }),
    ).toThrow(/剩余可退 \$60\.00/);
  });

  it('R11: 全额已退后任何金额都拒绝', () => {
    expect(() =>
      assertRefundWithinOrderCap({
        orderTotal: '88.88',
        completedRefunded: '88.88',
        refundAmount: '0.01',
      }),
    ).toThrow(/剩余可退 \$0\.00/);
  });
});
