import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { eq, and, desc, count, ilike, or, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { nanoid } from 'nanoid';

import {
  payments, refunds, orders, orderItems,
  products, productVariants, stockMovements,
  pointTransactions, users,
} from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { resolveProviderRefundAmount } from '../payments/refund-amount';
import { assertRefundWithinOrderCap } from './refund-cap';
import {
  computeRefundableQuantity,
  computeItemRefundAmount,
  parseRefundItemsJson,
  sumRefundedQuantityByItem,
} from './refund-items';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';

/** Parsed shape of the refunds.items JSON field */
interface RefundItemEntry {
  orderItemId: string;
  quantity: number;
}

interface RestoreItem {
  variantId: string | null;
  productId: string;
  quantity: number;
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // ==================== Helpers ====================

  private generateRefundNo(): string {
    return `RF${Date.now()}${nanoid(6).toUpperCase()}`;
  }

  private parseRefundItems(raw: string | null): RefundItemEntry[] | undefined {
    return parseRefundItemsJson(raw);
  }

  private mapRefund(row: typeof refunds.$inferSelect, orderNo?: string) {
    return {
      id: row.id,
      orderId: row.orderId,
      orderNo,
      userId: row.userId,
      refundNo: row.refundNo,
      status: row.status,
      amount: row.amount as string,
      reason: row.reason,
      reasonDetail: row.reasonDetail ?? undefined,
      items: this.parseRefundItems(row.items),
      sellerReply: row.sellerReply ?? undefined,
      refundMethod: row.refundMethod,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : undefined,
      completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async loadOrder(orderId: string) {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    return orderRows[0];
  }

  private async loadRefund(refundId: string) {
    const refundRows = await this.db.select().from(refunds).where(eq(refunds.id, refundId));
    if (refundRows.length === 0) {
      throw new NotFoundException('退款记录不存在');
    }
    return refundRows[0];
  }

  /** 退款归属：退款所属订单的卖家必须是当前操作者（管理员除外）。 */
  private async assertSellerOwnsRefund(
    refund: { orderId: string },
    sellerId: string,
    role?: string,
  ): Promise<void> {
    if (isPlatformAdmin(role)) return;
    const orderRow = await this.loadOrder(refund.orderId);
    if (!orderRow.sellerId || orderRow.sellerId !== sellerId) {
      throw new ForbiddenException('无权处理该退款');
    }
  }

  // ==================== Buyer: Request Refund ====================

  async requestRefund(
    orderId: string,
    userId: string,
    dto: {
      amount?: string;
      reason: string;
      reasonDetail?: string;
      items?: Array<{ orderItemId: string; quantity: number }>;
      refundMethod?: string;
    },
  ) {
    const order = await this.loadOrder(orderId);

    if (order.userId !== userId) {
      throw new ForbiddenException('无权操作该订单');
    }

    // partially_refunded 允许继续申请（余额由 approve 阶段的累计上限校验把控）
    const refundableStatuses = ['paid', 'shipped', 'delivered', 'partially_refunded'];
    if (!refundableStatuses.includes(order.status)) {
      throw new BadRequestException('当前订单状态不可申请退款');
    }

    // Check for existing pending refund
    const existingRefundsRows = await this.db
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(
        eq(refunds.orderId, orderId),
        eq(refunds.status, 'requested'),
      ));
    if (existingRefundsRows.length > 0) {
      throw new ConflictException('已有待处理的退款申请');
    }

    // Calculate refund amount
    let refundAmount: Decimal;
    if (dto.items && dto.items.length > 0) {
      // 行项校验：数量必须为正整数、不得重复、不得超过购买数量、
      // 也不得超过该行项历史已退数量（防止用超大 quantity 反复部分退款刷库存）。
      const seen = new Set<string>();
      const previous = await this.db
        .select({ items: refunds.items })
        .from(refunds)
        .where(and(eq(refunds.orderId, orderId), eq(refunds.status, 'completed')));
      const refundedByItem = sumRefundedQuantityByItem(previous);

      refundAmount = new Decimal(0);
      for (const refundItem of dto.items) {
        if (!refundItem?.orderItemId || !Number.isInteger(refundItem.quantity) || refundItem.quantity <= 0) {
          throw new BadRequestException('退款行项数量必须是正整数');
        }
        if (seen.has(refundItem.orderItemId)) {
          throw new BadRequestException('同一订单行不能重复提交退款');
        }
        seen.add(refundItem.orderItemId);

        const itemRows = await this.db
          .select({ unitPrice: orderItems.unitPrice, quantity: orderItems.quantity })
          .from(orderItems)
          .where(and(
            eq(orderItems.id, refundItem.orderItemId),
            eq(orderItems.orderId, orderId),
          ));
        if (itemRows.length === 0) {
          throw new BadRequestException('退款行项不属于该订单');
        }
        const item = itemRows[0];
        const alreadyRefunded = refundedByItem.get(refundItem.orderItemId) ?? 0;
        const refundable = computeRefundableQuantity({
          purchased: item.quantity,
          alreadyRefunded,
        });
        if (refundItem.quantity > refundable) {
          throw new BadRequestException(`退款数量超过可退数量（最多 ${refundable} 件）`);
        }
        refundAmount = refundAmount.plus(
          computeItemRefundAmount({ unitPrice: item.unitPrice as string, quantity: refundItem.quantity }),
        );
      }
    } else if (dto.amount) {
      refundAmount = new Decimal(dto.amount);
    } else {
      refundAmount = new Decimal(order.totalAmount as string);
    }

    if (refundAmount.lte(0)) {
      throw new BadRequestException('退款金额必须大于 0');
    }

    // 申请时即做累计校验（fail fast）：剩余可退 = 订单总额 - 已完成退款合计。
    // 审批时还会再做一次同样的校验兜底（处理并发/状态变化）。
    const completedRows = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${refunds.amount}), 0)::text` })
      .from(refunds)
      .where(and(eq(refunds.orderId, orderId), eq(refunds.status, 'completed')));
    const completedTotal = new Decimal(completedRows[0]?.total ?? 0);
    const remaining = new Decimal(order.totalAmount as string).minus(completedTotal);
    if (refundAmount.gt(remaining)) {
      throw new BadRequestException(`退款金额不能超过剩余可退金额 $${remaining.toFixed(2)}`);
    }

    const refundNo = this.generateRefundNo();

    const inserted = await this.db
      .insert(refunds)
      .values({
        orderId,
        userId,
        refundNo,
        status: 'requested',
        amount: refundAmount.toFixed(2),
        reason: dto.reason,
        reasonDetail: dto.reasonDetail ?? null,
        items: dto.items ? JSON.stringify(dto.items) : null,
        refundMethod: dto.refundMethod ?? 'original',
      })
      .returning();

    const refund = inserted[0];

    try {
      void this.auditService.log({
        action: 'refund.request',
        entity: 'refund',
        entityId: refund.id,
        after: {
          orderId,
          amount: refundAmount.toFixed(2),
          reason: dto.reason,
        },
        userId,
        role: 'buyer',
      });
    } catch {
      // Audit log failure must not affect main flow
    }

    return this.mapRefund(refund);
  }

  // ==================== Seller: Approve Refund ====================

  async approveRefund(
    refundId: string,
    sellerId: string,
    dto?: { reply?: string },
    actorRole?: string,
  ) {
    const refund = await this.loadRefund(refundId);
    await this.assertSellerOwnsRefund(refund, sellerId, actorRole);

    if (refund.status !== 'requested') {
      throw new BadRequestException('仅待处理退款可审批');
    }

    // 原子抢占：并发两次「批准」只有一个能把 requested → processing，另一个立即失败，
    // 避免向 Stripe/PayPal 发起两笔真实退款。
    const claimed = await this.db
      .update(refunds)
      .set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, 'requested')))
      .returning({ id: refunds.id });
    if (claimed.length === 0) {
      throw new ConflictException('该退款已被其他操作处理，请刷新后重试');
    }

    try {
      return await this.approveRefundClaimed(refund, sellerId, dto, actorRole);
    } catch (error) {
      // 只有「渠道退款失败」才能安全放回 requested 让卖家重试。
      // 若渠道已退款成功、但后续写库失败，保持 approved 待人工核对，
      // 绝不能回退成 requested —— 那会导致同一笔退款被再次打款。
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('支付退款失败')) {
        await this.db
          .update(refunds)
          .set({ status: 'requested', approvedAt: null, updatedAt: new Date() })
          .where(and(eq(refunds.id, refundId), eq(refunds.status, 'approved')));
      } else {
        this.logger.error(`退款已向渠道提交但落库失败，需人工核对：refund=${refundId} err=${message}`);
      }
      throw error;
    }
  }

  private async approveRefundClaimed(
    refund: typeof refunds.$inferSelect,
    sellerId: string,
    dto?: { reply?: string },
    actorRole?: string,
  ) {
    const refundId = refund.id;
    const order = await this.loadOrder(refund.orderId);
    const refundAmount = new Decimal(refund.amount as string);
    const orderTotal = new Decimal(order.totalAmount as string);

    // 累计退款上限：已完成退款 + 本次 <= 订单总额（fail closed，防重复/超额退款）
    const completedRows = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${refunds.amount}), 0)::text` })
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), eq(refunds.status, 'completed')));
    const completedTotal = new Decimal(completedRows[0]?.total ?? 0);
    try {
      assertRefundWithinOrderCap({
        orderTotal: order.totalAmount as string,
        completedRefunded: completedTotal.toFixed(2),
        refundAmount: refundAmount.toFixed(2),
      });
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    // 找到本订单的已支付流水（用于渠道退款）
    const paymentRows = await this.db
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, 'paid')))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    let providerRefundId: string | null = null;
    if (paymentRows.length > 0) {
      const paidAmount = new Decimal(paymentRows[0].amount as string);
      // 部分退款必须向渠道传递明确金额；仅当"首次且全额"时传 undefined（渠道按全额退回）
      const providerAmount = completedTotal.eq(0)
        ? resolveProviderRefundAmount(paidAmount.toString(), refundAmount.toString())
        : Number(refundAmount.toFixed(2));

      try {
        const result = await this.paymentsService.processRefund(paymentRows[0].id, providerAmount);
        providerRefundId = result.providerRefundId;
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.error(`Payment refund failed for refund ${refundId}: ${msg}`);
        throw new BadRequestException(`支付退款失败: ${msg}`);
      }
    }

    // 更新退款状态 + 库存/销量回滚 + 订单状态
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const updatedRefundRows = await tx
        .update(refunds)
        .set({
          status: 'completed',
          sellerReply: dto?.reply ?? null,
          approvedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(refunds.id, refundId))
        .returning();

      // 库存/销量回滚：
      // - 指定行项 → 只回滚这些行项（无论金额）
      // - 未指定行项且累计达到全额 → 回滚整单
      // - 未指定行项的金额部分退款 → 不回滚（无法确定对应商品，由卖家人工处理库存）
      const refundItemsList = this.parseRefundItems(refund.items);
      const cumulative = completedTotal.plus(refundAmount);
      const isFullyRefunded = cumulative.gte(orderTotal);

      let itemsToRestore: RestoreItem[] = [];
      if (refundItemsList && refundItemsList.length > 0) {
        for (const refundItem of refundItemsList) {
          const itemRows = await tx
            .select({ variantId: orderItems.variantId, productId: orderItems.productId })
            .from(orderItems)
            .where(and(eq(orderItems.id, refundItem.orderItemId), eq(orderItems.orderId, order.id)));
          if (itemRows.length > 0) {
            itemsToRestore.push({ ...itemRows[0], quantity: refundItem.quantity });
          }
        }
      } else if (isFullyRefunded) {
        itemsToRestore = await tx
          .select({
            variantId: orderItems.variantId,
            productId: orderItems.productId,
            quantity: orderItems.quantity,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
      }

      for (const item of itemsToRestore) {
        if (item.variantId) {
          await tx
            .update(productVariants)
            .set({
              stock: sql`${productVariants.stock} + ${item.quantity}`,
              sold: sql`GREATEST(${productVariants.sold} - ${item.quantity}, 0)`,
              updatedAt: now,
            })
            .where(eq(productVariants.id, item.variantId));

          await tx.insert(stockMovements).values({
            variantId: item.variantId,
            quantity: item.quantity,
            reason: 'refund_return',
            referenceId: refundId,
            note: `Refund approved: ${refund.refundNo}`,
            createdBy: sellerId,
          });
        }
        await tx
          .update(products)
          .set({
            totalStock: sql`${products.totalStock} + ${item.quantity}`,
            totalSold: sql`GREATEST(${products.totalSold} - ${item.quantity}, 0)`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId));
      }

      // 积分回滚：按退款金额扣减（与入账口径一致：1 美元 = 1 分）
      if (order.userId) {
        const pointsToDeduct = Math.floor(Number(refundAmount.toFixed(2)));
        if (pointsToDeduct > 0) {
          await tx.insert(pointTransactions).values({
            userId: order.userId,
            amount: -pointsToDeduct,
            type: 'refund',
            source: 'refund',
            referenceId: refundId,
            note: `Refund ${refund.refundNo}`,
          });
          await tx
            .update(users)
            .set({ points: sql`GREATEST(${users.points} - ${pointsToDeduct}, 0)` })
            .where(eq(users.id, order.userId));
        }
      }

      // 订单状态按累计口径判定：累计退款 >= 订单总额 → refunded，否则 partially_refunded
      await tx
        .update(orders)
        .set({
          status: isFullyRefunded ? 'refunded' : 'partially_refunded',
          updatedAt: now,
        })
        .where(eq(orders.id, refund.orderId));

      // 累计补齐全额时，同步支付行状态（单笔全额时 processRefund 已处理）
      if (isFullyRefunded && paymentRows.length > 0) {
        await tx
          .update(payments)
          .set({ status: 'refunded', updatedAt: now })
          .where(eq(payments.id, paymentRows[0].id));
      }

      return updatedRefundRows[0];
    });

    try {
      void this.auditService.log({
        action: 'refund.approve',
        entity: 'refund',
        entityId: refundId,
        before: { status: refund.status },
        after: {
          status: 'completed',
          amount: refundAmount.toFixed(2),
          providerRefundId,
          approvedAt: now.toISOString(),
        },
        userId: sellerId,
        role: 'seller',
      });
    } catch {
      // Audit log failure must not affect main flow
    }

    return this.mapRefund(result);
  }

  // ==================== Seller: Reject Refund ====================

  async rejectRefund(
    refundId: string,
    sellerId: string,
    dto: { reply: string },
    actorRole?: string,
  ) {
    const refund = await this.loadRefund(refundId);
    await this.assertSellerOwnsRefund(refund, sellerId, actorRole);

    if (refund.status !== 'requested') {
      throw new BadRequestException('仅待处理退款可拒绝');
    }

    if (!dto.reply?.trim()) {
      throw new BadRequestException('拒绝退款需要说明原因');
    }

    const now = new Date();
    const updatedRows = await this.db
      .update(refunds)
      .set({
        status: 'rejected',
        sellerReply: dto.reply.trim(),
        updatedAt: now,
      })
      .where(eq(refunds.id, refundId))
      .returning();

    try {
      void this.auditService.log({
        action: 'refund.reject',
        entity: 'refund',
        entityId: refundId,
        before: { status: refund.status },
        after: { status: 'rejected', reply: dto.reply.trim() },
        userId: sellerId,
        role: 'seller',
      });
    } catch {
      // Audit log failure must not affect main flow
    }

    return this.mapRefund(updatedRows[0]);
  }

  // ==================== Seller: List Refunds ====================

  async listForSeller(
    sellerId: string,
    query: { status?: string; page?: string; pageSize?: string; keyword?: string },
    role?: string,
  ) {
    const whereConditions = [];

    // 卖家只能看到自己订单的退款（管理员可跨店）
    if (!isPlatformAdmin(role)) {
      whereConditions.push(
        sql`EXISTS (SELECT 1 FROM ${orders} o WHERE o.id = ${refunds.orderId} AND o.seller_id = ${sellerId})`,
      );
    }

    // Filter by status
    if (query.status) {
      whereConditions.push(eq(refunds.status, query.status as typeof refunds.status.enumValues[number]));
    }

    // Filter by keyword (refundNo only — orderId is UUID and not suitable for ilike)
    if (query.keyword && query.keyword.trim()) {
      const kw = `%${query.keyword.trim()}%`;
      whereConditions.push(or(
        ilike(refunds.refundNo, kw),
        ilike(sql`${refunds.orderId}::text`, kw),
      ));
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Pagination
    const page = query.page ? Math.max(1, parseInt(query.page, 10)) : 1;
    const pageSize = query.pageSize ? Math.min(50, Math.max(1, parseInt(query.pageSize, 10))) : 10;

    const countResult = await this.db
      .select({ count: count() })
      .from(refunds)
      .where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const offset = (page - 1) * pageSize;
    const refundRows = await this.db
      .select({ refund: refunds, orderNo: orders.orderNo })
      .from(refunds)
      .leftJoin(orders, eq(orders.id, refunds.orderId))
      .where(whereClause)
      .orderBy(desc(refunds.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      items: refundRows.map((row) => this.mapRefund(row.refund, row.orderNo ?? undefined)),
      total,
      page,
      pageSize,
    };
  }

  // ==================== Buyer: List Own Refunds ====================

  async listForUser(
    userId: string,
    query: { status?: string; page?: string; pageSize?: string },
  ) {
    const whereConditions = [eq(refunds.userId, userId)];

    if (query.status) {
      whereConditions.push(eq(refunds.status, query.status as typeof refunds.status.enumValues[number]));
    }

    const whereClause = and(...whereConditions);

    const page = query.page ? Math.max(1, parseInt(query.page, 10)) : 1;
    const pageSize = query.pageSize ? Math.min(50, Math.max(1, parseInt(query.pageSize, 10))) : 10;

    const countResult = await this.db
      .select({ count: count() })
      .from(refunds)
      .where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const offset = (page - 1) * pageSize;
    const refundRows = await this.db
      .select({ refund: refunds, orderNo: orders.orderNo })
      .from(refunds)
      .leftJoin(orders, eq(orders.id, refunds.orderId))
      .where(whereClause)
      .orderBy(desc(refunds.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      items: refundRows.map((row) => this.mapRefund(row.refund, row.orderNo ?? undefined)),
      total,
      page,
      pageSize,
    };
  }

  // ==================== Get Detail ====================

  async getDetail(
    refundId: string,
    userId?: string,
    seller?: { sellerId: string; role?: string },
  ) {
    const refund = await this.loadRefund(refundId);

    // 卖家侧：只能查看自己订单的退款（管理员可跨店）
    if (seller) {
      await this.assertSellerOwnsRefund(refund, seller.sellerId, seller.role);
    }

    // If userId provided, check ownership
    if (userId && refund.userId !== userId) {
      throw new ForbiddenException('无权查看该退款记录');
    }

    const order = await this.db
      .select({ orderNo: orders.orderNo })
      .from(orders)
      .where(eq(orders.id, refund.orderId))
      .limit(1);

    return this.mapRefund(refund, order[0]?.orderNo);
  }
}
