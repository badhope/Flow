import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ShopperAnalyticsService } from './shopper-analytics.service';

describe('ShopperAnalyticsService tenant scope', () => {
  it('R36: demand gaps accepts actor scope and seller query is not global', async () => {
    const whereConditions: unknown[] = [];
    const rows = [{ keyword: 'x', misses: 1, sessions: 1, lastSeenAt: 'now' }];
    const db = {
      select: () => {
        const builder = {
          from: () => builder,
          where: (condition: unknown) => { whereConditions.push(condition); return builder; },
          groupBy: () => builder,
          orderBy: () => builder,
          limit: async () => rows,
        };
        return builder;
      },
    };
    const service = new ShopperAnalyticsService(db as never);
    await service.getDemandGaps(30, 10, { userId: 'seller-1', role: 'seller' });
    expect(whereConditions).toHaveLength(1);
    const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
    expect(query.params).toContain('seller-1');
  });
});
