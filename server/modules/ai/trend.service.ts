import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, desc, gte, sql, sum, count } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { AiGatewayService } from './ai-gateway.service';
import { buildSellerScopeCondition, andOptional, type SellerActor } from './seller-scope';
import { products, productVariants, categories, orders, orderItems, aiReports } from '../../database/schema';
import type { AITrendReport } from '../../../shared/api.interface';

@Injectable()
export class TrendService {
  private readonly logger = new Logger(TrendService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async generateTrendReport(actor: SellerActor): Promise<AITrendReport> {
    const sellerId = actor.userId;
    const salesData = await this.getSalesData(sellerId);
    const categorySales = await this.getCategorySales(sellerId);
    const topProducts = await this.getTopProducts(sellerId);
    const allCategories = await this.db.select({
      id: categories.id,
      nameZh: categories.nameZh,
      nameEn: categories.nameEn,
    }).from(categories);

    const dataContext = JSON.stringify({
      salesTrend: salesData,
      categorySales,
      topProducts,
      categories: allCategories,
    }, null, 2);

    const now = new Date();
    const seasonMonth = now.getMonth() + 1;
    const seasonYear = now.getFullYear();
    const systemPrompt = '你是专业的跨境电商市场分析师，擅长基于销售数据分析市场趋势并给出可执行的建议。请用中文输出 Markdown 格式的报告。';

    const userPrompt = `基于以下本店销售数据，生成一份深度市场趋势分析报告（Markdown 格式）。

## 销售数据
${dataContext}

## 报告要求
请包含以下章节（Markdown ## 二级标题）：
1. 热搜词分析 - 基于热销商品关键词提炼当前热门搜索词
2. 价格带分析 - 分析各价格区间的销售表现，找出黄金价格带
3. 季节性趋势建议 - 结合当前季节（${seasonYear}年${seasonMonth}月）给出选品和营销建议
4. 行动建议 - 给出3-5条具体可执行的运营行动建议

请直接输出完整的 Markdown 报告内容，不要包裹在代码块中。`;

    const { content } = await this.aiGateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.7, maxTokens: 3000, agent: 'trend', userId: actor.userId },
    );

    // 落库：报告可在「AI 分析中心 → 历史报告」回看（docs 承诺的真实实现）
    const model = await this.aiGateway.getModel();
    const inserted = await this.db
      .insert(aiReports)
      .values({
        userId: actor.userId,
        reportType: 'trend',
        title: '市场趋势分析报告',
        content,
        model,
      })
      .returning({ id: aiReports.id, createdAt: aiReports.createdAt });

    return {
      id: inserted[0].id,
      reportType: 'trend',
      title: '市场趋势分析报告',
      content,
      status: 'completed',
      createdAt: inserted[0].createdAt.toISOString(),
    };
  }

  private async getSalesData(sellerId?: string): Promise<Array<{ date: string; amount: number; orders: number }>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        date: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
        amount: sum(orders.totalAmount).mapWith(Number),
        orders: count(orders.id).mapWith(Number),
      })
      .from(orders)
      .where(andOptional(
        gte(orders.createdAt, thirtyDaysAgo),
        eq(orders.status, 'delivered'),
        buildSellerScopeCondition(orders.sellerId, { userId: sellerId }),
      ))
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`);

    return rows.map((row: { date: string; amount: number | null; orders: number }) => ({
      date: row.date,
      amount: row.amount ?? 0,
      orders: row.orders ?? 0,
    }));
  }

  private async getCategorySales(sellerId?: string): Promise<Array<{ categoryName: string; amount: number }>> {
    const rows = await this.db
      .select({
        categoryName: categories.nameEn,
        amount: sum(orderItems.subtotal).mapWith(Number),
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(andOptional(
        eq(orders.status, 'delivered'),
        buildSellerScopeCondition(products.sellerId, { userId: sellerId }),
      ))
      .groupBy(categories.nameEn)
      .orderBy(desc(sum(orderItems.subtotal)));

    return rows.map((row: { categoryName: string; amount: number | null }) => ({
      categoryName: row.categoryName,
      amount: row.amount ?? 0,
    }));
  }

  private async getTopProducts(sellerId?: string): Promise<Array<{ id: string; titleEn: string; sold: number; price: string }>> {
    // Aggregate from productVariants: SUM(variants.sold) per product, MIN(price) for display
    const rows = await this.db
      .select({
        id: products.id,
        titleEn: products.titleEn,
        totalSold: sql<number>`COALESCE(SUM(${productVariants.sold}), 0)`,
        minPrice: sql<string>`MIN(${productVariants.price})::text`,
        totalStock: sql<number>`COALESCE(SUM(${productVariants.stock}), 0)`,
      })
      .from(products)
      .leftJoin(productVariants, and(
        eq(productVariants.productId, products.id),
        eq(productVariants.status, 'active'),
      ))
      .where(andOptional(
        eq(products.status, 'active'),
        buildSellerScopeCondition(products.sellerId, { userId: sellerId }),
      ))
      .groupBy(products.id, products.titleEn)
      .orderBy(desc(sql`COALESCE(SUM(${productVariants.sold}), 0)`))
      .limit(10);

    return rows.map((row) => ({
      id: row.id,
      titleEn: row.titleEn,
      sold: Number(row.totalSold),
      price: String(row.minPrice),
    }));
  }
}
