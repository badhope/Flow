import { Injectable, Inject, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { eq, and, desc } from 'drizzle-orm';
import { logistics, orders, orderFulfillments } from '../../database/schema';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';

export interface TrackingEvent {
  time: string;
  status: string;
  location: string;
  description: string;
}

export interface TrackingInfo {
  events: TrackingEvent[];
  carrier: string | null;
  trackingNumber: string | null;
  fulfillments: Array<{
    carrier: string;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: string;
    shippedAt: string | null;
  }>;
  isDemo: boolean;
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);
  private readonly apiKey: string;
  private readonly isDemoMode: boolean;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {
    this.apiKey = process.env['17TRACK_API_KEY'] || '';
    // 诚实标注（v1.21.1 修正）：当前版本 17TRACK 未实现真实 HTTP 查询，
    // getTrackingInfo 恒走 generateDemoTimeline；isDemo 恒为 true，
    // 前端「演示物流」水印恒显示。配置 Key 仅预留，不改变行为（真实接入见 Roadmap）。
    this.isDemoMode = true;
  }

  async registerTracking(
    orderId: string,
    carrier: string,
    trackingNumber: string,
    trackingUrl?: string,
  ): Promise<{ success: boolean; isDemo: boolean; fulfillmentId: string }> {
    if (this.isDemoMode) {
      const fulfillmentId = await this.upsertFulfillmentAndShipOrder(orderId, carrier, trackingNumber, trackingUrl);
      return { success: true, isDemo: true, fulfillmentId };
    }

    try {
      const fulfillmentId = await this.upsertFulfillmentAndShipOrder(orderId, carrier, trackingNumber, trackingUrl);
      return { success: true, isDemo: false, fulfillmentId };
    } catch (error) {
      this.logger.error('注册运单失败', error);
      throw error;
    }
  }

  private async upsertFulfillmentAndShipOrder(
    orderId: string,
    carrier: string,
    trackingNumber: string,
    trackingUrl?: string,
  ): Promise<string> {
    const result = await this.db.transaction(async (tx) => {
      // Check for existing pending fulfillment for this order
      const existingFulfillments = await tx
        .select()
        .from(orderFulfillments)
        .where(and(
          eq(orderFulfillments.orderId, orderId),
          eq(orderFulfillments.status, 'pending'),
        ))
        .limit(1);

      let fulfillmentId: string;

      if (existingFulfillments.length > 0) {
        // Update existing pending fulfillment
        await tx
          .update(orderFulfillments)
          .set({
            carrier,
            trackingNumber,
            trackingUrl: trackingUrl ?? null,
            status: 'shipped',
            shippedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(orderFulfillments.id, existingFulfillments[0].id));
        fulfillmentId = existingFulfillments[0].id;
      } else {
        // Create new fulfillment
        const inserted = await tx.insert(orderFulfillments).values({
          orderId,
          carrier,
          trackingNumber,
          trackingUrl: trackingUrl ?? null,
          status: 'shipped',
          shippedAt: new Date(),
        }).returning();
        fulfillmentId = inserted[0].id;
      }

      // Update order status if not already shipped
      const orderRows = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (orderRows.length > 0 && orderRows[0].status === 'paid') {
        await tx
          .update(orders)
          .set({
            status: 'shipped',
            trackingNumber,
            carrier,
            shippedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId));
      }

      // Upsert logistics record for tracking data
      const existingLogistics = await tx
        .select({ id: logistics.id, fulfillmentId: logistics.fulfillmentId })
        .from(logistics)
        .where(eq(logistics.orderId, orderId))
        .limit(1);

      if (existingLogistics.length > 0) {
        await tx
          .update(logistics)
          .set({
            carrier,
            trackingNumber,
            fulfillmentId,
            status: 'in_transit',
            updatedAt: new Date(),
          })
          .where(eq(logistics.id, existingLogistics[0].id));
      } else {
        await tx.insert(logistics).values({
          orderId,
          fulfillmentId,
          carrier,
          trackingNumber,
          status: 'in_transit',
        });
      }

      return fulfillmentId;
    });

    return result;
  }

  async getTrackingInfo(orderId: string): Promise<TrackingInfo> {
    const [order] = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
        shippedAt: orders.shippedAt,
        deliveredAt: orders.deliveredAt,
        carrier: orders.carrier,
        trackingNumber: orders.trackingNumber,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    // Load fulfillments for this order
    const fulfillments = await this.db
      .select()
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, orderId))
      .orderBy(desc(orderFulfillments.createdAt));

    // Load logistics records
    const logisticsRecord = await this.db
      .select({
        carrier: logistics.carrier,
        trackingNumber: logistics.trackingNumber,
        status: logistics.status,
      })
      .from(logistics)
      .where(eq(logistics.orderId, orderId))
      .limit(1);

    const primaryCarrier = fulfillments.length > 0 ? fulfillments[0].carrier : (logisticsRecord[0]?.carrier ?? null);
    const primaryTracking = fulfillments.length > 0 ? fulfillments[0].trackingNumber : (logisticsRecord[0]?.trackingNumber ?? null);

    const events = this.generateDemoTimeline(order);

    return {
      events,
      carrier: primaryCarrier,
      trackingNumber: primaryTracking,
      fulfillments: fulfillments.map((f) => ({
        carrier: f.carrier,
        trackingNumber: f.trackingNumber,
        trackingUrl: f.trackingUrl,
        status: f.status,
        shippedAt: f.shippedAt?.toISOString() ?? null,
      })),
      isDemo: this.isDemoMode,
    };
  }

  /** 卖家侧归属校验：订单必须属于当前卖家（管理员可跨店） */
  async verifySellerOwnership(
    orderId: string,
    sellerId: string | undefined,
    role?: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ sellerId: orders.sellerId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('订单不存在');
    if (!isPlatformAdmin(role) && (!sellerId || rows[0].sellerId !== sellerId)) {
      throw new ForbiddenException('无权操作该订单物流');
    }
  }

  async verifyOrderOwnership(
    orderId: string,
    userId: string | undefined,
    sessionId: string | undefined,
  ): Promise<void> {
    const orderRows = await this.db
      .select({
        id: orders.id,
        userId: orders.userId,
        addressSnapshot: orders.addressSnapshot,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (orderRows.length === 0) {
      throw new NotFoundException('订单不存在');
    }
    const order = orderRows[0];

    if (userId && order.userId === userId) {
      return;
    }

    // Check session via addressSnapshot
    if (sessionId && order.addressSnapshot) {
      try {
        const snap = JSON.parse(order.addressSnapshot) as { sessionId?: string };
        if (snap.sessionId === sessionId) {
          return;
        }
      } catch {
        // ignore parse error
      }
    }

    throw new ForbiddenException('无权查看该订单物流');
  }

  private generateDemoTimeline(order: {
    status: string;
    createdAt: Date;
    paidAt: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
  }): TrackingEvent[] {
    const events: TrackingEvent[] = [];
    const status = order.status;

    // Always include order placed event
    events.push({
      time: order.createdAt.toISOString(),
      status: 'order_placed',
      location: '',
      description: '订单已提交',
    });

    if (status === 'pending_payment') {
      return events;
    }

    if (order.paidAt) {
      events.push({
        time: order.paidAt.toISOString(),
        status: 'paid',
        location: '',
        description: '订单已付款',
      });
    }

    if (status === 'paid') {
      return events;
    }

    if (order.shippedAt) {
      const shippedTime = order.shippedAt;
      events.push({
        time: shippedTime.toISOString(),
        status: 'shipped',
        location: '中国深圳',
        description: '包裹已发出，等待承运人揽收',
      });

      // Add in_transit event (1 day after shipping)
      const inTransitTime = new Date(shippedTime.getTime() + 24 * 60 * 60 * 1000);
      events.push({
        time: inTransitTime.toISOString(),
        status: 'in_transit',
        location: '香港转运中心',
        description: '包裹已到达转运中心，正在安排国际运输',
      });

      // Add customs event (3 days after shipping)
      const customsTime = new Date(shippedTime.getTime() + 3 * 24 * 60 * 60 * 1000);
      events.push({
        time: customsTime.toISOString(),
        status: 'customs',
        location: '目的国海关',
        description: '包裹正在清关处理中',
      });
    }

    if (status === 'shipped' || status === 'in_transit') {
      return events;
    }

    if (order.deliveredAt) {
      events.push({
        time: order.deliveredAt.toISOString(),
        status: 'delivered',
        location: '收件地址',
        description: '包裹已签收',
      });
    }

    if (status === 'cancelled') {
      events.push({
        time: order.createdAt.toISOString(),
        status: 'cancelled',
        location: '',
        description: '订单已取消',
      });
    }

    return events;
  }
}
