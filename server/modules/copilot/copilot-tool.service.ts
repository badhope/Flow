import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { CopilotToolDefinition } from './copilot-protocol';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import {
  orders,
  products,
  refunds,
} from '../../database/schema';
import { DashboardService } from '../dashboard/dashboard.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { RefundsService } from '../refunds/refunds.service';
import { CouponsService } from '../coupons/coupons.service';
import { InquiryService } from '../inquiry/inquiry.service';
import { CopywriterService } from '../ai/copywriter.service';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';
import type { OrderStatus } from '../../../shared/api.interface';

export interface ToolExecutionResult {
  ok: boolean;
  content: string;
  /** 执行后的结果摘要，用于动作记录 */
  summary?: string;
}

/**
 * 工具执行器：读写分离。
 * - 读工具：仅做查询，返回压缩后的结构化文本；列表类读工具按卖家隔离（admin 可跨店），
 *   保证模型只能基于自己店铺的数据决策，与写工具的归属校验同一口径
 * - 写工具：全部委托既有业务服务（订单状态机 / 退款审批 / 商品状态 / 优惠券 / 咨询），
 *   不在此处重写任何业务规则，确保库存、积分、审计等副作用与卖家手动操作一致。
 */
@Injectable()
export class CopilotToolService {
  private readonly logger = new Logger(CopilotToolService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly dashboardService: DashboardService,
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
    private readonly refundsService: RefundsService,
    private readonly couponsService: CouponsService,
    private readonly inquiryService: InquiryService,
    private readonly copywriterService: CopywriterService,
  ) {}

  async runReadTool(
    tool: CopilotToolDefinition,
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    try {
      switch (tool.name) {
        case 'get_store_overview':
          return await this.getStoreOverview(actor);
        case 'list_orders':
          return await this.listOrders(args, actor);
        case 'list_products':
          return await this.listProducts(args, actor);
        case 'list_low_stock':
          return await this.listLowStock(args, actor);
        case 'list_pending_refunds':
          return await this.listPendingRefunds(actor);
        default:
          return { ok: false, content: `未知工具：${tool.name}` };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`读取工具 ${tool.name} 执行失败：${message}`);
      return { ok: false, content: `查询失败：${message}` };
    }
  }

  async runWriteTool(
    tool: CopilotToolDefinition,
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    switch (tool.name) {
      case 'update_order_status':
        return this.updateOrderStatus(args, actor);
      case 'approve_refund':
        return this.approveRefund(args, actor);
      case 'reject_refund':
        return this.rejectRefund(args, actor);
      case 'update_product_status':
        return this.updateProductStatus(args, actor);
      case 'create_coupon':
        return this.createCoupon(args, actor);
      case 'create_draft_product':
        return this.createDraftProduct(args, actor);
      case 'send_inquiry_reply':
        return this.sendInquiryReply(args, actor);
      default:
        return { ok: false, content: `未知写操作：${tool.name}` };
    }
  }

  // ==================== Read tools ====================

  private async getStoreOverview(actor: { userId: string; role: string }): Promise<ToolExecutionResult> {
    const data = await this.dashboardService.getStats({
      sellerId: actor.userId,
      role: actor.role,
    });
    const { stats } = data;
    return {
      ok: true,
      content: [
        `GMV：$${stats.gmv}`,
        `订单数：${stats.orderCount}`,
        `访客数（近 90 天去重）：${stats.visitorCount}`,
        `商品数：${stats.productCount}`,
        `今日 GMV：$${stats.todayGmv}`,
        `今日订单：${stats.todayOrders}`,
        `待发货订单：${stats.pendingOrders}`,
      ].join('\n'),
    };
  }

