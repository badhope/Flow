import { Inject, Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { productVariants, stockBatches, warehouseStock, warehouses } from '../../database/schema';

/**
 * 批次与效期。
 *
 * 核心规则（写死，不靠调用方记忆）：
 *   1. **先到期先出（FEFO）**，不是先进先出。保质期商品必须按到期日排，
 *      按入库时间排会把临期货压在仓里直到报废。
 *   2. **过期批次不计入可售**，但保留在库以便追溯与报废流程。
 *   3. **批次总和必须等于分仓库存**。这条不变量由本服务在事务内维持，
 *      漂移了就是数据错误。
 *
 * 无保质期商品（标品）：`expiresAt` 为空，排在所有有到期日批次之后。
 */

export interface BatchView {
  id: string;
  batchNo: string;
  warehouseId: string;
  warehouseName: string;
  variantId: string;
  quantity: number;
  producedAt?: string;
  expiresAt?: string;
  source: string;
  note?: string;
  /** 距到期天数；null 表示无保质期；负数表示已过期 */
  daysToExpiry: number | null;
  status: 'ok' | 'expiring' | 'expired' | 'no_expiry';
}

export interface BatchConsumption {
  batchId: string;
  batchNo: string;
  quantity: number;
  expiresAt: string | null;
}

/** 临期阈值：30 天内到期算临期 */
const EXPIRING_SOON_DAYS = 30;

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  // ---------------- 入库 ----------------

  /**
   * 批次入库。
   *
   * 同一 (仓, SKU, 批次号) 重复入库时累加数量——补货常常是同一批次的后续到货。
   * 同时同步 `warehouse_stock`，保持"批次总和 = 分仓库存"的不变量。
   */
  async addBatch(params: {
    sellerId: string;
    warehouseId: string;
    variantId: string;
    batchNo: string;
    quantity: number;
    producedAt?: string;
    expiresAt?: string;
    source?: string;
    note?: string;
  }): Promise<BatchView> {
    const batchNo = params.batchNo?.trim();
    if (!batchNo) throw new BadRequestException('批次号必填');
    if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
      throw new BadRequestException('入库数量必须为正整数');
    }

    // 有效期校验：过期批次不该被"入库"成可售
    if (params.expiresAt) {
      const exp = new Date(params.expiresAt);
      if (Number.isNaN(exp.getTime())) throw new BadRequestException('到期日格式非法');
      if (exp.getTime() <= Date.now()) {
        throw new BadRequestException('到期日已过，不能入库为可售批次');
      }
    }

    const wh = await this.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.id, params.warehouseId), eq(warehouses.sellerId, params.sellerId)))
      .limit(1);
    if (wh.length === 0) throw new NotFoundException('仓库不存在');

    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: stockBatches.id, quantity: stockBatches.quantity })
        .from(stockBatches)
        .where(and(
          eq(stockBatches.warehouseId, params.warehouseId),
          eq(stockBatches.variantId, params.variantId),
          eq(stockBatches.batchNo, batchNo),
        ))
        .limit(1);

      let row;
      if (existing.length > 0) {
        const updated = await tx
          .update(stockBatches)
          .set({
            quantity: existing[0].quantity + params.quantity,
            expiresAt: params.expiresAt ? new Date(params.expiresAt) : undefined,
            producedAt: params.producedAt ? new Date(params.producedAt) : undefined,
            updatedAt: new Date(),
          })
          .where(eq(stockBatches.id, existing[0].id))
          .returning();
        row = updated[0];
      } else {
        const inserted = await tx
          .insert(stockBatches)
          .values({
            sellerId: params.sellerId,
            warehouseId: params.warehouseId,
            variantId: params.variantId,
            batchNo,
            quantity: params.quantity,
            producedAt: params.producedAt ? new Date(params.producedAt) : null,
            expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
            source: params.source ?? 'supplier',
            note: params.note,
          })
          .returning();
        row = inserted[0];
      }

      // 同步分仓库存：批次入库必然带来可售量增加
      await tx
        .insert(warehouseStock)
        .values({ warehouseId: params.warehouseId, variantId: params.variantId, stock: params.quantity })
        .onConflictDoUpdate({
          target: [warehouseStock.warehouseId, warehouseStock.variantId],
          set: { stock: sql`${warehouseStock.stock} + ${params.quantity}`, updatedAt: new Date() },
        });

      await this.syncAggregate(tx as unknown as typeof this.db, params.variantId);
      return this.toView(row, row.warehouseId);
    });
  }

  // ---------------- 查询 ----------------

  /** 某变体在各仓的批次明细（含临期/过期状态） */
  async listByVariant(sellerId: string, variantId: string): Promise<BatchView[]> {
    const rows = await this.db
      .select({
        batch: stockBatches,
        warehouseName: warehouses.name,
      })
      .from(stockBatches)
      .innerJoin(warehouses, eq(warehouses.id, stockBatches.warehouseId))
      .where(and(eq(stockBatches.sellerId, sellerId), eq(stockBatches.variantId, variantId)))
      .orderBy(asc(stockBatches.expiresAt));

    return rows.map((r) => this.toView(r.batch, r.batch.warehouseId, r.warehouseName));
  }

  /**
   * 临期与过期看板。
   *
   * 按天数升序（最紧急的在前）。过期批次单独标出——它们仍在库中占着数量，
   * 需要卖家走报废流程，而不是当成可售。
   */
  async listExpiring(sellerId: string, days = EXPIRING_SOON_DAYS, limit = 200): Promise<BatchView[]> {
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ batch: stockBatches, warehouseName: warehouses.name })
      .from(stockBatches)
      .innerJoin(warehouses, eq(warehouses.id, stockBatches.warehouseId))
      .where(and(
        eq(stockBatches.sellerId, sellerId),
        gt(stockBatches.quantity, 0),
        isNotNull(stockBatches.expiresAt),
        lte(stockBatches.expiresAt, cutoff),
      ))
      .orderBy(asc(stockBatches.expiresAt))
      .limit(Math.min(Math.max(limit, 1), 500));

    return rows.map((r) => this.toView(r.batch, r.batch.warehouseId, r.warehouseName));
  }

  /** 所有有保质期的批次（概览用） */
  async listAll(sellerId: string, limit = 200): Promise<BatchView[]> {
    const rows = await this.db
      .select({ batch: stockBatches, warehouseName: warehouses.name })
      .from(stockBatches)
      .innerJoin(warehouses, eq(warehouses.id, stockBatches.warehouseId))
      .where(eq(stockBatches.sellerId, sellerId))
      .orderBy(asc(stockBatches.expiresAt))
      .limit(Math.min(Math.max(limit, 1), 500));
    return rows.map((r) => this.toView(r.batch, r.batch.warehouseId, r.warehouseName));
  }

  // ---------------- 扣减（FEFO） ----------------

  /**
   * 按先到期先出扣减批次（在订单事务内调用）。
   *
   * 排序规则：
   *   1. 有过期日的优先于无过期日（标品最后出）
   *   2. 有过期日的按到期日升序
   *   3. 同时到期按入库时间（先入先出）
   *
   * 已过期批次**跳过**（`expiresAt > now` 或为空）。它们仍占库存数字，
   * 但不可销售——这是"过期不参与可售"规则的落点。
   *
   * 返回实际消耗的批次快照，写入 order_items 供追溯与召回。
   */
  async consumeFefo(
    tx: Database,
    params: { warehouseId: string; variantId: string; quantity: number },
  ): Promise<BatchConsumption[]> {
    const { warehouseId, variantId, quantity } = params;
    if (quantity <= 0) return [];

    const now = new Date();
    const candidates = await tx
      .select()
      .from(stockBatches)
      .where(and(
        eq(stockBatches.warehouseId, warehouseId),
        eq(stockBatches.variantId, variantId),
        gt(stockBatches.quantity, 0),
        // 未过期，或无保质期
        or(isNull(stockBatches.expiresAt), gt(stockBatches.expiresAt, now)),
      ))
      .orderBy(
        // Postgres: NULLS LAST 让无保质期的排在后面
        sql`${stockBatches.expiresAt} ASC NULLS LAST`,
        asc(stockBatches.createdAt),
      );

    let remaining = quantity;
    const consumed: BatchConsumption[] = [];

    for (const b of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.quantity);
      const updated = await tx
        .update(stockBatches)
        .set({ quantity: sql`${stockBatches.quantity} - ${take}`, updatedAt: new Date() })
        .where(and(eq(stockBatches.id, b.id), sql`${stockBatches.quantity} >= ${take}`))
        .returning({ id: stockBatches.id });

      if (updated.length === 0) {
        // 并发扣减失败：跳过该批，继续找下一批
        continue;
      }

      consumed.push({
        batchId: b.id,
        batchNo: b.batchNo,
        quantity: take,
        expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
      });
      remaining -= take;
    }

    // 批次不足以覆盖需求：说明「批次总和 < 分仓库存」已经漂移，
    // 必须报错而不是静默少发——否则会发出没有批次记录的货，无法追溯。
    if (remaining > 0) {
      this.logger.error(
        `批次不足：仓 ${warehouseId} 变体 ${variantId} 缺 ${remaining} 件（批次总和与分仓库存不一致）`,
      );
      throw new BadRequestException('批次库存不足，无法发货（库存数据可能不一致，请联系运营核对批次）');
    }

    return consumed;
  }

  /**
   * 回补批次（取消/退款）。
   *
   * 按订单行记录的批次快照原路退回——不能笼统加到"某个批次"，
   * 否则追溯链断裂，效期也会算错。
   */
  async restoreBatches(
    tx: Database,
    warehouseId: string,
    variantId: string,
    allocations: BatchConsumption[],
  ): Promise<void> {
    if (allocations.length === 0) return;
    for (const a of allocations) {
      const updated = await tx
        .update(stockBatches)
        .set({ quantity: sql`${stockBatches.quantity} + ${a.quantity}`, updatedAt: new Date() })
        .where(eq(stockBatches.id, a.batchId))
        .returning({ id: stockBatches.id });

      if (updated.length === 0) {
        // 批次已被删除（如清理过期数据）：退回到该仓该 SKU 的默认批次，
        // 保证库存不丢，同时留下警告。
        this.logger.warn(`回补时批次 ${a.batchNo} 已不存在，退回默认批次`);
        await tx
          .insert(stockBatches)
          .values({
            sellerId: (await this.sellerOfVariant(tx, variantId)) ?? '',
            warehouseId,
            variantId,
            batchNo: 'RECOVERED',
            quantity: a.quantity,
            source: 'return',
            note: `原批次 ${a.batchNo} 已删除，回补至恢复批次`,
          })
          .onConflictDoUpdate({
            target: [stockBatches.warehouseId, stockBatches.variantId, stockBatches.batchNo],
            set: { quantity: sql`${stockBatches.quantity} + ${a.quantity}`, updatedAt: new Date() },
          });
      }
    }
  }

  // ---------------- 维护 ----------------

  /**
   * 确保某 (仓, SKU) 有批次记录。没有就按当前分仓库存补一个 LEGACY 批次。
   *
   * 在扣减前调用，属于**读路径自愈**：比起让买家看到"批次库存不足"，
   * 不如当场把缺失的批次补上。只在完全无批次时触发，不覆盖已有批次。
   */
  async ensureBatchesFor(
    tx: Database,
    params: { warehouseId: string; variantId: string },
  ): Promise<void> {
    const existing = await tx
      .select({ id: stockBatches.id })
      .from(stockBatches)
      .where(and(
        eq(stockBatches.warehouseId, params.warehouseId),
        eq(stockBatches.variantId, params.variantId),
      ))
      .limit(1);
    if (existing.length > 0) return;

    const stockRow = await tx
      .select({ stock: warehouseStock.stock })
      .from(warehouseStock)
      .where(and(
        eq(warehouseStock.warehouseId, params.warehouseId),
        eq(warehouseStock.variantId, params.variantId),
      ))
      .limit(1);
    const qty = stockRow[0]?.stock ?? 0;
    if (qty <= 0) return;

    const sellerRow = await tx
      .select({ sellerId: warehouses.sellerId })
      .from(warehouses)
      .where(eq(warehouses.id, params.warehouseId))
      .limit(1);

    await tx
      .insert(stockBatches)
      .values({
        sellerId: sellerRow[0]?.sellerId ?? '',
        warehouseId: params.warehouseId,
        variantId: params.variantId,
        batchNo: 'LEGACY',
        quantity: qty,
        source: 'supplier',
        note: '自愈：扣减前发现无批次记录，按当前库存补齐',
      })
      .onConflictDoNothing();
  }

  /**
   * 为「有分仓库存但没有批次」的 SKU 自动补一个 LEGACY 批次。
   *
   * 为什么需要：迁移 0013 只为迁移当时已存在的库存生成批次，
   * 而种子数据、以及升级后新写入的库存可能绕过批次直接写分仓。
   * 没有批次就扣不出货（FEFO 会报"批次库存不足"），
   * 在这里自愈比让买家遇到下单失败好。
   *
   * 幂等：只补完全没有批次的 (仓, SKU) 组合。
   */
  async backfillMissingBatches(sellerId: string): Promise<number> {
    const missing = await this.db
      .select({
        warehouseId: warehouseStock.warehouseId,
        variantId: warehouseStock.variantId,
        stock: warehouseStock.stock,
      })
      .from(warehouseStock)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
      .where(and(
        eq(warehouses.sellerId, sellerId),
        gt(warehouseStock.stock, 0),
        sql`NOT EXISTS (
          SELECT 1 FROM ${stockBatches} b
          WHERE b.warehouse_id = ${warehouseStock.warehouseId}
            AND b.variant_id = ${warehouseStock.variantId}
        )`,
      ));

    if (missing.length === 0) return 0;

    for (const m of missing) {
      await this.db
        .insert(stockBatches)
        .values({
          sellerId,
          warehouseId: m.warehouseId,
          variantId: m.variantId,
          batchNo: 'LEGACY',
          quantity: m.stock,
          source: 'supplier',
          note: '自动补齐：该库存无批次记录（历史数据）',
        })
        .onConflictDoNothing();
    }
    this.logger.log(`已为 ${missing.length} 条分仓库存补齐 LEGACY 批次`);
    return missing.length;
  }

  /**
   * 批次与分仓库存的一致性检查。
   *
   * 正常情况下两者相等。不等说明有代码路径绕过了本服务直接改库存——
   * 这类问题必须能查出来，否则会一直累积。
   */
  async findBatchDrift(sellerId: string, limit = 200): Promise<Array<{
    warehouseId: string;
    variantId: string;
    warehouseStock: number;
    batchTotal: number;
    diff: number;
  }>> {
    const rows = await this.db
      .select({
        warehouseId: warehouseStock.warehouseId,
        variantId: warehouseStock.variantId,
        warehouseStock: warehouseStock.stock,
        batchTotal: sql<string>`COALESCE((
          SELECT SUM(b.quantity) FROM ${stockBatches} b
          WHERE b.warehouse_id = ${warehouseStock.warehouseId}
            AND b.variant_id = ${warehouseStock.variantId}
        ), 0)::text`,
      })
      .from(warehouseStock)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
      .where(eq(warehouses.sellerId, sellerId))
      .limit(limit);

    return rows
      .map((r) => ({
        warehouseId: r.warehouseId,
        variantId: r.variantId,
        warehouseStock: r.warehouseStock,
        batchTotal: Number(r.batchTotal),
        diff: r.warehouseStock - Number(r.batchTotal),
      }))
      .filter((r) => r.diff !== 0);
  }

  /**
   * 修复批次漂移：以分仓库存为准，把差额补进/扣出 `LEGACY` 批次。
   *
   * 为什么以分仓为准：分仓库存是下单扣减的依据，批次只是它的明细。
   * 差额没有批次来源，只能记到 LEGACY 并留说明。
   */
  async repairBatchDrift(sellerId: string): Promise<number> {
    const drifted = await this.findBatchDrift(sellerId, 1000);
    if (drifted.length === 0) return 0;

    await this.db.transaction(async (tx) => {
      for (const d of drifted) {
        if (d.diff > 0) {
          await tx
            .insert(stockBatches)
            .values({
              sellerId,
              warehouseId: d.warehouseId,
              variantId: d.variantId,
              batchNo: 'LEGACY',
              quantity: d.diff,
              source: 'supplier',
              note: '批次漂移修复补入（差额无批次来源）',
            })
            .onConflictDoUpdate({
              target: [stockBatches.warehouseId, stockBatches.variantId, stockBatches.batchNo],
              set: { quantity: sql`${stockBatches.quantity} + ${d.diff}`, updatedAt: new Date() },
            });
        } else {
          // 批次多于分仓：从最早的批次里扣，直到抹平
          let excess = -d.diff;
          const batches = await tx
            .select()
            .from(stockBatches)
            .where(and(
              eq(stockBatches.warehouseId, d.warehouseId),
              eq(stockBatches.variantId, d.variantId),
            ))
            .orderBy(asc(stockBatches.expiresAt));
          for (const b of batches) {
            if (excess <= 0) break;
            const take = Math.min(excess, b.quantity);
            await tx
              .update(stockBatches)
              .set({ quantity: sql`${stockBatches.quantity} - ${take}`, updatedAt: new Date() })
              .where(eq(stockBatches.id, b.id));
            excess -= take;
          }
        }
      }
    });

    this.logger.warn(`已修复 ${drifted.length} 条批次漂移（以分仓库存为准）`);
    return drifted.length;
  }

  /** 清理数量为 0 且无追溯价值的历史批次 */
  async purgeEmptyBatches(sellerId: string): Promise<number> {
    const deleted = await this.db
      .delete(stockBatches)
      .where(and(eq(stockBatches.sellerId, sellerId), eq(stockBatches.quantity, 0)))
      .returning({ id: stockBatches.id });
    return deleted.length;
  }

  private async syncAggregate(tx: Database, variantId: string): Promise<void> {
    const sum = await tx
      .select({ total: sql<string>`COALESCE(SUM(${warehouseStock.stock}), 0)::text` })
      .from(warehouseStock)
      .where(eq(warehouseStock.variantId, variantId));
    const total = Number(sum[0]?.total ?? 0);

    const vr = await tx
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);
    await tx.update(productVariants).set({ stock: total, updatedAt: new Date() }).where(eq(productVariants.id, variantId));
    if (vr[0]) {
      // 商品总库存由 StockService 的规则重算；这里只保证变体聚合正确
      await tx
        .update(productVariants)
        .set({ stock: total })
        .where(eq(productVariants.id, variantId));
    }
  }

  private async sellerOfVariant(tx: Database, variantId: string): Promise<string | null> {
    const rows = await tx
      .select({ sellerId: stockBatches.sellerId })
      .from(stockBatches)
      .where(eq(stockBatches.variantId, variantId))
      .limit(1);
    return rows[0]?.sellerId ?? null;
  }

  private toView(
    row: typeof stockBatches.$inferSelect,
    _warehouseId: string,
    warehouseName?: string,
  ): BatchView {
    const now = Date.now();
    const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
    const daysToExpiry = exp === null ? null : Math.floor((exp - now) / (24 * 60 * 60 * 1000));

    let status: BatchView['status'] = 'no_expiry';
    if (daysToExpiry !== null) {
      if (daysToExpiry < 0) status = 'expired';
      else if (daysToExpiry <= EXPIRING_SOON_DAYS) status = 'expiring';
      else status = 'ok';
    }

    return {
      id: row.id,
      batchNo: row.batchNo,
      warehouseId: row.warehouseId,
      warehouseName: warehouseName ?? '',
      variantId: row.variantId,
      quantity: row.quantity,
      producedAt: row.producedAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      source: row.source,
      note: row.note ?? undefined,
      daysToExpiry,
      status,
    };
  }
}
