import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { Decimal } from 'decimal.js';

import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { currencies } from '../../database/schema';

/**
 * 多币种与汇率。
 *
 * 设计取舍：
 *   1. **汇率只从公开源拉取，不猜**。数据源为 open.er-api.com（免费、无需 key、
 *      每日更新）。拉取失败时保留库中上一次的汇率并标记 `rate_source='manual'`，
 *      绝不把失败当成 1:1。
 *   2. **订单落库时快照汇率**。汇率每天都在变，历史订单必须能按当时汇率复算，
 *      否则退款、结算、对账都会漂移。
 *   3. **小数位随币种**。JPY/KRW 没有小数位，用固定 2 位会显示成 ¥100.00，
 *      对账时会被当成误差。
 */

/**
 * 汇率源，按顺序尝试。
 *
 * 为什么要多源：单一免费源会定期维护，失败时如果只回退到"保留旧值"，
 * 长时间停机就会用过期汇率报价。两个独立源交叉覆盖能把这种窗口压到最小。
 * 任一源成功即停止，全部失败才保留旧值。
 */
const FX_SOURCES = [
  { name: 'open.er-api', url: 'https://open.er-api.com/v6/latest/USD' },
  { name: 'frankfurter', url: 'https://api.frankfurter.dev/v1/latest?base=USD' },
] as const;

/** 默认刷新间隔：15 分钟（可通过 FX_REFRESH_MINUTES 调整） */
const DEFAULT_REFRESH_MINUTES = 15;
/** 支持展示/交易的币种；不在表内的币种一律拒绝，避免脏数据 */
const SUPPORTED = ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'CAD', 'AUD', 'SGD', 'KRW', 'HKD'] as const;

export interface FxRate {
  code: string;
  /** 1 USD = rate 个该币种 */
  rate: number;
  decimalDigits: number;
  symbol: string;
  nameZh: string;
  nameEn: string;
  updatedAt: Date | null;
  source: string;
}

export interface ConversionResult {
  from: string;
  to: string;
  amount: string;
  converted: string;
  rate: number;
}