  private async listOrders(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const status = typeof args.status === 'string' ? args.status : undefined;
    const keyword = typeof args.keyword === 'string' ? args.keyword : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    const conditions = [];
    // 卖家只能读取自己店铺的订单（与写工具归属校验同一口径）
    if (!isPlatformAdmin(actor.role)) conditions.push(eq(orders.sellerId, actor.userId));
    if (status) conditions.push(eq(orders.status, status as OrderStatus));
    if (keyword) conditions.push(ilike(orders.orderNo, `%${keyword}%`));

    const rows = await this.db
      .select({
        orderNo: orders.orderNo,
        status: orders.status,
        totalAmount: orders.totalAmount,
        createdAt: orders.createdAt,
        addressSnapshot: orders.addressSnapshot,
      })
      .from(orders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(limit);

    if (rows.length === 0) return { ok: true, content: '没有符合条件的订单。' };

    const lines = rows.map((row) => {
      const receiver = this.parseReceiver(row.addressSnapshot);
      return `- ${row.orderNo}｜${row.status}｜$${row.totalAmount}｜${receiver || '未知买家'}｜${row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`;
    });
    return { ok: true, content: `共 ${rows.length} 条订单：\n${lines.join('\n')}` };
  }

  private async listProducts(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const keyword = typeof args.keyword === 'string' ? args.keyword : undefined;
    const status = typeof args.status === 'string' ? args.status : 'active';
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    const conditions = [eq(products.status, status)];
    if (!isPlatformAdmin(actor.role)) conditions.push(eq(products.sellerId, actor.userId));
    if (keyword) {
      conditions.push(sql`(${ilike(products.titleZh, `%${keyword}%`)} OR ${ilike(products.titleEn, `%${keyword}%`)})`);
    }

    const rows = await this.db
      .select({
        id: products.id,
        titleZh: products.titleZh,
        titleEn: products.titleEn,
        status: products.status,
        totalStock: products.totalStock,
        totalSold: products.totalSold,
      })
      .from(products)
      .where(and(...conditions))
      .orderBy(desc(products.createdAt))
      .limit(limit);

    if (rows.length === 0) return { ok: true, content: '没有符合条件的商品。' };

    const lines = rows.map(
      (row) => `- ${row.titleZh || row.titleEn}｜${row.status}｜库存 ${row.totalStock}｜已售 ${row.totalSold}｜id=${row.id}`,
    );
    return { ok: true, content: `共 ${rows.length} 条商品：\n${lines.join('\n')}` };
  }

  private async listLowStock(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const threshold = typeof args.threshold === 'number' ? args.threshold : 10;
    const conditions = [eq(products.status, 'active'), sql`${products.totalStock} < ${threshold}`];
    if (!isPlatformAdmin(actor.role)) conditions.push(eq(products.sellerId, actor.userId));
    const rows = await this.db
      .select({
        id: products.id,
        titleZh: products.titleZh,
        titleEn: products.titleEn,
        totalStock: products.totalStock,
        totalSold: products.totalSold,
      })
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(products.totalStock))
      .limit(20);

    if (rows.length === 0) return { ok: true, content: `没有总库存低于 ${threshold} 的在售商品。` };

    const lines = rows.map(
      (row) => `- ${row.titleZh || row.titleEn}｜库存 ${row.totalStock}｜已售 ${row.totalSold}｜id=${row.id}`,
    );
    return {
      ok: true,
      content: `库存低于 ${threshold} 的在售商品共 ${rows.length} 个：\n${lines.join('\n')}`,
    };
  }

