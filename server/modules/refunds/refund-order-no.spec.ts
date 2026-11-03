import { describe, expect, it } from 'vitest';
import { RefundsService } from './refunds.service';

/**
 * The seller refund table used to render the raw order UUID because the API
 * only exposed `orderId`. These tests pin the contract: refund payloads carry
 * the human-readable `orderNo` so the UI never shows a UUID as an order number.
 */
describe('RefundsService order number exposure', () => {
  function serviceWithOrder(orderNo: string | undefined) {
    const refundRow = {
      id: 'refund-1',
      orderId: '11111111-2222-3333-4444-555555555555',
      userId: 'buyer-1',
      refundNo: 'RF20261103001',
      status: 'requested',
      amount: '39.00',
      reason: 'quality',
      reasonDetail: null,
      items: null,
      sellerReply: null,
      refundMethod: 'original',
      approvedAt: null,
      completedAt: null,
      createdAt: new Date('2026-11-03T10:00:00Z'),
      updatedAt: new Date('2026-11-03T10:00:00Z'),
    };

    /**
     * Drizzle query builders are thenable at every step, and the service both
     * awaits `where(...)` directly (loadRefund) and calls `.limit(1)` on it
     * (order lookup). The mock therefore has to be awaitable *and* chainable.
     * `select()` with no projection is the refund read; with one it is the
     * order-number read.
     */
    const db = {
      select: (projection?: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            const rows = projection === undefined ? [refundRow] : orderNo ? [{ orderNo }] : [];
            return {
              then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
              limit: async () => rows,
              orderBy: () => ({ limit: () => ({ offset: async () => rows }) }),
            };
          },
        }),
      }),
    };

    return new RefundsService(
      db as never,
      { log: async () => undefined } as never,
      {} as never,
    );
  }

  it('R1: detail exposes the human-readable order number', async () => {
    const detail = await serviceWithOrder('ORD202611030001').getDetail('refund-1', 'buyer-1');
    expect(detail.orderNo).toBe('ORD202611030001');
    expect(detail.orderId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('R2: detail omits orderNo when the order row is missing', async () => {
    const detail = await serviceWithOrder(undefined).getDetail('refund-1', 'buyer-1');
    expect(detail.orderNo).toBeUndefined();
    expect(detail.id).toBe('refund-1');
  });

  it('R3: a buyer cannot read another buyer refund', async () => {
    const service = serviceWithOrder('ORD202611030001');
    await expect(service.getDetail('refund-1', 'buyer-2')).rejects.toThrow();
  });
});
