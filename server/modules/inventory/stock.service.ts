import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { productVariants, products, warehouseStock, warehouses } from '../../database/schema';

/**
 * 库存写入的唯一入口。
 *
 * 为什么需要这层：分仓库存（`warehouse_stock`）是下单时的真相来源，
 * 而聚合字段（`product_variants.stock` / `products.total_stock`）是列表页、
 * 筛选、售罄判断读的地方。两者必须同步。
 *
 * 此前有 5 处代码各自写 `product_variants.stock`，只有 2 处写了分仓——
 * 结果是"商品显示有货但从哪个仓都发不出"，或者退款后分仓与聚合永久漂移。
 * 每加一个新入口就漏一次，靠 review 抓不住。所以把写入收敛到这里，
 * 调用方只表达"这个变体现在多少库存"，同步由本服务保证。
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  /**
   * 设置某个变体的库存（绝对值），并同步聚合字段。
   *
   * 分仓归属规则：写进卖家的默认仓。多仓调拨走 WarehouseService，
   * 这里只保证"新增/调整的总量"有地方落脚，不会凭空少货。
   */
  async setVariantStock(
    tx: Database,
    params: { variantId: string; stock: number; sellerId?: string },
  ): Promise<void> {
    const { variantId, stock } = params;
    if (!Number.isInteger(stock) || stock < 0) {
      throw new Error(`库存必须为非负整数（收到 ${stock}）`);
    }

    await tx
      .update(productVariants)
      .set({ stock, updatedAt: new Date() })
      .where(eq(productVariants.id, variantId));

    const sellerId = params.sellerId ?? (await this.sellerOfVariant(tx, variantId));
    if (sellerId) {
      await this.writeToDefaultWarehouse(tx, sellerId, variantId, stock);
    }
    await this.syncProductTotal(tx, variantId);
  }

  /**
   * 相对增减库存。
   *
   * `delta > 0` 回补（退款/取消），`delta < 0` 扣减。
   * 扣减时用条件更新防止扣成负数——并发下只有一个能成功。
   */
  async adjustVariantStock(
    tx: Database,
    params: { variantId: string; delta: number; sellerId?: string; warehouseId?: string | null },
  ): Promise<void> {
    const { variantId, delta } = params;
    if (!Number.isInteger(delta) || delta === 0) return;

    if (delta < 0) {
      const updated = await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} + ${delta}`, updatedAt: new Date() })
        .where(and(
          eq(productVariants.id, variantId),
          sql`${productVariants.stock} >= ${-delta}`,
        ))
        .returning({ id: productVariants.id });
      if (updated.length === 0) {
        throw new Error(`变体 ${variantId} 库存不足，无法扣减 ${-delta}`);
      }
    } else {
      await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} + ${delta}`, updatedAt: new Date() })
        .where(eq(productVariants.id, variantId));
    }

    const sellerId = params.sellerId ?? (await this.sellerOfVariant(tx, variantId));
    if (sellerId) {
      // 有明确仓库时回补到该仓；否则按默认仓处理
      if (params.warehouseId) {
        await this.upsertWarehouseStock(tx, params.warehouseId, variantId, delta);
      } else if (delta > 0) {
        await this.writeToDefaultWarehouseDelta(tx, sellerId, variantId, delta);
      }
      // 扣减且无仓库：分仓已由 WarehouseService.deduct 处理过，这里不再动
    }
    await this.syncProductTotal(tx, variantId);
  }

  /**
   * 商品总库存（products.total_stock）按变体汇总重算。
   *
   * 用重算而非增减：增量写法在"某次操作漏加/多加"之后会永久跑偏，
   * 而重算每次都收敛到真实值。
   */
  async syncProductTotal(tx: Database, variantId: string): Promise<void> {
    const rows = await tx
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);
    if (rows.length === 0) return;

    const sum = await tx
      .select({ total: sql<string>`COALESCE(SUM(${productVariants.stock}), 0)::text` })
      .from(productVariants)
      .where(eq(productVariants.productId, rows[0].productId));

    await tx
      .update(products)
      .set({ totalStock: Number(sum[0]?.total ?? 0), updatedAt: new Date() })
      .where(eq(products.id, rows[0].productId));
  }

  /**
   * 确保卖家有默认仓。多个入口需要它，抽出来避免各写一份。
   * 返回 null 表示无法创建（例如卖家不存在）。
   */
  async ensureDefaultWarehouse(tx: Database, sellerId: string): Promise<string | null> {
    const existing = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)))
      .limit(1);
    if (existing.length > 0) return existing[0].id;

    const inserted = await tx
      .insert(warehouses)
      .values({ sellerId, name: '默认仓', code: 'DEFAULT', country: 'CN', isDefault: true, priority: 100 })
      .onConflictDoNothing()
      .returning({ id: warehouses.id });
    if (inserted.length > 0) return inserted[0].id;

    const retry = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)))
      .limit(1);
    return retry[0]?.id ?? null;
  }

  /** 把某变体的库存绝对值写进默认仓（覆盖），用于"设置库存"语义 */
  private async writeToDefaultWarehouse(
    tx: Database,
    sellerId: string,
    variantId: string,
    stock: number,
  ): Promise<void> {
    const whId = await this.ensureDefaultWarehouse(tx, sellerId);
    if (!whId) return;
    await tx
      .insert(warehouseStock)
      .values({ warehouseId: whId, variantId, stock })
      .onConflictDoUpdate({
        target: [warehouseStock.warehouseId, warehouseStock.variantId],
        set: { stock, updatedAt: new Date() },
      });
  }

  /** 把增量累加到默认仓 */
  private async writeToDefaultWarehouseDelta(
    tx: Database,
    sellerId: string,
    variantId: string,
    delta: number,
  ): Promise<void> {
    const whId = await this.ensureDefaultWarehouse(tx, sellerId);
    if (!whId) return;
    await tx
      .insert(warehouseStock)
      .values({ warehouseId: whId, variantId, stock: delta })
      .onConflictDoUpdate({
        target: [warehouseStock.warehouseId, warehouseStock.variantId],
        set: { stock: sql`${warehouseStock.stock} + ${delta}`, updatedAt: new Date() },
      });
  }

  private async upsertWarehouseStock(
    tx: Database,
    warehouseId: string,
    variantId: string,
    delta: number,
  ): Promise<void> {
    await tx
      .insert(warehouseStock)
      .values({ warehouseId, variantId, stock: Math.max(0, delta) })
      .onConflictDoUpdate({
        target: [warehouseStock.warehouseId, warehouseStock.variantId],
        set: { stock: sql`${warehouseStock.stock} + ${delta}`, updatedAt: new Date() },
      });
  }

  private async sellerOfVariant(tx: Database, variantId: string): Promise<string | null> {
    const rows = await tx
      .select({ sellerId: products.sellerId })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, variantId))
      .limit(1);
    return rows[0]?.sellerId ?? null;
  }

  /**
   * 批量校验：找出聚合库存与分仓总和不一致的变体。
   * 供运维巡检与测试使用——这类漂移不会报错，只能主动查。
   */
  async findStockDrift(sellerId?: string, limit = 100): Promise<Array<{
    variantId: string; sku: string; aggregate: number; warehouses: number; diff: number;
  }>> {
    const conditions = sellerId ? [eq(products.sellerId, sellerId)] : [];
    const rows = await this.db
      .select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        aggregate: productVariants.stock,
        warehouses: sql<string>`COALESCE((
          SELECT SUM(ws.stock) FROM ${warehouseStock} ws WHERE ws.variant_id = ${productVariants.id}
        ), 0)::text`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(limit);

    return rows
      .map((r) => ({
        variantId: r.variantId,
        sku: r.sku,
        aggregate: r.aggregate,
        warehouses: Number(r.warehouses),
        diff: r.aggregate - Number(r.warehouses),
      }))
      .filter((r) => r.diff !== 0);
  }

  /** 修复漂移：以分仓为准重算聚合（分仓是真相来源） */
  async repairStockDrift(sellerId?: string): Promise<number> {
    const drifted = await this.findStockDrift(sellerId, 1000);
    if (drifted.length === 0) return 0;

    await this.db.transaction(async (tx) => {
      for (const d of drifted) {
        await tx
          .update(productVariants)
          .set({ stock: d.warehouses, updatedAt: new Date() })
          .where(eq(productVariants.id, d.variantId));
        await this.syncProductTotal(tx as unknown as typeof this.db, d.variantId);
      }
    });
    this.logger.warn(`已修复 ${drifted.length} 个变体的库存漂移（以分仓为准）`);
    return drifted.length;
  }
}
