import { describe, expect, it } from 'vitest';
import { GenericHttpBrokerAdapter, BrokerError, getBrokerAdapter } from './broker-adapter';

/**
 * 报关行适配器的契约。
 *
 * 这些用例用假的 fetch 覆盖真实会遇到的分支：签名、重试、4xx 不重试、
 * 响应格式不符。之所以要测：报关提交失败意味着货卡在关口，
 * 而"重试了不该重试的请求"会重复申报，比失败更麻烦。
 */

interface Call { url: string; headers: Record<string, string>; body: string }

function fakeFetch(
  responses: Array<{ status: number; body: unknown; text?: string }>,
): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.text ?? JSON.stringify(r.body),
      json: async () => r.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const payload = {
  declarationNo: 'CD123',
  destinationCountry: 'DE',
  originCountry: 'CN',
  declaredValue: '100.00',
  declaredCurrency: 'USD',
  declaredValueUsd: '100.00',
  lineItems: [{
    sku: 'SKU-1', hsCode: '392410', description: 'Cup', quantity: 1,
    unitValue: '100.00', totalValue: '100.00', originCountry: 'CN', weightKg: 0.2,
  }],
};

const config = {
  endpoint: 'https://broker.example.com/declare',
  credentials: { apiKey: 'k' },
  signingSecret: 'secret',
};

describe('customs broker adapter', () => {
  it('B1: 成功提交返回回执与状态', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { reference: 'BRK-9', status: 'accepted' } }]);
    const adapter = new GenericHttpBrokerAdapter(impl);
    const r = await adapter.submit(config, payload);

    expect(r.reference).toBe('BRK-9');
    expect(r.status).toBe('accepted');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(config.endpoint);
  });

  it('B2: 有签名密钥时带 HMAC 签名头', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { reference: 'R', status: 'pending' } }]);
    const adapter = new GenericHttpBrokerAdapter(impl);
    await adapter.submit(config, payload);
    expect(calls[0].headers['X-Flow-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('B3: 无签名密钥时退化为 Bearer token，不裸奔', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { reference: 'R', status: 'accepted' } }]);
    const adapter = new GenericHttpBrokerAdapter(impl);
    await adapter.submit(
      { endpoint: config.endpoint, credentials: { apiKey: 'token-1' } },
      payload,
    );
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(calls[0].headers['X-Flow-Signature']).toBeUndefined();
  });

  it('B4: 5xx 会重试（服务端临时故障）', async () => {
    const { impl, calls } = fakeFetch([
      { status: 503, body: { error: 'busy' } },
      { status: 200, body: { reference: 'R2', status: 'accepted' } },
    ]);
    const adapter = new GenericHttpBrokerAdapter(impl, 3, 1);
    const r = await adapter.submit(config, payload);
    expect(r.status).toBe('accepted');
    expect(calls).toHaveLength(2);
  });

  it('B5: 4xx 不重试（报文问题，重试只会重复触发校验）', async () => {
    const { impl, calls } = fakeFetch([{ status: 400, body: { error: 'bad' } }]);
    const adapter = new GenericHttpBrokerAdapter(impl, 3, 1);
    await expect(adapter.submit(config, payload)).rejects.toThrow(BrokerError);
    expect(calls).toHaveLength(1);
  });

  it('B6: 响应缺少 status 视为协议不匹配，不当成功', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { reference: 'R' } }]);
    const adapter = new GenericHttpBrokerAdapter(impl, 1, 1);
    await expect(adapter.submit(config, payload)).rejects.toThrow(/status/);
  });

  it('B7: 非 JSON 响应不被当成成功', async () => {
    const { impl } = fakeFetch([{ status: 200, body: null, text: '<html>gateway</html>' }]);
    const adapter = new GenericHttpBrokerAdapter(impl, 1, 1);
    await expect(adapter.submit(config, payload)).rejects.toThrow(BrokerError);
  });

  it('B8: 拒绝状态原样返回，由调用方决定不推进状态', async () => {
    const { impl } = fakeFetch([{ status: 200, body: { reference: 'R', status: 'rejected', message: 'HS 码无效' } }]);
    const adapter = new GenericHttpBrokerAdapter(impl);
    const r = await adapter.submit(config, payload);
    expect(r.status).toBe('rejected');
    expect(r.message).toBe('HS 码无效');
  });

  it('B9: 未配置端点直接报错', async () => {
    const adapter = new GenericHttpBrokerAdapter(fakeFetch([]).impl);
    await expect(adapter.submit({ endpoint: '', credentials: {} }, payload)).rejects.toThrow(/端点/);
  });

  it('B10: 未知 provider 不静默降级', () => {
    expect(() => getBrokerAdapter('some_future_provider')).toThrow(BrokerError);
    expect(getBrokerAdapter('generic_http').provider).toBe('generic_http');
  });

  it('B11: 网络异常按可重试处理', async () => {
    let n = 0;
    const impl = (async () => {
      n += 1;
      if (n === 1) throw new Error('ECONNRESET');
      return { ok: true, status: 200, text: async () => JSON.stringify({ reference: 'R', status: 'accepted' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const adapter = new GenericHttpBrokerAdapter(impl, 3, 1);
    const r = await adapter.submit(config, payload);
    expect(r.status).toBe('accepted');
    expect(n).toBe(2);
  });
});
