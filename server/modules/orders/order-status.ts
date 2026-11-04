import type { OrderStatus } from '../../../shared/api.interface';

/**
 * 订单状态机。
 *
 * 设计取舍（参考 Vendure 的 `OrderProcess`）：把「允许的迁移」与「迁移的前置条件」
 * 分开表达。迁移表是纯数据的，可被前端、Copilot 工具参数、API 文档直接消费；
 * 前置条件（guard）留在各自的 service 里，因为多数 guard 需要读库。
 *
 * 两条铁律：
 *   1. **fail closed**：未声明的 from/to 组合一律禁止，不靠"默认允许"。
 *   2. **支付与退款不由卖家手动流转**：`pending_payment → paid` 只能由支付入账写，
 *      `→ refunded / partially_refunded` 只能由退款服务写。卖家能手动做的只有
 *      发货、送达、取消（且取消仅限未支付）。
 */

/**
 * 仅记录卖家/管理员可手动触发的迁移；支付与退款链路另有专属入口。
 *
 * `paid → delivered` 是显式允许的：数字商品、到店自提、线下交付没有可运单的
 * 发货环节，强制先点"发货"只会逼卖家填假运单号。这条迁移在 UI 上标注为
 * 「标记完成（无需物流）」而不是「送达」。
 */
export const ORDER_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['shipped', 'delivered'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
  partially_refunded: [],
};

/** 系统内部（支付/退款）允许的迁移，与手动迁移分开，避免前端误用 */
export const SYSTEM_ORDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['refunded', 'partially_refunded', 'shipped'],
  shipped: ['delivered', 'refunded', 'partially_refunded'],
  delivered: ['refunded', 'partially_refunded'],
  partially_refunded: ['refunded'],
};

/** 判断一次状态迁移是否被允许（fail closed：未知当前状态一律禁止） */
export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_STATUS_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/** 系统链路（支付/退款）使用的判定，语义更宽但同样 fail closed */
export function canTransitionOrderStatusSystem(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = SYSTEM_ORDER_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/**
 * 卖家在 UI 上「下一个状态」的可选项。前端据此渲染按钮，服务端据此校验，
 * 两边同源，避免出现"按钮可点但请求 400"。
 */
export function nextOrderStatuses(from: OrderStatus): OrderStatus[] {
  return [...(ORDER_STATUS_TRANSITIONS[from] ?? [])];
}

/** 终态：不再接受任何迁移 */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return nextOrderStatuses(status).length === 0;
}
