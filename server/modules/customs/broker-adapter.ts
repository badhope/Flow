import { createHmac } from 'node:crypto';

/**
 * 报关行适配器。
 *
 * 现实约束：各家报关服务商的接口形态差异极大（有的 REST+JSON、有的 XML、
 * 有的走 FTP 传文件），不可能在代码里穷举。所以这里定义**一个最小契约**，
 * 由 `generic_http` 适配器实现，卖家在自己的报关行配置里提供端点与凭据即可接入。
 *
 * 契约（POST JSON）：
 *   请求  { declarationNo, destinationCountry, originCountry, declaredValue,
 *           declaredCurrency, lineItems[], sellerRef }
 *   响应  { reference, status: 'accepted'|'rejected'|'pending', message? }
 *
 * 签名：`X-Flow-Signature: sha256=<hmac(secret, rawBody)>`，与 Stripe webhook 同款，
 * 便于对方做恒定时间校验。没有签名密钥时退化为 Bearer token，不静默裸奔。
 */

export interface BrokerLineItem {
  sku: string;
  hsCode: string | null;
  description: string;
  quantity: number;
  unitValue: string;
  totalValue: string;
  originCountry: string | null;
  weightKg: number | null;
}

export interface BrokerSubmitPayload {
  declarationNo: string;
  destinationCountry: string;
  originCountry: string;
  declaredValue: string;
  declaredCurrency: string;
  declaredValueUsd: string;
  lineItems: BrokerLineItem[];
  sellerRef?: string;
}

export interface BrokerSubmitResult {
  /** 对方系统内的回执号 */
  reference: string;
  status: 'accepted' | 'rejected' | 'pending';
  message?: string;
  /** 原始响应，便于排障 */
  raw?: unknown;
}

export interface BrokerConfig {
  endpoint: string;
  credentials: Record<string, string>;
  signingSecret?: string;
}

export class BrokerError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryable = false,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

export interface CustomsBrokerAdapter {
  readonly provider: string;
  submit(config: BrokerConfig, payload: BrokerSubmitPayload): Promise<BrokerSubmitResult>;
}

/**
 * 通用 HTTP 报关行适配器。
 *
 * 重试策略：仅对**网络错误与 5xx** 重试——4xx 是报文问题，重试只会重复触发对方的
 * 参数校验日志，而且可能被判定为攻击。指数退避，最多 3 次。
 */
export class GenericHttpBrokerAdapter implements CustomsBrokerAdapter {
  readonly provider = 'generic_http';

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxAttempts = 3,
    private readonly baseDelayMs = 500,
  ) {}

  async submit(config: BrokerConfig, payload: BrokerSubmitPayload): Promise<BrokerSubmitResult> {
    if (!config.endpoint) {
      throw new BrokerError('报关行端点未配置', undefined, false);
    }

    const rawBody = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Flow-Commerce/1.x',
    };

    if (config.signingSecret) {
      // 与 Stripe webhook 同款：对原始 body 做 HMAC，对方用共享密钥校验
      const signature = createHmac('sha256', config.signingSecret).update(rawBody).digest('hex');
      headers['X-Flow-Signature'] = `sha256=${signature}`;
    } else if (config.credentials?.apiKey) {
      headers.Authorization = `Bearer ${config.credentials.apiKey}`;
    }

    if (config.credentials?.accountId) {
      headers['X-Flow-Account'] = config.credentials.accountId;
    }

    let lastError: BrokerError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const res = await this.fetchImpl(config.endpoint, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: AbortSignal.timeout(15_000),
        });

        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          // 对方返回非 JSON：保留原文用于排障，不当成成功
          parsed = text;
        }

        if (!res.ok) {
          const retryable = res.status >= 500;
          throw new BrokerError(
            `报关行返回 ${res.status}`,
            res.status,
            retryable,
            parsed,
          );
        }

        // 响应体必须能看出"接受/拒绝"，否则视为协议不匹配
        const body = (parsed ?? {}) as Record<string, unknown>;
        const status = String(body.status ?? '').toLowerCase();
        if (!['accepted', 'rejected', 'pending'].includes(status)) {
          throw new BrokerError(
            `报关行响应缺少有效 status（收到 "${String(body.status ?? '')}"）`,
            res.status,
            false,
            parsed,
          );
        }

        const reference = String(body.reference ?? body.id ?? payload.declarationNo);
        return {
          reference,
          status: status as BrokerSubmitResult['status'],
          message: body.message ? String(body.message) : undefined,
          raw: parsed,
        };
      } catch (error) {
        const brokerError = error instanceof BrokerError
          ? error
          : new BrokerError(
            error instanceof Error ? error.message : String(error),
            undefined,
            true, // 网络错误/超时视为可重试
          );
        lastError = brokerError;

        if (!brokerError.retryable || attempt === this.maxAttempts) break;
        await new Promise((r) => setTimeout(r, this.baseDelayMs * 2 ** (attempt - 1)));
      }
    }

    throw lastError ?? new BrokerError('报关行提交失败');
  }
}

/** 按 provider 名称取适配器；未知 provider 直接报错，不静默降级 */
export function getBrokerAdapter(provider: string): CustomsBrokerAdapter {
  switch (provider) {
    case 'generic_http':
      return new GenericHttpBrokerAdapter();
    default:
      throw new BrokerError(`不支持的报关行适配器：${provider}`);
  }
}
