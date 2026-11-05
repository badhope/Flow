import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { commissionRules, orders, refunds, settlements } from '../../database/schema';

/**
 * 卖家结算与平台佣金。
 *
 * 为什么必须有：一个跨境平台要让卖家留下，最基础的一件事是「我卖了多少、平台抽了多少、
 * 什么时候打给我」。此前系统只有订单流水，没有任何结算概念——卖家要自己对账，
 * 而且平台侧没有抽成记录，等于这个商业模型没闭环。
 *
 * 计算口径（写死在代码里，避免每次靠人回忆）：
 *   应结 = 周期内已支付订单的 USD 基准额
 *        − 该周期发生的退款
 *        − 佣金（按卖家费率的百分比 × 应结基数）
 *        − 固定手续费 × 订单数
 *
 * 关键取舍：
 *   1. **一律用 USD 基准额**（订单落库时的快照），不按当前汇率换算——
 *      否则同一笔订单在不同时间结算会得到不同金额。
 *   2. **佣金费率快照到结算单**。卖家改费率不影响已生成的结算单。
 *   3. **退款按退款发生时间归属**，而不是按原订单时间。这样"这个月退了上个月的单"
 *      会体现在本月结算里，符合现金流事实。
 */

export interface SettlementLine {
  orderNo: string;
  paidAt: string | null;
  gross: string;
  refund: string;
  commission: string;
  net: string;
}

export interface SettlementView {
  id: string;
  settlementNo: string;
  sellerId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossAmount: string;
  refundAmount: string;
  commissionAmount: string;
  netAmount: string;
  orderCount: number;
  refundCount: number;
  commissionRate: string;
  fixedFeeTotal: string;
  lineItems: SettlementLine[];
  note?: string;
  paidAt?: string;
  createdAt: string;
}

