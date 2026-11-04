import { Decimal } from 'decimal.js';

/**
 * 模型价目表与成本核算。
 *
 * 为什么需要它：`ai_usage_log` 只记 token 时，"哪个 Agent 在烧钱"这个问题无法回答，
 * 卖家也看不到自己这个月的 AI 支出。成本必须在**写入时**按当时的价格算好——
 * 事后按汇率式反推会因为调价而失真。
 *
 * 价格单位：美元 / 100 万 token。数据来自各厂商公开定价页，只收录明确公开的模型；
 * 未收录的模型**返回 null**，不猜、不臆造（诚实优先于好看）。
 */

export interface ModelPrice {
  /** 输入 token 单价（USD / 1M tokens） */
  input: number;
  /** 输出 token 单价（USD / 1M tokens） */
  output: number;
  /** 命中提示缓存的输入 token 单价；缺省表示该模型不单独计费缓存 */
  cachedInput?: number;
}

/**
 * 匹配规则：按前缀匹配，最长前缀优先。
 * 这样 `gpt-4o-mini` 不会被 `gpt-4o` 抢先匹配，模型的小版本后缀（-2024-08-06）也能命中。
 */
const PRICE_TABLE: Array<{ prefix: string; price: ModelPrice }> = [
  // OpenAI
  { prefix: 'gpt-4o-mini', price: { input: 0.15, output: 0.6, cachedInput: 0.075 } },
  { prefix: 'gpt-4o', price: { input: 2.5, output: 10, cachedInput: 1.25 } },
  { prefix: 'gpt-4.1-mini', price: { input: 0.4, output: 1.6, cachedInput: 0.1 } },
  { prefix: 'gpt-4.1', price: { input: 2, output: 8, cachedInput: 0.5 } },
  { prefix: 'o4-mini', price: { input: 1.1, output: 4.4, cachedInput: 0.275 } },
  { prefix: 'o3', price: { input: 2, output: 8, cachedInput: 0.5 } },
  // Anthropic
  { prefix: 'claude-3-5-haiku', price: { input: 0.8, output: 4, cachedInput: 0.08 } },
  { prefix: 'claude-3-5-sonnet', price: { input: 3, output: 15, cachedInput: 0.3 } },
  { prefix: 'claude-sonnet-4', price: { input: 3, output: 15, cachedInput: 0.3 } },
  { prefix: 'claude-opus-4', price: { input: 15, output: 75, cachedInput: 1.5 } },
  // DeepSeek（缓存命中是主要成本杠杆，务必单列）
  { prefix: 'deepseek-chat', price: { input: 0.27, output: 1.1, cachedInput: 0.07 } },
  { prefix: 'deepseek-reasoner', price: { input: 0.55, output: 2.19, cachedInput: 0.14 } },
  // 阿里通义
  { prefix: 'qwen-plus', price: { input: 0.4, output: 1.2 } },
  { prefix: 'qwen-turbo', price: { input: 0.05, output: 0.2 } },
  { prefix: 'qwen-max', price: { input: 1.6, output: 6.4 } },
  // 智谱
  { prefix: 'glm-4-flash', price: { input: 0, output: 0 } },
  { prefix: 'glm-4-plus', price: { input: 0.7, output: 0.7 } },
];

/** 查价：返回 null 表示未收录，调用方必须容忍 null（不臆造成本） */
export function lookupModelPrice(model: string): ModelPrice | null {
  const normalized = (model ?? '').trim().toLowerCase();
  if (!normalized) return null;

  let best: { prefix: string; price: ModelPrice } | null = null;
  for (const entry of PRICE_TABLE) {
    if (!normalized.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  return best?.price ?? null;
}

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  /** 其中命中缓存的输入 token（如果上游提供） */
  cachedInputTokens?: number;
}

/**
 * 计算成本（USD）。缓存 token 单独按缓存价计费，未命中部分按普通输入价。
 * 未收录模型返回 null。
 */
export function computeCostUsd(model: string, usage: CostInput): string | null {
  const price = lookupModelPrice(model);
  if (!price) return null;

  const totalInput = Math.max(0, usage.inputTokens || 0);
  const cached = Math.min(Math.max(0, usage.cachedInputTokens || 0), totalInput);
  const freshInput = totalInput - cached;
  const output = Math.max(0, usage.outputTokens || 0);

  const cachedRate = price.cachedInput ?? price.input;

  const cost = new Decimal(freshInput).mul(price.input)
    .plus(new Decimal(cached).mul(cachedRate))
    .plus(new Decimal(output).mul(price.output))
    // 单价是 USD / 1M tokens
    .div(1_000_000);

  // 极小的值也要保留，便于按天累加；6 位小数足够表达单次调用
  return cost.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

/**
 * 从上游 usage 对象里抽取缓存命中 token。
 *
 * 三家字段各不相同，且都在演进：
 *   OpenAI      prompt_tokens_details.cached_tokens
 *   DeepSeek    prompt_cache_hit_tokens
 *   Anthropic   cache_read_input_tokens
 * 取不到就返回 0——宁可低估缓存收益，也不编造。
 */
export function extractCachedInputTokens(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0;
  const u = usage as Record<string, unknown>;

  const candidates: unknown[] = [
    (u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens,
    u.prompt_cache_hit_tokens,
    u.cache_read_input_tokens,
    u.cached_tokens,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate);
    }
  }
  return 0;
}
