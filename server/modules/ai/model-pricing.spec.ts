import { describe, expect, it } from 'vitest';
import { computeCostUsd, extractCachedInputTokens, lookupModelPrice } from './model-pricing';

/**
 * 成本核算的契约。这些数字直接出现在卖家的「AI 用量」页上，必须有据可查：
 * 未收录的模型宁可返回 null（显示"未收录"），也不能给一个看上去合理但错误的金额。
 */
describe('model pricing', () => {
  it('P1: 长前缀优先匹配，gpt-4o-mini 不会被 gpt-4o 抢走', () => {
    expect(lookupModelPrice('gpt-4o-mini')?.input).toBe(0.15);
    expect(lookupModelPrice('gpt-4o')?.input).toBe(2.5);
    // 带日期后缀的版本也要命中
    expect(lookupModelPrice('gpt-4o-mini-2024-07-18')?.input).toBe(0.15);
  });

  it('P2: 未收录模型返回 null，不臆造成本', () => {
    expect(lookupModelPrice('some-internal-model-v9')).toBeNull();
    expect(computeCostUsd('some-internal-model-v9', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
    // 空模型名同样 null
    expect(computeCostUsd('', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('P3: 纯输入/输出按百万单价折算', () => {
    // gpt-4o-mini: input 0.15 / output 0.6 per 1M
    // 1M input + 0 output = 0.15
    expect(computeCostUsd('gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 0 })).toBe('0.150000');
    // 0 input + 1M output = 0.6
    expect(computeCostUsd('gpt-4o-mini', { inputTokens: 0, outputTokens: 1_000_000 })).toBe('0.600000');
  });

  it('P4: 缓存 token 按缓存价单独计费，不会被当成普通输入', () => {
    // deepseek-chat: input 0.27, cachedInput 0.07
    // 全部命中缓存 -> 1M * 0.07 = 0.07，而不是 0.27
    const allCached = computeCostUsd('deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(allCached).toBe('0.070000');

    // 一半命中 -> 0.5M*0.27 + 0.5M*0.07 = 0.135 + 0.035 = 0.17
    const halfCached = computeCostUsd('deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 500_000,
    });
    expect(halfCached).toBe('0.170000');
  });

  it('P5: 缓存 token 超过输入 token 时按输入封顶（脏数据不放大成本）', () => {
    const result = computeCostUsd('deepseek-chat', {
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 999_999,
    });
    // 100 全按缓存价：100 * 0.07 / 1M = 0.000007
    expect(result).toBe('0.000007');
  });

  it('P6: 负值与缺失字段被安全归零', () => {
    expect(computeCostUsd('gpt-4o-mini', { inputTokens: -5, outputTokens: -5 })).toBe('0.000000');
    expect(computeCostUsd('gpt-4o-mini', { inputTokens: 0, outputTokens: 0 })).toBe('0.000000');
  });

  it('P7: 缓存 token 抽取兼容三家字段', () => {
    // OpenAI
    expect(extractCachedInputTokens({ prompt_tokens_details: { cached_tokens: 128 } })).toBe(128);
    // DeepSeek
    expect(extractCachedInputTokens({ prompt_cache_hit_tokens: 256 })).toBe(256);
    // Anthropic
    expect(extractCachedInputTokens({ cache_read_input_tokens: 512 })).toBe(512);
    // 没有就 0，不猜
    expect(extractCachedInputTokens({ prompt_tokens: 1000 })).toBe(0);
    expect(extractCachedInputTokens(null)).toBe(0);
    expect(extractCachedInputTokens(undefined)).toBe(0);
    expect(extractCachedInputTokens({ prompt_cache_hit_tokens: 'many' })).toBe(0);
  });

  it('P8: 免费模型（glm-4-flash）成本为 0 而不是 null', () => {
    // 0 和 null 语义不同：0 表示"确实不计费"，null 表示"不知道价格"
    expect(computeCostUsd('glm-4-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe('0.000000');
  });
});
