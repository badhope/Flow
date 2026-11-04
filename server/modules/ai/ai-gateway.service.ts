import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { eq, and, gte, lte, count, sum, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { enforcePublicOutbound, isSafePublicHttpUrl, publicOutboundAgents } from '../../common/http/url-guard';
import { aiSettings, aiUsageLog } from '../../database/schema';
import { isPlatformAdmin } from '../../common/tenant/tenant-scope';
import { computeCostUsd, extractCachedInputTokens } from './model-pricing';
import { withRetry, parseRetryAfter } from './retry-policy';
import type { SellerActor } from './seller-scope';
import {
  LLM_NOT_CONFIGURED_MESSAGE,
  buildChatCompletionsUrl,
  resolveLlmConfig,
  type LlmDbConfig,
  type ResolvedLlmConfig,
} from './llm-config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  /**
   * 任务类型：允许按任务路由到不同模型（写作/客服/翻译/趋势各有所长）。
   * 未配置任务级覆盖时回退卖家默认模型。
   */
  task?: string;
  /** 一次 Agent 运行内共享的 trace id，用于把多步调用串起来 */
  traceId?: string;
}

interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** 命中提示缓存的输入 token（各家字段不同，已归一） */
  cached_input_tokens?: number;
}

interface ChatResult {
  content: string;
  usage?: ChatUsage;
}

