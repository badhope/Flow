import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/** webhook 时间戳容忍窗口（秒）：超过该窗口的签名视为重放攻击 */
const SIGNATURE_TOLERANCE_SECONDS = 300;

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly secretKey: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly baseUrl: string;

  constructor() {
    // STRIPE_API_BASE 用于对接 API 代理或联调环境；默认官方地址
    this.baseUrl = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com';
    this.secretKey = process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!this.secretKey) {
      this.logger.warn(
        'Stripe not configured: STRIPE_SECRET_KEY missing. Running in demo mode.',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.secretKey;
  }

  /** 前端 Stripe.js 所需公钥（仅 publishable key，可公开） */
  getPublishableKey(): string | undefined {
    return process.env.STRIPE_PUBLISHABLE_KEY || undefined;
  }

  async createPaymentIntent(
    amount: number,
    currency: string,
    orderId: string,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    if (!this.secretKey) {
      throw new Error('Stripe not configured');
    }

    const body = new URLSearchParams({
      amount: Math.round(amount * 100).toString(),
      currency: currency.toLowerCase(),
      'metadata[orderId]': orderId,
    });

    const response = await fetch(`${this.baseUrl}/v1/payment_intents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${this.secretKey}`,
        'Stripe-Version': '2024-06-20',
      },
      body,
    });

    const data = await response.json() as { client_secret?: string; id?: string };
    if (!response.ok) {
      throw new Error(`Stripe createPaymentIntent failed: ${JSON.stringify(data)}`);
    }

    return {
      clientSecret: data.client_secret ?? '',
      paymentIntentId: data.id ?? '',
    };
  }

  /**
   * 校验并解析 Stripe webhook 事件：
   * - 时间戳容忍窗口内（防重放）
   * - 所有 v1 签名恒定时间比较（防时序侧信道，兼容端点密钥轮换期多签名）
   * - 验签失败一律返回 null（fail closed）
   */
  verifyAndParse(
    payload: Buffer | string,
    signature: string,
  ): { type: string; data: Record<string, unknown> } | null {
    if (!this.webhookSecret) {
      this.logger.warn('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET not configured');
      return null;
    }

    try {
      const parts: Record<string, string[]> = {};
      for (const element of signature.split(',')) {
        const separatorIndex = element.indexOf('=');
        if (separatorIndex <= 0) continue;
        const key = element.slice(0, separatorIndex).trim();
        const value = element.slice(separatorIndex + 1).trim();
        if (!key || !value) continue;
        (parts[key] ??= []).push(value);
      }

      const timestamp = parts['t']?.[0];
      const signatures = parts['v1'] ?? [];
      if (!timestamp || signatures.length === 0) {
        this.logger.warn('Stripe webhook rejected: missing t= or v1= in signature header');
        return null;
      }

      const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
        this.logger.warn(`Stripe webhook rejected: timestamp outside tolerance (${Math.round(ageSeconds)}s)`);
        return null;
      }

      const payloadStr = typeof payload === 'string' ? payload : payload.toString('utf8');
      const expected = createHmac('sha256', this.webhookSecret)
        .update(`${timestamp}.${payloadStr}`)
        .digest();

      const matched = signatures.some((candidate) => {
        let provided: Buffer;
        try {
          provided = Buffer.from(candidate, 'hex');
        } catch {
          return false;
        }
        return provided.length === expected.length && timingSafeEqual(provided, expected);
      });

      if (!matched) {
        this.logger.warn('Stripe webhook rejected: signature mismatch');
        return null;
      }

      const event = JSON.parse(payloadStr) as {
        type?: string;
        data?: { object?: Record<string, unknown> };
      };
      return { type: event.type ?? 'UNKNOWN', data: event.data?.object ?? {} };
    } catch (err) {
      this.logger.warn('Stripe webhook rejected: parse failure', (err as Error).message);
      return null;
    }
  }

  async refund(
    paymentIntentId: string,
    amount?: number,
    /**
     * Stripe 幂等键：24 小时内同键重复调用返回首次结果，不会产生第二笔退款。
     * 这是防「网络超时后重试导致重复打款」的官方机制。
     */
    idempotencyKey?: string,
  ): Promise<{ refundId: string }> {
    if (!this.secretKey) {
      throw new Error('Stripe not configured');
    }

    const params = new URLSearchParams({ payment_intent: paymentIntentId });
    if (amount !== undefined) {
      params.append('amount', Math.round(amount * 100).toString());
    }

    const response = await fetch(`${this.baseUrl}/v1/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${this.secretKey}`,
        'Stripe-Version': '2024-06-20',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: params,
    });

    const data = await response.json() as { id?: string };
    if (!response.ok) {
      throw new Error(`Stripe refund failed: ${JSON.stringify(data)}`);
    }

    return { refundId: data.id ?? '' };
  }
}
