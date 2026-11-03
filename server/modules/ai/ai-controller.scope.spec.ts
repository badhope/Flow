import { describe, expect, it, vi } from 'vitest';
import { AiController } from './ai.controller';

describe('AiController tenant actor propagation', () => {
  it('R31: usage stats passes request actor to gateway', async () => {
    const gateway = { getUsageStats: vi.fn().mockResolvedValue({ totalCalls: 0 }) };
    const controller = new AiController(
      {} as never,
      gateway as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await controller.getUsageStats('trend', undefined, undefined, { user: { id: 'seller-1', role: 'seller' } } as never);
    expect(gateway.getUsageStats).toHaveBeenCalledWith({
      agent: 'trend',
      startDate: undefined,
      endDate: undefined,
      actor: { userId: 'seller-1', role: 'seller' },
    });
  });
});
