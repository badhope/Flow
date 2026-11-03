import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotNotifyService } from './copilot-notify.service';
import { NotifyTransport } from './copilot-notify-transport';

// 行为契约（R18/R21）：通知失败不抛出；瞬态失败重试；永久失败不重试；连续失败熔断
describe('CopilotNotifyService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function serviceWith(deliver: NotifyTransport['deliver']): CopilotNotifyService {
    const transport = { deliver } as unknown as NotifyTransport;
    return new CopilotNotifyService(transport);
  }

  it('R18: 未配置渠道时直接返回失败且不调用 transport', async () => {
    const deliver = vi.fn();
    const service = serviceWith(deliver as unknown as NotifyTransport['deliver']);
    const result = await service.send({ kind: 'none' }, 'hello');
    expect(result.ok).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('R21: 瞬态失败会重试，第二次成功后返回 attempts=2', async () => {
    let calls = 0;
    const deliver = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, channel: 'webhook' as const, message: 'boom', permanent: false }
        : { ok: true, channel: 'webhook' as const, message: 'ok' };
    });
    const service = serviceWith(deliver as unknown as NotifyTransport['deliver']);

    const result = await service.send({ kind: 'webhook', url: 'https://example.com/hook' }, 'x');

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('R21: 永久失败（配置错误）不重试', async () => {
    const deliver = vi.fn(async () => ({
      ok: false,
      channel: 'webhook' as const,
      message: 'bad url',
      permanent: true,
    }));
    const service = serviceWith(deliver as unknown as NotifyTransport['deliver']);

    const result = await service.send({ kind: 'webhook', url: 'https://example.com/hook' }, 'x');

    expect(result.ok).toBe(false);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('R21: 连续失败达阈值后熔断，后续不再调用 transport', async () => {
    const deliver = vi.fn(async () => ({
      ok: false,
      channel: 'webhook' as const,
      message: 'down',
      permanent: true,
    }));
    const service = serviceWith(deliver as unknown as NotifyTransport['deliver']);
    const config = { kind: 'webhook' as const, url: 'https://example.com/hook' };

    for (let i = 0; i < 3; i += 1) {
      await service.send(config, 'x');
    }
    const callsBefore = deliver.mock.calls.length;
    const result = await service.send(config, 'x');

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(deliver.mock.calls.length).toBe(callsBefore);
    expect(result.message).toContain('熔断');
  });

  it('R21: 不同通道的熔断互不影响', async () => {
    const deliver = vi.fn(async (config: { kind: string }) => ({
      ok: false,
      channel: config.kind as 'webhook',
      message: 'down',
      permanent: true,
    }));
    const service = serviceWith(deliver as unknown as NotifyTransport['deliver']);

    const webhook = { kind: 'webhook' as const, url: 'https://a.example/hook' };
    const email = {
      kind: 'email' as const,
      smtp: { host: 'smtp.example.com', port: 587, secure: false, from: 'a@b.c', to: 'd@e.f' },
    };

    for (let i = 0; i < 3; i += 1) await service.send(webhook, 'x');
    const before = deliver.mock.calls.length;
    await service.send(email, 'x');

    expect(deliver.mock.calls.length).toBe(before + 1);
  });
});

describe('NotifyTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('R18: 非 http(s) 地址判定为永久失败', async () => {
    const transport = new NotifyTransport();
    const result = await transport.deliver({ kind: 'webhook', url: 'file:///etc/passwd' }, 's', 't');
    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
  });

  it('R18: 5xx 可重试，4xx 不可重试', async () => {
    const transport = new NotifyTransport();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    expect((await transport.deliver({ kind: 'webhook', url: 'https://e.com/h' }, 's', 't')).permanent).toBe(false);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 400 }));
    expect((await transport.deliver({ kind: 'webhook', url: 'https://e.com/h' }, 's', 't')).permanent).toBe(true);
  });

  it('未知环境拒绝私网 webhook，测试环境拒绝重定向', async () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'staging';
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const transport = new NotifyTransport();
      expect((await transport.deliver({ kind: 'webhook', url: 'http://127.0.0.1/h' }, 's', 't')).permanent).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      process.env.NODE_ENV = 'test';
      fetchMock.mockResolvedValue(new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }));
      expect((await transport.deliver({ kind: 'webhook', url: 'https://e.com/h' }, 's', 't')).ok).toBe(false);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('R18: 邮件配置不完整判定为永久失败', async () => {
    const transport = new NotifyTransport();
    const result = await transport.deliver({ kind: 'email', smtp: { host: '', port: 587, secure: false, from: '', to: '' } }, 's', 't');
    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
  });
});
