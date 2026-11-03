import { Decimal } from 'decimal.js';

export interface RefundItemEntry {
  orderItemId: string;
  quantity: number;
}

/**
 * 行项可退数量 = 购买数量 - 已退数量；脏数据（已退 > 购买）兜底为 0，绝不返回负数。
 */
export function computeRefundableQuantity(input: {
  purchased: number;
  alreadyRefunded: number;
}): number {
  return Math.max(0, input.purchased - input.alreadyRefunded);
}

/**
 * 行项退款金额 = 单价 × 数量（Decimal 精度，两位小数口径与库内 decimal(12,2) 一致）。
 */
export function computeItemRefundAmount(input: {
  unitPrice: string;
  quantity: number;
}): Decimal {
  return new Decimal(input.unitPrice).mul(input.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** 解析退款行项 JSON（脏数据返回 undefined，与原 parseRefundItems 行为一致） */
export function parseRefundItemsJson(raw: string | null | undefined): RefundItemEntry[] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as RefundItemEntry[];
  } catch {
    return undefined;
  }
}

/** 汇总已完成退款的按行项已退数量 */
export function sumRefundedQuantityByItem(
  completedRefunds: Array<{ items: string | null }>,
): Map<string, number> {
  const refundedByItem = new Map<string, number>();
  for (const prev of completedRefunds) {
    for (const entry of parseRefundItemsJson(prev.items) ?? []) {
      refundedByItem.set(entry.orderItemId, (refundedByItem.get(entry.orderItemId) ?? 0) + entry.quantity);
    }
  }
  return refundedByItem;
}
