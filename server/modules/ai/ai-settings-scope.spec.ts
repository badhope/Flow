import { describe, expect, it } from 'vitest';
import { resolveLlmConfig } from './llm-config';
import { scopedSettingKey, isPlatformSettingKey } from './ai-settings-scope';
import { WATCH_SETTINGS_KEY, watchSettingsKeyFor } from '../copilot/copilot-watch.service';

describe('ai-settings-scope R5: 模型配置按卖家隔离', () => {
  it('R5: llm_* 键对 seller actor 生成为带归属的作用域键', () => {
    expect(scopedSettingKey('llm_api_key', { userId: 'u1', role: 'seller' }))
      .toBe('u1:llm_api_key');
  });

  it('R5: admin actor 使用平台全局键（历史行为兼容）', () => {
    expect(scopedSettingKey('llm_api_key', { userId: 'admin-1', role: 'admin' }))
      .toBe('llm_api_key');
  });

  it('R5: seller 无 userId 时 fail-closed 不可写全局键', () => {
    expect(scopedSettingKey('llm_api_key', { userId: undefined, role: 'seller' }))
      .toBe('llm_api_key');
  });

  it('R5: 平台键判定只认无前缀形式', () => {
    expect(isPlatformSettingKey('llm_api_key')).toBe(true);
    expect(isPlatformSettingKey('u1:llm_api_key')).toBe(false);
  });
});

describe('ai-settings-scope R6: 环境变量兜底优先级', () => {
  it('R6: 卖家无 DB 配置时回退环境变量（不串用他卖家的 DB 键）', () => {
    const resolved = resolveLlmConfig({}, { LLM_API_KEY: 'env-key' });
    expect(resolved.apiKey).toBe('env-key');
    expect(resolved.source).toBe('env');
  });

  it('R6: 卖家有 DB 配置时优先于环境变量', () => {
    const resolved = resolveLlmConfig(
      { apiKey: 'db-key' },
      { LLM_API_KEY: 'env-key' },
    );
    expect(resolved.apiKey).toBe('db-key');
    expect(resolved.source).toBe('db');
  });
});

describe('copilot-watch R7: 巡检设置按卖家作用域', () => {
  it('R7: seller 的设置键带归属前缀，admin 用全局键', () => {
    expect(watchSettingsKeyFor({ userId: 'u1', role: 'seller' }))
      .toBe('u1:copilot_watch_settings');
    expect(watchSettingsKeyFor({ userId: 'u2', role: 'seller' }))
      .toBe('u2:copilot_watch_settings');
    expect(watchSettingsKeyFor({ userId: 'admin-1', role: 'admin' }))
      .toBe(WATCH_SETTINGS_KEY);
  });

  it('R7: 不同卖家的键互不相同', () => {
    const a = watchSettingsKeyFor({ userId: 'u1', role: 'seller' });
    const b = watchSettingsKeyFor({ userId: 'u2', role: 'seller' });
    expect(a).not.toBe(b);
  });
});
