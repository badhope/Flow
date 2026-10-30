import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';

export interface SellerActor {
  userId?: string;
  role?: string;
}

/**
 * 卖家数据范围条件（fail-closed）：
 * - admin → undefined（跨店全平台口径，与 RolesGuard 语义一致）
 * - seller 有 userId → 目标列等值条件
 * - seller 无 userId → 恒假条件（1=0），绝不返回 undefined 导致全表可见
 */
export function buildSellerScopeCondition(
  sellerColumn: Parameters<typeof eq>[0],
  actor: SellerActor,
): SQL | undefined {
  if (isPlatformAdmin(actor.role)) return undefined;
  if (!actor.userId) {
    return eq(sellerColumn as never, '__none__' as never);
  }
  return eq(sellerColumn, actor.userId);
}

/**
 * 归属可见性条件（NULL 归属 fail-closed）：
 * - admin → undefined（含 NULL 行）
 * - seller → (owner = me) 条件；NULL 归属行对卖家不可见
 */
export function buildOwnerVisibilityCondition(
  ownerColumn: Parameters<typeof eq>[0],
  actor: SellerActor,
): SQL | undefined {
  if (isPlatformAdmin(actor.role)) return undefined;
  if (!actor.userId) {
    return eq(ownerColumn as never, '__none__' as never);
  }
  return eq(ownerColumn, actor.userId);
}

/** 组合多个条件为 AND；全 undefined 时返回 undefined（不加 where） */
export function andOptional(
  ...conditions: Array<SQL | undefined>
): SQL | undefined {
  const defined = conditions.filter((c): c is SQL => c !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  return and(...defined);
}

// re-export for service composition readability
export { eq, isNull, or };