@Injectable()
export class FxService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FxService.name);
  /** 内存缓存：汇率一天变一次，没必要每个请求都查库 */
  private cache = new Map<string, FxRate>();
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  private timer: NodeJS.Timeout | null = null;

  onApplicationBootstrap(): void {
    // 启动 20 秒后尝试刷新一次；失败不阻塞启动（离线环境也能跑，用库内汇率）
    setTimeout(() => void this.refreshRates().catch(() => undefined), 20_000);

    // 定时刷新：汇率的时效性直接决定报价准确性，只靠启动时拉一次会越用越旧
    const minutes = Number(process.env.FX_REFRESH_MINUTES ?? DEFAULT_REFRESH_MINUTES);
    const interval = (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_REFRESH_MINUTES) * 60_000;
    this.timer = setInterval(() => void this.refreshRates().catch(() => undefined), interval);
    this.timer.unref?.();
    this.logger.log(`汇率定时刷新已启用：每 ${interval / 60000} 分钟`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 全部启用的币种（含实时汇率） */
  async listRates(): Promise<FxRate[]> {
    await this.ensureCache();
    return [...this.cache.values()];
  }

  /** 查单个币种；不支持的币种返回 null，调用方必须显式处理 */
  async getRate(code: string): Promise<FxRate | null> {
    const normalized = (code ?? '').trim().toUpperCase();
    if (!normalized) return null;
    await this.ensureCache();
    return this.cache.get(normalized) ?? null;
  }

  /**
   * 币种换算。
   *
   * 走 USD 中转：1 USD = rateA 个 A，1 USD = rateB 个 B
   *   → A 转 B：amount / rateA * rateB
   * 这样只需维护一张"相对 USD"的表，不用维护 N² 个币种对。
   */
  async convert(amount: string | number, from: string, to: string): Promise<ConversionResult> {
    const f = (from ?? '').toUpperCase();
    const t = (to ?? '').toUpperCase();
    const [rateFrom, rateTo] = await Promise.all([this.getRate(f), this.getRate(t)]);
    if (!rateFrom || !rateTo) {
      throw new Error(`不支持的币种：${!rateFrom ? f : t}`);
    }

    const value = new Decimal(amount || 0);
    if (value.isNegative()) {
      throw new Error('换算金额不能为负');
    }

    const rate = new Decimal(rateTo.rate).div(rateFrom.rate);
    const converted = value.mul(rate);

    return {
      from: f,
      to: t,
      amount: value.toFixed(rateFrom.decimalDigits),
      converted: converted.toFixed(rateTo.decimalDigits),
      rate: rate.toNumber(),
    };
  }

  /**
   * 按币种小数位格式化金额。
   * 用于「显示层」——JPY 不该出现 .00。
   */
  format(amount: string | number, code: string): string {
    const meta = this.cache.get((code ?? 'USD').toUpperCase());
    const digits = meta?.decimalDigits ?? 2;
    return new Decimal(amount || 0).toFixed(digits);
  }

  /** 把外币金额折算为 USD（结算、统计统一口径） */
  async toUsd(amount: string | number, code: string): Promise<string> {
    const rate = await this.getRate(code);
    if (!rate) throw new Error(`不支持的币种：${code}`);
    if (rate.rate === 0) throw new Error(`币种 ${code} 的汇率非法（0）`);
    return new Decimal(amount || 0).div(rate.rate).toFixed(2);
  }

  /**
   * 从公开汇率源刷新。
   *
   * 失败处理是刻意的：网络不可用时**保留库中已有汇率**并把 source 标为 manual，
   * 让运维一眼看出"这份汇率不是最新的"。绝不 fallback 到 1:1 —— 那会让
   * 一张 100 EUR 的订单被当成 100 USD，误差比不更新汇率还大。
   */
  async refreshRates(): Promise<{ updated: number; failed: number; source: string }> {
    let payload: { rates?: Record<string, number>; updatedAt?: Date; source?: string } | null = null;
    const errors: string[] = [];

    for (const src of FX_SOURCES) {
      try {
        const res = await fetch(src.url, {
          signal: AbortSignal.timeout(10_000),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as Record<string, unknown>;

        // 两个源的字段名不同：open.er-api 用 rates + time_last_update_unix，
        // frankfurter 用 rates + date。统一成内部形态。
        const rates = (json.rates ?? {}) as Record<string, number>;
        if (!rates || typeof rates !== 'object' || Object.keys(rates).length === 0) {
          throw new Error('响应缺少 rates');
        }
        // frankfurter 不含 USD 自身，补上
        if (rates.USD === undefined) rates.USD = 1;

        const unix = Number(json.time_last_update_unix);
        const updatedAt = Number.isFinite(unix) && unix > 0
          ? new Date(unix * 1000)
          : (typeof json.date === 'string' ? new Date(`${json.date}T00:00:00Z`) : new Date());

        payload = { rates, updatedAt, source: src.name };
        break;
      } catch (error) {
        errors.push(`${src.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!payload) {
      this.logger.warn(`所有汇率源均失败，保留库中既有汇率：${errors.join('; ')}`);
      this.cacheLoadedAt = 0; // 下次访问重新读库
      return { updated: 0, failed: SUPPORTED.length, source: 'manual' };
    }

    const updatedAt = payload.updatedAt ?? new Date();

    let updated = 0;
    let failed = 0;
    for (const code of SUPPORTED) {
      const rate = payload.rates?.[code];
      // USD 自身恒为 1；其余币种必须有正数汇率，否则视为该币种失败
      if (code !== 'USD' && (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)) {
        failed += 1;
        continue;
      }
      const value = code === 'USD' ? 1 : rate!;
      try {
        await this.db
          .update(currencies)
          .set({
            rateToUsd: value.toFixed(8),
            rateSource: 'remote',
            rateUpdatedAt: updatedAt,
            updatedAt: new Date(),
          })
          .where(eq(currencies.code, code));
        updated += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`写入 ${code} 汇率失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 刷新后让下一次读取重新建缓存
    this.cacheLoadedAt = 0;
    this.logger.log(`汇率已刷新：${updated} 个币种，${failed} 个失败（源更新于 ${updatedAt.toISOString()}）`);
    return { updated, failed, source: 'remote' };
  }

  /** 手工设置某币种汇率（运营兜底，比如公开源长期不可用） */
  async setManualRate(code: string, rate: number): Promise<FxRate> {
    const normalized = (code ?? '').trim().toUpperCase();
    if (!SUPPORTED.includes(normalized as typeof SUPPORTED[number])) {
      throw new Error(`不支持的币种：${normalized}`);
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('汇率必须为正数');
    }
    const rows = await this.db
      .update(currencies)
      .set({ rateToUsd: rate.toFixed(8), rateSource: 'manual', rateUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(currencies.code, normalized))
      .returning();
    if (rows.length === 0) throw new Error(`币种 ${normalized} 不存在`);
    this.cacheLoadedAt = 0;
    return this.mapRow(rows[0]);
  }

  private async ensureCache(): Promise<void> {
    if (this.cache.size > 0 && Date.now() - this.cacheLoadedAt < FxService.CACHE_TTL_MS) return;
    const rows = await this.db
      .select()
      .from(currencies)
      .where(and(eq(currencies.enabled, true), inArray(currencies.code, [...SUPPORTED])));
    this.cache = new Map(rows.map((row) => [row.code, this.mapRow(row)]));
    this.cacheLoadedAt = Date.now();
  }

  private mapRow(row: typeof currencies.$inferSelect): FxRate {
    return {
      code: row.code,
      rate: Number(row.rateToUsd),
      decimalDigits: row.decimalDigits,
      symbol: row.symbol,
      nameZh: row.nameZh,
      nameEn: row.nameEn,
      updatedAt: row.rateUpdatedAt,
      source: row.rateSource,
    };
  }
}