  private async listPendingRefunds(actor: { userId: string; role: string }): Promise<ToolExecutionResult> {
    const conditions = [eq(refunds.status, 'requested')];
    if (!isPlatformAdmin(actor.role)) conditions.push(eq(orders.sellerId, actor.userId));
    const rows = await this.db
      .select({
        refundNo: refunds.refundNo,
        amount: refunds.amount,
        reason: refunds.reason,
        status: refunds.status,
        createdAt: refunds.createdAt,
        orderNo: orders.orderNo,
      })
      .from(refunds)
      .leftJoin(orders, eq(refunds.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(desc(refunds.createdAt))
      .limit(20);

    if (rows.length === 0) return { ok: true, content: '当前没有待审批退款。' };

    const lines = rows.map(
      (row) => `- ${row.refundNo}｜订单 ${row.orderNo ?? '未知'}｜$${row.amount}｜原因：${row.reason}｜${row.createdAt.toISOString().slice(0, 10)}`,
    );
    return { ok: true, content: `待审批退款 ${rows.length} 条：\n${lines.join('\n')}` };
  }

  // ==================== Write tools ====================

  private async updateOrderStatus(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const orderNo = String(args.orderNo);
    const status = String(args.status) as OrderStatus;
    const rows = await this.db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.orderNo, orderNo))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException(`订单 ${orderNo} 不存在`);

    const carrier = typeof args.carrier === 'string' ? args.carrier : undefined;
    const trackingNumber = typeof args.trackingNumber === 'string' ? args.trackingNumber : undefined;
    await this.ordersService.updateStatus(
      rows[0].id,
      { status, carrier, trackingNumber },
      actor.userId,
      actor.role,
    );

    return {
      ok: true,
      content: `订单 ${orderNo} 状态已从 ${rows[0].status} 变更为 ${status}。`,
      summary: `${orderNo}: ${rows[0].status} → ${status}`,
    };
  }

  private async approveRefund(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const refundNo = String(args.refundNo);
    const refund = await this.findRefundByNo(refundNo);
    const reply = typeof args.reply === 'string' ? args.reply : undefined;

    await this.refundsService.approveRefund(refund.id, actor.userId, reply ? { reply } : undefined, actor.role);
    return {
      ok: true,
      content: `退款单 ${refundNo}（$${refund.amount}）已批准并完成原路退回。`,
      summary: `${refundNo}: 已退款 $${refund.amount}`,
    };
  }

  private async rejectRefund(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const refundNo = String(args.refundNo);
    const reply = String(args.reply);
    const refund = await this.findRefundByNo(refundNo);

    await this.refundsService.rejectRefund(refund.id, actor.userId, { reply }, actor.role);
    return {
      ok: true,
      content: `退款单 ${refundNo} 已拒绝，原因已回复买家。`,
      summary: `${refundNo}: 已拒绝`,
    };
  }

  private async updateProductStatus(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const productId = String(args.productId);
    const status = String(args.status) as 'draft' | 'active' | 'inactive';

    await this.productsService.update(productId, { status }, actor.userId, { role: actor.role });
    return {
      ok: true,
      content: `商品 ${productId.slice(0, 8)}… 状态已更新为 ${status}。`,
      summary: `商品 ${productId.slice(0, 8)}… → ${status}`,
    };
  }

