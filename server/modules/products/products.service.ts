import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { products, categories, productVariants, reviews, stockMovements, warehouseStock, warehouses } from '../../database/schema';
import { eq, and, count, desc, asc, ilike, sql, inArray, type SQL } from 'drizzle-orm';
import type {
  Product,
  ProductListResponse,
  ProductListParams,
  CreateProductRequest,
  UpdateProductRequest,
} from '../../../shared/api.interface';
import { AuditService } from '../audit/audit.service';
import { evaluatePublishReadiness } from './product-publish-check';
import { evaluateCopyQuality, type CopyQualityReport } from './copy-quality';
import { planProductQuery } from './product-visibility';
import { buildPriceRangeCondition, normalizeSortBy, priceOrderExpression } from './product-query';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';
import type { SellerActor } from '../ai/seller-scope';
import Papa from 'papaparse';

export interface ImportFailure { row: number; reason: string; }
export interface ImportResult { successCount: number; failCount: number; failures: ImportFailure[]; }

function buildProductOwnerCondition(actor?: SellerActor): SQL | undefined {
  if (isPlatformAdmin(actor?.role)) return undefined;
  return actor?.userId ? eq(products.sellerId, actor.userId) : sql`FALSE`;
}

interface ParsedCsvRow {
  nameZh: string; nameEn: string; category: string; price: string;
  stock: string; descriptionZh: string; descriptionEn: string; images: string;
}

export interface ProductVariant {
  id: string; productId: string; sku: string; optionValues: string[];
  price: string; originalPrice?: string; stock: number; sold: number;
  image?: string; status: string;
}

export interface CreateVariantDto {
  sku: string; optionValues?: string[]; price: number; originalPrice?: number;
  stock?: number; sold?: number; image?: string; status?: 'draft' | 'active' | 'inactive';
}

export interface UpdateVariantDto {
  sku?: string; optionValues?: string[]; price?: number; originalPrice?: number;
  stock?: number; sold?: number; image?: string; status?: 'draft' | 'active' | 'inactive';
}

export interface StockChangeParams {
  variantId: string; delta: number;
  reason: 'sale' | 'purchase' | 'refund_return' | 'adjustment';
  referenceId?: string; note?: string; createdBy?: string;
}

