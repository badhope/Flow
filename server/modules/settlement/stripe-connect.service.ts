import { Injectable, Logger } from '@nestjs/common';

/**
 * Stripe Connect 转账。
 *
 * 为什么单独实现而不复用 StripeService：Connect 走的是 `/v1/transfers`，
 * 需要对**被转账的账户**（connected account）做 header 标识，且必须携带
 * `Idempotency-Key`——否则网络抖动重试会重复打款。这与收款的 PaymentIntent
 * 是两条链路，混在一起会让幂等与账户维度的边界变模糊。
 *
 * 未配置 `STRIPE_SECRET_KEY` 时全部方法返回 `configured: false`，
 * 由调用方决定是走 demo 还是拒绝——不在这里伪造成功。
 */

const STRIPE_API = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com';

export interface ConnectAccount {
  id: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
}

export interface TransferResult {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  status: string;
}

@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly secretKey: string | undefined;

  constructor() {
    this.secretKey = process.env.STRIPE_SECRET_KEY;
    if (!this.secretKey) {
      this.logger.warn('Stripe Connect not configured: STRIPE_SECRET_KEY missing.');
    }
  }

  isConfigured(): boolean {
    return !!this.secretKey;
  }

  /** 创建 Express 账户（卖家收款载体） */
  async createAccount(params: {
    email: string;
    country?: string;
    businessType?: 'individual' | 'company';
    sellerId: string;
  }): Promise<ConnectAccount> {
    if (!this.secretKey) throw new Error('Stripe Connect 未配置');

    const body = new URLSearchParams({
      type: 'express',
      country: params.country ?? 'US',
      email: params.email,
      'business_type': params.businessType ?? 'company',
      'capabilities[transfers][requested]': 'true',
      // 把卖家 id 写进 metadata，便于 webhook 反查本地账户
      'metadata[sellerId]': params.sellerId,
    });

    const res = await fetch(`${STRIPE_API}/v1/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `acct-${params.sellerId}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Stripe 创建账户失败：${String((json.error as { message?: string })?.message ?? res.status)}`);
    }

    return {
      id: String(json.id),
      payoutsEnabled: Boolean(json.payouts_enabled),
      detailsSubmitted: Boolean(json.details_submitted),
      chargesEnabled: Boolean(json.charges_enabled),
    };
  }

  /** 生成 onboarding 链接（卖家填资料） */
  async createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
    if (!this.secretKey) throw new Error('Stripe Connect 未配置');

    const body = new URLSearchParams({
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });

    const res = await fetch(`${STRIPE_API}/v1/account_links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Stripe 生成 onboarding 链接失败：${String((json.error as { message?: string })?.message ?? res.status)}`);
    }
    return String(json.url);
  }

  /** 查询账户状态（onboarding 回来后刷新） */
  async getAccount(accountId: string): Promise<ConnectAccount> {
    if (!this.secretKey) throw new Error('Stripe Connect 未配置');
    const res = await fetch(`${STRIPE_API}/v1/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Stripe 查询账户失败：${String((json.error as { message?: string })?.message ?? res.status)}`);
    }
    return {
      id: String(json.id),
      payoutsEnabled: Boolean(json.payouts_enabled),
      detailsSubmitted: Boolean(json.details_submitted),
      chargesEnabled: Boolean(json.charges_enabled),
    };
  }

  /**
   * 向卖家账户转账（结算打款）。
   *
   * 幂等键由调用方传入（通常用结算单号）：同一张结算单重复点击"打款"只会产生一笔转账。
   * `amount` 单位是**最小货币单位**（分），与 Stripe 一致。
   */
  async createTransfer(params: {
    accountId: string;
    amountCents: number;
    currency: string;
    settlementNo: string;
    description?: string;
  }): Promise<TransferResult> {
    if (!this.secretKey) throw new Error('Stripe Connect 未配置');
    if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
      throw new Error('转账金额必须为正整数（分）');
    }

    const body = new URLSearchParams({
      amount: String(params.amountCents),
      currency: params.currency.toLowerCase(),
      destination: params.accountId,
      description: params.description ?? `Settlement ${params.settlementNo}`,
      'metadata[settlementNo]': params.settlementNo,
    });

    const res = await fetch(`${STRIPE_API}/v1/transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // 结算单号做幂等键：重复打款是这类系统最贵的 bug
        'Idempotency-Key': `settlement-${params.settlementNo}`,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });

    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = String((json.error as { message?: string })?.message ?? res.status);
      throw new Error(`Stripe 转账失败：${msg}`);
    }

    return {
      id: String(json.id),
      amount: Number(json.amount),
      currency: String(json.currency),
      destination: String(json.destination),
      status: String(json.status ?? 'unknown'),
    };
  }
}
