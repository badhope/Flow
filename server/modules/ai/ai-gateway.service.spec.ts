import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AiGatewayService } from './ai-gateway.service';
import { LLM_NOT_CONFIGURED_MESSAGE } from './llm-config';

const LLM_ENV_KEYS = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;
const savedEnv: Record<string, string | undefined> = {};

function clearLlmEnv(): void {
  for (const key of LLM_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreLlmEnv(): void {
  for (const key of LLM_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

function makeGateway(rows: Array<{ key: string; value: string }>, querySpy?: (condition: unknown) => void): AiGatewayService {
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          querySpy?.(condition);
          return {
            groupBy: () => ({
              orderBy: async () => rows,
            }),
            then: (resolve: (value: unknown[]) => void) => resolve(rows),
          };
        },
        then: (resolve: (value: unknown[]) => void) => resolve(rows),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  } as never;
  const http = { post: () => { throw new Error('HTTP 不应被调用'); } } as never;
  return new AiGatewayService(http, db);
}

// 行为契约（R13）：未配置模型时诚实拒绝（统一文案、不调用 HTTP、不返回假数据）
describe('AiGatewayService 诚实拒绝', () => {
  afterEach(restoreLlmEnv);

  it('R13: 无 DB 设置且无环境变量时抛统一文案，HTTP 不被调用', async () => {
    clearLlmEnv();
    const gateway = makeGateway([]);
    await expect(gateway.isConfigured()).resolves.toBe(false);
    await expect(
      gateway.chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(LLM_NOT_CONFIGURED_MESSAGE);
    await expect(
      gateway.chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('R13: DB 配置生效（isConfigured / 模型名来自 DB）', async () => {
    clearLlmEnv();
    const gateway = makeGateway([
      { key: 'llm_api_key', value: 'sk-db' },
      { key: 'llm_model', value: 'db-model' },
    ]);
    await expect(gateway.isConfigured()).resolves.toBe(true);
    await expect(gateway.getModel()).resolves.toBe('db-model');
  });

  it('R13: 环境变量兜底（source=env，模型名回退默认值）', async () => {
    clearLlmEnv();
    process.env.LLM_API_KEY = 'sk-env-test';
    const gateway = makeGateway([]);
    const config = await gateway.resolveConfig();
    expect(config.source).toBe('env');
    expect(config.model).toBe('deepseek-chat');
  });
});


describe('AiGatewayService outbound policy', () => {
  it('对数据库目标禁用重定向和代理并使用安全连接代理', async () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'staging';
      const post = vi.fn((_url: string, _body: unknown, _options: unknown) => of({ data: { choices: [{ message: { content: 'ok' } }] } }));
      const db = {
        select: () => ({ from: async () => [
          { key: 'llm_base_url', value: 'https://example.com/v1' },
          { key: 'llm_api_key', value: 'test-key' },
        ] }),
        insert: () => ({ values: async () => undefined }),
      } as never;
      const gateway = new AiGatewayService({ post } as never, db);
      await expect(gateway.chat([{ role: 'user', content: 'hello' }])).resolves.toMatchObject({ content: 'ok' });
      expect(post.mock.calls[0][2]).toMatchObject({ maxRedirects: 0, proxy: false, httpAgent: expect.anything(), httpsAgent: expect.anything() });
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('未知环境拒绝数据库配置的私网地址', async () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'staging';
      const gateway = makeGateway([
        { key: 'llm_base_url', value: 'http://127.0.0.1/v1' },
        { key: 'llm_api_key', value: 'test-key' },
      ]);
      await expect(gateway.resolveConfig()).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

describe('AiGatewayService usage tenant scope', () => {
  it('R30: seller usage stats query includes actor userId, admin query stays global', async () => {
    const sellerConditions: unknown[] = [];
    const sellerGateway = makeGateway([], (condition) => sellerConditions.push(condition));
    await sellerGateway.getUsageStats({ actor: { userId: 'seller-1', role: 'seller' } });
    expect(sellerConditions).toHaveLength(3);

    const adminConditions: unknown[] = [];
    const adminGateway = makeGateway([], (condition) => adminConditions.push(condition));
    await adminGateway.getUsageStats({ actor: { userId: 'admin-1', role: 'admin' } });
    expect(adminConditions).toHaveLength(3);
    expect(adminConditions[0]).toBeUndefined();
    expect(adminConditions[1]).toBeDefined();
    expect(adminConditions[2]).toBeUndefined();
  });
});
