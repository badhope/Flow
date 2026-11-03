import { describe, expect, it } from 'vitest';
import { buildChatCompletionsUrl, maskApiKey, normalizeAgentSlug, renderPromptTemplate, resolveLlmConfig } from './llm-config';

// 行为契约（R12）：模型配置优先级 DB > env > none，字段级合并；未配置 apiKey 一律 source=none
describe('resolveLlmConfig', () => {
  it('R12: UI 设置的 Key 优先于环境变量（source=db）', () => {
    const cfg = resolveLlmConfig(
      { baseUrl: 'http://ui.test/v1', apiKey: 'sk-ui', model: 'ui-model' },
      { LLM_BASE_URL: 'https://env.test', LLM_API_KEY: 'sk-env', LLM_MODEL: 'env-model' },
    );
    expect(cfg).toEqual({ baseUrl: 'http://ui.test/v1', apiKey: 'sk-ui', model: 'ui-model', source: 'db', baseUrlSource: 'db' });
  });

  it('R12: DB BaseURL 与环境 Key 合并时标记为 db，触发生产 SSRF 防护', () => {
    const cfg = resolveLlmConfig(
      { baseUrl: 'http://ui.test', apiKey: null, model: '' },
      { LLM_BASE_URL: 'https://env.test', LLM_API_KEY: 'sk-env', LLM_MODEL: 'env-model' },
    );
    expect(cfg.baseUrl).toBe('http://ui.test');
    expect(cfg.apiKey).toBe('sk-env');
    expect(cfg.model).toBe('env-model');
    expect(cfg.source).toBe('env');
    expect(cfg.baseUrlSource).toBe('db');
  });

  it('R12: 全空时 source=none，仅保留默认 base/model（apiKey 为空串）', () => {
    const cfg = resolveLlmConfig(null, {});
    expect(cfg.source).toBe('none');
    expect(cfg.apiKey).toBe('');
    expect(cfg.baseUrl).toBe('https://api.deepseek.com');
    expect(cfg.model).toBe('deepseek-chat');
  });

  it('R12: 空白字符串视为未填写', () => {
    const cfg = resolveLlmConfig({ apiKey: '   ' }, { LLM_API_KEY: '  ' });
    expect(cfg.source).toBe('none');
  });
});

describe('maskApiKey', () => {
  it('保留头尾用于识别，中间掩码；短串全掩；空值返回 null', () => {
    expect(maskApiKey('sk-abcdefghijklmn')).toBe('sk-****klmn');
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('')).toBeNull();
    expect(maskApiKey(null)).toBeNull();
  });
});

describe('renderPromptTemplate', () => {
  it('替换全部 {{input}} 占位符', () => {
    expect(renderPromptTemplate('分析：{{input}}\n再次：{{input}}', 'ABC')).toBe('分析：ABC\n再次：ABC');
  });

  it('无占位符时输入追加末尾', () => {
    expect(renderPromptTemplate('请分析以下内容：', 'ABC')).toBe('请分析以下内容：\n\nABC');
  });
});

describe('normalizeAgentSlug', () => {
  it('合法 slug 原样返回（小写化），非法返回 null', () => {
    expect(normalizeAgentSlug('My-Agent_1')).toBeNull();
    expect(normalizeAgentSlug('my-agent-1')).toBe('my-agent-1');
    expect(normalizeAgentSlug('  SEO-Helper ')).toBe('seo-helper');
    expect(normalizeAgentSlug('中文名')).toBeNull();
    expect(normalizeAgentSlug('')).toBeNull();
  });
});

// 行为契约（R14）：商家自选任何服务商的 Base URL 都能拼出正确的兼容端点
describe('buildChatCompletionsUrl', () => {
  it('R14: 裸域名与 /v1 写法（DeepSeek / OpenAI）', () => {
    expect(buildChatCompletionsUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(buildChatCompletionsUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(buildChatCompletionsUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('R14: 非 v1 版本路径（智谱 /api/paas/v4、火山方舟 /api/v3）', () => {
    expect(buildChatCompletionsUrl('https://open.bigmodel.cn/api/paas/v4')).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    expect(buildChatCompletionsUrl('https://ark.cn-beijing.volces.com/api/v3')).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  });

  it('R14: 通义 compatible-mode 与完整端点原样使用', () => {
    expect(buildChatCompletionsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(buildChatCompletionsUrl('https://proxy.example.com/v1/chat/completions')).toBe('https://proxy.example.com/v1/chat/completions');
  });

  it('R14: 无版本段的自建代理默认补 /v1', () => {
    expect(buildChatCompletionsUrl('https://proxy.example.com/llm')).toBe('https://proxy.example.com/llm/v1/chat/completions');
    expect(buildChatCompletionsUrl('http://127.0.0.1:4880/llm')).toBe('http://127.0.0.1:4880/llm/v1/chat/completions');
  });
});
