import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { AiGatewayService } from './ai-gateway.service';
import { parseLlmJson } from './llm-json';
import { buildSellerScopeCondition, andOptional, type SellerActor } from './seller-scope';
import { products, productVariants, categories, shopperEvents } from '../../database/schema';
import type { AISelectResponse } from '../../../shared/api.interface';

@Injectable()
export class SelectService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async selectProducts(actor: SellerActor): Promise<AISelectResponse> {
    // 空店铺提前返回仅用于「已配置模型」的卖家——省一次无意义的 LLM 调用。
    // 未配置模型时必须走完整链路：gateway.chat 会如实落 ai_usage_log(success=false)
    // 再抛 400（诚实降级 + 可观测），绝不静默返回空数组冒充「无推荐」。
    const configured = await this.aiGateway.isConfigured({ userId: actor.userId, role: actor.role });
    const allCategories = await this.db.select({
      id: categories.id,
      nameZh: categories.nameZh,
      nameEn: categories.nameEn,
    }).from(categories);

    // 本店在售商品 id（seller 范围内；admin 全平台）
    const sellerProductIds = await this.db
      .select({ id: products.id })
      .from(products)
      .where(andOptional(
        eq(products.status, 'active'),
        buildSellerScopeCondition(products.sellerId, actor),
      ));
    const scopedIds = sellerProductIds.map((row) => row.id);

    if (scopedIds.length === 0 && configured) {
      return { items: [] };
    }

    // Aggregate variant data per product for sold/price/stock
    const variantAgg = await this.db
      .select({
        productId: productVariants.productId,
        totalSold: sql<number>`COALESCE(SUM(${productVariants.sold}), 0)`,
        totalStock: sql<number>`COALESCE(SUM(${productVariants.stock}), 0)`,
        minPrice: sql<string>`MIN(${productVariants.price})::text`,
      })
      .from(productVariants)
      .where(and(
        eq(productVariants.status, 'active'),
        inArray(productVariants.productId, scopedIds),
      ))
      .groupBy(productVariants.productId)
      .orderBy(desc(sql`COALESCE(SUM(${productVariants.sold}), 0)`))
      .limit(20);

    // Get product titles for the top variant products
    const productIds = variantAgg.map((v) => v.productId);
    const productRows = productIds.length > 0
      ? await this.db
        .select({ id: products.id, titleEn: products.titleEn, categoryId: products.categoryId })
        .from(products)
        .where(and(eq(products.status, 'active'), inArray(products.id, productIds)))
      : [];

    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const stockLevels = variantAgg
      .filter((v) => productMap.has(v.productId))
      .map((v) => ({
        titleEn: productMap.get(v.productId)!.titleEn,
        stock: Number(v.totalStock),
        sold: Number(v.totalSold),
        price: String(v.minPrice),
      }));

    const dataContext = JSON.stringify({
      categories: allCategories,
      topProducts: stockLevels,
    }, null, 2);

    const systemPrompt = '你是专业的跨境电商选品专家，擅长基于销售数据和市场趋势给出选品建议。请用中文输出严格的 JSON 格式。';

    // 真实需求信号：买家在导购里搜了但店里没有的词（查不到就静默降级，不影响选品）
    const demandGapSection = await this.buildDemandGapSection(actor);

    const userPrompt = `基于以下店铺现有类目和销售数据，推荐 5-8 个值得上架的细分品。

${demandGapSection ? `${demandGapSection}

` : ''}## 现有数据
${dataContext}

## 输出格式要求
请返回严格的 JSON 格式，结构如下：
{
  "items": [
    {
      "keyword": "细分品关键词",
      "estimatedDemand": "预估市场需求描述（如\"高\"、\"中\"、\"低\"）",
      "suggestedPriceRange": "建议售价区间（如 \"$19.99 - $29.99\"）",
      "reason": "推荐理由（2-3句话）",
      "confidence": 0.85
    }
  ]
}

confidence 是 0-1 之间的数字，表示推荐置信度。
每个细分品应有差异化定位，避免同质化推荐。`;

    const { content } = await this.aiGateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.8, maxTokens: 2000, responseFormat: 'json', agent: 'select', userId: actor.userId, role: actor.role },
    );

    const parsed = parseLlmJson<AISelectResponse>(content);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }

  /** 近 90 天导购零结果搜索 → 提示词段落；无数据/查询失败时返回空串 */
  private async buildDemandGapSection(actor: SellerActor): Promise<string> {
    try {
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
      const rows = await this.db
        .select({
          keyword: shopperEvents.keyword,
          misses: sql<number>`COUNT(*)::int`,
          sessions: sql<number>`COUNT(DISTINCT COALESCE(${shopperEvents.userId}::text, ${shopperEvents.sessionId}))::int`,
        })
        .from(shopperEvents)
        .where(and(
          eq(shopperEvents.stage, 'search_miss'),
          gte(shopperEvents.createdAt, since),
          sql`${shopperEvents.keyword} IS NOT NULL`,
          sql`${shopperEvents.keyword} <> ''`,
          ...(actor.role === 'admin'
            ? []
            : [actor.userId
              ? sql`${shopperEvents.productId} IN (SELECT id FROM ${products} WHERE seller_id = ${actor.userId})`
              : sql`FALSE`]),
        ))
        .groupBy(shopperEvents.keyword)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(10);

      if (rows.length === 0) return '';
      return [
        '## 真实买家未满足需求（来自导购搜索零结果，按需求强度排序）',
        ...rows.map((row) => `- ${row.keyword}（搜索 ${Number(row.misses)} 次，${Number(row.sessions)} 位买家，零结果）`),
        '请在推荐中优先考虑这些词对应的细分品（这是本店真实的未成交需求）。',
      ].join('\n');
    } catch {
      return '';
    }
  }
}
