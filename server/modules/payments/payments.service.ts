import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { and, eq, desc, sql } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import {
  payments,
  orders,
  orderItems,
  productVariants,
  products,
  stockMovements,
  pointTransactions,
  users,
} from '../../database/schema';
import type {
  Payment,
  PaymentProvider,
  PaymentStatus,
  PayResponse,
  Order,
} from '../../../shared/api.interface';

import { StripeService } from './stripe.service';
import { isDemoPaymentAllowed } from './demo-gate';
import { PayPalService } from './paypal.service';
import { AuditService } from '../audit/audit.service';
import { canAccessSellerResource } from '../../common/tenant/tenant-scope';

type MarkPaidProvider = PaymentProvider | 'manual';

export interface MarkPaidOptions {
  provider: MarkPaidProvider;
  /** 渠道流水号（幂等锚点）：同一流水重复入账会被忽略 */
  transactionId: string;
  /** 渠道实收金额；缺省按订单总额记录 */
  amount?: string;
  currency?: string;
  actorUserId?: string;
}

export interface MarkPaidResult {
  order: typeof orders.$inferSelect;
  paymentId: string | null;
  /** true = 订单此前已非待支付状态，本次未做任何变更（webhook 重复投递/晚到回调） */
  skipped: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly stripeService: StripeService,
    private readonly payPalService: PayPalService,
    private readonly auditService: AuditService,
  ) {}

  private generateDemoTransactionId(): string {
    return `DEMO_${Date.now().toString()}_${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  }

  private mapPayment(row: {
    id: string;
    orderId: string;
    provider: string | null;
    amount: string;
    currency: string;
    status: string;
    transactionId: string | null;
    createdAt: Date;
  }): Payment {
    return {
      id: row.id,
      orderId: row.orderId,
      provider: row.provider as PaymentProvider,
      amount: row.amount,
      currency: row.currency,
      status: row.status as PaymentStatus,
      transactionId: row.transactionId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Parse addressSnapshot JSON for output mapping */
  private parseAddressSnapshot(raw: string | null): {
    receiverName?: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
    country?: string;
    zipCode?: string;
  } | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  private mapOrderForResponse(order: typeof orders.$inferSelect, items: Array<typeof orderItems.$inferSelect>): Order {
    const addr = this.parseAddressSnapshot(order.addressSnapshot);

    return {
      id: order.id,
      orderNo: order.orderNo,
      userId: order.userId ?? undefined,
      buyerName: addr?.receiverName ?? '',
      buyerPhone: addr?.phone,
      shippingAddress: addr?.addressLine1 ?? '',
      shippingCity: addr?.city ?? '',
      shippingCountry: addr?.country ?? '',
      shippingZip: addr?.zipCode,
      subtotal: order.subtotal as string,
      shippingFee: order.shippingFee as string,
      discountAmount: order.discountAmount as string,
      taxAmount: order.taxAmount as string,
      totalAmount: order.totalAmount as string,
      couponCode: order.couponCode ?? undefined,
      status: order.status as Order['status'],
      paymentMethod: order.paymentMethod ?? 'demo',
      paidAt: order.paidAt?.toISOString(),
      shippedAt: order.shippedAt?.toISOString(),
      deliveredAt: order.deliveredAt?.toISOString(),
      trackingNumber: order.trackingNumber ?? undefined,
      customerNote: order.customerNote ?? undefined,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId ?? undefined,
        variantId: item.variantId ?? undefined,
        productTitle: item.productTitle,
        variantInfo: item.variantInfo ?? undefined,
        productSku: item.productSku ?? undefined,
        productImage: item.productImage ?? undefined,
        unitPrice: item.unitPrice as string,
        quantity: item.quantity,
        subtotal: item.subtotal as string,
      })),
      fulfillments: [],
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  /**
   * 支付成功入账的唯一入口（Demo / Stripe webhook / PayPal webhook / 卖家手动标记共用）。
   * 幂等：仅当订单处于 pending_payment 时入账；重复调用（webhook 重投）直接跳过；
   * 支付流水号在 payments 表有唯一索引，并发重复也会被数据库拦截。
   * 入账同时累计销量（variant.sold / product.totalSold）并写库存流水。
   */
  async markOrderPaid(orderId: string, opts: MarkPaidOptions): Promise<MarkPaidResult> {
    const result = await this.db.transaction(async (tx) => {
      const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (orderRows.length === 0) {
        throw new NotFoundException('订单不存在');
      }
      const order = orderRows[0];

      if (order.status !== 'pending_payment') {
        return { order, paymentId: null, skipped: true };
      }

      // 原子抢占：只有仍处于 pending_payment 的订单能完成入账。
      // 并发 webhook / webhook 与手动入账 / 双实例同时回调时，只有一个事务能命中，
      // 否则会重复累加销量、积分并重复写库存流水。
      const claimed = await tx
        .update(orders)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'pending_payment')))
        .returning({ id: orders.id });
      if (claimed.length === 0) {
        return { order, paymentId: null, skipped: true };
      }

      const now = new Date();
      const amount = opts.amount ?? (order.totalAmount as string);
      const currency = opts.currency ?? 'USD';

      // 渠道预创建的 pending 流水（Stripe intent / PayPal order）就地升级为 paid，
      // 避免支付历史出现 "pending 与 paid 并存"；无 pending 时插入（重复流水由唯一索引兜底）
      const pendingRows = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(
          eq(payments.orderId, orderId),
          eq(payments.provider, opts.provider),
          eq(payments.status, 'pending'),
        ))
        .limit(1);

      let paymentId: string | null = null;
      if (pendingRows.length > 0) {
        const upgraded = await tx
          .update(payments)
          .set({
            status: 'paid',
            transactionId: opts.transactionId,
            amount,
            currency,
            updatedAt: now,
          })
          .where(eq(payments.id, pendingRows[0].id))
          .returning({ id: payments.id });
        paymentId = upgraded[0]?.id ?? null;
      } else {
        const insertedPayments = await tx
          .insert(payments)
          .values({
            orderId,
            method: opts.provider === 'manual' ? 'demo' : opts.provider,
            provider: opts.provider,
            amount,
            currency,
            status: 'paid',
            transactionId: opts.transactionId,
          })
          .onConflictDoNothing()
          .returning({ id: payments.id });
        paymentId = insertedPayments[0]?.id ?? null;
      }

      const updatedOrders = await tx
        .update(orders)
        .set({
          paidAt: now,
          paymentMethod: opts.provider === 'manual' ? 'demo' : opts.provider,
          paymentId: opts.transactionId,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
        .returning();

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      for (const item of items) {
        if (item.variantId) {
          await tx
            .update(productVariants)
            .set({
              sold: sql`${productVariants.sold} + ${item.quantity}`,
              updatedAt: now,
            })
            .where(eq(productVariants.id, item.variantId));

          await tx.insert(stockMovements).values({
            variantId: item.variantId,
            quantity: -item.quantity,
            reason: 'sale',
            referenceId: orderId,
            note: `Order paid: ${order.orderNo}`,
            createdBy: opts.actorUserId ?? null,
          });
        }
        await tx
          .update(products)
          .set({
            totalSold: sql`${products.totalSold} + ${item.quantity}`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId));
      }

      // 会员积分：1 美元 = 1 分（仅登录用户），退款审批时按金额回滚
      if (order.userId) {
        const points = Math.floor(Number(amount));
        if (points > 0) {
          await tx.insert(pointTransactions).values({
            userId: order.userId,
            amount: points,
            type: 'earn',
            source: 'order',
            referenceId: orderId,
            note: `Order ${order.orderNo}`,
          });
          await tx
            .update(users)
            .set({ points: sql`${users.points} + ${points}` })
            .where(eq(users.id, order.userId));
        }
      }

      return {
        order: updatedOrders[0],
        paymentId,
        skipped: false,
      };
    });

    if (result.skipped) {
      this.logger.warn(
        `markOrderPaid skipped: order=${orderId} status=${result.order.status} provider=${opts.provider} txn=${opts.transactionId}`,
      );
    } else {
      this.logger.log(
        `Order paid: order=${result.order.orderNo} provider=${opts.provider} txn=${opts.transactionId}`,
      );
      try {
        void this.auditService.log({
          action: 'payment.pay',
          entity: 'payment',
          entityId: result.paymentId ?? opts.transactionId,
          after: {
            provider: opts.provider,
            transactionId: opts.transactionId,
            amount: opts.amount ?? (result.order.totalAmount as string),
          },
          userId: opts.actorUserId ?? result.order.userId ?? undefined,
        });
      } catch {
        // Audit log failure must not affect main flow
      }
    }

    return result;
  }

  async pay(
    orderId: string,
    provider: PaymentProvider,
    userId?: string,
    sessionId?: string,
    auditMeta?: { ip?: string },
  ): Promise<PayResponse> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }

    const order = orderRows[0];
    const isOwner = (userId && order.userId && order.userId === userId)
      || (sessionId && order.addressSnapshot && this.checkSessionOwnership(order.addressSnapshot, sessionId));
    if (!isOwner) {
      throw new ForbiddenException('无权支付该订单');
    }
    if (order.status === 'paid') {
      throw new BadRequestException('订单已支付');
    }
    if (order.status !== 'pending_payment') {
      throw new BadRequestException('当前订单状态无法支付');
    }

    const amount = Number(order.totalAmount);
    const currency = 'USD';

    if (provider === 'stripe' && this.stripeService.isConfigured()) {
      const { paymentIntentId, clientSecret } = await this.stripeService.createPaymentIntent(
        amount,
        currency,
        orderId,
      );
      const paymentRow = await this.createPayment(orderId, 'stripe', amount, currency, 'pending', paymentIntentId);
      return {
        success: true,
        payment: this.mapPayment({
          ...paymentRow,
          createdAt: new Date(paymentRow.createdAt),
        }),
        message: 'Stripe payment intent created',
        clientSecret: clientSecret || undefined,
        paymentStatus: 'pending',
      };
    }

    if (provider === 'paypal' && this.payPalService.isConfigured()) {
      const { paypalOrderId, approveUrl } = await this.payPalService.createOrder(
        amount,
        currency,
        orderId,
      );
      const paymentRow = await this.createPayment(orderId, 'paypal', amount, currency, 'pending', paypalOrderId);
      return {
        success: true,
        payment: this.mapPayment({
          ...paymentRow,
          createdAt: new Date(paymentRow.createdAt),
        }),
        message: approveUrl ? 'PayPal approval required' : 'PayPal order created',
        approveUrl: approveUrl || undefined,
        paymentStatus: 'pending',
      };
    }

    // 演示支付环境门禁（fail-closed）：仅 development/test 放行，
    // 防止未配渠道的生产环境被 provider=demo 直接置 paid 白拿订单。
    if (!isDemoPaymentAllowed({ nodeEnv: process.env.NODE_ENV, allowDemoPayment: process.env.ALLOW_DEMO_PAYMENT })) {
      throw new ForbiddenException(
        '演示支付仅在 development/test 环境可用：生产请配置真实支付渠道（Stripe/PayPal）',
      );
    }
    return this.processDemoPayment(orderId, provider, order, auditMeta);
  }

  /**
   * 买家从 PayPal 授权页返回后确认支付：capture → 校验金额 → 幂等入账。
   * 校验项：订单归属、订单状态、capture 金额与订单总额一致（防篡改）。
   */
  async capturePayPalOrder(
    orderId: string,
    paypalOrderId: string,
    userId?: string,
    sessionId?: string,
  ): Promise<PayResponse> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    const order = orderRows[0];
    const isOwner = (userId && order.userId && order.userId === userId)
      || (sessionId && order.addressSnapshot && this.checkSessionOwnership(order.addressSnapshot, sessionId));
    if (!isOwner) {
      throw new ForbiddenException('无权支付该订单');
    }
    if (order.status === 'paid') {
      throw new BadRequestException('订单已支付');
    }
    if (order.status !== 'pending_payment') {
      throw new BadRequestException('当前订单状态无法支付');
    }

    // 绑定校验：只能 capture 本订单创建的 PayPal order，防止拿别人的 order id 顶账
    const boundRows = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(
        eq(payments.orderId, orderId),
        eq(payments.provider, 'paypal'),
        eq(payments.transactionId, paypalOrderId),
        eq(payments.status, 'pending'),
      ))
      .limit(1);
    if (boundRows.length === 0) {
      throw new BadRequestException('PayPal 支付单不属于该订单');
    }

    const capture = await this.payPalService.captureOrder(paypalOrderId);
    const expected = Number(order.totalAmount);
    if (Number.isFinite(expected) && Math.abs(capture.amount - expected) > 0.01) {
      throw new BadRequestException('支付金额与订单金额不一致，已拒绝入账');
    }

    const result = await this.markOrderPaid(orderId, {
      provider: 'paypal',
      transactionId: capture.transactionId || paypalOrderId,
      amount: capture.amount.toFixed(2),
      currency: capture.currency || 'USD',
    });

    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    return {
      success: true,
      order: this.mapOrderForResponse(result.order, items),
      paymentStatus: 'paid',
      message: 'PayPal 支付成功',
    };
  }

  private checkSessionOwnership(addressSnapshot: string, sessionId: string): boolean {
    try {
      const snap = JSON.parse(addressSnapshot) as { sessionId?: string };
      return snap.sessionId === sessionId;
    } catch {
      return false;
    }
  }

  private async processDemoPayment(
    orderId: string,
    provider: PaymentProvider,
    order: typeof orders.$inferSelect,
    auditMeta?: { ip?: string },
  ): Promise<PayResponse> {
    const transactionId = this.generateDemoTransactionId();

    const result = await this.markOrderPaid(orderId, {
      provider,
      transactionId,
      amount: order.totalAmount as string,
    });

    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const paymentRows = result.paymentId
      ? await this.db.select().from(payments).where(eq(payments.id, result.paymentId))
      : [];

    void auditMeta;

    return {
      success: true,
      payment: paymentRows[0]
        ? this.mapPayment({
            ...paymentRows[0],
            createdAt: new Date(paymentRows[0].createdAt),
          })
        : undefined,
      order: this.mapOrderForResponse(result.order, items),
      demoMode: true,
      paymentStatus: 'paid',
      message: '演示支付成功',
    };
  }

  private async createPayment(
    orderId: string,
    provider: PaymentProvider,
    amount: number,
    currency: string,
    status: PaymentStatus,
    transactionId?: string,
  ): Promise<typeof payments.$inferSelect> {
    const rows = await this.db
      .insert(payments)
      .values({
        orderId,
        method: provider,
        provider,
        amount: amount.toString(),
        currency,
        status,
        transactionId,
      })
      .returning();
    return rows[0];
  }

  /**
   * 向支付渠道发起退款并更新本笔支付的状态。
   * 退款记录（refunds 表）、订单状态与库存回滚由调用方（RefundsService）负责，
   * 本方法只做「渠道调用 + payments 行状态」，避免双记账。
   */
  async processRefund(
    paymentId: string,
    amount?: number,
    /**
     * 渠道幂等键。同一笔退款重试时必须传同一个值，Stripe 才会返回首次结果而不是再退一次。
     * 缺省时退化为“无幂等保护”，仅用于内部脚本。
     */
    idempotencyKey?: string,
  ): Promise<{ providerRefundId: string | null; paymentStatus: string }> {
    const paymentRows = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (paymentRows.length === 0) {
      throw new NotFoundException('支付记录不存在');
    }
    const payment = paymentRows[0];

    if (payment.status !== 'paid') {
      throw new BadRequestException('只能对已支付记录发起退款');
    }

    const paymentAmount = Number(payment.amount);
    const refundAmount = amount ?? paymentAmount;

    if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > paymentAmount) {
      throw new BadRequestException('退款金额无效');
    }

    let providerRefundId: string | null = null;

    if (payment.provider === 'stripe' && payment.transactionId && this.stripeService.isConfigured()) {
      try {
        const result = await this.stripeService.refund(payment.transactionId, refundAmount, idempotencyKey);
        providerRefundId = result.refundId;
      } catch (err) {
        this.logger.error('Stripe refund failed', (err as Error).message);
        throw new BadRequestException(`Stripe 退款失败: ${(err as Error).message}`);
      }
    } else if (payment.provider === 'paypal' && payment.transactionId && this.payPalService.isConfigured()) {
      try {
        const result = await this.payPalService.refundCapture(
          payment.transactionId,
          refundAmount,
          payment.currency,
          idempotencyKey,
        );
        providerRefundId = result.refundId;
      } catch (err) {
        this.logger.error('PayPal refund failed', (err as Error).message);
        throw new BadRequestException(`PayPal 退款失败: ${(err as Error).message}`);
      }
    } else {
      // 演示模式：无真实渠道可退，生成可追溯的演示单号
      providerRefundId = `DEMO_REFUND_${Date.now()}`;
    }

    const newPaymentStatus = refundAmount >= paymentAmount ? 'refunded' : payment.status;
    await this.db
      .update(payments)
      .set({ status: newPaymentStatus, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));

    return { providerRefundId, paymentStatus: newPaymentStatus };
  }

  async getPaymentsByOrder(
    orderId: string,
    userId?: string,
    sessionId?: string,
    actor?: { id?: string; role?: string },
  ): Promise<Payment[]> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    const order = orderRows[0];

    if (actor) {
      // 卖家只能查自己店铺订单的支付流水（管理员可跨店）
      if (!canAccessSellerResource(order.sellerId, actor.id, actor.role)) {
        throw new ForbiddenException('无权查看该订单的支付记录');
      }
    } else {
      const isOwner = (userId && order.userId && order.userId === userId)
        || (sessionId && order.addressSnapshot && this.checkSessionOwnership(order.addressSnapshot, sessionId));
      if (!isOwner) {
        throw new ForbiddenException('无权查看该订单的支付记录');
      }
    }

    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.createdAt));

    return rows.map((row) =>
      this.mapPayment({
        ...row,
        createdAt: new Date(row.createdAt),
      }),
    );
  }

  async getPaymentConfig(): Promise<{
    stripeConfigured: boolean;
    paypalConfigured: boolean;
    demoMode: boolean;
    stripePublishableKey?: string;
  }> {
    const stripeConfigured = this.stripeService.isConfigured();
    const paypalConfigured = this.payPalService.isConfigured();
    return {
      stripeConfigured,
      paypalConfigured,
      demoMode: !stripeConfigured
        && !paypalConfigured
        && isDemoPaymentAllowed({ nodeEnv: process.env.NODE_ENV, allowDemoPayment: process.env.ALLOW_DEMO_PAYMENT }),
      stripePublishableKey: this.stripeService.getPublishableKey(),
    };
  }

  /**
   * Stripe webhook：验签（时间戳容忍 + 恒定时间比较）→ payment_intent.succeeded → 幂等入账。
   * 返回 false 表示验签失败（HTTP 400，Stripe 会重试并在后台标记端点异常）。
   */
  async handleStripeWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<boolean> {
    if (!rawBody || !signature) {
      this.logger.warn('Stripe webhook rejected: missing raw body or signature');
      return false;
    }

    const event = this.stripeService.verifyAndParse(rawBody, signature);
    if (!event) {
      this.logger.warn('Stripe webhook rejected: signature verification failed');
      return false;
    }

    if (event.type !== 'payment_intent.succeeded') {
      this.logger.log(`Stripe webhook skipped: ${event.type}`);
      return true;
    }

    const data = event.data as {
      id?: string;
      amount_received?: number;
      currency?: string;
      metadata?: { orderId?: string };
    };
    const orderId = data.metadata?.orderId;
    if (!orderId || !data.id) {
      this.logger.warn('Stripe webhook rejected: missing metadata.orderId or payment intent id');
      return false;
    }

    const amount = typeof data.amount_received === 'number'
      ? (data.amount_received / 100).toFixed(2)
      : undefined;

    // 金额校验：实收必须覆盖订单总额，防止改价/部分支付被当成全额入账
    const orderRows = await this.db
      .select({ totalAmount: orders.totalAmount })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (orderRows.length === 0) {
      this.logger.warn(`Stripe webhook: order ${orderId} not found`);
      return false;
    }
    if (amount !== undefined && Number(amount) + 0.005 < Number(orderRows[0].totalAmount)) {
      this.logger.error(
        `Stripe webhook amount mismatch: order=${orderId} paid=${amount} expected=${orderRows[0].totalAmount}`,
      );
      return false;
    }

    const result = await this.markOrderPaid(orderId, {
      provider: 'stripe',
      transactionId: data.id,
      amount,
      currency: (data.currency ?? 'usd').toUpperCase(),
    });

    if (result.skipped && result.order.status !== 'paid') {
      this.logger.error(
        `Stripe 已收款但订单状态不可入账: order=${orderId} status=${result.order.status} txn=${data.id}（需人工核对）`,
      );
    }
    return true;
  }

  /**
   * PayPal webhook：验签 → PAYMENT.CAPTURE.COMPLETED → 幂等入账（capture id 作为流水锚点）。
   */
  async handlePayPalWebhook(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<boolean> {
    const verified = await this.payPalService.verifyWebhook(
      headers,
      JSON.stringify(body),
    );
    if (!verified) {
      return false;
    }

    const { eventType, data } = verified;
    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
      this.logger.log(`PayPal webhook skipped: ${eventType}`);
      return true;
    }

    const resource = data as {
      id?: string;
      custom_id?: string;
      amount?: { value?: string; currency_code?: string };
    };
    const orderId = resource.custom_id;
    const transactionId = resource.id;

    if (!orderId || !transactionId) {
      this.logger.warn('PayPal webhook rejected: missing custom_id (orderId) or capture id');
      return false;
    }

    const orderRows = await this.db
      .select({ totalAmount: orders.totalAmount })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (orderRows.length === 0) {
      this.logger.warn(`PayPal webhook: order ${orderId} not found`);
      return false;
    }
    const paid = resource.amount?.value;
    if (paid !== undefined && Number(paid) + 0.005 < Number(orderRows[0].totalAmount)) {
      this.logger.error(
        `PayPal webhook amount mismatch: order=${orderId} paid=${paid} expected=${orderRows[0].totalAmount}`,
      );
      return false;
    }

    const result = await this.markOrderPaid(orderId, {
      provider: 'paypal',
      transactionId,
      amount: resource.amount?.value,
      currency: resource.amount?.currency_code ?? 'USD',
    });

    if (result.skipped && result.order.status !== 'paid') {
      this.logger.error(
        `PayPal 已收款但订单状态不可入账: order=${orderId} status=${result.order.status} capture=${transactionId}（需人工核对）`,
      );
    }
    return true;
  }
}
