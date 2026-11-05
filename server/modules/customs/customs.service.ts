import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Decimal } from 'decimal.js';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import {
  customsDeclarations, orderItems, orders, products,
} from '../../database/schema';

/**
 * 清关单据。
 *
 * 为什么必须有：跨境订单在目的国清关时需要一份申报清单，包含每项商品的
 * HS 编码、英文品名、数量、单价、原产国。此前系统完全没有这个概念——
 * 卖家只能手工在 Excel 里拼一份，或者干脆用商品展示标题申报，被海关退回。
 *
 * 设计取舍：
 *   1. **行项目快照**。商品后续改价改名不影响已生成的单据，这是单据的底线。
 *   2. **缺 HS 码不等于阻断**。生成时对缺失项给出显式告警而不是静默跳过，
 *      因为海关不认"忘了填"，但电商也不该因为一个字段没填就禁止发货。
 *   3. **申报价值用成交价**，不是 listing 原价——折扣后的实际支付金额才是
 *      海关认定的完税价格（这一点写错会被认定为低报）。
 */

export interface CustomsLineItem {
  sku: string;
  hsCode: string | null;
  description: string;
  quantity: number;
  unitValue: string;
  totalValue: string;
  originCountry: string | null;
  weightKg: number | null;
  /** 缺失 HS 码等问题的显式标记 */
  warnings: string[];
}

export interface CustomsDeclarationView {
  id: string;
  declarationNo: string;
  orderId: string;
  orderNo: string;
  status: string;
  destinationCountry: string;
  originCountry: string;
  declaredValue: string;
  declaredCurrency: string;
  declaredValueUsd: string;
  lineItems: CustomsLineItem[];
  note?: string;
  generatedAt: string;
  filedAt?: string;
  /** 整单层面的告警（如全部商品缺 HS 码） */
  warnings: string[];
}

