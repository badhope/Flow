import { Injectable, Inject, Logger, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { eq, and, desc, count, ilike, or, inArray, sql, gte, lt } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { nanoid } from 'nanoid';

import {
  orders, orderItems, orderFulfillments,
  products, productVariants, cartItems, coupons,
} from '../../database/schema';
import { CouponsService } from '../coupons/coupons.service';
import { AuditService } from '../audit/audit.service';
import { ShippingService } from '../shipping/shipping.service';
import { PaymentsService } from '../payments/payments.service';
import { computeOrderPricing } from '../../common/pricing/order-pricing';
import { computeTax } from '../../common/pricing/tax';
import { FxService } from '../fx/fx.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { WarehouseService } from '../inventory/warehouse.service';
import { canAccessSellerResource, isPlatformAdmin, resolveSingleSellerId } from '../../common/tenant/tenant-scope';
import { canTransitionOrderStatus } from './order-status';
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderListResponse,
  CreateOrderRequest,
  OrderStatusUpdateRequest,
} from '../../../shared/api.interface';

/** Shape of the addressSnapshot JSON stored on the order */
interface AddressSnapshot {
  receiverName: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  country: string;
  zipCode?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly couponsService: CouponsService,
    private readonly auditService: AuditService,
    private readonly shippingService: ShippingService,
    private readonly paymentsService: PaymentsService,
    private readonly fxService: FxService,
    private readonly stockReservation: StockReservationService,
    private readonly warehouseService: WarehouseService,
  ) {}

  private generateOrderNo(): string {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const rand = nanoid(10).toUpperCase();
    return `ORD${dateStr}${rand}`;
  }

  private async generateUniqueOrderNo(): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const orderNo = this.generateOrderNo();
      const existing = await this.db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNo, orderNo));
      if (existing.length === 0) return orderNo;
    }
    throw new ConflictException('生成订单号失败，请重试');
  }

  private mapOrderItem(row: {
    id: string;
    productId: string | null;
    variantId: string | null;
    productTitle: string;
    variantInfo: string | null;
    productSku: string | null;
    productImage: string | null;
    unitPrice: string;
    quantity: number;
    subtotal: string;
  }): OrderItem {
    return {
      id: row.id,
      productId: row.productId ?? undefined,
      variantId: row.variantId ?? undefined,
      productTitle: row.productTitle,
      variantInfo: row.variantInfo ?? undefined,
      productSku: row.productSku ?? undefined,
      productImage: row.productImage ?? undefined,
      unitPrice: row.unitPrice,
      quantity: row.quantity,
      subtotal: row.subtotal,
    };
  }

  private parseAddressSnapshot(raw: string | null): AddressSnapshot | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as AddressSnapshot;
    } catch {
      return undefined;
    }
  }

  /** Build a tracking-number string aggregated from fulfillments */
  private aggregateTracking(row: { trackingNumber: string | null }, fulfillmentsRows: Array<{ carrier: string | null; trackingNumber: string | null }>): string | undefined {
    if (fulfillmentsRows.length === 0) return row.trackingNumber ?? undefined;
    const parts = fulfillmentsRows
      .filter((f) => f.trackingNumber)
      .map((f) => `${f.carrier ?? ''}:${f.trackingNumber}`);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  private mapOrder(
    orderRow: {
      id: string;
      orderNo: string;
      userId: string | null;
      subtotal: string;
      shippingFee: string;
      discountAmount: string;
      taxAmount: string;
      totalAmount: string;
      currency: string;
      exchangeRate: string;
      baseTotalAmount: string;
      status: string;
      couponId: string | null;
      couponCode: string | null;
      paymentMethod: string | null;
      addressSnapshot: string | null;
      carrier: string | null;
      trackingNumber: string | null;
      customerNote: string | null;
      paidAt: Date | null;
      shippedAt: Date | null;
      deliveredAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    items: OrderItem[],
    fulfillments: Array<{ carrier: string | null; trackingNumber: string | null }> = [],
  ): Order {
    const addr = this.parseAddressSnapshot(orderRow.addressSnapshot);
    const tracking = this.aggregateTracking(orderRow, fulfillments);

    return {
      id: orderRow.id,
      orderNo: orderRow.orderNo,
      userId: orderRow.userId ?? undefined,
      buyerName: addr?.receiverName ?? '',
      buyerEmail: undefined,
      buyerPhone: addr?.phone,
      shippingAddress: addr?.addressLine1 ?? '',
      shippingCity: addr?.city ?? '',
      shippingZip: addr?.zipCode,
      shippingCountry: addr?.country ?? '',
      subtotal: orderRow.subtotal as string,
      shippingFee: orderRow.shippingFee as string,
      discountAmount: orderRow.discountAmount as string,
      taxAmount: orderRow.taxAmount as string,
      totalAmount: orderRow.totalAmount as string,
      currency: orderRow.currency,
      exchangeRate: orderRow.exchangeRate as string,
      baseTotalAmount: orderRow.baseTotalAmount as string,
      couponCode: orderRow.couponCode ?? undefined,
      status: orderRow.status as OrderStatus,
      paymentMethod: orderRow.paymentMethod ?? 'demo',
      paidAt: orderRow.paidAt ? orderRow.paidAt.toISOString() : undefined,
      shippedAt: orderRow.shippedAt ? orderRow.shippedAt.toISOString() : undefined,
      deliveredAt: orderRow.deliveredAt ? orderRow.deliveredAt.toISOString() : undefined,
      trackingNumber: tracking,
      customerNote: orderRow.customerNote ?? undefined,
      items,
      fulfillments: fulfillments.map((f) => ({
        carrier: f.carrier ?? undefined,
        trackingNumber: f.trackingNumber ?? undefined,
      })),
      createdAt: orderRow.createdAt.toISOString(),
      updatedAt: orderRow.updatedAt.toISOString(),
    };
  }

  private async loadOrderItems(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
    if (orderIds.length === 0) return new Map();
    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds));

    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const row of itemRows) {
      const item = this.mapOrderItem({
        id: row.id,
        productId: row.productId,
        variantId: row.variantId,
        productTitle: row.productTitle,
        variantInfo: row.variantInfo,
        productSku: row.productSku,
        productImage: row.productImage,
        unitPrice: row.unitPrice as string,
        quantity: row.quantity,
        subtotal: row.subtotal as string,
      });
      const arr = itemsByOrder.get(row.orderId) ?? [];
      arr.push(item);
      itemsByOrder.set(row.orderId, arr);
    }
    return itemsByOrder;
  }

  private async loadFulfillments(orderIds: string[]): Promise<Map<string, Array<{ carrier: string | null; trackingNumber: string | null }>>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        orderId: orderFulfillments.orderId,
        carrier: orderFulfillments.carrier,
        trackingNumber: orderFulfillments.trackingNumber,
      })
      .from(orderFulfillments)
      .where(inArray(orderFulfillments.orderId, orderIds));

    const map = new Map<string, Array<{ carrier: string | null; trackingNumber: string | null }>>();
    for (const row of rows) {
      const arr = map.get(row.orderId) ?? [];
      arr.push({ carrier: row.carrier, trackingNumber: row.trackingNumber });
      map.set(row.orderId, arr);
    }
    return map;
  }

  async getOrderList(
    page: number,
    pageSize: number,
    status?: OrderStatus,
    keyword?: string,
    actor?: { actorId?: string; role?: string },
  ): Promise<OrderListResponse> {
    const whereConditions = [];
    // 卖家只能看到自己店铺的订单；管理员可跨店查看
    if (actor && !isPlatformAdmin(actor.role)) {
      if (!actor.actorId) return { items: [], total: 0, page, pageSize };
      whereConditions.push(eq(orders.sellerId, actor.actorId));
    }
    if (status) {
      whereConditions.push(eq(orders.status, status));
    }
    if (keyword && keyword.trim()) {
      const kw = `%${keyword.trim()}%`;
      whereConditions.push(or(
        ilike(orders.orderNo, kw),
        // uuid 不能直接 ILIKE，需显式转文本
        sql`${orders.userId}::text ILIKE ${kw}`,
      ));
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const countResult = await this.db
      .select({ count: count() })
      .from(orders)
      .where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const offset = (page - 1) * pageSize;
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(whereClause)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset);

    if (orderRows.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const orderIds = orderRows.map((o) => o.id);
    const itemsByOrder = await this.loadOrderItems(orderIds);
    const fulfillmentsByOrder = await this.loadFulfillments(orderIds);

    const items = orderRows.map((row) => this.mapOrder(
      {
        id: row.id,
        orderNo: row.orderNo,
        userId: row.userId,
        subtotal: row.subtotal as string,
        shippingFee: row.shippingFee as string,
        discountAmount: row.discountAmount as string,
        taxAmount: row.taxAmount as string,
        totalAmount: row.totalAmount as string,
        currency: row.currency,
        exchangeRate: row.exchangeRate as string,
        baseTotalAmount: row.baseTotalAmount as string,
        status: row.status,
        couponId: row.couponId,
        couponCode: row.couponCode,
        paymentMethod: row.paymentMethod,
        addressSnapshot: row.addressSnapshot,
        carrier: row.carrier,
        trackingNumber: row.trackingNumber,
        customerNote: row.customerNote,
        paidAt: row.paidAt,
        shippedAt: row.shippedAt,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      itemsByOrder.get(row.id) ?? [],
      fulfillmentsByOrder.get(row.id) ?? [],
    ));

    return { items, total, page, pageSize };
  }

  async getBuyerOrders(
    userId: string | undefined,
    sessionId: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<OrderListResponse> {
    let whereClause;
    if (userId) {
      whereClause = eq(orders.userId, userId);
    } else if (sessionId) {
      // 游客订单：通过地址快照中的 sessionId 关联（与支付/订单详情的归属校验一致）
      whereClause = and(
        sql`${orders.addressSnapshot} IS NOT NULL`,
        sql`${orders.addressSnapshot}::jsonb ->> 'sessionId' = ${sessionId}`,
      );
    } else {
      return { items: [], total: 0, page, pageSize };
    }

    const countResult = await this.db
      .select({ count: count() })
      .from(orders)
      .where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const offset = (page - 1) * pageSize;
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(whereClause)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset);

    if (orderRows.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const orderIds = orderRows.map((o) => o.id);
    const itemsByOrder = await this.loadOrderItems(orderIds);
    const fulfillmentsByOrder = await this.loadFulfillments(orderIds);

    const items = orderRows.map((row) => this.mapOrder(
      {
        id: row.id,
        orderNo: row.orderNo,
        userId: row.userId,
        subtotal: row.subtotal as string,
        shippingFee: row.shippingFee as string,
        discountAmount: row.discountAmount as string,
        taxAmount: row.taxAmount as string,
        totalAmount: row.totalAmount as string,
        currency: row.currency,
        exchangeRate: row.exchangeRate as string,
        baseTotalAmount: row.baseTotalAmount as string,
        status: row.status,
        couponId: row.couponId,
        couponCode: row.couponCode,
        paymentMethod: row.paymentMethod,
        addressSnapshot: row.addressSnapshot,
        carrier: row.carrier,
        trackingNumber: row.trackingNumber,
        customerNote: row.customerNote,
        paidAt: row.paidAt,
        shippedAt: row.shippedAt,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      itemsByOrder.get(row.id) ?? [],
      fulfillmentsByOrder.get(row.id) ?? [],
    ));

    return { items, total, page, pageSize };
  }

  /**
   * 卖家订单详情：仅允许查看自己店铺的订单（管理员可跨店）。
   */
  async getSellerOrderDetail(
    id: string,
    actorId: string | undefined,
    role?: string,
  ): Promise<Order> {
    return this.getOrderDetail(id, undefined, undefined, { id: actorId, role });
  }

  /**
   * 订单详情。三种调用者：
   * - 买家（userId / sessionId 归属）
   * - 卖家（必须订单 sellerId === 操作者，管理员可跨店）
   * - 内部服务（actor.role = 'admin'）
   */
  async getOrderDetail(
    id: string,
    userId?: string,
    sessionId?: string,
    actor?: { id?: string; role?: string },
  ): Promise<Order> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, id));
    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    const orderRow = orderRows[0];

    if (actor) {
      if (!canAccessSellerResource(orderRow.sellerId, actor.id, actor.role)) {
        throw new ForbiddenException('无权访问该订单');
      }
    } else {
      if (userId && orderRow.userId && orderRow.userId === userId) {
        // owner
      } else if (sessionId && orderRow.addressSnapshot) {
        // guest session lookup via addressSnapshot.sessionId (legacy compatibility)
        try {
          const snap = JSON.parse(orderRow.addressSnapshot) as { sessionId?: string };
          if (snap.sessionId !== sessionId) {
            throw new ForbiddenException('无权访问该订单');
          }
        } catch {
          throw new ForbiddenException('无权访问该订单');
        }
      } else {
        throw new ForbiddenException('无权访问该订单');
      }
    }

    const itemRows = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id))
      .orderBy(orderItems.createdAt);

    const items: OrderItem[] = itemRows.map((row) => this.mapOrderItem({
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      productTitle: row.productTitle,
      variantInfo: row.variantInfo,
      productSku: row.productSku,
      productImage: row.productImage,
      unitPrice: row.unitPrice as string,
      quantity: row.quantity,
      subtotal: row.subtotal as string,
    }));

    const fulfillments = await this.db
      .select({
        carrier: orderFulfillments.carrier,
        trackingNumber: orderFulfillments.trackingNumber,
      })
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, id));

    return this.mapOrder(
      {
        id: orderRow.id,
        orderNo: orderRow.orderNo,
        userId: orderRow.userId,
        subtotal: orderRow.subtotal as string,
        shippingFee: orderRow.shippingFee as string,
        discountAmount: orderRow.discountAmount as string,
        taxAmount: orderRow.taxAmount as string,
        totalAmount: orderRow.totalAmount as string,
        currency: orderRow.currency,
        exchangeRate: orderRow.exchangeRate as string,
        baseTotalAmount: orderRow.baseTotalAmount as string,
        status: orderRow.status,
        couponId: orderRow.couponId,
        couponCode: orderRow.couponCode,
        paymentMethod: orderRow.paymentMethod,
        addressSnapshot: orderRow.addressSnapshot,
        carrier: orderRow.carrier,
        trackingNumber: orderRow.trackingNumber,
        customerNote: orderRow.customerNote,
        paidAt: orderRow.paidAt,
        shippedAt: orderRow.shippedAt,
        deliveredAt: orderRow.deliveredAt,
        createdAt: orderRow.createdAt,
        updatedAt: orderRow.updatedAt,
      },
      items,
      fulfillments.map((f) => ({ carrier: f.carrier, trackingNumber: f.trackingNumber })),
    );
  }

  async createOrder(
    dto: CreateOrderRequest,
    userId: string | undefined,
    sessionId?: string,
    auditMeta?: { ip?: string },
  ): Promise<Order> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单商品不能为空');
    }

    const receiverName = dto.buyerName?.trim();
    if (!receiverName) {
      throw new BadRequestException('收货人姓名不能为空');
    }
    if (receiverName.length > 100) {
      throw new BadRequestException('收货人姓名不能超过 100 个字符');
    }

    const shippingAddress = dto.shippingAddress?.trim();
    if (!shippingAddress) {
      throw new BadRequestException('收货地址不能为空');
    }
    if (shippingAddress.length > 500) {
      throw new BadRequestException('收货地址不能超过 500 个字符');
    }

    const shippingCity = dto.shippingCity?.trim();
    if (!shippingCity) {
      throw new BadRequestException('城市不能为空');
    }
    if (shippingCity.length > 100) {
      throw new BadRequestException('城市不能超过 100 个字符');
    }

    const shippingCountry = dto.shippingCountry?.trim();
    if (!shippingCountry) {
      throw new BadRequestException('国家不能为空');
    }
    if (shippingCountry.length > 100) {
      throw new BadRequestException('国家不能超过 100 个字符');
    }

    if (dto.buyerEmail && dto.buyerEmail.trim()) {
      const email = dto.buyerEmail.trim();
      if (email.length > 255) {
        throw new BadRequestException('邮箱不能超过 255 个字符');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new BadRequestException('邮箱格式不正确');
      }
    }

    if (dto.buyerPhone && dto.buyerPhone.trim()) {
      const phone = dto.buyerPhone.trim();
      if (phone.length > 50) {
        throw new BadRequestException('手机号不能超过 50 个字符');
      }
      const phoneRegex = /^[+]?[\d\s\-()]{6,50}$/;
      if (!phoneRegex.test(phone)) {
        throw new BadRequestException('手机号格式不正确');
      }
    }

    if (dto.shippingZip && dto.shippingZip.trim()) {
      const zip = dto.shippingZip.trim();
      if (zip.length > 20) {
        throw new BadRequestException('邮编不能超过 20 个字符');
      }
      const zipRegex = /^[\d\w\s\-]{3,20}$/;
      if (!zipRegex.test(zip)) {
        throw new BadRequestException('邮编格式不正确');
      }
    }

    if (dto.customerNote && dto.customerNote.length > 500) {
      throw new BadRequestException('备注不能超过 500 个字符');
    }

    const validPaymentMethods = new Set(['demo', 'stripe', 'paypal']);
    if (!validPaymentMethods.has(dto.paymentMethod)) {
      throw new BadRequestException('无效的支付方式');
    }

    // Resolve variant for each item (use provided variantId or first variant of product)
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const productRows = await this.db
      .select()
      .from(products)
      .where(inArray(products.id, productIds));

    if (productRows.length !== productIds.length) {
      throw new BadRequestException('部分商品不存在');
    }

    const productMap = new Map(productRows.map((p) => [p.id, p]));

    // 订单归属：同一订单只能包含同一卖家的商品（跨卖家合单会破坏卖家看板与退款归属）
    const { sellerId: orderSellerId, crossSeller } = resolveSingleSellerId(
      productRows.map((p) => p.sellerId),
    );
    if (crossSeller) {
      throw new BadRequestException('同一订单只能包含同一店铺的商品，请分开下单');
    }

    // Load all variants for these products
    const variantRows = await this.db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds));

    const variantsByProduct = new Map<string, typeof variantRows>();
    for (const v of variantRows) {
      const arr = variantsByProduct.get(v.productId) ?? [];
      arr.push(v);
      variantsByProduct.set(v.productId, arr);
    }

    // Resolve variantId for each item（按行索引对应，避免同商品多规格互相覆盖）
    const itemVariantIds: Array<{ index: number; variantId: string }> = [];
    dto.items.forEach((item, index) => {
      const variants = variantsByProduct.get(item.productId) ?? [];
      let variantId: string | undefined;
      if (item.variantId) {
        // 规格必须属于该商品，防止用其他商品的低价规格下单
        const matched = variants.find((v) => v.id === item.variantId);
        if (!matched) {
          const product = productMap.get(item.productId)!;
          throw new BadRequestException(`商品 ${product.titleEn} 的规格不存在`);
        }
        variantId = matched.id;
      } else {
        const activeVariants = variants.filter((v) => v.status === 'active');
        // 多规格商品必须显式选择规格，禁止静默回退到首个规格（会买错颜色/尺码）
        if (activeVariants.length > 1) {
          const product = productMap.get(item.productId)!;
          throw new BadRequestException(`商品 ${product.titleEn} 有多个规格，请先选择规格`);
        }
        variantId = activeVariants[0]?.id ?? variants[0]?.id;
      }
      if (!variantId) {
        const product = productMap.get(item.productId)!;
        throw new BadRequestException(`商品 ${product.titleEn} 没有可用的规格`);
      }
      itemVariantIds.push({ index, variantId });
    });

    // Map variantId → variant row for quick lookup
    const variantMap = new Map(variantRows.map((v) => [v.id, v]));

    dto.items.forEach((item, index) => {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('商品数量必须是正整数');
      }
      const product = productMap.get(item.productId);
      if (!product) {
        throw new BadRequestException('商品不存在');
      }
      if (product.status !== 'active') {
        throw new BadRequestException(`商品 ${product.titleEn} 已下架`);
      }
      const entry = itemVariantIds.find((e) => e.index === index);
      const variant = variantMap.get(entry!.variantId);
      if (!variant || variant.stock < item.quantity) {
        throw new BadRequestException(`商品 ${product.titleEn} 库存不足`);
      }
    });

    // ── 幂等短路：同一幂等键已经建过单，直接返回原单 ──
    // 放在库存校验之前：重复提交不应消耗任何库存检查配额，也不该因为
    // 「库存刚好被别人买走」而让用户看到失败——订单其实早已成功。
    const idempotencyKey = dto.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      if (idempotencyKey.length > 120) {
        throw new BadRequestException('幂等键过长');
      }
      const existingOrder = await this.db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existingOrder.length > 0) {
        // 必须带上本次请求的 userId/sessionId 做归属校验：
        // 幂等键是调用方自己生成的，但"能读到哪张单"仍要按身份判定，
        // 否则任何人猜到键就能拿到别人订单（信息泄露）。
        return this.getOrderDetail(existingOrder[0].id, userId, sessionId);
      }
    }

    // 币种与汇率：下单时快照，后续退款/结算/对账都按这个汇率复算。
    // 不在读取时现算——汇率每天变，历史订单会因此漂移。
    const currencyCode = (dto.currency ?? 'USD').trim().toUpperCase();
    const fxRate = await this.fxService.getRate(currencyCode);
    if (!fxRate) {
      throw new BadRequestException(`不支持的结算币种：${currencyCode}`);
    }
    // 汇率语义 1 USD = rate 个该币种；价格以 USD 为基准，乘 rate 得到本币价格
    const fxMultiplier = new Decimal(fxRate.rate);

    const orderNo = await this.generateUniqueOrderNo();

    let subtotal = new Decimal(0);
    const orderItemValues: Array<{
      productId: string;
      variantId: string;
      productTitle: string;
      variantInfo: string | null;
      productSku: string | null;
      productImage: string | null;
      unitPrice: string;
      quantity: number;
      subtotal: string;
      /** 发货仓（拆单时记录主仓） */
      warehouseId?: string | null;
    }> = [];

    dto.items.forEach((item, index) => {
      const product = productMap.get(item.productId)!;
      const entry = itemVariantIds.find((e) => e.index === index);
      const variant = variantMap.get(entry!.variantId)!;
      // 商品价格以 USD 为基准；按快照汇率折算为本单币种
      const unitPrice = new Decimal(variant.price as string).mul(fxMultiplier)
        .toDecimalPlaces(fxRate.decimalDigits, Decimal.ROUND_HALF_UP);
      const itemSubtotal = unitPrice.mul(item.quantity);
      subtotal = subtotal.plus(itemSubtotal);
      orderItemValues.push({
        productId: product.id,
        variantId: variant.id,
        productTitle: product.titleEn,
        variantInfo: Array.isArray(variant.optionValues) ? variant.optionValues.join(' / ') : null,
        productSku: variant.sku,
        productImage: variant.image ?? product.coverImage,
        unitPrice: unitPrice.toFixed(2),
        quantity: item.quantity,
        subtotal: itemSubtotal.toFixed(2),
      });
    });

    const subtotalStr = subtotal.toFixed(2);
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let discountAmount = new Decimal(0);

    if (dto.couponCode?.trim()) {
      const validation = await this.couponsService.validate(
        dto.couponCode.trim(),
        subtotalStr,
        userId,
        dto.items.map((item) => item.productId),
      );
      if (!validation.valid) {
        throw new BadRequestException(validation.message || '优惠券无效');
      }
      couponId = validation.coupon!.id;
      couponCode = validation.coupon!.code;
      discountAmount = new Decimal(validation.discountAmount);
    }

    // 运费由服务端按运费模板重算（客户端传入的展示值一律忽略）；重量/件数从订单行汇总
    const qtyTotal = dto.items.reduce((sum, item) => sum + item.quantity, 0);
    const weightTotal = dto.items.reduce((sum, item) => {
      const product = productMap.get(item.productId);
      const weight = product?.weight ? Number(product.weight) : 0;
      return sum + weight * item.quantity;
    }, 0);
    const shippingQuote = await this.shippingService.quoteForBuyer({
      country: shippingCountry,
      qtyTotal,
      weightTotal,
      subtotal: Number(subtotalStr),
    });

    // 免运费券：把运费归零（券面额 0，通过 free_shipping 标记表达）
    const freeShippingCoupon = dto.couponCode?.trim()
      ? (await this.couponsService.getCouponByCode(dto.couponCode.trim()))?.type === 'free_shipping'
      : false;

    const effectiveShippingFee = freeShippingCoupon ? 0 : shippingQuote.fee;

    // 跨境税额：按目的国规则计算，写进订单并落库。
    // 此前 taxAmount 恒为 0（代码注释直说 "税额(=0)"），
    // 导致跨境订单报价低于真实到手成本——买家结账看到的价格不成立。
    const taxComputation = computeTax({
      subtotal: subtotal.toFixed(2),
      shippingFee: String(effectiveShippingFee),
      discountAmount: discountAmount.toFixed(2),
      country: shippingCountry,
    });

    const pricing = computeOrderPricing({
      items: orderItemValues.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
      shippingFee: effectiveShippingFee,
      discountAmount: discountAmount.toFixed(2),
      taxAmount: taxComputation.total,
    });

    // 折算 USD 基准总额：结算与跨币种统计统一用 USD，避免每次查询都做换算
    const baseTotalUsd = new Decimal(pricing.totalAmount).div(fxMultiplier)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Build address snapshot
    const addressSnapshot: AddressSnapshot = {
      receiverName,
      phone: dto.buyerPhone?.trim() || undefined,
      addressLine1: dto.shippingAddress.trim(),
      addressLine2: undefined,
      city: dto.shippingCity.trim(),
      state: undefined,
      country: dto.shippingCountry.trim(),
      zipCode: dto.shippingZip?.trim() || undefined,
    };
    if (sessionId) {
      (addressSnapshot as unknown as Record<string, unknown>).sessionId = sessionId;
    }

    // 选仓：按目的国本地仓优先 → 优先级 → 可用量，算出从哪些仓发货。
    // 必须在事务外先算，失败时不必回滚已开的连接；实际扣减仍在事务内。
    const allocationPlans = await this.warehouseService.planAllocation(
      orderSellerId ?? '',
      dto.items.map((item, index) => ({
        variantId: itemVariantIds.find((e) => e.index === index)!.variantId,
        quantity: item.quantity,
      })),
      shippingCountry,
    );

    // 任一商品无法完全满足就拒绝下单，不做静默拆单或部分发货
    for (const [variantId, plan] of allocationPlans) {
      if (!plan.fulfillable) {
        // 区分两种失败：仓库没配 vs 真的没货。
        // 前者是配置问题，报"库存不足"会让人查错方向。
        const hasAnyWarehouse = plan.allocations.length > 0;
        if (!hasAnyWarehouse) {
          throw new ConflictException(
            '商品尚未配置仓库库存，无法下单。请在卖家后台为仓库分配库存后重试',
          );
        }
        throw new ConflictException(
          `库存不足（缺 ${plan.shortage} 件，SKU ${variantId.slice(0, 8)}），请减少数量后重试`,
        );
      }
    }

    const result = await this.db.transaction(async (tx) => {
      const insertedOrders = await tx
        .insert(orders)
        .values({
          orderNo,
          idempotencyKey,
          userId: userId ?? null,
          sellerId: orderSellerId,
          subtotal: pricing.subtotal,
          shippingFee: pricing.shippingFee,
          discountAmount: pricing.discountAmount,
          taxAmount: pricing.taxAmount,
          totalAmount: pricing.totalAmount,
          currency: currencyCode,
          exchangeRate: fxRate.rate.toFixed(8),
          baseTotalAmount: baseTotalUsd.toFixed(2),
          shippingTemplateId: shippingQuote.templateId,
          status: 'pending_payment',
          paymentMethod: (dto.paymentMethod?.trim() || 'demo') as 'stripe' | 'paypal' | 'demo',
          couponId,
          couponCode,
          addressSnapshot: JSON.stringify(addressSnapshot),
          customerNote: dto.customerNote?.trim() ?? dto.remark?.trim() ?? null,
        })
        .returning();

      const newOrder = insertedOrders[0];

      // 发货仓必须在写 order_items 之前确定：
      // 这个字段是"从哪发货"的永久记录，事后补写会漏掉并发窗口。
      dto.items.forEach((item, index) => {
        const variantId = itemVariantIds.find((e) => e.index === index)?.variantId;
        if (!variantId) return;
        const plan = allocationPlans.get(variantId);
        orderItemValues[index].warehouseId = plan?.allocations[0]?.warehouseId ?? null;
      });

      await tx.insert(orderItems).values(
        orderItemValues.map((item) => ({
          orderId: newOrder.id,
          productId: item.productId,
          variantId: item.variantId,
          productTitle: item.productTitle,
          variantInfo: item.variantInfo,
          productSku: item.productSku,
          productImage: item.productImage,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          subtotal: item.subtotal,
          warehouseId: item.warehouseId ?? null,
        })),
      );

      // 下单即锁定库存；销量（sold）在支付成功入账时累计（见 PaymentsService.markOrderPaid）
      //
      // 分仓扣减：按 planAllocation 算出的方案逐仓扣，扣不动就整体回滚。
      // 聚合字段（product_variants.stock / products.total_stock）随后按分仓总和重算，
      // 避免"分仓有货但商品显示售罄"。
      for (const [index, item] of dto.items.entries()) {
        const entry = itemVariantIds.find((e) => e.index === index);
        const variantId = entry!.variantId;
        const plan = allocationPlans.get(variantId);

        await this.warehouseService.deduct(
          tx as unknown as typeof this.db,
          (plan?.allocations ?? []).map((a) => ({
            warehouseId: a.warehouseId,
            variantId,
            quantity: a.quantity,
          })),
        );

      }

      if (couponId) {
        const couponUpdated = await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(and(
            eq(coupons.id, couponId),
            lt(coupons.usedCount, coupons.totalQuantity),
            eq(coupons.active, true),
          ))
          .returning({ id: coupons.id });
        if (couponUpdated.length === 0) {
          throw new ConflictException('优惠券已用完或已停用');
        }
      }

      if (userId) {
        await tx.delete(cartItems).where(eq(cartItems.userId, userId));
      } else if (sessionId) {
        await tx.delete(cartItems).where(eq(cartItems.sessionId, sessionId));
      }

      // 记录库存占用：与扣减同事务，保证"扣了库存就一定有对应的占用记录"。
      // 支付后转 consumed，取消/超时转 released。
      const reservationExpiry = new Date(
        Date.now() + Number(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES ?? 30) * 60 * 1000,
      );
      await this.stockReservation.reserveSoft(
        tx as unknown as typeof this.db,
        {
          orderId: newOrder.id,
          orderNo,
          items: dto.items
            .map((item, index) => {
              const entry = itemVariantIds.find((e) => e.index === index);
              return entry?.variantId
                ? { variantId: entry.variantId, quantity: item.quantity }
                : null;
            })
            .filter((v): v is { variantId: string; quantity: number } => v !== null),
          expiresAt: reservationExpiry,
        },
      );

      return newOrder;
    });

    // 记录每用户用量（per_user_limit 的判定依据；唯一索引保证幂等）
    if (couponId && userId) {
      try {
        await this.couponsService.recordCouponUsage(couponId, userId, result.id);
      } catch (error) {
        this.logger.warn(`记录优惠券用量失败（不影响下单）：${(error as Error).message}`);
      }
    }

    const createdOrder = await this.getOrderDetail(result.id, userId, sessionId);

    // Audit log for order creation
    try {
      void this.auditService.log({
        action: 'order.create',
        entity: 'order',
        entityId: orderNo,
        after: {
          totalAmount: createdOrder.totalAmount,
          status: createdOrder.status,
          itemsCount: createdOrder.items.length,
        },
        userId: userId,
        role: userId ? 'buyer' : undefined,
        ip: auditMeta?.ip,
      });
    } catch {
      // Audit log failure must not affect main flow
    }

    // Audit log for coupon redemption
    if (couponId) {
      try {
        void this.auditService.log({
          action: 'coupon.redeem',
          entity: 'coupon',
          entityId: couponId,
          after: {
            orderId: result.id,
          },
          userId: userId,
          role: userId ? 'buyer' : undefined,
          ip: auditMeta?.ip,
        });
      } catch {
        // Audit log failure must not affect main flow
      }
    }

    return createdOrder;
  }

  /**
   * 释放订单占用的资源：回补库存、归还优惠券额度、置为已取消。
   *
   * 抽成独立方法是因为有两条路径需要完全一致的语义：
   *   1. 卖家/买家主动取消
   *   2. 未支付订单超时自动取消（见 releaseExpiredOrders）
   * 此前两条路径各写一遍极易漂移——只补库存不退券，或反之。
   *
   * 用条件更新（status = 'pending_payment'）做幂等锚点：
   * 并发/重复调用时只有一次能成功，避免库存被回补两次。
   */
  private async releaseOrderResources(
    orderId: string,
    couponId: string | null,
    expectedStatus: OrderStatus,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // 先抢占状态：只有仍处于待付款的订单才允许释放
      const claimed = await tx
        .update(orders)
        .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, expectedStatus)))
        .returning({ id: orders.id });

      if (claimed.length === 0) return false;

      const items = await tx
        .select({
          productId: orderItems.productId,
          variantId: orderItems.variantId,
          quantity: orderItems.quantity,
          warehouseId: orderItems.warehouseId,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      // 回补到**实际发货仓**，不是笼统加到聚合字段：
      // 分仓模型下"回补错仓"会让 A 仓虚高、B 仓缺货。
      for (const item of items) {
        if (!item.variantId) continue;
        // restore() 内部会按分仓总和重算聚合字段（product_variants.stock / products.total_stock），
        // 这里**不能**再手动 +1 次，否则每次取消都会凭空多出库存。
        await this.warehouseService.restore(
          tx as unknown as typeof this.db,
          [{ warehouseId: item.warehouseId, variantId: item.variantId, quantity: item.quantity }],
        );
      }

      if (couponId) {
        await tx
          .update(coupons)
          .set({ usedCount: sql`GREATEST(${coupons.usedCount} - 1, 0)` })
          .where(eq(coupons.id, couponId));
      }

      // 预留状态与库存回补必须同事务：否则会留下"库存已回补但预留仍 active"的幽灵占用
      await this.stockReservation.releaseForOrder(tx as unknown as typeof this.db, orderId);

      return true;
    });
  }

  /**
   * 释放超时未支付的订单。
   *
   * 为什么必须有：下单即锁库存，但未支付订单此前**永不过期**。
   * 买家拍下不付款，库存就被永久占用，其他买家买不到——
   * 这是电商最常见的"隐性超卖"，比并发超卖更隐蔽。
   *
   * 默认 30 分钟（可通过 ORDER_PAYMENT_TIMEOUT_MINUTES 调整）。
   * 返回实际释放的订单号，便于审计与巡检上报。
   */
  async releaseExpiredOrders(limit = 100): Promise<{ released: string[]; scanned: number }> {
    const timeoutMinutes = Number(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES ?? 30);
    const minutes = Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 ? timeoutMinutes : 30;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const expired = await this.db
      .select({ id: orders.id, orderNo: orders.orderNo, couponId: orders.couponId })
      .from(orders)
      .where(and(eq(orders.status, 'pending_payment'), lt(orders.createdAt, cutoff)))
      .limit(limit);

    const released: string[] = [];
    for (const row of expired) {
      try {
        const ok = await this.releaseOrderResources(row.id, row.couponId, 'pending_payment');
        if (ok) {
          released.push(row.orderNo);
          this.logger.log(`未支付订单超时释放：${row.orderNo}（库存与优惠券已回补）`);
        }
      } catch (error) {
        this.logger.error(
          `释放超时订单失败 ${row.orderNo}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { released, scanned: expired.length };
  }

  async updateStatus(
    id: string,
    dto: OrderStatusUpdateRequest,
    userId?: string,
    role?: string,
    ip?: string,
  ): Promise<Order> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, id));
    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }

    const currentOrder = orderRows[0];
    const currentStatus = currentOrder.status as OrderStatus;
    const newStatus = dto.status;
    const orderNo = currentOrder.orderNo;

    // 归属校验：卖家只能操作自己店铺的订单（管理员可跨店）；
    // 买家取消订单由控制器先做 userId/sessionId 详情校验，此处不再按卖家归属拦截。
    if (role === 'seller' && !canAccessSellerResource(currentOrder.sellerId, userId, role)) {
      throw new ForbiddenException('无权操作该订单');
    }

    if (!canTransitionOrderStatus(currentStatus, newStatus)) {
      throw new BadRequestException(`不允许的订单状态变更: ${currentStatus} → ${newStatus}`);
    }

    if (newStatus === 'cancelled') {
      if (currentStatus !== 'pending_payment') {
        throw new BadRequestException('仅待付款订单可取消');
      }

      await this.releaseOrderResources(id, currentOrder.couponId, currentStatus);

      const updatedOrder = await this.getOrderDetail(id, undefined, undefined, { role: 'admin' });

      // Audit log for status change
      try {
        void this.auditService.log({
          action: 'order.status_change',
          entity: 'order',
          entityId: orderNo,
          before: { oldStatus: currentStatus },
          after: { newStatus },
          userId,
          role,
          ip,
        });
      } catch {
        // Audit log failure must not affect main flow
      }

      return updatedOrder;
    }

    if (newStatus === 'paid') {
      // 手动标记已支付（如线下转账）：走统一入账（记录渠道流水 + 累计销量 + 审计）
      await this.paymentsService.markOrderPaid(id, {
        provider: 'manual',
        transactionId: `MANUAL_${Date.now().toString(36).toUpperCase()}_${nanoid(6).toUpperCase()}`,
        amount: currentOrder.totalAmount as string,
        actorUserId: userId,
      });
    } else {
      const updateData: Partial<typeof orders.$inferInsert> = {
        status: newStatus,
        updatedAt: new Date(),
      };

      const now = new Date();
      if (newStatus === 'shipped') {
        updateData.shippedAt = now;
        if (dto.trackingNumber !== undefined) {
          updateData.trackingNumber = dto.trackingNumber;
          updateData.carrier = dto.carrier ?? null;
        }
      } else if (newStatus === 'delivered') {
        updateData.deliveredAt = now;
      }

      await this.db
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, id));
    }

    const updatedOrder = await this.getOrderDetail(id, undefined, undefined, { role: 'admin' });

    // Audit log for status change
    try {
      void this.auditService.log({
        action: 'order.status_change',
        entity: 'order',
        entityId: orderNo,
        before: { oldStatus: currentStatus },
        after: { newStatus },
        userId,
        role,
        ip,
      });
    } catch {
      // Audit log failure must not affect main flow
    }

    return updatedOrder;
  }

}