  private async createCoupon(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const type = String(args.type) as 'percent' | 'fixed' | 'free_shipping';
    const value = typeof args.value === 'number' ? args.value : undefined;
    const minOrderAmount = typeof args.minOrderAmount === 'number' ? args.minOrderAmount : undefined;
    const totalQuantity = typeof args.totalQuantity === 'number' ? args.totalQuantity : undefined;
    const expiresInDays = typeof args.expiresInDays === 'number' ? args.expiresInDays : 30;

    if (type !== 'free_shipping' && (value === undefined || value <= 0)) {
      return { ok: false, content: '非包邮券必须提供大于 0 的面额（value）。' };
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const coupon = await this.couponsService.create(
      {
        code: String(args.code),
        type,
        value: type === 'free_shipping' ? undefined : value,
        minOrderAmount,
        totalQuantity,
        expiresAt,
      },
      { userId: actor.userId, role: actor.role },
    );

    return {
      ok: true,
      content: `优惠券 ${coupon.code} 已创建（${coupon.type}，面额 ${coupon.value}，有效期至 ${expiresAt.slice(0, 10)}）。`,
      summary: `${coupon.code}: 已创建`,
    };
  }

  private async createDraftProduct(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const titleZh = String(args.titleZh).trim();
    const titleEn = String(args.titleEn).trim();
    const price = Number(args.price);
    const stock = typeof args.stock === 'number' ? args.stock : 0;
    const categoryId = typeof args.categoryId === 'string' ? args.categoryId : undefined;

    const product = await this.productsService.create(
      {
        titleZh,
        titleEn,
        descZh: typeof args.descZh === 'string' ? args.descZh : undefined,
        descEn: typeof args.descZh === 'string' ? args.descZh : undefined,
        price,
        stock,
        status: 'draft',
        categoryId,
      },
      actor.userId,
    );

    // AI 补全：有模型时自动生成英文文案并写回草稿；失败不影响商品创建（诚实降级）
    let copyNote = '';
    try {
      const copy = await this.copywriterService.generate(
        {
          productNameZh: titleZh,
          category: categoryId,
          targetMarket: '北美市场',
        },
        actor,
      );
      const patch: Record<string, unknown> = {};
      if (copy.titleEn) patch.titleEn = copy.titleEn.slice(0, 200);
      if (copy.longDescription) patch.longDescEn = copy.longDescription;
      if (copy.bulletPoints.length > 0) patch.bulletPointsEn = copy.bulletPoints;
      if (copy.seoKeywords) patch.seoKeywordsEn = copy.seoKeywords;
      if (Object.keys(patch).length > 0) {
        await this.productsService.update(product.id, patch, actor.userId, { role: actor.role });
        copyNote = ' 已用 AI 生成英文文案（标题/卖点/描述/SEO），请复核后补图上架。';
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`草稿文案 AI 补全失败（商品已创建）：${message}`);
      copyNote = ' （AI 文案未生成：模型未配置或调用失败，可稍后在商品管理里用「AI 生成文案」补全）';
    }

    return {
      ok: true,
      content: `草稿商品《${product.titleZh}》已创建（状态 draft，售价 $${product.minPrice ?? price}）。${copyNote}`,
      summary: `草稿商品 ${product.id.slice(0, 8)}…`,
    };
  }

  private async sendInquiryReply(
    args: Record<string, unknown>,
    actor: { userId: string; role: string },
  ): Promise<ToolExecutionResult> {
    const sessionId = String(args.sessionId);
    const content = String(args.content);

    await this.inquiryService.sendMessage(
      { sessionId, role: 'seller', content },
      actor.userId,
    );
    return {
      ok: true,
      content: `已以卖家身份回复咨询会话 ${sessionId}。`,
      summary: `会话 ${sessionId}: 已回复`,
    };
  }

  // ==================== Helpers ====================

  private async findRefundByNo(refundNo: string) {
    const rows = await this.db
      .select({ id: refunds.id, amount: refunds.amount, status: refunds.status })
      .from(refunds)
      .where(eq(refunds.refundNo, refundNo))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException(`退款单 ${refundNo} 不存在`);
    return rows[0];
  }

  private parseReceiver(snapshot: string | null): string {
    if (!snapshot) return '';
    try {
      const parsed = JSON.parse(snapshot) as { receiverName?: string };
      return parsed.receiverName ?? '';
    } catch {
      return '';
    }
  }

  /** 供动作确认页展示：写操作影响的行数（只读统计，不产生副作用） */
  async describeImpact(tool: CopilotToolDefinition, args: Record<string, unknown>): Promise<string> {
    if (tool.name === 'update_order_status') {
      const orderNo = String(args.orderNo ?? '');
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.orderNo, orderNo));
      return `匹配订单 ${rows[0]?.count ?? 0} 条`;
    }
    if (tool.name === 'approve_refund' || tool.name === 'reject_refund') {
      const refundNo = String(args.refundNo ?? '');
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(refunds)
        .where(eq(refunds.refundNo, refundNo));
      return `匹配退款单 ${rows[0]?.count ?? 0} 条`;
    }
    if (tool.name === 'update_product_status') {
      const productId = String(args.productId ?? '');
      const rows = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(eq(products.id, productId));
      return `匹配商品 ${rows[0]?.count ?? 0} 条`;
    }
    if (tool.name === 'send_inquiry_reply') {
      return '将向该会话追加一条卖家消息';
    }
    if (tool.name === 'create_coupon') {
      return '将新增 1 张优惠券';
    }
    if (tool.name === 'create_draft_product') {
      return '将新增 1 个草稿商品（不会自动上架）';
    }
    return '';
  }
}