@Injectable()
export class CustomsService {
  private readonly logger = new Logger(CustomsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  /**
   * 为订单生成清关单据。
   *
   * 幂等：同一订单重复调用返回已有单据（用 orderId 查），不会重复生成。
   * 这样"生成"按钮可以放心点多次，也方便订单详情页自动补齐。
   */
  async generateForOrder(orderId: string, actor?: { userId?: string; role?: string }): Promise<CustomsDeclarationView> {
    const existing = await this.db
      .select()
      .from(customsDeclarations)
      .where(eq(customsDeclarations.orderId, orderId))
      .limit(1);
    if (existing.length > 0) {
      return this.toView(existing[0]);
    }

    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (orderRows.length === 0) throw new NotFoundException('订单不存在');
    const order = orderRows[0];

    // 归属校验：卖家只能给自己店铺的订单开单
    if (actor?.role === 'seller' && order.sellerId !== actor.userId) {
      throw new NotFoundException('订单不存在');
    }

    // 直接用 order_items 里的快照字段：SKU 与标题在下单时已固化，
    // 不需要 join product_variants（而且历史变体可能已被删除）。
    const items = await this.db
      .select({
        sku: orderItems.productSku,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        productId: orderItems.productId,
        variantId: orderItems.variantId,
        productTitle: orderItems.productTitle,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const productIds = items.map((i) => i.productId).filter((v): v is string => !!v);
    const productRows = productIds.length > 0
      ? await this.db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const lineItems: CustomsLineItem[] = [];
    const warnings: string[] = [];

    for (const item of items) {
      const product = item.productId ? productMap.get(item.productId) : undefined;
      const itemWarnings: string[] = [];

      const hsCode = product?.hsCode?.trim() || null;
      if (!hsCode) {
        itemWarnings.push(`SKU ${item.sku ?? item.productId ?? '?'} 缺少 HS 编码，海关可能退单`);
      }

      // 报关品名优先用专门的 customsNameEn，回退到商品英文标题，
      // 最后兜底到 SKU —— 绝不能留空，空品名报关会被直接退单
      const description = product?.customsNameEn?.trim()
        || product?.titleEn?.trim()
        || item.productTitle
        || item.sku
        || 'Unspecified goods';

      const origin = product?.originCountry?.trim().toUpperCase() || null;
      if (!origin) {
        itemWarnings.push(`SKU ${item.sku ?? item.productId ?? '?'} 缺少原产国`);
      }

      const unit = new Decimal(item.unitPrice as string);
      const total = unit.mul(item.quantity);
      // 历史订单可能没有 SKU 快照，用商品 id 前 8 位兜底，避免 undefined 进单据
      const sku = item.sku ?? `ITEM-${(item.productId ?? '').slice(0, 8).toUpperCase()}`;

      lineItems.push({
        sku,
        hsCode,
        description,
        quantity: item.quantity,
        // 申报单价用成交价（下单时已含币种折算），不是 listing 原价
        unitValue: unit.toFixed(2),
        totalValue: total.toFixed(2),
        originCountry: origin,
        weightKg: product?.weight ? Number(product.weight) : null,
        warnings: itemWarnings,
      });
    }

    const missingHs = lineItems.filter((l) => !l.hsCode).length;
    if (missingHs === lineItems.length) {
      warnings.push('全部商品缺少 HS 编码，该单据无法直接用于申报');
    } else if (missingHs > 0) {
      warnings.push(`${missingHs} 项商品缺少 HS 编码`);
    }

    // 申报价值 = 订单商品小计（成交价，不含运费与税）
    const declaredValue = new Decimal(order.subtotal as string);
    const exchangeRate = new Decimal((order.exchangeRate as string) || '1');
    const declaredUsd = exchangeRate.isZero()
      ? declaredValue
      : declaredValue.div(exchangeRate);

    const declarationNo = await this.generateDeclarationNo();

    const inserted = await this.db
      .insert(customsDeclarations)
      .values({
        orderId,
        declarationNo,
        sellerId: order.sellerId,
        status: 'draft',
        destinationCountry: this.extractCountry(order.addressSnapshot),
        originCountry: lineItems.find((l) => l.originCountry)?.originCountry ?? '',
        declaredValue: declaredValue.toFixed(2),
        declaredCurrency: order.currency,
        declaredValueUsd: declaredUsd.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        lineItems: lineItems as unknown as Record<string, unknown>[],
        note: warnings.length > 0 ? warnings.join('；') : null,
      })
      .returning();

    this.logger.log(`生成清关单据 ${declarationNo}（订单 ${order.orderNo}，${lineItems.length} 项）`);
    return this.toView(inserted[0]);
  }

  /** 卖家/管理员：单据列表 */
  async list(actor: { userId?: string; role?: string }, limit = 50): Promise<CustomsDeclarationView[]> {
    const conditions = [];
    if (actor.role === 'seller') {
      if (!actor.userId) return [];
      conditions.push(eq(customsDeclarations.sellerId, actor.userId));
    }
    const rows = await this.db
      .select()
      .from(customsDeclarations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(customsDeclarations.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((r) => this.toView(r));
  }

  /** 按订单查单据（订单详情页用；没有则返回 null，不抛错） */
  async findByOrder(orderId: string): Promise<CustomsDeclarationView | null> {
    const rows = await this.db
      .select()
      .from(customsDeclarations)
      .where(eq(customsDeclarations.orderId, orderId))
      .limit(1);
    return rows.length > 0 ? this.toView(rows[0]) : null;
  }

  /** 标记已申报（真实场景下由对接报关行的回调触发；此处供卖家手工推进） */
  async markFiled(id: string, actor: { userId?: string; role?: string }): Promise<CustomsDeclarationView> {
    const rows = await this.db.select().from(customsDeclarations).where(eq(customsDeclarations.id, id));
    if (rows.length === 0) throw new NotFoundException('单据不存在');
    if (actor.role === 'seller' && rows[0].sellerId !== actor.userId) {
      throw new NotFoundException('单据不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException(`当前状态 ${rows[0].status} 无法标记为已申报`);
    }
    // 缺 HS 码的单据不允许申报——海关会直接退回，不如在这里拦住
    const items = rows[0].lineItems as unknown as CustomsLineItem[];
    const missing = items.filter((i) => !i.hsCode);
    if (missing.length > 0) {
      throw new BadRequestException(
        `还有 ${missing.length} 项商品缺少 HS 编码，无法申报：${missing.map((m) => m.sku).join(', ')}`,
      );
    }
    const updated = await this.db
      .update(customsDeclarations)
      .set({ status: 'filed', filedAt: new Date(), updatedAt: new Date() })
      .where(eq(customsDeclarations.id, id))
      .returning();
    return this.toView(updated[0]);
  }

  private async generateDeclarationNo(): Promise<string> {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    // 用时间戳后 6 位 + 随机 4 位，避免引入额外依赖
    const seq = String(now.getTime()).slice(-6);
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `CD${stamp}${seq}${rand}`;
  }

  private extractCountry(snapshot: string | null): string {
    if (!snapshot) return '';
    try {
      const parsed = JSON.parse(snapshot) as { country?: string };
      return (parsed.country ?? '').trim().toUpperCase().slice(0, 2);
    } catch {
      return '';
    }
  }

  private toView(row: typeof customsDeclarations.$inferSelect): CustomsDeclarationView {
    const items = (row.lineItems ?? []) as unknown as CustomsLineItem[];
    const warnings: string[] = [];
    const missing = items.filter((i) => !i.hsCode).length;
    if (missing > 0) warnings.push(`${missing} 项商品缺少 HS 编码`);
    if (!row.destinationCountry) warnings.push('缺少目的国，无法申报');

    return {
      id: row.id,
      declarationNo: row.declarationNo,
      orderId: row.orderId,
      orderNo: '',
      status: row.status,
      destinationCountry: row.destinationCountry,
      originCountry: row.originCountry,
      declaredValue: row.declaredValue as string,
      declaredCurrency: row.declaredCurrency,
      declaredValueUsd: row.declaredValueUsd as string,
      lineItems: items,
      note: row.note ?? undefined,
      generatedAt: row.generatedAt.toISOString(),
      filedAt: row.filedAt?.toISOString(),
      warnings,
    };
  }
}