type ProductWithCategory = typeof products.$inferSelect & {
  categoryNameZh: string | null; categoryNameEn: string | null;
  avgRating: number | null; reviewCount: number | null;
};

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly auditService: AuditService,
  ) {}

  // ── DTO helpers ──────────────────────────────

  private variantToDto(v: typeof productVariants.$inferSelect): ProductVariant {
    return {
      id: v.id, productId: v.productId, sku: v.sku,
      optionValues: v.optionValues ?? [],
      price: String(v.price),
      originalPrice: v.originalPrice != null ? String(v.originalPrice) : undefined,
      stock: v.stock, sold: v.sold, image: v.image ?? undefined, status: v.status,
    };
  }

  private async toDto(
    row: ProductWithCategory,
    options?: { onlyActiveVariants?: boolean },
  ): Promise<Product> {
    const variants = await this.fetchVariantsForProduct(row.id, options?.onlyActiveVariants === true);
    const activeVariants = variants.filter((v) => v.status === 'active');
    const prices = activeVariants.map((v) => Number(v.price));
    const minPrice = prices.length > 0 ? Math.min(...prices).toString() : '0';
    return {
      id: row.id,
      titleZh: row.titleZh, titleEn: row.titleEn,
      descZh: row.descZh ?? '', descEn: row.descEn ?? '',
      longDescZh: row.longDescZh ?? '', longDescEn: row.longDescEn ?? '',
      categoryId: row.categoryId ?? undefined,
      categoryNameZh: row.categoryNameZh ?? undefined, categoryNameEn: row.categoryNameEn ?? undefined,
      sellerId: row.sellerId, minPrice, maxPrice: activeVariants[0]?.originalPrice ?? minPrice,
      totalStock: row.totalStock, totalSold: row.totalSold,
      status: row.status as 'draft' | 'active' | 'inactive',
      coverImage: row.coverImage ?? undefined, images: row.images ?? [],
      optionNames: row.optionNames ?? [], seoKeywordsZh: row.seoKeywordsZh ?? '', seoKeywordsEn: row.seoKeywordsEn ?? '',
      bulletPointsZh: row.bulletPointsZh ?? [], bulletPointsEn: row.bulletPointsEn ?? [],
      weight: row.weight ? String(row.weight) : undefined,
      hsCode: row.hsCode ?? undefined,
      originCountry: row.originCountry ?? undefined,
      customsNameEn: row.customsNameEn ?? undefined,
      customsMaterialEn: row.customsMaterialEn ?? undefined,
      avgRating: row.avgRating != null ? Number(row.avgRating) : undefined,
      reviewCount: row.reviewCount != null ? Number(row.reviewCount) : undefined,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      variants,
    };
  }

  // ── Query helpers ────────────────────────────

  private buildWhere(
    params: ProductListParams,
    scope?: { sellerId?: string; role?: string },
  ) {
    const conditions: SQL[] = [];
    const plan = planProductQuery(params, scope);
    if (plan.mine && plan.sellerId) {
      conditions.push(eq(products.sellerId, plan.sellerId));
    }
    if (plan.status !== undefined) {
      conditions.push(eq(products.status, plan.status));
    }
    if (params.categoryId) conditions.push(eq(products.categoryId, params.categoryId));
    if (params.keyword) {
      const escaped = params.keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      conditions.push(sql`(${ilike(products.titleZh, `%${escaped}%`)} OR ${ilike(products.titleEn, `%${escaped}%`)})`);
    }
    const priceCondition = buildPriceRangeCondition({
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
    });
    if (priceCondition) conditions.push(priceCondition);
    return conditions;
  }

  private getOrderBy(sortBy: ProductListParams['sortBy']) {
    switch (normalizeSortBy(sortBy)) {
      case 'sold_desc': return [desc(products.totalSold)];
      case 'price_asc': return [priceOrderExpression('asc')];
      case 'price_desc': return [priceOrderExpression('desc')];
      case 'newest': default: return [desc(products.createdAt)];
    }
  }

  // ── Variant query ────────────────────────────

  private async fetchVariantsForProduct(productId: string, onlyActive = false): Promise<ProductVariant[]> {
    const conditions: SQL[] = [eq(productVariants.productId, productId)];
    if (onlyActive) conditions.push(eq(productVariants.status, 'active'));
    const rows = await this.db
      .select()
      .from(productVariants)
      .where(and(...conditions))
      .orderBy(asc(productVariants.createdAt));
    return rows.map((variant) => this.variantToDto(variant));
  }

  private async fetchVariantsForProducts(
    productIds: string[],
    onlyActive = false,
  ): Promise<Map<string, ProductVariant[]>> {
    if (productIds.length === 0) return new Map();
    const conditions: SQL[] = [inArray(productVariants.productId, productIds)];
    if (onlyActive) conditions.push(eq(productVariants.status, 'active'));
    const rows = await this.db.select().from(productVariants)
      .where(and(...conditions))
      .orderBy(asc(productVariants.createdAt));
    const map = new Map<string, ProductVariant[]>();
    for (const v of rows) {
      const list = map.get(v.productId) ?? [];
      list.push(this.variantToDto(v));
      map.set(v.productId, list);
    }
    return map;
  }

  // ── List products ────────────────────────────

  async findAll(
    params: ProductListParams,
    scope?: { sellerId?: string; role?: string },
  ): Promise<ProductListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const conditions = this.buildWhere(params, scope);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const orderBy = this.getOrderBy(params.sortBy);

    const baseQuery = this.db.select({
      ...(products as any),
      categoryNameZh: categories.nameZh,
      categoryNameEn: categories.nameEn,
    }).from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(whereClause)
      .orderBy(...orderBy, desc(products.id));

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(products).where(whereClause),
      baseQuery.limit(pageSize).offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const productRows = rows as unknown as ProductWithCategory[];
    const privateList = params.scope === 'mine'
      && (scope?.role === 'admin'
        || (scope?.role === 'seller' && Boolean(scope.sellerId)));
    const publicList = !privateList;
    const variantsMap = await this.fetchVariantsForProducts(
      productRows.map((r: any) => r.id),
      publicList,
    );

    const items = productRows.map((row) => {
      const variants = variantsMap.get(row.id) ?? [];
      const activeVariants = variants.filter((v) => v.status === 'active');
      const prices = activeVariants.map((v) => Number(v.price));
      const minPrice = prices.length > 0 ? Math.min(...prices).toString() : '0';
      return {
        id: row.id,
        titleZh: row.titleZh, titleEn: row.titleEn,
        descZh: row.descZh ?? '', descEn: row.descEn ?? '',
        longDescZh: row.longDescZh ?? '', longDescEn: row.longDescEn ?? '',
        categoryId: row.categoryId ?? undefined,
        categoryNameZh: row.categoryNameZh ?? undefined, categoryNameEn: row.categoryNameEn ?? undefined,
        sellerId: row.sellerId, minPrice, maxPrice: activeVariants[0]?.originalPrice ?? minPrice,
        totalStock: row.totalStock, totalSold: row.totalSold,
        status: row.status as 'draft' | 'active' | 'inactive',
        coverImage: row.coverImage ?? undefined, images: row.images ?? [],
        optionNames: row.optionNames ?? [], seoKeywordsZh: row.seoKeywordsZh ?? '', seoKeywordsEn: row.seoKeywordsEn ?? '',
        bulletPointsZh: row.bulletPointsZh ?? [], bulletPointsEn: row.bulletPointsEn ?? [],
        weight: row.weight ? String(row.weight) : undefined,
      hsCode: row.hsCode ?? undefined,
      originCountry: row.originCountry ?? undefined,
      customsNameEn: row.customsNameEn ?? undefined,
      customsMaterialEn: row.customsMaterialEn ?? undefined,
        avgRating: row.avgRating != null ? Number(row.avgRating) : undefined,
        reviewCount: row.reviewCount != null ? Number(row.reviewCount) : undefined,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        variants,
      };
    });

    return { items, total, page, pageSize };
  }

  /**
   * 商品详情。默认只返回上架商品（公开接口防草稿泄露）；
   * 卖家工作台与内部服务显式传 includeUnpublished。
   */
  async findOne(
    id: string,
    options?: { includeUnpublished?: boolean; actor?: SellerActor },
  ): Promise<Product> {
    const rows = await this.db.select({
      ...(products as any),
      categoryNameZh: categories.nameZh,
      categoryNameEn: categories.nameEn,
    }).from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.id, id)).limit(1);

    if (rows.length === 0) throw new NotFoundException('商品不存在');
    const row = rows[0] as unknown as ProductWithCategory;
    let includeUnpublished = options?.includeUnpublished === true;
    const privateActor = options?.actor && ['seller', 'admin'].includes(options.actor.role ?? '');
    if (includeUnpublished && privateActor && options.actor?.role !== 'admin' && row.sellerId !== options.actor?.userId) {
      if (row.status !== 'active') throw new ForbiddenException('无权查看该商品');
      includeUnpublished = false;
    }
    if (!includeUnpublished && row.status !== 'active') {
      throw new NotFoundException('商品不存在');
    }

    const result = await this.toDto(row, {
      onlyActiveVariants: !includeUnpublished,
    });

    const reviewStats = await this.db.select({
      avgRating: sql<number>`round(avg(${reviews.rating})::numeric, 1)`,
      reviewCount: count(reviews.id),
    }).from(reviews).where(eq(reviews.productId, id));

    if (reviewStats.length > 0) {
      result.avgRating = reviewStats[0].avgRating != null ? Number(reviewStats[0].avgRating) : 0;
      result.reviewCount = Number(reviewStats[0].reviewCount);
    } else {
      result.avgRating = 0;
      result.reviewCount = 0;
    }
    return result;
  }

  /**
   * 按 ID 列表批量返回完整商品（保持传入顺序；一次查询商品 + 一次查询变体）。
   * 供店铺楼层等聚合场景复用，避免逐个 findOne 造成 N+1。
   */
  async findByIds(ids: string[], onlyActive = true): Promise<Product[]> {
    if (ids.length === 0) return [];

    const rows = await this.db.select({
      ...(products as any),
      categoryNameZh: categories.nameZh,
      categoryNameEn: categories.nameEn,
    }).from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(inArray(products.id, ids));

    const productRows = (rows as unknown as ProductWithCategory[])
      .filter((row) => !onlyActive || row.status === 'active');
    const variantsMap = await this.fetchVariantsForProducts(
      productRows.map((row) => row.id),
      onlyActive,
    );

    const byId = new Map(productRows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id)).filter((row): row is ProductWithCategory => Boolean(row));

    return ordered.map((row) => {
      const variants = variantsMap.get(row.id) ?? [];
      const activeVariants = variants.filter((v) => v.status === 'active');
      const prices = activeVariants.map((v) => Number(v.price));
      const minPrice = prices.length > 0 ? Math.min(...prices).toString() : '0';
      return {
        id: row.id,
        titleZh: row.titleZh, titleEn: row.titleEn,
        descZh: row.descZh ?? '', descEn: row.descEn ?? '',
        longDescZh: row.longDescZh ?? '', longDescEn: row.longDescEn ?? '',
        categoryId: row.categoryId ?? undefined,
        categoryNameZh: row.categoryNameZh ?? undefined, categoryNameEn: row.categoryNameEn ?? undefined,
        sellerId: row.sellerId, minPrice, maxPrice: activeVariants[0]?.originalPrice ?? minPrice,
        totalStock: row.totalStock, totalSold: row.totalSold,
        status: row.status as 'draft' | 'active' | 'inactive',
        coverImage: row.coverImage ?? undefined, images: row.images ?? [],
        optionNames: row.optionNames ?? [], seoKeywordsZh: row.seoKeywordsZh ?? '', seoKeywordsEn: row.seoKeywordsEn ?? '',
        bulletPointsZh: row.bulletPointsZh ?? [], bulletPointsEn: row.bulletPointsEn ?? [],
        weight: row.weight ? String(row.weight) : undefined,
      hsCode: row.hsCode ?? undefined,
      originCountry: row.originCountry ?? undefined,
      customsNameEn: row.customsNameEn ?? undefined,
      customsMaterialEn: row.customsMaterialEn ?? undefined,
        avgRating: row.avgRating != null ? Number(row.avgRating) : 0,
        reviewCount: row.reviewCount != null ? Number(row.reviewCount) : 0,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        variants,
      };
    });
  }

  async getFeatured(): Promise<Array<Product>> {
    const rows = await this.db.select({
      ...(products as any),
      categoryNameZh: categories.nameZh,
      categoryNameEn: categories.nameEn,
    }).from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.status, 'active'))
      .orderBy(desc(products.totalSold), desc(products.createdAt)).limit(8);

    const productRows = rows as unknown as ProductWithCategory[];
    const variantsMap = await this.fetchVariantsForProducts(
      productRows.map((r: any) => r.id),
      true,
    );

    return productRows.map((row) => {
      const variants = variantsMap.get(row.id) ?? [];
      const activeVariants = variants.filter((v) => v.status === 'active');
      const prices = activeVariants.map((v) => Number(v.price));
      const minPrice = prices.length > 0 ? Math.min(...prices).toString() : '0';
      return {
        id: row.id,
        titleZh: row.titleZh, titleEn: row.titleEn,
        descZh: row.descZh ?? '', descEn: row.descEn ?? '',
        longDescZh: row.longDescZh ?? '', longDescEn: row.longDescEn ?? '',
        categoryId: row.categoryId ?? undefined,
        categoryNameZh: row.categoryNameZh ?? undefined, categoryNameEn: row.categoryNameEn ?? undefined,
        sellerId: row.sellerId, minPrice, maxPrice: activeVariants[0]?.originalPrice ?? minPrice,
        totalStock: row.totalStock, totalSold: row.totalSold,
        status: row.status as 'draft' | 'active' | 'inactive',
        coverImage: row.coverImage ?? undefined, images: row.images ?? [],
        optionNames: row.optionNames ?? [], seoKeywordsZh: row.seoKeywordsZh ?? '', seoKeywordsEn: row.seoKeywordsEn ?? '',
        bulletPointsZh: row.bulletPointsZh ?? [], bulletPointsEn: row.bulletPointsEn ?? [],
        weight: row.weight ? String(row.weight) : undefined,
      hsCode: row.hsCode ?? undefined,
      originCountry: row.originCountry ?? undefined,
      customsNameEn: row.customsNameEn ?? undefined,
      customsMaterialEn: row.customsMaterialEn ?? undefined,
        avgRating: row.avgRating != null ? Number(row.avgRating) : 0,
        reviewCount: row.reviewCount != null ? Number(row.reviewCount) : 0,
                createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        variants,
      };
    });
  }

  // ── Create product ───────────────────────────

  async create(
    input: CreateProductRequest & { variants?: CreateVariantDto[] },
    userId: string,
  ): Promise<Product> {
    try {
      this.validateProductImages(input.coverImage, input.images);
      const result = await this.db.transaction(async (tx) => {
        const [productRow] = await tx.insert(products).values({
          sellerId: userId,
          titleZh: input.titleZh,
          titleEn: input.titleEn,
          descZh: input.descZh ?? undefined,
          descEn: input.descEn ?? undefined,
          longDescZh: input.longDescZh ?? undefined,
          longDescEn: input.longDescEn ?? undefined,
          categoryId: input.categoryId ?? null,
          status: input.status ?? 'draft',
          coverImage: input.coverImage ?? undefined,
          images: input.images ?? [],
          seoKeywordsZh: input.seoKeywordsZh ?? undefined,
          seoKeywordsEn: input.seoKeywordsEn ?? undefined,
          bulletPointsZh: input.bulletPointsZh ?? [],
          bulletPointsEn: input.bulletPointsEn ?? [],
          weight: input.weight !== undefined ? String(input.weight) : null,
          // 跨境清关字段：HS 编码与报关品名，报关单的数据来源
          hsCode: input.hsCode?.trim() || null,
          originCountry: input.originCountry?.trim().toUpperCase() || null,
          customsNameEn: input.customsNameEn?.trim() || null,
          customsMaterialEn: input.customsMaterialEn?.trim() || null,
          optionNames: input.variants?.length ? this.deriveOptionNames(input.variants) : [],
          totalStock: 0,
          totalSold: 0,
          updatedBy: userId,
        }).returning();

        if (!productRow) throw new BadRequestException('创建商品失败');

        if (input.variants?.length) {
          const variantRows = await tx.insert(productVariants).values(
            input.variants.map((v) => ({
              productId: productRow.id,
              sku: v.sku,
              optionValues: v.optionValues ?? [],
              price: String(v.price),
              originalPrice: v.originalPrice !== undefined ? String(v.originalPrice) : null,
              stock: v.stock ?? 0,
              sold: v.sold ?? 0,
              image: v.image ?? null,
              status: v.status ?? 'active',
            })),
          ).returning();

          const totalStock = variantRows.reduce((sum, v) => sum + v.stock, 0);
          await tx.update(products).set({ totalStock }).where(eq(products.id, productRow.id));

          // 分仓镜像：把初始库存落到默认仓，否则商品无法下单
          await this.mirrorStockToDefaultWarehouse(tx, userId, variantRows.map((v) => ({
            id: v.id, stock: v.stock,
          })));
        } else {
          // 界面创建路径（只填价格/库存，不带变体）：自动生成默认变体，
          // 与 CSV 导入口径一致，确保商品可加购、可下单。
          const defaultSku = input.sku?.trim() || `SKU-${(productRow.id as string).slice(0, 8).toUpperCase()}`;
          const stock = input.stock ?? 0;
          const [defaultVariant] = await tx.insert(productVariants).values({
            productId: productRow.id,
            sku: defaultSku,
            optionValues: [],
            price: String(input.price),
            originalPrice: input.originalPrice !== undefined ? String(input.originalPrice) : null,
            stock,
            status: 'active',
          }).returning();
          await tx.update(products).set({ totalStock: stock }).where(eq(products.id, productRow.id));

          // 同样镜像到默认仓，保证商品可下单
          await this.mirrorStockToDefaultWarehouse(tx, userId, [{ id: defaultVariant.id, stock }]);
        }

        return productRow;
      });

      // 上架门禁同样覆盖「创建即为 active」路径（此前只在校验更新时生效）
      const created = await this.findOne(result.id, { includeUnpublished: true });
      if (created.status === 'active') {
        const readiness = evaluatePublishReadiness(created);
        if (!readiness.ready) {
          const missing = readiness.checks.filter((check) => !check.ok).map((check) => check.label).join('；');
          // 创建失败即回滚商品，避免留下未通过门禁的在售商品
          await this.db.delete(products).where(eq(products.id, result.id));
          throw new BadRequestException(`商品未满足上架条件：${missing}`);
        }
      }
      return created;
    } catch (error) {
      this.logger.error('创建商品失败', error);
      throw error;
    }
  }

  private deriveOptionNames(variants: CreateVariantDto[]): string[] {
    if (!variants[0]?.optionValues?.length) return [];
    return Array.from({ length: variants[0].optionValues.length }, (_, i) => `规格${i + 1}`);
  }

  // ── Update product ───────────────────────────

  /**
   * 把变体库存镜像到卖家的默认仓。
   *
   * 为什么必须做：分仓库存是下单时的真相来源。商品创建只写了聚合字段
   * （product_variants.stock），没有 warehouse_stock 记录，下单会因
   * "找不到仓库库存"直接 409——这是 E2E 抓到的真实回归。
   *
   * 只在默认仓尚无该变体记录时写入，避免覆盖运营已经调过的分仓数据。
   */
  private async mirrorStockToDefaultWarehouse(
    tx: typeof this.db,
    sellerId: string,
    variants: Array<{ id: string; stock: number }>,
  ): Promise<void> {
    if (!sellerId || variants.length === 0) return;
    let whRows = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)))
      .limit(1);

    // 自动兜底：卖家还没有默认仓时立刻创建。
    // 不能依赖启动钩子——它在进程启动 15 秒后才跑，而商品可能在之前就创建了，
    // 结果就是"商品建好但无法下单"。
    if (whRows.length === 0) {
      whRows = await tx
        .insert(warehouses)
        .values({
          sellerId,
          name: '默认仓',
          code: 'DEFAULT',
          country: 'CN',
          isDefault: true,
          priority: 100,
        })
        .onConflictDoNothing()
        .returning({ id: warehouses.id });

      // 并发下另一个请求可能已插入：再查一次
      if (whRows.length === 0) {
        whRows = await tx
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.sellerId, sellerId), eq(warehouses.isDefault, true)))
          .limit(1);
      }
    }
    if (whRows.length === 0) return;

    for (const v of variants) {
      if (v.stock <= 0) continue;
      await tx
        .insert(warehouseStock)
        .values({ warehouseId: whRows[0].id, variantId: v.id, stock: v.stock })
        .onConflictDoNothing();
    }
  }

  async update(
    id: string,
    input: UpdateProductRequest,
    userId: string,
    auditMeta?: { role?: string; ip?: string },
  ): Promise<Product> {
    if (!isPlatformAdmin(auditMeta?.role)) {
      const ownerRows = await this.db
        .select({ sellerId: products.sellerId })
        .from(products)
        .where(eq(products.id, id));
      if (ownerRows.length === 0) throw new NotFoundException('商品不存在');
      if (ownerRows[0].sellerId !== userId) {
        throw new ForbiddenException('无权修改该商品');
      }
    }

    const existingRows = await this.db.select({ status: products.status }).from(products).where(eq(products.id, id));
    if (existingRows.length === 0) throw new NotFoundException('商品不存在');
    const oldStatus = existingRows[0].status as string;

    if (input.coverImage !== undefined || input.images !== undefined) {
      this.validateProductImages(input.coverImage ?? undefined, input.images ?? undefined);
    }

    const patch: Record<string, unknown> = {};
    if (input.titleZh !== undefined) patch.titleZh = input.titleZh;
    if (input.titleEn !== undefined) patch.titleEn = input.titleEn;
    if (input.descZh !== undefined) patch.descZh = input.descZh;
    if (input.descEn !== undefined) patch.descEn = input.descEn;
    if (input.longDescZh !== undefined) patch.longDescZh = input.longDescZh;
    if (input.longDescEn !== undefined) patch.longDescEn = input.longDescEn;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.status !== undefined) patch.status = input.status;
    if (input.coverImage !== undefined) patch.coverImage = input.coverImage;
    if (input.images !== undefined) patch.images = input.images;
    if (input.seoKeywordsZh !== undefined) patch.seoKeywordsZh = input.seoKeywordsZh;
    if (input.seoKeywordsEn !== undefined) patch.seoKeywordsEn = input.seoKeywordsEn;
    if (input.bulletPointsZh !== undefined) patch.bulletPointsZh = input.bulletPointsZh;
    if (input.bulletPointsEn !== undefined) patch.bulletPointsEn = input.bulletPointsEn;
    if (input.weight !== undefined) patch.weight = String(input.weight);
    // 清关字段：允许显式清空（传空串即置 null），否则卖家无法纠正填错的编码
    if (input.hsCode !== undefined) patch.hsCode = input.hsCode.trim() || null;
    if (input.originCountry !== undefined) patch.originCountry = input.originCountry.trim().toUpperCase() || null;
    if (input.customsNameEn !== undefined) patch.customsNameEn = input.customsNameEn.trim() || null;
    if (input.customsMaterialEn !== undefined) patch.customsMaterialEn = input.customsMaterialEn.trim() || null;
    // 内部字段：仅 backfillCopy 使用，外部请求经 DTO 白名单已剔除
    const copySource = (input as { copySource?: unknown }).copySource;
    if (copySource === 'ai' || copySource === 'reviewed' || copySource === 'manual') {
      patch.copySource = copySource;
    }

    // 价格/库存同步（界面编辑路径）：
    // - 无变体 → 用新价格/库存补建默认变体（修复历史商品）
    // - 唯一变体 → 同步该变体并重算聚合库存
    // - 多变体 → 忽略（由变体体系/批量导入管理）
    const priceChanged = input.price !== undefined || input.originalPrice !== undefined || input.stock !== undefined;
    if (priceChanged) {
      const variantRows = await this.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id));

      if (variantRows.length === 0 && input.price !== undefined) {
        await this.db.insert(productVariants).values({
          productId: id,
          sku: `SKU-${id.slice(0, 8).toUpperCase()}`,
          optionValues: [],
          price: String(input.price),
          originalPrice: input.originalPrice !== undefined ? String(input.originalPrice) : null,
          stock: input.stock ?? 0,
          status: 'active',
        });
        patch.totalStock = input.stock ?? 0;
      } else if (variantRows.length === 1) {
        const only = variantRows[0];
        const variantPatch: Partial<typeof productVariants.$inferInsert> = { updatedAt: new Date() };
        if (input.price !== undefined) variantPatch.price = String(input.price);
        if (input.originalPrice !== undefined) variantPatch.originalPrice = String(input.originalPrice);
        if (input.stock !== undefined) variantPatch.stock = input.stock;
        await this.db.update(productVariants).set(variantPatch).where(eq(productVariants.id, only.id));
        if (input.stock !== undefined) {
          patch.totalStock = input.stock;
        }
      }
    }

    // 上架门禁：draft/inactive → active 必须先通过完整性校验（fail-closed）
    if (input.status === 'active' && oldStatus !== 'active') {
      const current = await this.findOne(id, { includeUnpublished: true });
      const readiness = evaluatePublishReadiness(current);
      if (!readiness.ready) {
        const missing = readiness.checks.filter((check) => !check.ok).map((check) => check.label).join('；');
        throw new BadRequestException(`商品未满足上架条件：${missing}`);
      }
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      patch.updatedBy = userId;
      const updated = await this.db.update(products).set(patch).where(eq(products.id, id)).returning({ id: products.id });
      if (updated.length === 0) throw new NotFoundException('商品不存在');
    }

    const result = await this.findOne(id, { includeUnpublished: true });

    if (input.status !== undefined && input.status !== oldStatus) {
      try {
        void this.auditService.log({
          action: 'product.toggle_status', entity: 'product', entityId: id,
          before: { oldStatus }, after: { newStatus: input.status },
          userId, role: auditMeta?.role, ip: auditMeta?.ip,
        }).catch(() => {});
      } catch { /* noop */ }
    }

    return result;
  }

  // ── Delete product ───────────────────────────

  /**
   * 批量上架体检：扫描已有 active 商品（历史遗留可能不完整），
   * 返回不合规商品与缺失项。只读，不自动改状态——由卖家决定下架或补齐。
   */
  async auditActiveProducts(
    limit = 200,
    actor?: SellerActor,
  ): Promise<Array<{
    id: string;
    title: string;
    missing: string[];
  }>> {
    const rows = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(
        eq(products.status, 'active'),
        buildProductOwnerCondition(actor),
      ))
      .orderBy(desc(products.createdAt))
      .limit(Math.max(1, Math.min(1000, Math.round(limit))));

    const results: Array<{ id: string; title: string; missing: string[] }> = [];
    for (const row of rows) {
      const product = await this.findOne(row.id, { includeUnpublished: true });
      const readiness = evaluatePublishReadiness(product);
      if (!readiness.ready) {
        results.push({
          id: product.id,
          title: product.titleZh || product.titleEn,
          missing: readiness.checks.filter((check) => !check.ok).map((check) => check.label),
        });
      }
    }
    return results;
  }

  /**
   * 批量补全：对信息不完整的在售/草稿商品调用 AI 文案生成并写回。
   * 只补「文案类」缺失（描述/卖点/SEO/英文标题），图片与库存仍需人工处理。
   * 返回逐条结果，失败不抛出（单品失败不影响其余）。
   */
  async backfillCopy(
    ids: string[],
    actor: { userId: string; role?: string },
    generate: (input: { productNameZh: string; category?: string }) => Promise<{
      titleEn?: string;
      bulletPoints?: string[];
      longDescription?: string;
      seoKeywords?: string;
    }>,
    limit = 20,
  ): Promise<Array<{ id: string; title: string; ok: boolean; filled: string[]; message?: string }>> {
    const targets = ids.slice(0, Math.max(1, Math.min(50, limit)));
    const results: Array<{ id: string; title: string; ok: boolean; filled: string[]; message?: string }> = [];

    for (const id of targets) {
      try {
        await this.assertProductOwner(id, actor);
        const product = await this.findOne(id, { includeUnpublished: true });
        const filled: string[] = [];

        const copy = await generate({
          productNameZh: product.titleZh || product.titleEn,
          category: product.categoryNameZh,
        });

        const patch: Record<string, unknown> = {};
        if (copy.titleEn && !product.titleEn.trim()) {
          patch.titleEn = copy.titleEn.slice(0, 200);
          filled.push('英文标题');
        }
        if (copy.longDescription && !product.longDescEn.trim()) {
          patch.longDescEn = copy.longDescription;
          filled.push('长描述');
        }
        if (copy.bulletPoints?.length && product.bulletPointsEn.length === 0) {
          patch.bulletPointsEn = copy.bulletPoints;
          filled.push('卖点');
        }
        if (copy.seoKeywords && !product.seoKeywordsEn.trim()) {
          patch.seoKeywordsEn = copy.seoKeywords;
          filled.push('SEO 关键词');
        }

        if (Object.keys(patch).length > 0) {
          // 标记文案来源为 AI，进入"待人工复核"队列
          patch.copySource = 'ai';
          await this.update(id, patch, actor.userId, { role: actor.role });
        }

        results.push({
          id,
          title: product.titleZh || product.titleEn,
          ok: true,
          filled,
          message: filled.length === 0 ? '无需补全' : undefined,
        });
      } catch (error: unknown) {
        results.push({
          id,
          title: id.slice(0, 8),
          ok: false,
          filled: [],
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /** AI 文案质量抽检：对 copy_source=ai 的商品做启发式评估 */
  async auditAiCopy(
    limit = 100,
    actor?: SellerActor,
  ): Promise<{
    total: number;
    needsReview: number;
    averageScore: number;
    items: CopyQualityReport[];
  }> {
    const rows = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(
        eq(products.copySource, 'ai'),
        buildProductOwnerCondition(actor),
      ))
      .orderBy(desc(products.updatedAt))
      .limit(Math.max(1, Math.min(500, Math.round(limit))));

    const items: CopyQualityReport[] = [];
    for (const row of rows) {
      items.push(evaluateCopyQuality(await this.findOne(row.id, { includeUnpublished: true })));
    }
    const needsReview = items.filter((item) => item.needsReview).length;
    const averageScore = items.length === 0
      ? 100
      : Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length);

    items.sort((a, b) => a.score - b.score);
    return { total: items.length, needsReview, averageScore, items };
  }

  /** 人工复核通过：copy_source ai → reviewed */
  async markCopyReviewed(
    id: string,
    actorOrId: SellerActor | string,
  ): Promise<{ id: string }> {
    const actor: SellerActor = typeof actorOrId === 'string'
      ? { userId: actorOrId, role: 'seller' }
      : actorOrId;
    await this.assertProductOwner(id, actor);
    await this.db
      .update(products)
      .set({ copySource: 'reviewed', updatedAt: new Date(), updatedBy: actor.userId })
      .where(eq(products.id, id));
    return { id };
  }

  async remove(id: string, actor?: { userId?: string; role?: string }): Promise<{ id: string }> {
    if (actor && !isPlatformAdmin(actor.role)) {
      const ownerRows = await this.db
        .select({ sellerId: products.sellerId })
        .from(products)
        .where(eq(products.id, id));
      if (ownerRows.length === 0) throw new NotFoundException('商品不存在');
      if (ownerRows[0].sellerId !== actor.userId) {
        throw new ForbiddenException('无权删除该商品');
      }
    }
    const deleted = await this.db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (deleted.length === 0) throw new NotFoundException('商品不存在');
    return { id };
  }

  // ── Variant CRUD ─────────────────────────────

  private async assertProductOwner(
    productId: string,
    actor?: SellerActor,
  ): Promise<void> {
    if (!actor || (!isPlatformAdmin(actor.role) && !actor.userId)) {
      throw new ForbiddenException('无权访问该商品');
    }
    const rows = await this.db
      .select({ sellerId: products.sellerId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('商品不存在');
    if (isPlatformAdmin(actor.role)) return;
    if (rows[0].sellerId !== actor.userId) throw new ForbiddenException('无权修改该商品');
  }

  async createVariant(
    productId: string,
    dto: CreateVariantDto,
    actor?: { userId?: string; role?: string },
  ): Promise<ProductVariant> {
    await this.assertProductOwner(productId, actor);
    const productRows = await this.db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
    if (productRows.length === 0) throw new NotFoundException('商品不存在');

    const existingSku = await this.db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, dto.sku)).limit(1);
    if (existingSku.length > 0) throw new BadRequestException(`SKU "${dto.sku}" 已存在`);

    const result = await this.db.transaction(async (tx) => {
      const [variant] = await tx.insert(productVariants).values({
        productId, sku: dto.sku, optionValues: dto.optionValues ?? [],
        price: String(dto.price),
        originalPrice: dto.originalPrice !== undefined ? String(dto.originalPrice) : null,
        stock: dto.stock ?? 0, sold: dto.sold ?? 0, image: dto.image ?? null,
        status: dto.status ?? 'active',
      }).returning();

      await tx.update(products)
        .set({ totalStock: sql`${products.totalStock} + ${dto.stock ?? 0}` })
        .where(eq(products.id, productId));

      return variant;
    });

    return this.variantToDto(result);
  }

  async updateVariant(
    variantId: string,
    dto: UpdateVariantDto,
    actor?: { userId?: string; role?: string },
  ): Promise<ProductVariant> {
    const existingRows = await this.db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
    if (existingRows.length === 0) throw new NotFoundException('变体不存在');
    const existing = existingRows[0];
    await this.assertProductOwner(existing.productId, actor);

    if (dto.sku && dto.sku !== existing.sku) {
      const dup = await this.db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, dto.sku)).limit(1);
      if (dup.length > 0) throw new BadRequestException(`SKU "${dto.sku}" 已存在`);
    }

    const patch: Record<string, unknown> = {};
    if (dto.sku !== undefined) patch.sku = dto.sku;
    if (dto.optionValues !== undefined) patch.optionValues = dto.optionValues;
    if (dto.price !== undefined) patch.price = String(dto.price);
    if (dto.originalPrice !== undefined) patch.originalPrice = String(dto.originalPrice);
    if (dto.stock !== undefined) patch.stock = dto.stock;
    if (dto.sold !== undefined) patch.sold = dto.sold;
    if (dto.image !== undefined) patch.image = dto.image;
    if (dto.status !== undefined) patch.status = dto.status;
    patch.updatedAt = new Date();

    if (dto.stock !== undefined && dto.stock !== existing.stock) {
      const diff = dto.stock - existing.stock;
      await this.db.transaction(async (tx) => {
        await tx.update(productVariants).set(patch).where(eq(productVariants.id, variantId));
        await tx.update(products).set({ totalStock: sql`${products.totalStock} + ${diff}` }).where(eq(products.id, existing.productId));
      });
    } else {
      await this.db.update(productVariants).set(patch).where(eq(productVariants.id, variantId));
    }

    const updated = await this.db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
    return this.variantToDto(updated[0]);
  }

  async deleteVariant(
    variantId: string,
    actor?: { userId?: string; role?: string },
  ): Promise<{ id: string }> {
    const existingRows = await this.db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
    if (existingRows.length === 0) throw new NotFoundException('变体不存在');
    const existing = existingRows[0];
    await this.assertProductOwner(existing.productId, actor);

    await this.db.transaction(async (tx) => {
      await tx.delete(productVariants).where(eq(productVariants.id, variantId));
      await tx.update(products)
        .set({ totalStock: sql`${products.totalStock} - ${existing.stock}` })
        .where(eq(products.id, existing.productId));
    });

    return { id: variantId };
  }

  async listVariants(productId: string, actor?: SellerActor): Promise<ProductVariant[]> {
    const productRows = await this.db
      .select({ id: products.id, sellerId: products.sellerId, status: products.status })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (productRows.length === 0) throw new NotFoundException('商品不存在');

    const product = productRows[0];
    const privateActor = actor && ['seller', 'admin'].includes(actor.role ?? '');
    if (privateActor) {
      await this.assertProductOwner(productId, actor);
    } else if (product.status !== 'active') {
      throw new NotFoundException('商品不存在');
    }

    return this.fetchVariantsForProduct(productId, !privateActor);
  }

  async getVariant(variantId: string): Promise<ProductVariant & { product?: Product }> {
    const rows = await this.db.select({
      ...(productVariants as any),
      productTitleZh: products.titleZh,
      productTitleEn: products.titleEn,
      productStatus: products.status,
    }).from(productVariants)
      .leftJoin(products, eq(productVariants.productId, products.id))
      .where(eq(productVariants.id, variantId)).limit(1);

    if (rows.length === 0) throw new NotFoundException('变体不存在');
    const row = rows[0] as any;
    return {
      ...this.variantToDto(row as any),
      product: {
        id: row.productId, titleZh: row.productTitleZh,
        titleEn: row.productTitleEn, status: row.productStatus,
      } as any,
    };
  }

  async getPublishReadiness(id: string, actor?: SellerActor) {
    await this.assertProductOwner(id, actor);
    const product = await this.findOne(id, { includeUnpublished: true });
    return evaluatePublishReadiness(product);
  }

  // ── Stock management ─────────────────────────

  async changeStock(params: StockChangeParams): Promise<ProductVariant> {
    const { variantId, delta, reason, referenceId, note, createdBy } = params;

    const existingRows = await this.db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
    if (existingRows.length === 0) throw new NotFoundException('变体不存在');
    const existing = existingRows[0];

    const newStock = existing.stock + delta;
    if (newStock < 0) throw new BadRequestException('库存不足，无法扣减');

    const result = await this.db.transaction(async (tx) => {
      await tx.insert(stockMovements).values({
        variantId, quantity: delta, reason,
        referenceId: referenceId ?? null, note: note ?? null, createdBy: createdBy ?? null,
      });

      const variantPatch: Record<string, unknown> = { stock: newStock, updatedAt: new Date() };
      if (reason === 'sale' && delta < 0) variantPatch.sold = existing.sold + Math.abs(delta);
      else if (reason === 'refund_return' && delta > 0) variantPatch.sold = Math.max(0, existing.sold - delta);

      await tx.update(productVariants).set(variantPatch).where(eq(productVariants.id, variantId));

      const productPatch: Record<string, unknown> = { totalStock: sql`${products.totalStock} + ${delta}` };
      if (reason === 'sale' && delta < 0) productPatch.totalSold = sql`${products.totalSold} + ${Math.abs(delta)}`;
      else if (reason === 'refund_return' && delta > 0) productPatch.totalSold = sql`GREATEST(0, ${products.totalSold} - ${delta})`;

      await tx.update(products).set(productPatch).where(eq(products.id, existing.productId));

      const updated = await tx.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
      return updated[0];
    });

    return this.variantToDto(result);
  }

  // ── Validation helpers ───────────────────────

  private validateProductImages(
    coverImage: string | null | undefined,
    images: string[] | undefined,
  ): void {
    const MAX_URL_LENGTH = 500;
    const MAX_IMAGES_COUNT = 10;

    const isValidImageUrl = (url: string): boolean => {
      if (url.length > MAX_URL_LENGTH) return false;
      if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch { return false; }
    };

    if (coverImage && !isValidImageUrl(coverImage)) {
      throw new BadRequestException('封面图 URL 格式不正确，必须以 http:// 或 https:// 开头且不超过 500 字符');
    }

    if (images) {
      if (images.length > MAX_IMAGES_COUNT) {
        throw new BadRequestException(`商品图片不能超过 ${MAX_IMAGES_COUNT} 张`);
      }
      for (const img of images) {
        if (!isValidImageUrl(img)) {
          throw new BadRequestException('商品图片 URL 格式不正确，必须以 http:// 或 https:// 开头且不超过 500 字符');
        }
      }
    }
  }

  // ── Bulk import (CSV) ────────────────────────

  getImportTemplateCsv(): string {
    return 'nameZh,nameEn,category,price,stock,descriptionZh,descriptionEn,images\n';
  }

  async bulkImport(
    fileBuffer: Buffer,
    userId: string,
    auditMeta?: { role?: string; ip?: string },
  ): Promise<ImportResult> {
    const content = fileBuffer.toString('utf-8');
    const rows = this.parseCsv(content);
    if (rows.length === 0) return { successCount: 0, failCount: 0, failures: [] };

    const allCategories = await this.db.select({
      id: categories.id, nameZh: categories.nameZh, nameEn: categories.nameEn, slug: categories.slug,
    }).from(categories);

    const categoryMap = new Map<string, string>();
    for (const cat of allCategories) {
      categoryMap.set(cat.nameZh.toLowerCase(), cat.id);
      categoryMap.set(cat.nameEn.toLowerCase(), cat.id);
      categoryMap.set(cat.slug.toLowerCase(), cat.id);
    }

    const failures: ImportFailure[] = [];
    const validRecords: Array<{ row: typeof products.$inferInsert; sourceIndex: number }> = [];

    rows.forEach((row: ParsedCsvRow, index: number) => {
      const rowNum = index + 2;
      const reasons: string[] = [];
      if (!row.nameZh?.trim()) reasons.push('nameZh 必填');
      if (!row.nameEn?.trim()) reasons.push('nameEn 必填');
      const priceNum = Number(row.price);
      if (isNaN(priceNum) || priceNum <= 0) reasons.push('price 必须是正数');
      const stockNum = Number(row.stock);
      if (isNaN(stockNum) || !Number.isInteger(stockNum) || stockNum < 0) reasons.push('stock 必须是非负整数');

      let categoryId: string | undefined;
      if (row.category?.trim()) {
        categoryId = categoryMap.get(row.category.trim().toLowerCase());
        if (!categoryId) reasons.push(`分类 "${row.category}" 未找到匹配`);
      }

      if (reasons.length > 0) {
        failures.push({ row: rowNum, reason: reasons.join('; ') });
        return;
      }

      const imageList: string[] = row.images ? row.images.split('|').map((s) => s.trim()).filter(Boolean) : [];

      validRecords.push({
        sourceIndex: index,
        row: {
        sellerId: userId,
        titleZh: row.nameZh.trim(),
        titleEn: row.nameEn.trim(),
        descZh: row.descriptionZh || undefined,
        descEn: row.descriptionEn || undefined,
        categoryId: categoryId ?? null,
        status: 'active',
        coverImage: imageList[0] ?? undefined,
        images: imageList,
        totalStock: Math.floor(stockNum),
        totalSold: 0,
        updatedBy: userId,
        },
      });
    });

    let successCount = 0;
    if (validRecords.length > 0) {
      try {
        await this.db.transaction(async (tx) => {
          for (const record of validRecords) {
            const [inserted] = await tx.insert(products).values(record.row).returning();
            // 用记录自带的原始行号取值：validRecords 已经剔除了失败行，
            // 用循环下标取 rows[i] 会把价格/库存写到错误的商品上。
            const row = rows[record.sourceIndex];
            await tx.insert(productVariants).values({
              productId: inserted.id as string,
              sku: `SKU-${(inserted.id as string).slice(0, 8).toUpperCase()}`,
              optionValues: [],
              price: String(Number(row.price)),
              stock: Math.floor(Number(row.stock)),
              status: 'active',
            } as any);
          }
        });
        successCount = validRecords.length;
      } catch (error) {
        this.logger.error('批量导入商品失败', error);
        for (const record of validRecords) {
          failures.push({ row: record.sourceIndex + 2, reason: '数据库写入失败' });
        }
      }
    }

    const result: ImportResult = { successCount, failCount: failures.length, failures };
    if (successCount > 0) {
      try {
        void this.auditService.log({
          action: 'csv.import', entity: 'product', entityId: 'batch',
          after: { count: successCount }, userId, role: auditMeta?.role, ip: auditMeta?.ip,
        }).catch(() => {});
      } catch { /* noop */ }
    }
    return result;
  }

  /**
   * 导出商品 CSV（卖家工作台）。
   * 只导出当前卖家自己的商品；字段与导入模板保持兼容，可直接改完再导入。
   */
  async exportCsv(
    actor: { userId: string; role?: string },
    limit = 5000,
  ): Promise<string> {
    const conditions: SQL[] = [];
    if (!isPlatformAdmin(actor.role)) conditions.push(eq(products.sellerId, actor.userId));
    const rows = await this.db
      .select({
        id: products.id,
        titleZh: products.titleZh,
        titleEn: products.titleEn,
        categoryName: categories.nameEn,
        stock: products.totalStock,
        descZh: products.descZh,
        descEn: products.descEn,
        images: products.images,
        status: products.status,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(products.createdAt))
      .limit(Math.max(1, Math.min(10000, limit)));

    const variantsMap = await this.fetchVariantsForProducts(rows.map((row) => row.id));
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? '' : String(value);
      const needsQuote = text.indexOf(',') >= 0 || text.indexOf('"') >= 0 || text.indexOf(String.fromCharCode(10)) >= 0;
      return needsQuote ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = 'nameZh,nameEn,category,price,stock,descriptionZh,descriptionEn,images,status,sku';
    const lines = rows.map((row) => {
      const variants = variantsMap.get(row.id) ?? [];
      const first = variants[0];
      return [
        row.titleZh,
        row.titleEn,
        row.categoryName ?? '',
        first?.price ?? '',
        row.stock,
        row.descZh,
        row.descEn,
        (row.images ?? []).join('|'),
        row.status,
        first?.sku ?? row.id,
      ].map(escape).join(',');
    });
    return [header, ...lines].join(String.fromCharCode(10));
  }

  /** 批量上下架：逐个执行完整校验（含上架门禁），返回成功/失败明细 */
  async bulkUpdateStatus(
    ids: string[],
    status: 'draft' | 'active' | 'inactive',
    actor: { userId: string; role?: string },
  ): Promise<{ updated: number; failed: Array<{ id: string; reason: string }> }> {
    const unique = [...new Set(ids)].slice(0, 200);
    const failed: Array<{ id: string; reason: string }> = [];
    let updated = 0;
    for (const id of unique) {
      try {
        await this.update(id, { status }, actor.userId, { role: actor.role });
        updated += 1;
      } catch (error) {
        failed.push({ id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { updated, failed };
  }

  // CSV 解析使用 papaparse（成熟开源库，正确处理 RFC 4180 转义、换行、BOM）
  private parseCsv(content: string): ParsedCsvRow[] {
    const result = Papa.parse(content as any, { skipEmptyLines: true, header: false }) as { data: string[][] };
    if (result.data.length <= 1) return [];
    return result.data.slice(1).map((fields) => ({
      nameZh: fields[0] ?? '', nameEn: fields[1] ?? '', category: fields[2] ?? '',
      price: fields[3] ?? '', stock: fields[4] ?? '',
      descriptionZh: fields[5] ?? '', descriptionEn: fields[6] ?? '', images: fields[7] ?? '',
    }));
  }
}
