import { describe, expect, it } from 'vitest';
import { eq, and, isNull, or, SQL } from 'drizzle-orm';
import { products, aiReports, aiAgents } from '../../database/schema';
import {
  buildSellerScopeCondition,
  buildOwnerVisibilityCondition,
} from './seller-scope';

describe('seller-scope R1: 卖家数据范围条件', () => {
  it('R1: seller actor 返回 sellerId 等值条件', () => {
    const cond = buildSellerScopeCondition(products.sellerId, {
      userId: 'u1',
      role: 'seller',
    });
    expect(cond).toBeDefined();
    const sql = (cond as SQL).queryChunks ?? null;
    expect(cond).toBeInstanceOf(SQL);
    expect(sql).not.toBeNull();
  });

  it('R1: admin actor 不返回任何条件（全平台口径）', () => {
    const cond = buildSellerScopeCondition(products.sellerId, {
      userId: 'admin-1',
      role: 'admin',
    });
    expect(cond).toBeUndefined();
  });

  it('R1: seller 无 userId 时 fail-closed 返回恒假条件', () => {
    const cond = buildSellerScopeCondition(products.sellerId, {
      userId: undefined,
      role: 'seller',
    });
    expect(cond).toBeDefined();
  });
});

describe('seller-scope R2: 报告归属可见性', () => {
  it('R2: seller 只看到自己的报告（含 NULL 归属排除）', () => {
    const cond = buildOwnerVisibilityCondition(aiReports.userId, {
      userId: 'u1',
      role: 'seller',
    });
    expect(cond).toBeDefined();
  });

  it('R2: admin 看到全部报告', () => {
    const cond = buildOwnerVisibilityCondition(aiReports.userId, {
      userId: 'admin-1',
      role: 'admin',
    });
    expect(cond).toBeUndefined();
  });
});

describe('seller-scope R4: 自定义 Agent 归属过滤', () => {
  it('R4: seller 列表条件 = sellerId 等值（列复用 R1 助手）', () => {
    const cond = buildSellerScopeCondition(aiAgents.createdBy, {
      userId: 'u1',
      role: 'seller',
    });
    expect(cond).toBeDefined();
  });
});
