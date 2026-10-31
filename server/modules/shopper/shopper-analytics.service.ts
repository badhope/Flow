import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { orders, products, productVariants, shopperEvents } from '../../database/schema';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';
import type { SellerActor } from '../ai/seller-scope';
import type {
  ShopperDemandGap,
  ShopperFunnelResponse,
  ShopperFunnelStage,
  ShopperProductFunnelItem,
  ShopperProductFunnelResponse,
  ShopperTopQuery,
} from '../../../shared/api.interface';

export type ShopperStage = 'viewed' | 'recommended' | 'search_miss' | 'product_recommended' | 'cart_confirmed' | 'ordered';

/**
 * 导购转化漏斗：只做"阶段打点 + 去重计数"，不采集搜索词以外的个人信息。
 * 去重口径 = 会话（登录用 userId，匿名用 sessionId），避免同一人多轮对话重复计数。
 */
@Injectable()
export class ShopperAnalyticsService {
  private readonly logger = new Logger(ShopperAnalyticsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  /** 打点：失败只记日志，绝不影响导购主流程 */
  async track(params: {
    userId?: string | null;
    sessionId?: string | null;
    stage: ShopperStage;
    conversationId?: string | null;
    productId?: string | null;
    keyword?: string | null;
  }): Promise<void> {
    try {
      if (!params.userId && !params.sessionId) return;
      await this.db.insert(shopperEvents).values({
        userId: params.userId ?? null,
        sessionId: params.userId ? null : (params.sessionId ?? null),
        stage: params.stage,
        conversationId: params.conversationId ?? null,
        productId: params.productId ?? null,
        keyword: params.keyword?.slice(0, 100) ?? null,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `导购埋点写入失败（${params.stage}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 需求缺口：搜索零结果的词（按出现次数降序）。
   * 这是"买家在找、店里没有"的直接信号，供选品 Agent 与卖家补货参考。
   */
  async getDemandGaps(days = 30, limit = 10, actorOrSellerId?: SellerActor | string): Promise<ShopperDemandGap[]> {
    const safeDays = Math.max(1, Math.min(365, Math.round(days)));
    const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
    const since = new Date(Date.now() - safeDays * 24 * 3600 * 1000);
    const actor = normalizeActor(actorOrSellerId);
    const scopeCondition = actor && !isPlatformAdmin(actor.role)
      ? sql`${shopperEvents.productId} IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId ?? null})`
      : undefined;

    const rows = await this.db
      .select({
        keyword: shopperEvents.keyword,
        misses: sql<number>`COUNT(*)::int`,
        sessions: sql<number>`COUNT(DISTINCT COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId}))::int`,
        lastSeenAt: sql<string>`MAX(${shopperEvents.createdAt})::text`,
      })
      .from(shopperEvents)
      .where(and(
        eq(shopperEvents.stage, 'search_miss'),
        gte(shopperEvents.createdAt, since),
        sql`${shopperEvents.keyword} IS NOT NULL`,
        sql`${shopperEvents.keyword} <> ''`,
        scopeCondition,
      ))
      .groupBy(shopperEvents.keyword)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(safeLimit);

    return rows
      .filter((row) => !!row.keyword)
      .map((row) => ({
        keyword: row.keyword as string,
        misses: Number(row.misses),
        sessions: Number(row.sessions),
        lastSeenAt: row.lastSeenAt,
      }));
  }

  /**
   * 商品级漏斗：哪些商品"被推荐但不加购"。
   * 全部以会话去重，便于和整体漏斗同口径对比。
   */
  async getProductFunnel(days = 30, limit = 20, actorOrSellerId?: SellerActor | string): Promise<ShopperProductFunnelResponse> {
    const safeDays = Math.max(1, Math.min(365, Math.round(days)));
    const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
    const since = new Date(Date.now() - safeDays * 24 * 3600 * 1000);
    const ownerExpr = sql<string>`COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId})`;
    const actor = normalizeActor(actorOrSellerId);

    const conditions = [
      gte(shopperEvents.createdAt, since),
      sql`${shopperEvents.productId} IS NOT NULL`,
      sql`${shopperEvents.stage} IN ('product_recommended', 'cart_confirmed')`,
    ];
    if (actor && !isPlatformAdmin(actor.role)) {
      conditions.push(sql`${shopperEvents.productId} IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId ?? null})`);
    }
    const rows = await this.db
      .select({
        productId: shopperEvents.productId,
        stage: shopperEvents.stage,
        sessions: sql<number>`COUNT(DISTINCT ${ownerExpr})::int`,
      })
      .from(shopperEvents)
      .where(and(...conditions))
      .groupBy(shopperEvents.productId, shopperEvents.stage);

    const recommended = new Map<string, number>();
    const carted = new Map<string, number>();
    for (const row of rows) {
      if (!row.productId) continue;
      const target = row.stage === 'product_recommended' ? recommended : carted;
      target.set(row.productId, Number(row.sessions));
    }

    const productIds = [...new Set([...recommended.keys(), ...carted.keys()])];
    if (productIds.length === 0) {
      return { since: since.toISOString(), days: safeDays, items: [] };
    }

    const productRows = await this.db
      .select({
        id: products.id,
        titleZh: products.titleZh,
        titleEn: products.titleEn,
        totalStock: products.totalStock,
        avgRating: products.avgRating,
      })
      .from(products)
      .where(sql`${products.id} IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`);

    const priceRows = await this.db
      .select({
        productId: productVariants.productId,
        minPrice: sql<string>`MIN(${productVariants.price})::text`,
      })
      .from(productVariants)
      .where(and(
        eq(productVariants.status, 'active'),
        sql`${productVariants.productId} IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`,
      ))
      .groupBy(productVariants.productId);
    const priceByProduct = new Map(priceRows.map((row) => [row.productId, row.minPrice]));

    // 商品级下单：该会话既确认过此商品加购、又确实下过单
    const orderedRows = await this.db.execute<{ product_id: string; sessions: string }>(sql`
      SELECT oi.product_id, COUNT(DISTINCT COALESCE(o.user_id::text, o.address_snapshot::jsonb ->> 'sessionId'))::int AS sessions
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ${since.toISOString()}
        AND oi.product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
        AND COALESCE(o.user_id::text, o.address_snapshot::jsonb ->> 'sessionId') IN (
          SELECT COALESCE(se.user_id::text, se.session_id)
          FROM shopper_events se
          WHERE se.stage = 'cart_confirmed'
            AND se.product_id = oi.product_id
            AND se.created_at >= ${since.toISOString()}
        )
      GROUP BY oi.product_id
    `);
    const orderedByProduct = new Map<string, number>(
      (orderedRows as unknown as Array<{ product_id: string; sessions: number }>).map((row) => [
        row.product_id,
        Number(row.sessions),
      ]),
    );

    const items: ShopperProductFunnelItem[] = productRows.map((row) => {
      const rec = recommended.get(row.id) ?? 0;
      const cart = carted.get(row.id) ?? 0;
      return {
        productId: row.id,
        title: row.titleZh || row.titleEn,
        recommendedSessions: rec,
        cartSessions: cart,
        cartRate: rec > 0 ? Math.round((cart / rec) * 1000) / 1000 : 0,
        orderedSessions: orderedByProduct.get(row.id) ?? 0,
        totalStock: row.totalStock,
        minPrice: priceByProduct.get(row.id) ?? '0',
        avgRating: Number(row.avgRating) || 0,
      };
    });

    items.sort((a, b) => b.recommendedSessions - a.recommendedSessions || a.cartRate - b.cartRate);
    return { since: since.toISOString(), days: safeDays, items: items.slice(0, safeLimit) };
  }

  /** 漏斗统计（近 N 天），返回各阶段去重会话数、转化率与热词 */
  async getFunnel(days = 30, actorOrSellerId?: SellerActor | string): Promise<ShopperFunnelResponse> {
    const safeDays = Math.max(1, Math.min(365, Math.round(days)));
    const since = new Date(Date.now() - safeDays * 24 * 3600 * 1000);
    const ownerExpr = sql<string>`COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId})`;
    const actor = normalizeActor(actorOrSellerId);

    const conditions = [gte(shopperEvents.createdAt, since)];
    if (actor && !isPlatformAdmin(actor.role)) {
      // 店铺口径：只统计「与本店商品发生过交互」的会话。
      // viewed 事件本身没有商品维度，因此用同会话的推荐/加购事件反查归属，
      // 既不会把别家店铺的会话算进来，也不会漏掉本店会话的"打开"阶段。
      conditions.push(sql`(
        ${shopperEvents.productId} IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId ?? null})
        OR ${ownerExpr} IN (
          SELECT COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId})
          FROM ${shopperEvents} se2
          WHERE se2.product_id IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId ?? null})
        )
      )`);
    }
    const rows = await this.db
      .select({
        stage: shopperEvents.stage,
        owners: sql<number>`COUNT(DISTINCT ${ownerExpr})::int`,
      })
      .from(shopperEvents)
      .where(and(...conditions))
      .groupBy(shopperEvents.stage);

    const byStage = new Map(rows.map((row) => [row.stage, Number(row.owners)]));
    const viewed = byStage.get('viewed') ?? 0;
    const recommended = byStage.get('recommended') ?? 0;
    const cartConfirmed = byStage.get('cart_confirmed') ?? 0;

    // 下单阶段不用打点推断，直接联真实订单：
    // 登录买家按 userId 匹配；匿名按 addressSnapshot.sessionId 匹配（与游客订单归属同一口径）。
    const orderedConditions = [
      gte(orders.createdAt, since),
      sql`COALESCE(${orders.userId}::text, ${orders.addressSnapshot}::jsonb ->> 'sessionId') IN (
        SELECT COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId})
        FROM ${shopperEvents}
        WHERE ${shopperEvents.stage} = 'cart_confirmed' AND ${shopperEvents.createdAt} >= ${since.toISOString()}
      )`,
    ];
    if (actor && !isPlatformAdmin(actor.role)) {
      orderedConditions.push(sql`${orders.sellerId} = ${actor.userId ?? null}`);
    }
    const orderedRows = await this.db
      .select({
        owners: sql<number>`COUNT(DISTINCT COALESCE(${orders.userId}::text, ${orders.addressSnapshot}::jsonb ->> 'sessionId'))::int`,
      })
      .from(orders)
      .where(and(...orderedConditions));
    const ordered = Number(orderedRows[0]?.owners ?? 0);

    const stages: ShopperFunnelStage[] = [
      { stage: 'viewed', label: '打开导购', sessions: viewed, conversionFromPrevious: viewed > 0 ? 1 : 0 },
      { stage: 'recommended', label: '获得推荐', sessions: recommended, conversionFromPrevious: ratio(recommended, viewed) },
      { stage: 'cart_confirmed', label: '确认加购', sessions: cartConfirmed, conversionFromPrevious: ratio(cartConfirmed, recommended) },
      { stage: 'ordered', label: '完成下单', sessions: ordered, conversionFromPrevious: ratio(ordered, cartConfirmed) },
    ];

    const topQueryConditions = [
      gte(shopperEvents.createdAt, since),
      sql`${shopperEvents.keyword} IS NOT NULL`,
      sql`${shopperEvents.keyword} <> ''`,
    ];
    if (actor && !isPlatformAdmin(actor.role)) {
      topQueryConditions.push(sql`(
        ${shopperEvents.productId} IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId ?? null})
        OR ${ownerExpr} IN (
          SELECT COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId})
          FROM ${shopperEvents} se2
          WHERE se2.product_id IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId ?? null})
        )
      )`);
    }

    const topQueryRows = await this.db
      .select({
        keyword: shopperEvents.keyword,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(shopperEvents)
      .where(and(...topQueryConditions))
      .groupBy(shopperEvents.keyword)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    const topQueries: ShopperTopQuery[] = topQueryRows
      .filter((row) => !!row.keyword)
      .map((row) => ({ keyword: row.keyword as string, count: Number(row.count) }));

    return {
      since: since.toISOString(),
      days: safeDays,
      stages,
      overallConversion: ratio(ordered, viewed),
      topQueries,
    };
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function normalizeActor(actorOrSellerId?: SellerActor | string): SellerActor | undefined {
  if (typeof actorOrSellerId === 'string') return { userId: actorOrSellerId, role: 'seller' };
  return actorOrSellerId;
}
