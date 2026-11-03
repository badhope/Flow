import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { aiSettings, orders, products, refunds } from '../../database/schema';
import type {
  CopilotInsight,
  CopilotInsightThresholds,
  CopilotInsightsView,
} from '../../../shared/api.interface';
import { mergeInsightThresholds } from './copilot-insight-thresholds';

/** ai_settings 中保存巡检阈值的键（JSON） */
export const INSIGHT_THRESHOLDS_KEY = 'copilot_insight_thresholds';

function scopedThresholdKey(actor?: { userId?: string; role?: string }): string {
  if (!actor?.userId || actor.role === 'admin') return INSIGHT_THRESHOLDS_KEY;
  return `${actor.userId}:${INSIGHT_THRESHOLDS_KEY}`;
}

/**
 * 店铺巡检：纯 SQL 聚合出的可执行告警，不调用 LLM。
 * 目的是让副驾在卖家提问前就能给出待办清单；每条告警都带一句可直接发给副驾的 prompt。
 */
@Injectable()
export class CopilotInsightsService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  async getThresholds(actor?: { userId?: string; role?: string }): Promise<CopilotInsightThresholds> {
    const rows = await this.db
      .select({ value: aiSettings.value })
      .from(aiSettings)
      .where(eq(aiSettings.key, scopedThresholdKey(actor)))
      .limit(1);
    return mergeInsightThresholds(rows[0]?.value);
  }

  async getInsights(actor?: { userId?: string; role?: string }): Promise<CopilotInsightsView> {
    const thresholds = await this.getThresholds(actor);
    // 卖家巡检只看本店（管理员不传 userId 时看全平台）
    const sellerId = actor && actor.role !== 'admin' ? actor.userId : undefined;
    const [lowStock, staleRefunds, unpaidOrders, staleShipments] = await Promise.all([
      this.lowStock(thresholds, sellerId),
      this.staleRefunds(thresholds, sellerId),
      this.unpaidOrders(thresholds, sellerId),
      this.staleShipments(thresholds, sellerId),
    ]);

    const insights = [...lowStock, ...staleRefunds, ...unpaidOrders, ...staleShipments].sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity),
    );

    return {
      generatedAt: new Date().toISOString(),
      thresholds,
      insights,
    };
  }

  /** 保存阈值（叠加在当前配置上；未变化时直接返回，不写库） */
  async updateThresholds(
    input: Partial<CopilotInsightThresholds>,
    actor: { userId?: string; role?: string },
  ): Promise<CopilotInsightThresholds> {
    const current = await this.getThresholds(actor);
    const next: CopilotInsightThresholds = { ...current, ...input };

    const changed = (Object.keys(next) as Array<keyof CopilotInsightThresholds>)
      .some((key) => next[key] !== current[key]);
    if (!changed) return current;

    await this.db
      .insert(aiSettings)
      .values({
        key: scopedThresholdKey(actor),
        value: JSON.stringify(next),
        updatedBy: actor.userId ?? '',
      })
      .onConflictDoUpdate({
        target: aiSettings.key,
        set: { value: JSON.stringify(next), updatedBy: actor.userId ?? '', updatedAt: new Date() },
      });

    return next;
  }

  private async lowStock(thresholds: CopilotInsightThresholds, sellerId?: string): Promise<CopilotInsight[]> {
    const conditions = [eq(products.status, 'active'), sql`${products.totalStock} < ${thresholds.lowStock}`];
    if (sellerId) conditions.push(eq(products.sellerId, sellerId));
    const rows = await this.db
      .select({
        id: products.id,
        title: products.titleZh,
        totalStock: products.totalStock,
        totalSold: products.totalSold,
      })
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(products.totalStock))
      .limit(10);

    return rows.map((row) => ({
      id: `low-stock-${row.id}`,
      type: 'low_stock' as const,
      severity: row.totalStock === 0 ? ('critical' as const) : ('warning' as const),
      title: row.totalStock === 0 ? '商品已售罄' : '库存偏低',
      detail: `${row.title || '未命名商品'} 当前库存 ${row.totalStock}，已售 ${row.totalSold}`,
      suggestion: `补货或下架：${row.title}`,
      prompt: `商品 ${row.title}（id=${row.id}）库存只剩 ${row.totalStock}，帮我下架并分析是否需要补货`,
      entityId: row.id,
    }));
  }

  private async staleRefunds(thresholds: CopilotInsightThresholds, sellerId?: string): Promise<CopilotInsight[]> {
    const conditions = [eq(refunds.status, 'requested'), sql`${refunds.createdAt} < ${cutoffIso(thresholds.pendingRefundHours)}`];
    if (sellerId) conditions.push(eq(orders.sellerId, sellerId));
    const rows = await this.db
      .select({
        id: refunds.id,
        refundNo: refunds.refundNo,
        amount: refunds.amount,
        reason: refunds.reason,
        createdAt: refunds.createdAt,
        orderNo: orders.orderNo,
      })
      .from(refunds)
      .leftJoin(orders, eq(refunds.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(asc(refunds.createdAt))
      .limit(10);

    return rows.map((row) => ({
      id: `refund-${row.id}`,
      type: 'stale_refund' as const,
      severity: 'critical' as const,
      title: '退款超时未处理',
      detail: `退款单 ${row.refundNo}（订单 ${row.orderNo ?? '未知'}，$${row.amount}）已等待超过 ${thresholds.pendingRefundHours} 小时：${row.reason}`,
      suggestion: '尽快审批或拒绝并说明原因',
      prompt: `退款单 ${row.refundNo} 已超时，帮我查看详情并给出处理建议`,
      entityId: row.id,
    }));
  }

  private async unpaidOrders(thresholds: CopilotInsightThresholds, sellerId?: string): Promise<CopilotInsight[]> {
    const conditions = [eq(orders.status, 'pending_payment'), sql`${orders.createdAt} < ${cutoffIso(thresholds.unpaidOrderHours)}`];
    if (sellerId) conditions.push(eq(orders.sellerId, sellerId));
    const rows = await this.db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        totalAmount: orders.totalAmount,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(...conditions))
      .orderBy(asc(orders.createdAt))
      .limit(10);

    return rows.map((row) => ({
      id: `unpaid-${row.id}`,
      type: 'unpaid_order' as const,
      severity: 'warning' as const,
      title: '订单超时未支付',
      detail: `订单 ${row.orderNo}（$${row.totalAmount}）创建于 ${row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}，仍未支付`,
      suggestion: '考虑取消订单释放库存',
      prompt: `订单 ${row.orderNo} 超时未支付，帮我确认后取消并释放库存`,
      entityId: row.id,
    }));
  }

  private async staleShipments(thresholds: CopilotInsightThresholds, sellerId?: string): Promise<CopilotInsight[]> {
    const conditions = [
      eq(orders.status, 'shipped'),
      gte(orders.shippedAt, sql`'1970-01-01'::timestamptz`),
      sql`${orders.shippedAt} < ${cutoffIso(thresholds.staleShippedDays * 24)}`,
    ];
    if (sellerId) conditions.push(eq(orders.sellerId, sellerId));
    const rows = await this.db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        shippedAt: orders.shippedAt,
        trackingNumber: orders.trackingNumber,
      })
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.shippedAt))
      .limit(10);

    return rows.map((row) => ({
      id: `stale-shipment-${row.id}`,
      type: 'stale_shipment' as const,
      severity: 'info' as const,
      title: '发货后长期未签收',
      detail: `订单 ${row.orderNo} 已发货 ${thresholds.staleShippedDays} 天以上（运单 ${row.trackingNumber ?? '未填'}），仍未标记送达`,
      suggestion: '核对物流后标记送达或联系买家',
      prompt: `订单 ${row.orderNo} 发货超过 ${thresholds.staleShippedDays} 天，帮我核对物流状态`,
      entityId: row.id,
    }));
  }
}

/** 截止时间：当前时间减去 N 小时（ISO 字符串，供 SQL 参数化比较） */
function cutoffIso(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function severityRank(severity: CopilotInsight['severity']): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}
