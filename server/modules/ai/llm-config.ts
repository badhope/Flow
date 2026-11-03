export type LlmConfigSource = 'db' | 'env' | 'none';

export interface LlmDbConfig {
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}

export interface LlmEnvConfig {
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

export interface ResolvedLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: LlmConfigSource;
  baseUrlSource: 'db' | 'env' | 'default';
}

export const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_LLM_MODEL = 'deepseek-chat';

/** 未配置模型时的统一诚实提示（全站唯一文案，接口 / 控制台 / 客服组件共用） */
export const LLM_NOT_CONFIGURED_MESSAGE =
  'AI 模型未配置：请在卖家端「AI 分析中心 → 模型设置」中填写模型 API（或由运维配置 LLM_API_KEY 环境变量）';

/**
 * 模型配置统一口径：UI 设置（DB）> 环境变量；字段级合并。
 * apiKey 缺失时 source='none' —— 调用方必须诚实拒绝，绝不返回假数据。
 */
export function resolveLlmConfig(
  db: LlmDbConfig | null | undefined,
  env: LlmEnvConfig,
): ResolvedLlmConfig {
  const dbBase = db?.baseUrl?.trim();
  const dbKey = db?.apiKey?.trim();
  const dbModel = db?.model?.trim();
  const envBase = env.LLM_BASE_URL?.trim();
  const envKey = env.LLM_API_KEY?.trim();
  const envModel = env.LLM_MODEL?.trim();

  return {
    baseUrl: dbBase || envBase || DEFAULT_LLM_BASE_URL,
    apiKey: dbKey || envKey || '',
    model: dbModel || envModel || DEFAULT_LLM_MODEL,
    // source 保留字段级合并契约：清除 UI Key 后可回退 env Key；
    // baseUrlSource 单独标识 URL 是否由卖家界面控制，供生产 SSRF 校验使用。
    source: dbKey ? 'db' : envKey ? 'env' : 'none',
    baseUrlSource: dbBase ? 'db' : envBase ? 'env' : 'default',
  };
}

/** 掩码展示（接口永不返回明文 Key）：sk-****abcd；短串全掩 */
export function maskApiKey(apiKey: string | null | undefined): string | null {
  const key = apiKey?.trim();
  if (!key) return null;
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

/** 渲染用户提示词模板：替换全部 {{input}}；无占位符时输入追加在末尾（行为可预期） */
export function renderPromptTemplate(template: string, input: string): string {
  if (template.includes('{{input}}')) {
    return template.split('{{input}}').join(input);
  }
  return `${template}\n\n${input}`.trim();
}

/**
 * 组装 chat/completions 端点（支持多种服务商兼容路径，商家自选 Base URL 不会被拼错）：
 * - 已是 /chat/completions 结尾 → 原样使用
 * - 路径以版本段结尾（/v1、/v3、/v4…）→ 追加 /chat/completions（智谱 /api/paas/v4、火山方舟 /api/v3 等）
 * - 其余 → 追加 /v1/chat/completions（DeepSeek / OpenAI 默认）
 */
export function buildChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  const lastSegment = base.split('/').pop() ?? '';
  if (/^v\d+$/.test(lastSegment)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** 自定义 Agent slug 规范（用户未填时由服务端生成） */
export function normalizeAgentSlug(raw: string | null | undefined): string | null {
  const slug = raw?.trim().toLowerCase();
  if (!slug) return null;
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(slug)) return null;
  return slug;
}
