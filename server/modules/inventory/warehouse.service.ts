import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ConflictException, OnApplicationBootstrap } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import {
  productVariants, products, stockMovements, stockTransfers, warehouseStock, warehouses,
} from '../../database/schema';
import { BatchService } from './batch.service';

/**
 * 多仓库存。
 *
 * 核心问题不是"多存几个地址"，而是**同一 SKU 在多个仓有货时，从哪个仓发**。
 * 规则（按顺序，写死而非猜测）：
 *   1. 目的国与仓所在国一致（本地仓优先）→ 时效最好、无关税
 *   2. 否则按 priority 升序（运营可调）
 *   3. 同优先级按可用量降序（一次发完，避免拆单）
 *
 * 可用量 = 分仓库存 − 该仓的安全库存。安全库存是预警线，不能拿来卖。
 */

export interface WarehouseAllocation {
  warehouseId: string;
  warehouseName: string;
  country: string;
  quantity: number;
  available: number;
  priority: number;
  /** 是否跨仓拆单 */
  split: boolean;
}

export interface AllocationPlan {
  allocations: WarehouseAllocation[];
  /** 是否有足够库存满足全部需求 */
  fulfillable: boolean;
  /** 缺口（无法满足的数量），0 表示可完全满足 */
  shortage: number;
}

