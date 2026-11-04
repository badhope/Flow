/**
 * 上游调用重试策略。
 *
 * 现状问题：`httpService.post` 单次 60s 超时、失败即抛。真实环境里 429（配额）和
 * 5xx（上游抖动）占了失败的大头，这些**重试就能好**，直接暴露给用户是浪费。
 * 而 401/404（Key 错、模型名错）重试只会拖长等待，必须立刻失败。
 *
 * 因此把错误分成三类：
 *   retryable    429 / 5xx / 网络错误 / 超时  → 指数退避重试
 *   fatal        4xx（除 429）                → 立即失败，不重试
 *   unknown      无状态码                     → 重试一次，谨慎处理
 */

export interface RetryPolicy {
  /** 最多尝试次数（含首次） */
  maxAttempts: number;
  /** 首次退避基数（毫秒） */
  baseDelayMs: number;
  /** 退避上限（毫秒） */
  maxDelayMs: number;
  /** 抖动比例，避免同一时刻的大量重试形成尖峰 */
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 4000,
  jitterRatio: 0.25,
};

/** 判断是否值得重试 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;      // 网络层错误：值得再试一次
  if (status === 429) return true;            // 配额/限流
  if (status === 408) return true;            // 请求超时
  if (status >= 500 && status < 600) return true; // 上游故障
  return false;
}

/**
 * 计算第 attempt 次失败后的等待时长（attempt 从 1 开始）。
 *
 * 指数退避 + 抖动：delay = min(base * 2^(attempt-1), max) * (1 ± jitter)
 * 抖动只在上限内叠加，保证不会因为抖动突破 maxDelayMs。
 */
export function retryDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY, randomValue = Math.random()): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * (randomValue * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/** 解析上游 Retry-After（秒数或 HTTP 日期），失败返回 undefined */
export function parseRetryAfter(header: string | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now);
}

export interface RetryOutcome<T> {
  ok: boolean;
  value?: T;
  error?: Error;
  attempts: number;
}

/**
 * 通用重试执行器。`shouldRetry` 接收错误与尝试次数，返回是否继续。
 * 不 sleep 的实现留给调用方注入（测试里可以传 no-op，避免真的等）。
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    policy?: RetryPolicy;
    /** 从错误里提取上游状态码，用于判定可重试性 */
    statusOf?: (error: unknown) => number | undefined;
    /** 从错误里提取 Retry-After 毫秒 */
    retryAfterOf?: (error: unknown) => number | undefined;
    /** 测试注入：默认真 sleep */
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  } = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const statusOf = options.statusOf ?? defaultStatusOf;

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const status = statusOf(error);
      const retryable = isRetryableStatus(status);
      const isLast = attempt >= policy.maxAttempts;
      if (!retryable || isLast) break;

      const serverHint = options.retryAfterOf?.(error);
      const delay = serverHint !== undefined
        ? Math.min(serverHint, policy.maxDelayMs)
        : retryDelayMs(attempt, policy);
      options.onRetry?.(attempt, error, delay);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function defaultStatusOf(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : undefined;
}