export interface CommissionRuleView {
  sellerId: string | null;
  rate: string;
  fixedFee: string;
  fixedFeeCurrency: string;
  note?: string;
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  /** 取卖家生效的佣金规则：卖家专属优先，否则用全局默认 */
  async resolveCommissionRule(sellerId: string): Promise<CommissionRuleView> {
    const own = await this.db
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.sellerId, sellerId))
      .limit(1);
    if (own.length > 0) {
      return {
        sellerId: own[0].sellerId,
        rate: own[0].rate as string,
        fixedFee: own[0].fixedFee as string,
        fixedFeeCurrency: own[0].fixedFeeCurrency,
        note: own[0].note ?? undefined,
      };
    }
    const fallback = await this.db
      .select()
      .from(commissionRules)
      .where(sql`${commissionRules.sellerId} IS NULL`)
      .limit(1);
    if (fallback.length === 0) {
      // 连默认规则都没有时给一个保守值，而不是 0 佣金（那等于平台白干）
      this.logger.warn('未配置佣金规则，使用内置默认 8%');
      return { sellerId: null, rate: '8.000', fixedFee: '0', fixedFeeCurrency: 'USD' };
    }
    return {
      sellerId: null,
      rate: fallback[0].rate as string,
      fixedFee: fallback[0].fixedFee as string,
      fixedFeeCurrency: fallback[0].fixedFeeCurrency,
      note: fallback[0].note ?? undefined,
    };
  }

  /** 管理员设置佣金规则（sellerId 为 null 表示全局默认） */
  async setCommissionRule(
    sellerId: string | null,
    input: { rate: number; fixedFee?: number; note?: string },
  ): Promise<CommissionRuleView> {
    if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) {
      throw new BadRequestException('佣金费率必须在 0–100 之间');
    }
    const fixedFee = input.fixedFee ?? 0;
    if (!Number.isFinite(fixedFee) || fixedFee < 0) {
      throw new BadRequestException('固定手续费不能为负');
    }

    const existing = sellerId
      ? await this.db.select().from(commissionRules).where(eq(commissionRules.sellerId, sellerId)).limit(1)
      : await this.db.select().from(commissionRules).where(sql`${commissionRules.sellerId} IS NULL`).limit(1);

    if (existing.length > 0) {
      const updated = await this.db
        .update(commissionRules)
        .set({
          rate: input.rate.toFixed(3),
          fixedFee: fixedFee.toFixed(2),
          note: input.note ?? existing[0].note,
          updatedAt: new Date(),
        })
        .where(eq(commissionRules.id, existing[0].id))
        .returning();
      return {
        sellerId: updated[0].sellerId,
        rate: updated[0].rate as string,
        fixedFee: updated[0].fixedFee as string,
        fixedFeeCurrency: updated[0].fixedFeeCurrency,
        note: updated[0].note ?? undefined,
      };
    }

    const inserted = await this.db
      .insert(commissionRules)
      .values({
        sellerId,
        rate: input.rate.toFixed(3),
        fixedFee: fixedFee.toFixed(2),
        note: input.note,
      })
      .returning();
    return {
      sellerId: inserted[0].sellerId,
      rate: inserted[0].rate as string,
      fixedFee: inserted[0].fixedFee as string,
      fixedFeeCurrency: inserted[0].fixedFeeCurrency,
      note: inserted[0].note ?? undefined,
    };
  }

  /**
   * 生成某个卖家在指定周期的结算单。
   *
   * 幂等：同一卖家 + 同一周期已有未取消的结算单时直接返回它，
   * 避免运营重复点击生成出两张金额相同的单据。
   */
  async generate(
    sellerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<SettlementView> {
    if (periodEnd <= periodStart) {
      throw new BadRequestException('结算周期结束时间必须晚于开始时间');
    }

    const existing = await this.db
      .select()
      .from(settlements)
      .where(and(
        eq(settlements.sellerId, sellerId),
        eq(settlements.periodStart, periodStart),
        eq(settlements.periodEnd, periodEnd),
        inArray(settlements.status, ['pending', 'paid']),
      ))
      .limit(1);
    if (existing.length > 0) {
      return this.toView(existing[0]);
    }

    const rule = await this.resolveCommissionRule(sellerId);
    const rate = new Decimal(rule.rate).div(100);
    const fixedFee = new Decimal(rule.fixedFee);

    // 周期内已支付订单（用 paidAt 归属，不是 createdAt —— 结算看现金流）
    const paidOrders = await this.db
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        paidAt: orders.paidAt,
        baseTotalAmount: orders.baseTotalAmount,
        totalAmount: orders.totalAmount,
        currency: orders.currency,
      })
      .from(orders)
      .where(and(
        eq(orders.sellerId, sellerId),
        gte(orders.paidAt, periodStart),
        lt(orders.paidAt, periodEnd),
        inArray(orders.status, ['paid', 'shipped', 'delivered', 'partially_refunded', 'refunded']),
      ))
      .orderBy(asc(orders.paidAt));

    // 周期内发生的退款（按退款时间归属）
    const periodRefunds = await this.db
      .select({
        orderId: refunds.orderId,
        amount: refunds.amount,
        status: refunds.status,
      })
      .from(refunds)
      .where(and(
        gte(refunds.createdAt, periodStart),
        lt(refunds.createdAt, periodEnd),
        inArray(refunds.status, ['approved', 'completed']),
      ));

    const refundByOrder = new Map<string, Decimal>();
    for (const r of periodRefunds) {
      const prev = refundByOrder.get(r.orderId) ?? new Decimal(0);
      // 退款金额记录的是订单币种，需要折回 USD 才能与 baseTotalAmount 同口径
      const orderRow = paidOrders.find((o) => o.id === r.orderId);
      if (!orderRow) continue;
      const orderCurrency = orderRow.currency ?? 'USD';
      // baseTotalAmount 已是 USD；退款按同样比例折算
      const orderTotal = new Decimal(orderRow.totalAmount as string);
      const ratio = orderTotal.isZero()
        ? new Decimal(0)
        : new Decimal(orderRow.baseTotalAmount as string).div(orderTotal);
      refundByOrder.set(r.orderId, prev.plus(new Decimal(r.amount as string).mul(ratio)));
    }

    const lines: SettlementLine[] = [];
    let gross = new Decimal(0);
    let refundTotal = new Decimal(0);
    let commissionTotal = new Decimal(0);
    let refundCount = 0;

    for (const o of paidOrders) {
      const orderGross = new Decimal(o.baseTotalAmount as string);
      // 早期订单可能没有 baseTotalAmount，兜底按 1:1（USD 单）
      const g = orderGross.isZero() ? new Decimal(o.totalAmount as string) : orderGross;
      const refund = refundByOrder.get(o.id) ?? new Decimal(0);
      const commission = g.mul(rate).plus(fixedFee);
      const net = g.minus(refund).minus(commission);

      gross = gross.plus(g);
      refundTotal = refundTotal.plus(refund);
      commissionTotal = commissionTotal.plus(commission);
      if (refund.greaterThan(0)) refundCount += 1;

      lines.push({
        orderNo: o.orderNo,
        paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        gross: g.toFixed(2),
        refund: refund.toFixed(2),
        commission: commission.toFixed(2),
        net: net.toFixed(2),
      });
    }

    const netTotal = gross.minus(refundTotal).minus(commissionTotal);
    const settlementNo = await this.generateNo();

    const inserted = await this.db
      .insert(settlements)
      .values({
        settlementNo,
        sellerId,
        status: 'pending',
        periodStart,
        periodEnd,
        currency: 'USD',
        grossAmount: gross.toFixed(2),
        refundAmount: refundTotal.toFixed(2),
        commissionAmount: commissionTotal.toFixed(2),
        netAmount: Decimal.max(netTotal, 0).toFixed(2),
        orderCount: paidOrders.length,
        refundCount,
        commissionRate: rule.rate,
        fixedFeeTotal: fixedFee.mul(paidOrders.length).toFixed(2),
        lineItems: lines as unknown as Record<string, unknown>[],
      })
      .returning();

    this.logger.log(
      `生成结算单 ${settlementNo}：卖家 ${sellerId}，${paidOrders.length} 单，净额 ${netTotal.toFixed(2)} USD`,
    );
    return this.toView(inserted[0]);
  }

  /** 卖家：自己的结算单；管理员：全部 */
  async list(actor: { userId?: string; role?: string }, limit = 50): Promise<SettlementView[]> {
    const conditions = [];
    if (actor.role === 'seller') {
      if (!actor.userId) return [];
      conditions.push(eq(settlements.sellerId, actor.userId));
    }
    const rows = await this.db
      .select()
      .from(settlements)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(settlements.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((r) => this.toView(r));
  }

  async getOne(id: string, actor: { userId?: string; role?: string }): Promise<SettlementView> {
    const rows = await this.db.select().from(settlements).where(eq(settlements.id, id));
    if (rows.length === 0) throw new NotFoundException('结算单不存在');
    if (actor.role === 'seller' && rows[0].sellerId !== actor.userId) {
      throw new NotFoundException('结算单不存在');
    }
    return this.toView(rows[0]);
  }

  /** 管理员：标记已打款 */
  async markPaid(id: string): Promise<SettlementView> {
    const rows = await this.db.select().from(settlements).where(eq(settlements.id, id));
    if (rows.length === 0) throw new NotFoundException('结算单不存在');
    if (rows[0].status !== 'pending') {
      throw new BadRequestException(`当前状态 ${rows[0].status} 无法标记为已打款`);
    }
    const updated = await this.db
      .update(settlements)
      .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
      .where(eq(settlements.id, id))
      .returning();
    return this.toView(updated[0]);
  }

  /** 卖家看板：待结算与已结算总额 */
  async getSummary(sellerId: string): Promise<{
    pendingAmount: string;
    paidAmount: string;
    pendingCount: number;
    lastSettlementAt: string | null;
  }> {
    const pending = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${settlements.netAmount}), 0)::text`,
        count: sql<number>`COUNT(*)`,
      })
      .from(settlements)
      .where(and(eq(settlements.sellerId, sellerId), eq(settlements.status, 'pending')));

    const paid = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${settlements.netAmount}), 0)::text` })
      .from(settlements)
      .where(and(eq(settlements.sellerId, sellerId), eq(settlements.status, 'paid')));

    const last = await this.db
      .select({ createdAt: settlements.createdAt })
      .from(settlements)
      .where(eq(settlements.sellerId, sellerId))
      .orderBy(desc(settlements.createdAt))
      .limit(1);

    return {
      pendingAmount: pending[0]?.total ?? '0.00',
      paidAmount: paid[0]?.total ?? '0.00',
      pendingCount: Number(pending[0]?.count ?? 0),
      lastSettlementAt: last[0]?.createdAt ? last[0].createdAt.toISOString() : null,
    };
  }

  private async generateNo(): Promise<string> {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const seq = String(now.getTime()).slice(-6);
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ST${stamp}${seq}${rand}`;
  }

  private toView(row: typeof settlements.$inferSelect): SettlementView {
    return {
      id: row.id,
      settlementNo: row.settlementNo,
      sellerId: row.sellerId,
      status: row.status,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      currency: row.currency,
      grossAmount: row.grossAmount as string,
      refundAmount: row.refundAmount as string,
      commissionAmount: row.commissionAmount as string,
      netAmount: row.netAmount as string,
      orderCount: row.orderCount,
      refundCount: row.refundCount,
      commissionRate: row.commissionRate as string,
      fixedFeeTotal: row.fixedFeeTotal as string,
      lineItems: (row.lineItems ?? []) as unknown as SettlementLine[],
      note: row.note ?? undefined,
      paidAt: row.paidAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
