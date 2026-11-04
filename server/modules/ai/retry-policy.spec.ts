import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  parseRetryAfter,
  retryDelayMs,
  withRetry,
} from './retry-policy';

/**
 * 重试策略的契约：
 *   - 429/5xx/网络错误要重试（这些重试就能好）
 *   - 401/404 不能重试（Key 错、模型名错，重试只是让用户多等）
 *   - 退避有上限，且抖动不会突破上限
 */
describe('retry policy', () => {
  it('R1: 只把 429/408/5xx/网络错误视为可重试', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(undefined)).toBe(true);

    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });

  it('R2: 指数退避且不超过上限', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 };
    expect(retryDelayMs(1, policy)).toBe(100);
    expect(retryDelayMs(2, policy)).toBe(200);
    expect(retryDelayMs(3, policy)).toBe(400);
    expect(retryDelayMs(4, policy)).toBe(800);
    // 第 5 次本来该 1600，被 maxDelayMs 截到 1000
    expect(retryDelayMs(5, policy)).toBe(1000);
    expect(retryDelayMs(9, policy)).toBe(1000);
  });

  it('R3: 抖动不会突破上限，也不会产生负等待', () => {
    const policy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 0.5 };
    // randomValue=1 取正向抖动
    expect(retryDelayMs(1, policy, 1)).toBe(1500);
    // randomValue=0 取负向抖动
    expect(retryDelayMs(1, policy, 0)).toBe(500);
    // 极端值也不为负
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      expect(retryDelayMs(3, policy, r)).toBeGreaterThanOrEqual(0);
    }
  });

  it('R4: 尊重 Retry-After（秒数与 HTTP 日期）', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('not-a-date')).toBeUndefined();

    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
    // 过去的日期归零，不产生负等待
    expect(parseRetryAfter('Thu, 01 Jan 2025 00:00:00 GMT', now)).toBe(0);
  });

  it('R5: 429 会重试并在第二次成功时正常返回', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw { response: { status: 429 } };
        return 'ok';
      },
      { sleep },
    );
    expect(value).toBe('ok');
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('R6: 401 立即失败，不消耗重试次数', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await expect(withRetry(
      async () => {
        calls += 1;
        throw { response: { status: 401 } };
      },
      { sleep },
    )).rejects.toBeDefined();
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('R7: 达到最大次数后抛出最后一次错误', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await expect(withRetry(
      async () => {
        calls += 1;
        throw { response: { status: 503 } };
      },
      { sleep, policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 } },
    )).rejects.toBeDefined();
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('R8: Retry-After 优先于自算退避，但仍受上限约束', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => { delays.push(ms); });
    let calls = 0;
    await expect(withRetry(
      async () => {
        calls += 1;
        throw {
          response: { status: 429, headers: { 'retry-after': '60' } },
        };
      },
      {
        sleep,
        policy: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 4000, jitterRatio: 0 },
        retryAfterOf: (err) => parseRetryAfter(
          (err as { response: { headers: Record<string, string> } }).response.headers['retry-after'],
        ),
      },
    )).rejects.toBeDefined();
    expect(calls).toBe(2);
    // 60s 被 maxDelayMs 压到 4s，不会真的等一分钟
    expect(delays).toEqual([4000]);
  });
});
