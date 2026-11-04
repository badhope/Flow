import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class PayPalService {
  private readonly logger = new Logger(PayPalService.name);
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    // PAYPAL_API_BASE 用于对接 API 代理或联调环境；默认按 PAYPAL_MODE 选官方地址
    this.baseUrl =
      process.env.PAYPAL_API_BASE ??
      (process.env.PAYPAL_MODE === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com');
    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        'PayPal not configured: PAYPAL_CLIENT_ID and/or PAYPAL_CLIENT_SECRET missing. Running in demo mode.',
      );
    }
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  async createOrder(
    amount: number,
    currency: string,
    orderId: string,
  ): Promise<{ paypalOrderId: string; approveUrl: string }> {
    if (!this.isConfigured()) {
      throw new Error('PayPal not configured');
    }

    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            custom_id: orderId,
            amount: {
              currency_code: currency.toUpperCase(),
              value: amount.toFixed(2),
            },
          },
        ],
        application_context: {
          return_url: `${process.env.APP_URL || ''}/orders?paypal=success&order=${encodeURIComponent(orderId)}`,
          cancel_url: `${process.env.APP_URL || ''}/checkout?paypal=cancel`,
        },
      }),
    });

    const data = await response.json() as {
      id?: string;
      links?: Array<{ rel: string; href: string }>;
      status?: string;
      purchase_units?: Array<{
        payments?: { captures?: Array<{ id?: string }> };
        amount?: { value?: string; currency_code?: string };
      }>;
    };
    if (!response.ok) {
      throw new Error(`PayPal create order failed: ${JSON.stringify(data)}`);
    }

    const approveLink = data.links?.find(
      (link: { rel: string; href: string }) => link.rel === 'approve',
    );

    return {
      paypalOrderId: data.id ?? '',
      approveUrl: approveLink?.href ?? '',
    };
  }

  async captureOrder(paypalOrderId: string): Promise<{
    status: string;
    transactionId: string;
    amount: number;
    currency: string;
  }> {
    if (!this.isConfigured()) {
      throw new Error('PayPal not configured');
    }

    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Prefer: 'return=representation',
        },
      },
    );

    const data = await response.json() as {
      id?: string;
      status?: string;
      purchase_units?: Array<{
        payments?: { captures?: Array<{ id?: string }> };
        amount?: { value?: string; currency_code?: string };
      }>;
    };
    if (!response.ok) {
      throw new Error(`PayPal capture failed: ${JSON.stringify(data)}`);
    }

    const purchaseUnit = data.purchase_units?.[0];
    const paymentCapture = purchaseUnit?.payments?.captures?.[0];

    return {
      status: data.status ?? 'UNKNOWN',
      transactionId: paymentCapture?.id ?? data.id ?? '',
      amount: Number(purchaseUnit?.amount?.value ?? 0),
      currency: purchaseUnit?.amount?.currency_code ?? 'USD',
    };
  }

  /**
   * 对已 capture 的支付发起退款（支持部分/全额）。
   * PayPal REST: POST /v2/payments/captures/{capture_id}/refunds
   * 不传 amount 表示全额退款；失败抛错（不做任何伪造成功）。
   */
  async refundCapture(
    captureId: string,
    amount?: number,
    currency = 'USD',
    /** PayPal-Request-Id：同键重复调用返回同一次退款，防超时重试造成重复打款。 */
    idempotencyKey?: string,
  ): Promise<{ refundId: string; status: string }> {
    if (!this.isConfigured()) {
      throw new Error('PayPal not configured');
    }

    const token = await this.getAccessToken();
    const body = amount !== undefined
      ? JSON.stringify({
          amount: {
            value: amount.toFixed(2),
            currency_code: currency.toUpperCase(),
          },
        })
      : '{}';

    const response = await fetch(
      `${this.baseUrl}/v2/payments/captures/${encodeURIComponent(captureId)}/refunds`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
        },
        body,
      },
    );

    const data = await response.json() as { id?: string; status?: string };
    if (!response.ok) {
      throw new Error(`PayPal refund failed: ${JSON.stringify(data)}`);
    }

    return { refundId: data.id ?? '', status: data.status ?? 'UNKNOWN' };
  }

  async verifyWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<{ eventType: string; data: unknown } | null> {
    if (!this.isConfigured()) {
      this.logger.warn('PayPal webhook rejected: PayPal not configured');
      return null;
    }

    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      this.logger.warn('PayPal webhook rejected: PAYPAL_WEBHOOK_ID not configured');
      return null;
    }

    const transmissionId = headers['paypal-transmission-id'] ?? '';
    const transmissionTime = headers['paypal-transmission-time'] ?? '';
    const transmissionSig = headers['paypal-transmission-sig'] ?? '';
    const certUrl = headers['paypal-cert-url'] ?? '';
    const authAlgo = headers['paypal-auth-algo'] ?? 'SHA256withRSA';

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl) {
      this.logger.warn('PayPal webhook rejected: missing required headers');
      return null;
    }

    if (authAlgo !== 'SHA256withRSA') {
      this.logger.warn(`PayPal webhook rejected: unsupported auth algo ${authAlgo}`);
      return null;
    }

    if (!certUrl.startsWith('https://api-m.sandbox.paypal.com/') && !certUrl.startsWith('https://api-m.paypal.com/') && !certUrl.startsWith('https://www.paypal.com/')) {
      this.logger.warn(`PayPal webhook rejected: invalid cert url ${certUrl}`);
      return null;
    }

    const publicKey = await this.loadWebhookCert(certUrl);
    if (!publicKey) {
      return null;
    }

    let event: { event_type?: string; resource?: unknown };
    try {
      event = JSON.parse(body);
    } catch {
      this.logger.warn('PayPal webhook rejected: invalid JSON body');
      return null;
    }

    const signatureBase = `${transmissionId}|${transmissionTime}|${webhookId}|${crypto.createHash('sha256').update(body).digest('hex')}`;

    const signatureBuffer = Buffer.from(transmissionSig, 'base64');
    const verify = crypto.createVerify('SHA256');
    verify.update(signatureBase);
    verify.end();

    const valid = verify.verify(publicKey, signatureBuffer);
    if (!valid) {
      this.logger.warn('PayPal webhook rejected: signature verification failed');
      return null;
    }

    this.logger.log(`PayPal webhook verified: ${event.event_type}`);
    return { eventType: event.event_type ?? 'UNKNOWN', data: event.resource ?? {} };
  }

  /**
   * 加载 webhook 验签公钥（生产路径从 PayPal 官方域拉取证书）。
   * 独立成 protected 方法：测试可注入本地生成密钥对，生产安全性不降级。
   */
  protected async loadWebhookCert(certUrl: string): Promise<crypto.KeyObject | null> {
    try {
      const certResponse = await fetch(certUrl);
      if (!certResponse.ok) {
        this.logger.warn(`PayPal webhook rejected: failed to fetch cert (${certResponse.status})`);
        return null;
      }
      const certPem = await certResponse.text();
      return crypto.createPublicKey(certPem);
    } catch (err) {
      this.logger.warn('PayPal webhook rejected: failed to load cert', (err as Error).message);
      return null;
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      body: 'grant_type=client_credentials',
    });

    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!response.ok) {
      throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
    }

    this.accessToken = data.access_token ?? null;
    this.tokenExpiresAt = now + (data.expires_in ?? 0) * 1000;
    return this.accessToken!;
  }
}