@Injectable()
export class WarehouseService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly batchService: BatchService,
  ) {}

  /**
   * 启动时补齐默认仓。
   *
   * 为什么不在迁移里做：迁移执行时业务表往往还是空的（新库/新环境），
   * 而卖家是之后才注册或由种子数据创建的——迁移里那条 INSERT 会一个都匹配不到，
   * 结果是"卖家有商品但没有任何仓库"，下单时选仓直接失败。
   * 放在启动钩子里可以覆盖"先有卖家后有仓"和"先有仓后有卖家"两种时序。
   */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.ensureDefaultWarehouses(), 15_000);
  }

  /** 为所有缺少默认仓的卖家补建一个默认仓 */
  async ensureDefaultWarehouses(): Promise<number> {
    try {
      // 找出有商品但没有任何仓库的卖家
      const missing = await this.db
        .select({ sellerId: products.sellerId })
        .from(products)
        .where(sql`NOT EXISTS (
          SELECT 1 FROM ${warehouses} w WHERE w.seller_id = ${products.sellerId}
        )`)
        .groupBy(products.sellerId);

      let created = 0;
      for (const row of missing) {
        await this.db
          .insert(warehouses)
          .values({
            sellerId: row.sellerId,
            name: '默认仓',
            code: 'DEFAULT',
            country: 'CN',
            isDefault: true,
            priority: 100,
          })
          .onConflictDoNothing();
        created += 1;
      }
      if (created > 0) {
        this.logger.log(`已为 ${created} 个卖家补建默认仓`);
      }
      return created;
    } catch (error) {
      this.logger.error(
        '补建默认仓失败',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  // ---------------- 仓库 CRUD ----------------

  async list(sellerId: string) {
    const rows = await this.db
      .select()
      .from(warehouses)
      .where(eq(warehouses.sellerId, sellerId))
      .orderBy(asc(warehouses.priority), asc(warehouses.createdAt));
    return rows.map((w) => this.mapWarehouse(w));
  }

  async create(sellerId: string, dto: {
    name: string; code: string; country?: string; address?: string;
    contactName?: string; contactPhone?: string; priority?: number; isDefault?: boolean;
  }) {
    const name = dto.name?.trim();
    const code = dto.code?.trim().toUpperCase();
    if (!name) throw new BadRequestException('仓库名称必填');
    if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) {
      throw new BadRequestException('仓库代码需为 2–32 位字母、数字、下划线或短横线');
    }

    const existing = await this.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.code, code)))
      .limit(1);
    if (existing.length > 0) throw new ConflictException(`仓库代码 ${code} 已存在`);

    // 第一个仓自动设为默认仓，避免出现"没有默认仓"的状态
    const countRows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(warehouses)
      .where(eq(warehouses.sellerId, sellerId));
    const isFirst = Number(countRows[0]?.count ?? 0) === 0;

    return this.db.transaction(async (tx) => {
      if (dto.isDefault || isFirst) {
        await tx
          .update(warehouses)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(warehouses.sellerId, sellerId));
      }
      const inserted = await tx
        .insert(warehouses)
        .values({
          sellerId,
          name,
          code,
          country: (dto.country ?? 'CN').trim().toUpperCase().slice(0, 2),
          address: dto.address,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          priority: dto.priority ?? 100,
          isDefault: dto.isDefault || isFirst,
        })
        .returning();
      return this.mapWarehouse(inserted[0]);
    });
  }

  async update(sellerId: string, id: string, dto: {
    name?: string; country?: string; address?: string; contactName?: string;
    contactPhone?: string; priority?: number; isDefault?: boolean; active?: boolean;
  }) {
    const owned = await this.db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.sellerId, sellerId)))
      .limit(1);
    if (owned.length === 0) throw new NotFoundException('仓库不存在');

    return this.db.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx
          .update(warehouses)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(warehouses.sellerId, sellerId));
      }
      const patch: Partial<typeof warehouses.$inferInsert> = { updatedAt: new Date() };
      if (dto.name !== undefined) patch.name = dto.name.trim();
      if (dto.country !== undefined) patch.country = dto.country.trim().toUpperCase().slice(0, 2);
      if (dto.address !== undefined) patch.address = dto.address;
      if (dto.contactName !== undefined) patch.contactName = dto.contactName;
      if (dto.contactPhone !== undefined) patch.contactPhone = dto.contactPhone;
      if (dto.priority !== undefined) patch.priority = dto.priority;
      if (dto.isDefault !== undefined) patch.isDefault = dto.isDefault;
      if (dto.active !== undefined) patch.active = dto.active;

      const updated = await tx
        .update(warehouses)
        .set(patch)
        .where(eq(warehouses.id, id))
        .returning();
      return this.mapWarehouse(updated[0]);
    });
  }

  /** 删除仓库前必须没有库存，避免库存凭空消失 */
  async remove(sellerId: string, id: string): Promise<void> {
    const owned = await this.db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.sellerId, sellerId)))
      .limit(1);
    if (owned.length === 0) throw new NotFoundException('仓库不存在');
    if (owned[0].isDefault) throw new BadRequestException('默认仓不能删除，请先切换默认仓');

    const stockRows = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${warehouseStock.stock}), 0)::text` })
      .from(warehouseStock)
      .where(eq(warehouseStock.warehouseId, id));
    if (Number(stockRows[0]?.total ?? 0) > 0) {
      throw new BadRequestException('该仓仍有库存，请先调拨或清空后再删除');
    }
    await this.db.delete(warehouses).where(eq(warehouses.id, id));
  }

  // ---------------- 分仓库存 ----------------

  /** 某变体在各仓的库存明细 */
  async stockByVariant(sellerId: string, variantId: string) {
    const rows = await this.db
      .select({
        warehouseId: warehouseStock.warehouseId,
        warehouseName: warehouses.name,
        warehouseCode: warehouses.code,
        country: warehouses.country,
        priority: warehouses.priority,
        stock: warehouseStock.stock,
        safetyStock: warehouseStock.safetyStock,
      })
      .from(warehouseStock)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
      .where(and(eq(warehouseStock.variantId, variantId), eq(warehouses.sellerId, sellerId)))
      .orderBy(asc(warehouses.priority));
    return rows.map((r) => ({
      ...r,
      // 可售 = 库存 − 安全库存，不为负
      available: Math.max(0, r.stock - r.safetyStock),
    }));
  }

  /** 设置某仓某变体的库存（运营补货/盘点） */
  async setStock(sellerId: string, warehouseId: string, variantId: string, stock: number, safetyStock = 0) {
    if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException('库存必须为非负整数');
    if (!Number.isInteger(safetyStock) || safetyStock < 0) throw new BadRequestException('安全库存必须为非负整数');

    const owned = await this.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.sellerId, sellerId)))
      .limit(1);
    if (owned.length === 0) throw new NotFoundException('仓库不存在');

    return this.db.transaction(async (tx) => {
      const before = await tx
        .select({ stock: warehouseStock.stock })
        .from(warehouseStock)
        .where(and(eq(warehouseStock.warehouseId, warehouseId), eq(warehouseStock.variantId, variantId)))
        .limit(1);

      await tx
        .insert(warehouseStock)
        .values({ warehouseId, variantId, stock, safetyStock })
        .onConflictDoUpdate({
          target: [warehouseStock.warehouseId, warehouseStock.variantId],
          set: { stock, safetyStock, updatedAt: new Date() },
        });

      // 记录变动，便于盘点追溯
      const delta = stock - (before[0]?.stock ?? 0);
      if (delta !== 0) {
        await tx.insert(stockMovements).values({
          variantId,
          quantity: delta,
          reason: 'adjustment',
          referenceId: warehouseId,
          note: `仓库盘点调整 → ${stock}`,
          createdBy: sellerId,
        });
      }

      // 同步变体的聚合库存与商品总库存，保持既有查询口径不变
      await this.syncVariantTotals(tx as unknown as typeof this.db, variantId);
      return { warehouseId, variantId, stock, safetyStock };
    });
  }

  /**
   * 把分仓库存汇总回 product_variants.stock 与 products.total_stock。
   *
   * 为什么必须同步：全站有大量既有查询依赖这两个字段（列表页、筛选、售罄判断）。
   * 分仓是**新的真相来源**，但聚合字段必须保持一致，否则会出现
   * "分仓有货但商品显示售罄"。
   */
  private async syncVariantTotals(tx: Database, variantId: string): Promise<void> {
    const sumRows = await tx
      .select({ total: sql<string>`COALESCE(SUM(${warehouseStock.stock}), 0)::text` })
      .from(warehouseStock)
      .where(eq(warehouseStock.variantId, variantId));
    const total = Number(sumRows[0]?.total ?? 0);

    const variantRow = await tx
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);

    await tx
      .update(productVariants)
      .set({ stock: total, updatedAt: new Date() })
      .where(eq(productVariants.id, variantId));

    if (variantRow[0]) {
      const productSum = await tx
        .select({ total: sql<string>`COALESCE(SUM(${productVariants.stock}), 0)::text` })
        .from(productVariants)
        .where(eq(productVariants.productId, variantRow[0].productId));
      await tx
        .update(products)
        .set({ totalStock: Number(productSum[0]?.total ?? 0), updatedAt: new Date() })
        .where(eq(products.id, variantRow[0].productId));
    }
  }

  // ---------------- 选仓与扣减 ----------------

  /**
   * 为订单分配发货仓。
   *
   * 返回分配方案，不直接扣减（扣减在订单事务内做，保证原子性）。
   * 若无法完全满足，返回 `fulfillable: false` 与缺口数量——
   * 由调用方决定是拒绝下单还是拆单，不在这里静默放过。
   */
  async planAllocation(
    sellerId: string,
    items: Array<{ variantId: string; quantity: number }>,
    destinationCountry: string,
  ): Promise<Map<string, AllocationPlan>> {
    const result = new Map<string, AllocationPlan>();
    if (items.length === 0) return result;

    const variantIds = items.map((i) => i.variantId);
    const rows = await this.db
      .select({
        variantId: warehouseStock.variantId,
        warehouseId: warehouseStock.warehouseId,
        stock: warehouseStock.stock,
        safetyStock: warehouseStock.safetyStock,
        name: warehouses.name,
        country: warehouses.country,
        priority: warehouses.priority,
        active: warehouses.active,
      })
      .from(warehouseStock)
      .innerJoin(warehouses, eq(warehouses.id, warehouseStock.warehouseId))
      .where(and(
        inArray(warehouseStock.variantId, variantIds),
        eq(warehouses.sellerId, sellerId),
        eq(warehouses.active, true),
      ));

    const dest = (destinationCountry ?? '').trim().toUpperCase();

    // 兜底：老商品（升级前创建的）可能没有任何 warehouse_stock 记录。
    // 此时按聚合库存把数量归入默认仓，避免"升级即无法下单"。
    // 这不是绕过分仓，而是把历史数据的一次性迁移放在读取路径上兜住。
    const missingVariants = items.filter(
      (i) => !rows.some((r) => r.variantId === i.variantId),
    );
    if (missingVariants.length > 0) {
      // 先尝试自动补齐：把聚合库存写进默认仓，让数据一致（而不只是读取时兜底）。
      // 这样"种子数据/历史商品"在下第一单时就被自愈，后续走正常分仓逻辑。
      await this.backfillDefaultWarehouseStock(sellerId, missingVariants.map((i) => i.variantId));
      const fallbackRows = await this.loadAggregateFallback(sellerId, missingVariants.map((i) => i.variantId));
      rows.push(...fallbackRows);
    }

    for (const item of items) {
      const candidates = rows
        .filter((r) => r.variantId === item.variantId)
        .map((r) => ({ ...r, available: Math.max(0, r.stock - r.safetyStock) }))
        .filter((r) => r.available > 0)
        // 1) 目的国本地仓优先 2) priority 升序 3) 可用量降序
        .sort((a, b) => {
          const aLocal = a.country === dest ? 0 : 1;
          const bLocal = b.country === dest ? 0 : 1;
          if (aLocal !== bLocal) return aLocal - bLocal;
          if (a.priority !== b.priority) return a.priority - b.priority;
          return b.available - a.available;
        });

      let remaining = item.quantity;
      const allocations: WarehouseAllocation[] = [];

      for (const c of candidates) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, c.available);
        allocations.push({
          warehouseId: c.warehouseId,
          warehouseName: c.name,
          country: c.country,
          quantity: take,
          available: c.available,
          priority: c.priority,
          split: false,
        });
        remaining -= take;
      }

      // 只有一仓能满足时标记不拆单
      if (allocations.length === 1) allocations[0].split = false;
      else if (allocations.length > 1) allocations.forEach((a) => { a.split = true; });

      result.set(item.variantId, {
        allocations,
        fulfillable: remaining === 0,
        shortage: Math.max(0, remaining),
      });
    }

    return result;
  }

  /**
   * 自愈：把聚合库存补写进默认仓。
   *
   * 触发场景：种子数据、迁移前创建的商品、或历史数据 —— 它们只有
   * `product_variants.stock` 而没有 `warehouse_stock`。
   * 在下单一刻补齐，避免"升级后老商品全部无法下单"。
   *
   * 幂等：只补没有记录的变体，不会覆盖运营已调整的分仓库存。
   */
  private async backfillDefaultWarehouseStock(sellerId: string, variantIds: string[]): Promise<void> {
    if (!sellerId || variantIds.length === 0) return;
    let whRows = await this.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)))
      .limit(1);

    if (whRows.length === 0) {
      const inserted = await this.db
        .insert(warehouses)
        .values({ sellerId, name: '默认仓', code: 'DEFAULT', country: 'CN', isDefault: true, priority: 100 })
        .onConflictDoNothing()
        .returning({ id: warehouses.id });
      if (inserted.length > 0) {
        whRows = inserted;
      } else {
        whRows = await this.db
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)))
          .limit(1);
      }
    }
    if (whRows.length === 0) return;

    const variantRows = await this.db
      .select({ id: productVariants.id, stock: productVariants.stock })
      .from(productVariants)
      .where(inArray(productVariants.id, variantIds));

    for (const v of variantRows) {
      if (v.stock <= 0) continue;
      await this.db
        .insert(warehouseStock)
        .values({ warehouseId: whRows[0].id, variantId: v.id, stock: v.stock })
        .onConflictDoNothing();
    }
  }

  /**
   * 老数据兜底：把商品聚合库存视为默认仓库存。
   *
   * 仅在完全没有 warehouse_stock 记录时触发；一旦卖家在后台调过分仓库存，
   * 就以分仓为准，不会重复计数。
   */
  private async loadAggregateFallback(sellerId: string, variantIds: string[]) {
    if (variantIds.length === 0) return [];
    const rows = await this.db
      .select({
        variantId: productVariants.id,
        stock: productVariants.stock,
        warehouseId: warehouses.id,
        name: warehouses.name,
        country: warehouses.country,
        priority: warehouses.priority,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(
        warehouses,
        and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)),
      )
      .where(and(
        inArray(productVariants.id, variantIds),
        eq(products.sellerId, sellerId),
      ));

    return rows
      .filter((r) => r.warehouseId !== null && r.stock > 0)
      .map((r) => ({
        variantId: r.variantId,
        warehouseId: r.warehouseId as string,
        stock: r.stock,
        safetyStock: 0,
        name: r.name ?? '默认仓',
        country: r.country ?? 'CN',
        priority: r.priority ?? 100,
        active: true,
      }));
  }

  /**
   * 按分配方案扣减分仓库存（在订单事务内调用）。
   *
   * 用条件更新（stock >= quantity）保证不会扣成负数：
   * 并发下单时只有一个能成功，另一个拿到 0 行并抛冲突。
   */
  async deduct(
    tx: Database,
    allocations: Array<{ warehouseId: string; variantId: string; quantity: number }>,
  ): Promise<Map<string, Array<{ batchId: string; batchNo: string; quantity: number; expiresAt: string | null }>>> {
    const touched = new Set<string>();
    // 按变体汇总本单实际消耗的批次，供 order_items 落快照
    const consumption = new Map<string, Array<{ batchId: string; batchNo: string; quantity: number; expiresAt: string | null }>>();

    for (const a of allocations) {
      const updated = await tx
        .update(warehouseStock)
        .set({ stock: sql`${warehouseStock.stock} - ${a.quantity}`, updatedAt: new Date() })
        .where(and(
          eq(warehouseStock.warehouseId, a.warehouseId),
          eq(warehouseStock.variantId, a.variantId),
          sql`${warehouseStock.stock} >= ${a.quantity}`,
        ))
        .returning({ id: warehouseStock.id });

      if (updated.length === 0) {
        throw new ConflictException('库存不足，下单失败');
      }

      // 自愈：该 (仓, SKU) 若完全没有批次记录（历史数据/直写分仓的路径），
      // 先按现有库存补一个 LEGACY 批次，否则 FEFO 扣不出货、下单直接失败。
      await this.batchService.ensureBatchesFor(tx, {
        warehouseId: a.warehouseId,
        variantId: a.variantId,
      });

      // 分仓扣减成功后立刻扣批次（FEFO）。两者同事务：不一致就整体回滚。
      const consumed = await this.batchService.consumeFefo(tx, {
        warehouseId: a.warehouseId,
        variantId: a.variantId,
        quantity: a.quantity,
      });
      const prev = consumption.get(a.variantId) ?? [];
      consumption.set(a.variantId, [...prev, ...consumed]);

      touched.add(a.variantId);
    }

    // 聚合字段必须在同一事务内重算：列表页/售罄判断读的是 product_variants.stock，
    // 只扣分仓会让商品显示"有货"但实际发不出，或反之。
    for (const variantId of touched) {
      await this.syncVariantTotals(tx, variantId);
    }

    return consumption;
  }

  /** 回补分仓库存（取消/退款时调用） */
  async restore(
    tx: Database,
    allocations: Array<{ warehouseId: string | null; variantId: string; quantity: number }>,
  ): Promise<void> {
    const touched = new Set<string>();
    for (const a of allocations) {
      if (!a.warehouseId) {
        // 历史数据没有仓库维度：回补到默认仓，保证库存不丢
        const fallback = await tx
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.sellerId, (await this.sellerOfVariant(a.variantId)) ?? ''), eq(warehouses.isDefault, true)))
          .limit(1);
        if (fallback.length === 0) {
          this.logger.warn(`变体 ${a.variantId} 找不到默认仓，跳过库存回补`);
          continue;
        }
        await tx
          .insert(warehouseStock)
          .values({ warehouseId: fallback[0].id, variantId: a.variantId, stock: a.quantity })
          .onConflictDoUpdate({
            target: [warehouseStock.warehouseId, warehouseStock.variantId],
            set: { stock: sql`${warehouseStock.stock} + ${a.quantity}`, updatedAt: new Date() },
          });
        touched.add(a.variantId);
        continue;
      }
      await tx
        .insert(warehouseStock)
        .values({ warehouseId: a.warehouseId, variantId: a.variantId, stock: a.quantity })
        .onConflictDoUpdate({
          target: [warehouseStock.warehouseId, warehouseStock.variantId],
          set: { stock: sql`${warehouseStock.stock} + ${a.quantity}`, updatedAt: new Date() },
        });
      touched.add(a.variantId);
    }

    // 与 deduct 对称：回补后立即重算聚合，避免调用方再手动加一次导致重复计数
    for (const variantId of touched) {
      await this.syncVariantTotals(tx, variantId);
    }
  }

  private async sellerOfVariant(variantId: string): Promise<string | null> {
    const rows = await this.db
      .select({ sellerId: products.sellerId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, variantId))
      .limit(1);
    return rows[0]?.sellerId ?? null;
  }

  // ---------------- 调拨 ----------------

  async createTransfer(sellerId: string, dto: {
    variantId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; note?: string;
  }) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('调出仓与调入仓不能相同');
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('调拨数量必须为正整数');
    }

    const owned = await this.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.sellerId, sellerId), inArray(warehouses.id, [dto.fromWarehouseId, dto.toWarehouseId])));
    if (owned.length !== 2) throw new NotFoundException('仓库不存在');

    return this.db.transaction(async (tx) => {
      // 调拨单创建即冻结调出仓库存（避免超卖）
      const updated = await tx
        .update(warehouseStock)
        .set({ stock: sql`${warehouseStock.stock} - ${dto.quantity}`, updatedAt: new Date() })
        .where(and(
          eq(warehouseStock.warehouseId, dto.fromWarehouseId),
          eq(warehouseStock.variantId, dto.variantId),
          sql`${warehouseStock.stock} >= ${dto.quantity}`,
        ))
        .returning({ id: warehouseStock.id });
      if (updated.length === 0) throw new ConflictException('调出仓库存不足');

      const no = `TR${Date.now().toString().slice(-10)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const inserted = await tx
        .insert(stockTransfers)
        .values({
          transferNo: no,
          sellerId,
          variantId: dto.variantId,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          quantity: dto.quantity,
          status: 'pending',
          note: dto.note,
        })
        .returning();

      await this.syncVariantTotals(tx as unknown as typeof this.db, dto.variantId);
      return this.mapTransfer(inserted[0]);
    });
  }

  /** 完成调拨：入库到目标仓 */
  async completeTransfer(sellerId: string, id: string) {
    const rows = await this.db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.sellerId, sellerId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('调拨单不存在');
    if (rows[0].status !== 'pending' && rows[0].status !== 'shipped') {
      throw new BadRequestException(`当前状态 ${rows[0].status} 无法完成入库`);
    }

    return this.db.transaction(async (tx) => {
      await tx
        .insert(warehouseStock)
        .values({ warehouseId: rows[0].toWarehouseId, variantId: rows[0].variantId, stock: rows[0].quantity })
        .onConflictDoUpdate({
          target: [warehouseStock.warehouseId, warehouseStock.variantId],
          set: { stock: sql`${warehouseStock.stock} + ${rows[0].quantity}`, updatedAt: new Date() },
        });

      const updated = await tx
        .update(stockTransfers)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(stockTransfers.id, id))
        .returning();

      await this.syncVariantTotals(tx as unknown as typeof this.db, rows[0].variantId);
      return this.mapTransfer(updated[0]);
    });
  }

  /** 取消调拨：退回调出仓 */
  async cancelTransfer(sellerId: string, id: string) {
    const rows = await this.db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.sellerId, sellerId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('调拨单不存在');
    if (rows[0].status === 'completed') throw new BadRequestException('已入库的调拨不能取消');

    return this.db.transaction(async (tx) => {
      await tx
        .insert(warehouseStock)
        .values({ warehouseId: rows[0].fromWarehouseId, variantId: rows[0].variantId, stock: rows[0].quantity })
        .onConflictDoUpdate({
          target: [warehouseStock.warehouseId, warehouseStock.variantId],
          set: { stock: sql`${warehouseStock.stock} + ${rows[0].quantity}`, updatedAt: new Date() },
        });
      const updated = await tx
        .update(stockTransfers)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(stockTransfers.id, id))
        .returning();
      await this.syncVariantTotals(tx as unknown as typeof this.db, rows[0].variantId);
      return this.mapTransfer(updated[0]);
    });
  }

  async listTransfers(sellerId: string, limit = 50) {
    const rows = await this.db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.sellerId, sellerId))
      .orderBy(asc(stockTransfers.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((r) => this.mapTransfer(r));
  }

  private mapWarehouse(w: typeof warehouses.$inferSelect) {
    return {
      id: w.id,
      name: w.name,
      code: w.code,
      country: w.country,
      address: w.address ?? undefined,
      contactName: w.contactName ?? undefined,
      contactPhone: w.contactPhone ?? undefined,
      priority: w.priority,
      isDefault: w.isDefault,
      active: w.active,
      createdAt: w.createdAt.toISOString(),
    };
  }

  private mapTransfer(t: typeof stockTransfers.$inferSelect) {
    return {
      id: t.id,
      transferNo: t.transferNo,
      variantId: t.variantId,
      fromWarehouseId: t.fromWarehouseId,
      toWarehouseId: t.toWarehouseId,
      quantity: t.quantity,
      status: t.status,
      note: t.note ?? undefined,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString(),
    };
  }
}