interface UsageStats {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  /** 已收录价目模型的累计成本（USD，字符串避免浮点误差）；null 表示全部未收录 */
  totalCostUsd: string | null;
  totalDurationMs: number;
  successRate: number;
  byAgent: Array<{
    agent: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    costUsd: string | null;
    durationMs: number;
  }>;
}

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
  ) {}

  /**
   * 每次调用时解析配置（UI 设置 > 环境变量），设置保存后立即生效、无需重启。
   * 配置为单行级查询，相对 LLM 调用延迟可忽略。
   * 作用域（切片 2）：传 userId 且非 admin → 读 `{userId}:llm_*` 作用域键；
   * 卖家无作用域配置时回退环境变量，绝不串用其他卖家的 DB 配置。
   */
  async resolveConfig(forUser?: { userId?: string; role?: string }): Promise<ResolvedLlmConfig> {
    const scoped = forUser?.userId && forUser.role !== 'admin';
    const rows = await this.db.select().from(aiSettings);
    const dbConfig: LlmDbConfig = {};
    const prefix = scoped ? `${forUser!.userId}:` : '';
    for (const row of rows) {
      if (scoped && !row.key.startsWith(prefix)) continue;
      const bareKey = scoped ? row.key.slice(prefix.length) : row.key;
      if (bareKey === 'llm_base_url') dbConfig.baseUrl = row.value;
      else if (bareKey === 'llm_api_key') dbConfig.apiKey = row.value;
      else if (bareKey === 'llm_model') dbConfig.model = row.value;
    }
    const resolved = resolveLlmConfig(dbConfig, process.env);
    if (
      resolved.baseUrlSource === 'db'
      && enforcePublicOutbound()
      && resolved.apiKey
      && !isSafePublicHttpUrl(buildChatCompletionsUrl(resolved.baseUrl))
    ) {
      throw new BadRequestException(
        '模型 Base URL 不可用：禁止指向内网/保留地址（SSRF 防护）。请在「模型设置」中改为公网地址',
      );
    }
    return resolved;
  }

  async isConfigured(forUser?: { userId?: string; role?: string }): Promise<boolean> {
    const config = await this.resolveConfig(forUser);
    return config.apiKey.length > 0;
  }

  async getModel(forUser?: { userId?: string; role?: string }): Promise<string> {
    const config = await this.resolveConfig(forUser);
    return config.model;
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions & { agent?: string; userId?: string; role?: string },
  ): Promise<ChatResult> {
    const agent = options?.agent ?? 'unknown';
    const userId = options?.userId;
    const startMs = Date.now();

    const config = await this.resolveConfig({ userId, role: options?.role });
    // 任务级模型覆盖：同一个卖家可以给「写文案」用强模型、「标题生成」用便宜模型。
    // 只覆盖模型名，Base URL 与 Key 仍走同一份配置（避免密钥扩散）。
    const taskModel = options?.task
      ? await this.resolveTaskModel(options.task, { userId, role: options?.role })
      : null;
    if (taskModel && taskModel !== config.model) {
      config.model = taskModel;
    }
    if (!config.apiKey) {
      await this.logUsage({
        agent,
        model: config.model,
        success: false,
        durationMs: 0,
        errorMessage: LLM_NOT_CONFIGURED_MESSAGE,
        userId,
      });
      throw new BadRequestException(LLM_NOT_CONFIGURED_MESSAGE);
    }

    const temperature = options?.temperature ?? 0.7;
    const responseFormat = options?.responseFormat === 'json'
      ? { type: 'json_object' as const }
      : undefined;

    // 思考型/推理模型（reasoner、u2、*-thinking 等）会先输出大段思维链，
    // 预算过小时正文尚未开始即被截断（实测云知声 u2-flash: finish_reason=length 且 content 为空）。
    // 这里按模型名自动扩容思考预算，各 Agent 只声明"答案需要多少 token"。
    const requestedTokens = options?.maxTokens ?? 2000;
    const isThinkingModel = /reason|thinking|-r1|u2|o[13]/i.test(config.model);
    const maxTokens = isThinkingModel ? Math.max(requestedTokens, 6000) : requestedTokens;

    const body = {
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };

    try {
      const url = buildChatCompletionsUrl(config.baseUrl);
      // 429 / 5xx / 网络错误自动退避重试；401/404 立即失败（重试只会拖长等待）
      const response = await withRetry(
        () => firstValueFrom(
          this.httpService.post(url, body, {
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
            maxRedirects: 0,
            ...(config.baseUrlSource === 'db' && enforcePublicOutbound()
              ? { ...publicOutboundAgents(), proxy: false as const }
              : {}),
          }),
        ),
        {
          statusOf: (err) => (err as { response?: { status?: number } })?.response?.status,
          retryAfterOf: (err) => parseRetryAfter(
            (err as { response?: { headers?: Record<string, string> } })?.response?.headers?.['retry-after'],
          ),
          onRetry: (attempt, err, delayMs) => {
            const status = (err as { response?: { status?: number } })?.response?.status;
            this.logger.warn(
              `LLM 调用失败（${status ?? 'network'}），${delayMs}ms 后第 ${attempt + 1} 次尝试`,
            );
          },
        },
      );

      const choices = response.data?.choices;
      if (!choices || choices.length === 0) {
        throw new InternalServerErrorException('LLM 返回为空');
      }

      // 不同服务商的字段差异容错（真实测试中已遇到）：
      // - 思考型模型（如云知声 u2-flash / DeepSeek-reasoner）可能把正文放在 reasoning_content
      // - 少数网关用 output_text / text 承载正文
      const message = choices[0]?.message ?? {};
      const content: string = (
        message.content
        || message.reasoning_content
        || message.output_text
        || message.text
        || ''
      ).trim();

      if (!content) {
        const truncated = choices[0]?.finish_reason === 'length';
        throw new InternalServerErrorException(
          truncated
            ? `LLM 输出被 max_tokens 截断（模型 ${config.model} 为思考型，建议提高预算或改用非思考模型）`
            : 'LLM 返回内容为空，请重试或检查模型设置',
        );
      }

      const truncated = choices[0]?.finish_reason === 'length';
      if (truncated) {
        this.logger.warn(`LLM 输出达到 max_tokens 上限（模型 ${config.model}），内容可能不完整`);
      }

      const usageRaw = response.data?.usage;
      const cachedInput = extractCachedInputTokens(usageRaw);
      const usage: ChatUsage | undefined = usageRaw
        ? {
            prompt_tokens: usageRaw.prompt_tokens ?? 0,
            completion_tokens: usageRaw.completion_tokens ?? 0,
            total_tokens: usageRaw.total_tokens ?? 0,
            cached_input_tokens: cachedInput,
          }
        : undefined;

      const durationMs = Date.now() - startMs;
      void this.logUsage({
        agent,
        model: config.model,
        success: true,
        durationMs,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
        cachedInputTokens: usage?.cached_input_tokens,
        traceId: options?.traceId,
        userId,
      });

      return { content, usage };
    } catch (error: unknown) {
      const durationMs = Date.now() - startMs;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('LLM 调用失败', error instanceof Error ? error.stack : String(error));

      void this.logUsage({
        agent,
        model: config.model,
        success: false,
        durationMs,
        errorMessage,
        traceId: options?.traceId,
        userId,
      });

      if (error instanceof BadRequestException) throw error;
      // 回显上游 HTTP 状态，便于用户在「模型设置」中定位问题（401=Key 错误 / 404=BaseURL 或模型名错误）
      const upstreamStatus = (error as { response?: { status?: number } })?.response?.status;
      throw new InternalServerErrorException(
        upstreamStatus
          ? `AI 服务调用失败（上游 HTTP ${upstreamStatus}），请检查模型设置`
          : 'AI 服务调用失败，请检查模型设置后重试',
      );
    }
  }

  /**
   * 读取任务级模型覆盖（键：`{scope}llm_task_model:{task}`）。
   * 未配置时返回 null，调用方沿用默认模型——不做猜测性路由。
   */
  async resolveTaskModel(
    task: string,
    forUser?: { userId?: string; role?: string },
  ): Promise<string | null> {
    const normalizedTask = task.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!normalizedTask) return null;
    const scoped = forUser?.userId && forUser.role !== 'admin';
    const prefix = scoped ? `${forUser!.userId}:` : '';
    const key = `${prefix}llm_task_model:${normalizedTask}`;

    const rows = await this.db
      .select({ value: aiSettings.value })
      .from(aiSettings)
      .where(eq(aiSettings.key, key))
      .limit(1);
    const value = rows[0]?.value?.trim();
    return value ? value : null;
  }

  private async logUsage(params: {
    agent: string;
    model: string;
    success: boolean;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    errorMessage?: string;
    traceId?: string;
    userId?: string;
  }): Promise<void> {
    try {
      // 成本在写入时按当时价目算好；模型未收录时为 null，绝不臆造一个数
      const costUsd = params.success
        ? computeCostUsd(params.model, {
          inputTokens: params.inputTokens ?? 0,
          outputTokens: params.outputTokens ?? 0,
          cachedInputTokens: params.cachedInputTokens ?? 0,
        })
        : null;

      await this.db.insert(aiUsageLog).values({
        agent: params.agent,
        model: params.model,
        inputTokens: params.inputTokens ?? 0,
        outputTokens: params.outputTokens ?? 0,
        cachedInputTokens: params.cachedInputTokens ?? 0,
        durationMs: params.durationMs,
        success: params.success,
        errorMessage: params.errorMessage,
        costUsd,
        traceId: params.traceId ?? null,
        userId: params.userId,
      });
    } catch (err: unknown) {
      this.logger.error('写入 AI 计量日志失败', err instanceof Error ? err.stack : String(err));
    }
  }

  async getUsageStats(params?: {
    agent?: string;
    startDate?: string;
    endDate?: string;
    actor?: SellerActor;
  }): Promise<UsageStats> {
    const conditions = [];
    const actor = params?.actor;
    if (actor && !isPlatformAdmin(actor.role)) {
      conditions.push(actor.userId ? eq(aiUsageLog.userId, actor.userId) : sql`FALSE`);
    }
    if (params?.agent) {
      conditions.push(eq(aiUsageLog.agent, params.agent));
    }
    if (params?.startDate) {
      conditions.push(gte(aiUsageLog.createdAt, new Date(params.startDate)));
    }
    if (params?.endDate) {
      const end = new Date(params.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(aiUsageLog.createdAt, end));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const aggregateRows = await this.db
      .select({
        totalCalls: count(aiUsageLog.id),
        totalInputTokens: sum(aiUsageLog.inputTokens).mapWith(Number),
        totalOutputTokens: sum(aiUsageLog.outputTokens).mapWith(Number),
        totalCachedInputTokens: sum(aiUsageLog.cachedInputTokens).mapWith(Number),
        totalCostUsd: sql<string | null>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)::text`,
        totalDurationMs: sum(aiUsageLog.durationMs).mapWith(Number),
      })
      .from(aiUsageLog)
      .where(whereClause);

    const successCountRows = await this.db
      .select({ count: count(aiUsageLog.id) })
      .from(aiUsageLog)
      .where(
        whereClause
          ? and(whereClause, eq(aiUsageLog.success, true))
          : eq(aiUsageLog.success, true),
      );

    const byAgentRows = await this.db
      .select({
        agent: aiUsageLog.agent,
        calls: count(aiUsageLog.id),
        inputTokens: sum(aiUsageLog.inputTokens).mapWith(Number),
        outputTokens: sum(aiUsageLog.outputTokens).mapWith(Number),
        cachedInputTokens: sum(aiUsageLog.cachedInputTokens).mapWith(Number),
        costUsd: sql<string | null>`COALESCE(SUM(${aiUsageLog.costUsd}), 0)::text`,
        durationMs: sum(aiUsageLog.durationMs).mapWith(Number),
      })
      .from(aiUsageLog)
      .where(whereClause)
      .groupBy(aiUsageLog.agent)
      .orderBy(aiUsageLog.agent);

    const agg = aggregateRows[0];
    const totalCalls = Number(agg?.totalCalls ?? 0);
    const successCount = Number(successCountRows[0]?.count ?? 0);
    const successRate = totalCalls > 0 ? successCount / totalCalls : 0;

    // 全部调用都来自未收录价目的模型时，成本显示为 null（"未收录"），
    // 而不是 0——0 会被误读成"这个月没花钱"。
    const hasPricedCall = Number(agg?.totalCostUsd ?? 0) > 0;
    return {
      totalCalls,
      totalInputTokens: agg?.totalInputTokens ?? 0,
      totalOutputTokens: agg?.totalOutputTokens ?? 0,
      totalCachedInputTokens: agg?.totalCachedInputTokens ?? 0,
      totalCostUsd: totalCalls > 0 && hasPricedCall ? agg?.totalCostUsd ?? null : null,
      totalDurationMs: agg?.totalDurationMs ?? 0,
      successRate,
      byAgent: byAgentRows.map((row) => ({
        agent: row.agent,
        calls: Number(row.calls),
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        cachedInputTokens: row.cachedInputTokens ?? 0,
        costUsd: Number(row.costUsd ?? 0) > 0 ? row.costUsd : null,
        durationMs: row.durationMs ?? 0,
      })),
    };
  }
}
