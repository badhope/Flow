import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq, desc, ilike, or, and, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { AiGatewayService, type ChatMessage } from './ai-gateway.service';
import { products, productVariants, inquiryMessages, inquirySessions, orders, orderFulfillments } from '../../database/schema';
import type { SupportChatRequest, SupportChatResponse } from '../../../shared/api.interface';
import type { SellerActor } from './seller-scope';

type SupportActor = SellerActor & { sessionId?: string };

const MAX_MESSAGE_LENGTH = 2000;
const SESSION_ID_PATTERN = /^[\w-]{8,64}$/;

interface FAQEntry {
  keywords: string[];
  question: string;
  answer: string;
}

const SHOP_FAQS: FAQEntry[] = [
  {
    keywords: ['退换', '退货', '退款', 'return', 'refund', 'exchange', '退换货'],
    question: '退换货政策',
    answer: '30天无理由退换，商品需保持全新未使用状态。',
  },
  {
    keywords: ['发货', '物流', '配送', 'shipping', 'delivery', 'dispatch', '多久到'],
    question: '发货时间',
    answer: '订单付款后2-5个工作日内发货。',
  },
  {
    keywords: ['支付', '付款', 'payment', 'paypal', '信用卡', '银行转账'],
    question: '支付方式',
    answer: '支持信用卡、PayPal、银行转账。',
  },
  {
    keywords: ['追踪', '运单号', 'tracking', '物流号', '快递', 'tracking number'],
    question: '物流追踪',
    answer: '发货后会通过邮件发送物流追踪号。',
  },
  {
    keywords: ['客服', '工作时间', '营业时间', 'support', 'service hours', '人工'],
    question: '客服时间',
    answer: '周一至周五 9:00-18:00 GMT+8。',
  },
];

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async chat(dto: SupportChatRequest, actorOrUserId?: SupportActor | string): Promise<SupportChatResponse> {
    const actor: SupportActor = typeof actorOrUserId === 'string' ? { userId: actorOrUserId } : (actorOrUserId ?? {});
    if (actor.sessionId && actor.sessionId !== dto.sessionId) {
      throw new BadRequestException('会话标识不一致');
    }
    if (!actor.userId && !actor.sessionId) {
      throw new BadRequestException('会话未初始化');
    }
    const message = dto.message?.trim() ?? '';
    if (!message) {
      throw new BadRequestException('消息不能为空');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`);
    }
    const messageLower = message.toLowerCase();

    // RAG: 检索相关商品
    const relatedProducts = await this.searchProducts(message, dto.language);

    // RAG: 匹配店铺政策 FAQ
    const matchedFaqs = this.matchFaqs(messageLower);

    // 公开客服只能读取当前用户/当前匿名 session 的会话与订单，不能信任 body 单独提供的 ID。
    const sessionAllowed = await this.assertSessionAccess(dto.sessionId, actor);
    if (!sessionAllowed) throw new BadRequestException('会话不存在或无权访问');

    // 查询订单状态（如果有 orderNo）
    let orderInfo = '';
    if (dto.orderNo) {
      orderInfo = await this.getOrderInfo(dto.orderNo, actor);
    }

    // 读取对话历史
    const historyMessages = await this.getHistoryMessages(dto.sessionId);

    // 构建上下文
    const contextParts: string[] = [];

    if (relatedProducts.length > 0) {
      const productsText = relatedProducts
        .map((p, i: number) => `${i + 1}. ${p.titleEn} - ${p.descEn || 'No description'} - Price from $${p.minPrice}, Stock: ${p.totalStock}`)
        .join('\n');
      contextParts.push(`【相关商品】\n${productsText}`);
    }

    if (matchedFaqs.length > 0) {
      const faqsText = matchedFaqs
        .map((f) => `- ${f.question}: ${f.answer}`)
        .join('\n');
      contextParts.push(`【店铺政策】\n${faqsText}`);
    }

    if (orderInfo) {
      contextParts.push(`【订单信息】\n${orderInfo}`);
    }

    const systemPrompt = this.buildSystemPrompt(dto.language, contextParts.join('\n\n'));

    // 构建消息序列：system + history + current user
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: message },
    ];

    const { content: reply } = await this.aiGateway.chat(messages, {
      temperature: 0.5,
      maxTokens: 800,
      agent: 'support',
      userId: actor.userId,
      role: actor.role,
    });

    // 收集 sources
    const sources: string[] = [];
    if (matchedFaqs.length > 0) {
      sources.push(...matchedFaqs.map((f) => `店铺政策 - ${f.question}`));
    }
    if (relatedProducts.length > 0) {
      sources.push(`相关商品 (${relatedProducts.length}个)`);
    }

    const replyText = reply.trim();

    // 会话落库：卖家「咨询管理」可见完整对话，同时作为后续多轮的上下文来源
    await this.persistConversation(dto.sessionId, message, replyText, actor.userId);

    return {
      reply: replyText,
      sources: sources.length > 0 ? sources : undefined,
    };
  }

  /** 落库失败不影响本次回复（best-effort） */
  private async persistConversation(
    sessionId: string | undefined,
    userMessage: string,
    assistantReply: string,
    userId?: string,
  ): Promise<void> {
    if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return;
    try {
      const existing = await this.db
        .select({ id: inquirySessions.id })
        .from(inquirySessions)
        .where(eq(inquirySessions.sessionId, sessionId));

      if (existing.length === 0) {
        await this.db.insert(inquirySessions).values({
          sessionId,
          userId: userId ?? null,
          status: 'active',
          lastMessageAt: new Date(),
        });
      } else {
        await this.db
          .update(inquirySessions)
          .set({ lastMessageAt: new Date() })
          .where(eq(inquirySessions.sessionId, sessionId));
      }

      await this.db.insert(inquiryMessages).values([
        { sessionId, role: 'user', content: userMessage },
        { sessionId, role: 'assistant', content: assistantReply },
      ]);
    } catch (err) {
      this.logger.warn(`会话落库失败: ${(err as Error).message}`);
    }
  }

  private async searchProducts(
    query: string,
    language?: string,
  ): Promise<Array<{ id: string; titleEn: string; descEn: string | null; minPrice: string; totalStock: number }>> {
    void language;

    // 关键词匹配检索
    const productKeywords = ['product', '商品', '产品', 'item', '商品详情', '规格', 'spec', '多少钱', 'price', '价格'];
    const lowerQuery = query.toLowerCase();
    const isProductRelated = productKeywords.some((kw: string) => lowerQuery.includes(kw.toLowerCase()));

    if (!isProductRelated) {
      return [];
    }

    try {
      const rows = await this.db
        .select({
          id: products.id,
          titleEn: products.titleEn,
          descEn: products.descEn,
        })
        .from(products)
        .where(and(
          eq(products.status, 'active'),
          or(
            ilike(products.titleEn, `%${query}%`),
            ilike(products.titleZh, `%${query}%`),
            ilike(products.descEn, `%${query}%`),
          ),
        ))
        .limit(20);

      if (rows.length === 0) return [];

      const productIds = rows.map((r) => r.id);

      // Get variant aggregates for price and stock
      const variantRows = await this.db
        .select({
          productId: productVariants.productId,
          minPrice: sql<string>`MIN(${productVariants.price})::text`,
          totalStock: sql<number>`COALESCE(SUM(${productVariants.stock}), 0)`,
          totalSold: sql<number>`COALESCE(SUM(${productVariants.sold}), 0)`,
        })
        .from(productVariants)
        .where(and(
          inArray(productVariants.productId, productIds),
          eq(productVariants.status, 'active'),
        ))
        .groupBy(productVariants.productId);

      const variantMap = new Map(variantRows.map((v) => [v.productId, v]));

      return rows.map((row) => {
        const v = variantMap.get(row.id);
        return {
          id: row.id,
          titleEn: row.titleEn,
          descEn: row.descEn,
          minPrice: v ? String(v.minPrice) : 'N/A',
          totalStock: v ? Number(v.totalStock) : 0,
        };
      });
    } catch {
      return [];
    }
  }

  private matchFaqs(queryLower: string): FAQEntry[] {
    return SHOP_FAQS.filter((faq: FAQEntry) =>
      faq.keywords.some((kw: string) => queryLower.includes(kw.toLowerCase())),
    );
  }

  private async assertSessionAccess(sessionId: string, actor: SupportActor): Promise<boolean> {
    const rows = await this.db
      .select({ userId: inquirySessions.userId })
      .from(inquirySessions)
      .where(eq(inquirySessions.sessionId, sessionId))
      .limit(1);
    if (rows.length === 0) {
      // 新会话允许首次写入；但跨已有会话必须拒绝。
      return Boolean(actor.userId || actor.sessionId);
    }
    return actor.userId ? rows[0].userId === actor.userId : Boolean(actor.sessionId === sessionId);
  }

  private async getOrderInfo(orderNo: string, actor: SupportActor): Promise<string> {
    try {
      const orderRows = await this.db
        .select()
        .from(orders)
        .where(eq(orders.orderNo, orderNo))
        .limit(1);

      if (orderRows.length === 0) {
        return `订单号 ${orderNo} 未找到。`;
      }
      const order = orderRows[0];
      const ownsOrder = actor.userId
        ? order.userId === actor.userId
        : this.orderSnapshotMatchesSession(order.addressSnapshot, actor.sessionId);
      if (!ownsOrder) return '订单号未找到。';

      // Get fulfillments for tracking info
      const fulfillments = await this.db
        .select({
          carrier: orderFulfillments.carrier,
          trackingNumber: orderFulfillments.trackingNumber,
          status: orderFulfillments.status,
        })
        .from(orderFulfillments)
        .where(eq(orderFulfillments.orderId, order.id));

      const statusMap: Record<string, string> = {
        pending_payment: '待付款',
        paid: '已付款，待发货',
        shipped: '已发货',
        delivered: '已送达',
        cancelled: '已取消',
        refunded: '已退款',
        partially_refunded: '部分退款',
        processing: '处理中',
      };

      const trackingStr = fulfillments.length > 0
        ? fulfillments.map((f) => `${f.carrier ?? ''}: ${f.trackingNumber ?? '无'}`).join(', ')
        : '暂无';

      // Parse address from snapshot
      let addressStr = '';
      if (order.addressSnapshot) {
        try {
          const addr = JSON.parse(order.addressSnapshot);
          addressStr = `${addr.receiverName ?? ''}, ${addr.addressLine1 ?? ''}, ${addr.city ?? ''}, ${addr.country ?? ''}`;
        } catch {
          // ignore parse error
        }
      }

      return [
        `订单号: ${order.orderNo}`,
        `状态: ${statusMap[order.status] || order.status}`,
        `金额: $${order.totalAmount}`,
        `收货地址: ${addressStr || '暂无'}`,
        `运单号: ${trackingStr}`,
        `支付方式: ${order.paymentMethod ?? ''}`,
        order.shippedAt ? `发货时间: ${order.shippedAt.toISOString()}` : '',
      ].filter(Boolean).join('\n');
    } catch {
      return '';
    }
  }

  private orderSnapshotMatchesSession(snapshot: string | null, sessionId?: string): boolean {
    if (!snapshot || !sessionId) return false;
    try {
      const parsed = JSON.parse(snapshot) as { sessionId?: string };
      return parsed.sessionId === sessionId;
    } catch {
      return false;
    }
  }

  private async getHistoryMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      const rows = await this.db
        .select({
          role: inquiryMessages.role,
          content: inquiryMessages.content,
        })
        .from(inquiryMessages)
        .where(eq(inquiryMessages.sessionId, sessionId))
        .orderBy(desc(inquiryMessages.createdAt))
        .limit(10);

      return rows
        .reverse()
        .filter((row) => row.role === 'user' || row.role === 'assistant')
        .map((row) => ({
          role: row.role as 'user' | 'assistant',
          content: row.content,
        }));
    } catch {
      return [];
    }
  }

  private buildSystemPrompt(language: string | undefined, context: string): string {
    const langInstruction = language === 'zh'
      ? '请用中文回复。'
      : language === 'en'
      ? 'Please reply in English.'
      : 'Please reply in the same language as the user\'s message.';

    return `你是专业的跨境电商智能客服，负责回答买家关于商品、订单、物流、售后等问题。${langInstruction}

## 回复规则
1. 基于以下上下文回答问题，不要编造上下文中不存在的信息。
2. 如果上下文中没有相关信息，请礼貌说明"暂无相关信息"或建议联系人工客服。
3. 语气友好、专业、简洁。
4. 不要假装能访问外部系统或实时数据，只能使用提供的上下文。

## 参考上下文
${context || '（暂无额外上下文）'}

请根据以上规则和上下文回答用户问题。`;
  }
}
