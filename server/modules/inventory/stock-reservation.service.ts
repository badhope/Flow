import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { stockReservations } from '../../database/schema';

/**
 * 库存预留。
 *
 * 此前系统只有「下单即扣 stock」这一种状态，无法回答：
 *   - 这个 SKU 有多少是被未支付订单占着、多少是真可用？
 *   - 支付成功后该把占用转成什么？
 *
 * 预留记录解决的是**可观测性**问题，不改变扣减语义：
 *   soft（下单时）→ consumed（支付后）或 released（取消/超时）
 *
 * 为什么不改成"先预留、支付时才扣"：
 *   那会让 stock 字段失去"实时可售"的含义，所有既有查询都要跟着改，
 *   风险远大于收益。当前做法是**在扣减的同时留下一条可追踪的占用记录**，
 *   语义不变、信息更全。
 */
@Injectable()
export class StockReservationService {
  private readonly logger = new Logger(StockReservationService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  /**
   * 创建软预留（在订单事务内调用，与库存扣减同生共死）。
   *
   * 用 onConflictDoNothing + 部分唯一索引兜住并发重复：
   * 同一订单同一变体只允许一条 active 预留。
   */
  async reserveSoft(
    tx: Database,
    params: {
      orderId: string;
      orderNo: string;
      items: Array<{ variantId: string; quantity: number }>;
      expiresAt: Date;
    },
  ): Promise<void> {
    if (params.items.length === 0) return;
    await tx
      .insert(stockReservations)
      .values(
        params.items.map((item) => ({
          variantId: item.variantId,
          orderId: params.orderId,
          orderNo: params.orderNo,
          quantity: item.quantity,
          status: 'active',
          kind: 'soft',
          expiresAt: params.expiresAt,
        })),
      )
      .onConflictDoNothing();
  }

  /** 支付成功：软预留转 consumed（占用变成真实消耗，不再回补） */
  async consumeForOrder(orderId: string): Promise<number> {
    const rows = await this.db
      .update(stockReservations)
      .set({ status: 'consumed', kind: 'hard', updatedAt: new Date() })
      .where(and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.status, 'active'),
      ))
      .returning({ id: stockReservations.id });
    if (rows.length > 0) {
      this.logger.debug(`订单 ${orderId} 的 ${rows.length} 条预留已转为 consumed`);
    }
    return rows.length;
  }

  /**
   * 取消/超时：释放预留。
   *
   * 注意此时 stock 的回补由 OrdersService.releaseOrderResources 负责，
   * 这里只改预留状态——两者必须在同一个事务里，否则会出现
   * "库存回补了但预留还挂着"的幽灵占用。
   */
  async releaseForOrder(tx: Database, orderId: string): Promise<number> {
    const rows = await tx
      .update(stockReservations)
      .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(stockReservations.orderId, orderId),
        eq(stockReservations.status, 'active'),
      ))
      .returning({ id: stockReservations.id });
    return rows.length;
  }

  /**
   * 清理过期但未处理的活动预留。
   *
   * 这是兜底：正常情况下订单超时服务会先取消订单并释放预留。
   * 若因进程崩溃等原因留下了孤儿预留，这里把它们标记为 released，
   * 让"被占用"的统计重新变准。
   *
   * 注意：**不会**自动回补 stock —— 库存回补必须由订单取消路径负责，
   * 否则两边都补一次就是凭空多库存。
   */
  async reapExpired(limit = 200): Promise<number> {
    const now = new Date();
    const rows = await this.db
      .update(stockReservations)
      .set({ status: 'released', releasedAt: now, updatedAt: now })
      .where(and(
        eq(stockReservations.status, 'active'),
        lt(stockReservations.expiresAt, now),
      ))
      .returning({ id: stockReservations.id });
    if (rows.length > 0) {
      this.logger.warn(`回收 ${Math.min(rows.length, limit)} 条过期预留（库存回补由订单取消路径负责）`);
    }
    return rows.length;
  }

  /** 某变体的占用统计：active 数量 = 被未支付订单占用的件数 */
  async getReservedQuantity(variantId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${stockReservations.quantity}), 0)` })
      .from(stockReservations)
      .where(and(
        eq(stockReservations.variantId, variantId),
        eq(stockReservations.status, 'active'),
      ));
    return Number(rows[0]?.total ?? 0);
  }

  /** 批量版本（商品列表页需要一次查多个 SKU） */
  async getReservedQuantities(variantIds: string[]): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        variantId: stockReservations.variantId,
        total: sql<number>`COALESCE(SUM(${stockReservations.quantity}), 0)`,
      })
      .from(stockReservations)
      .where(and(
        inArray(stockReservations.variantId, variantIds),
        eq(stockReservations.status, 'active'),
      ))
      .groupBy(stockReservations.variantId);
    return new Map(rows.map((r) => [r.variantId, Number(r.total)]));
  }
}
