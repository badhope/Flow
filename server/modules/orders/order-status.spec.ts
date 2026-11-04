import { describe, expect, it } from 'vitest';
import {
  canTransitionOrderStatus,
  canTransitionOrderStatusSystem,
  isTerminalOrderStatus,
  nextOrderStatuses,
  ORDER_STATUS_TRANSITIONS,
} from './order-status';

// 行为契约（R7）：订单状态机 fail closed —— 仅允许显式声明的迁移
describe('order status transitions', () => {
  it('R7: 合法迁移通过', () => {
    expect(canTransitionOrderStatus('pending_payment', 'paid')).toBe(true);
    expect(canTransitionOrderStatus('pending_payment', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('paid', 'shipped')).toBe(true);
    expect(canTransitionOrderStatus('paid', 'delivered')).toBe(true);
    expect(canTransitionOrderStatus('shipped', 'delivered')).toBe(true);
  });

  it('R7: 非法迁移拒绝（跳级/回退/原地）', () => {
    expect(canTransitionOrderStatus('pending_payment', 'shipped')).toBe(false);
    expect(canTransitionOrderStatus('pending_payment', 'delivered')).toBe(false);
    expect(canTransitionOrderStatus('pending_payment', 'pending_payment')).toBe(false);
    expect(canTransitionOrderStatus('paid', 'paid')).toBe(false);
    expect(canTransitionOrderStatus('paid', 'pending_payment')).toBe(false);
    expect(canTransitionOrderStatus('shipped', 'paid')).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'pending_payment')).toBe(false);
  });

  it('R7: 终态与退款态不在人工迁移表中', () => {
    // 终态显式声明为空数组而不是 undefined，调用方无需区分"没有键"和"没有出路"
    expect(ORDER_STATUS_TRANSITIONS.delivered).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.cancelled).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.refunded).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.partially_refunded).toEqual([]);
    expect(canTransitionOrderStatus('cancelled', 'paid')).toBe(false);
    expect(canTransitionOrderStatus('refunded', 'shipped')).toBe(false);
    expect(isTerminalOrderStatus('delivered')).toBe(true);
    expect(isTerminalOrderStatus('paid')).toBe(false);
  });

  it('R7: paid → delivered 是显式允许的（数字商品/自提，无需物流）', () => {
    expect(canTransitionOrderStatus('paid', 'delivered')).toBe(true);
    // 但跳级到 refunded 只能走退款服务，人工接口不允许
    expect(canTransitionOrderStatus('paid', 'refunded')).toBe(false);
    expect(canTransitionOrderStatusSystem('paid', 'refunded')).toBe(true);
  });

  it('R7: 人工可选状态由状态机单点给出', () => {
    expect(nextOrderStatuses('pending_payment')).toEqual(['paid', 'cancelled']);
    expect(nextOrderStatuses('shipped')).toEqual(['delivered']);
    expect(nextOrderStatuses('refunded')).toEqual([]);
  });
});
