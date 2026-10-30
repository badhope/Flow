import { Decimal } from 'decimal.js';

/**
 * 累计退款封顶（申请与审批两处共用的唯一口径）：
 * 本次退款 + 已完成退款 必须 <= 订单总额，否则拒绝并报出剩余可退金额。
 */
export function assertRefundWithinOrderCap(input: {
  orderTotal: string;
  completedRefunded: string;
  refundAmount: string;
}): void {
  const remaining = new Decimal(input.orderTotal).minus(input.completedRefunded);
  if (new Decimal(input.refundAmount).gt(remaining)) {
    throw new RangeError(`可退余额不足：剩余可退 $${remaining.toFixed(2)}`);
  }
}
