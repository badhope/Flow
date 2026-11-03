import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { aiSettings } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from './ai-gateway.service';
import { LLM_NOT_CONFIGURED_MESSAGE, maskApiKey } from './llm-config';
import { scopedSettingKey, type SettingActor } from './ai-settings-scope';
import type { AiSettingsTestResult, AiSettingsView } from '../../../shared/api.interface';
import type { UpdateAiSettingsDto } from './dto/ai-settings.dto';

export type { AiSettingsTestResult, AiSettingsView };

/**
 * 模型设置：UI（DB）> 环境变量。保存后立即生效（网关按调用解析配置）。
 * Key 永不明文回显；环境变量仅作无界面部署的引导默认值。
 * 作用域（切片 2）：admin 写平台全局键；seller 写 `{userId}:llm_*` 作用域键，
 * 互不可见、无法覆盖他人配置；seller 未配置时网关回退环境变量。
 */
@Injectable()
export class AiSettingsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly gateway: AiGatewayService,
    private readonly auditService: AuditService,
  ) {}

  async get(actor: SettingActor): Promise<AiSettingsView> {
    const config = await this.gateway.resolveConfig(actor);
    const apiKey = await this.readScopedKey('llm_api_key', actor);

    return {
      configured: config.apiKey.length > 0,
      source: config.source,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyMasked: maskApiKey(apiKey),
    };
  }

  async update(dto: UpdateAiSettingsDto, actor: SettingActor): Promise<AiSettingsView> {
    const actorId = actor.userId ?? '';
    await this.upsert('llm_base_url', dto.baseUrl === undefined ? undefined : (dto.baseUrl.trim() || null), actorId, actor);
    await this.upsert('llm_model', dto.model === undefined ? undefined : (dto.model.trim() || null), actorId, actor);
    if (dto.apiKey !== undefined) {
      await this.upsert('llm_api_key', dto.apiKey.trim() || null, actorId, actor);
    }

    try {
      void this.auditService.log({
        action: 'ai.settings_update',
        entity: 'ai_settings',
        // 审计只记录变更字段与掩码，绝不落明文 Key
        after: {
          baseUrl: dto.baseUrl?.trim() || undefined,
          model: dto.model?.trim() || undefined,
          apiKey: dto.apiKey === undefined ? undefined : (dto.apiKey.trim() ? maskApiKey(dto.apiKey) : 'cleared'),
        },
        userId: actorId,
        role: actor.role === 'admin' ? 'admin' : 'seller',
      });
    } catch {
      // 审计失败不影响主流程
    }

    return this.get(actor);
  }

  /** 连通性检测：真正调用一次模型；失败返回原样错误信息（诚实回显） */
  async test(actor: SettingActor): Promise<AiSettingsTestResult> {
    const config = await this.gateway.resolveConfig(actor);
    if (!config.apiKey) {
      return { ok: false, message: LLM_NOT_CONFIGURED_MESSAGE };
    }

    try {
      const result = await this.gateway.chat(
        [
          { role: 'system', content: '你是连通性检测助手。' },
          { role: 'user', content: '请只回复两个字：可用' },
        ],
        { agent: 'settings-test', maxTokens: 16, temperature: 0, userId: actor.userId, role: actor.role },
      );
      return {
        ok: true,
        model: config.model,
        message: `连通正常（${config.model}）：${result.content.trim().slice(0, 60)}`,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async readScopedKey(key: string, actor: SettingActor): Promise<string | null> {
    const scopedKey = scopedSettingKey(key, actor);
    const rows = await this.db
      .select({ value: aiSettings.value })
      .from(aiSettings)
      .where(eq(aiSettings.key, scopedKey))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  private async upsert(
    key: string,
    value: string | null | undefined,
    actorId: string,
    actor: SettingActor,
  ): Promise<void> {
    if (value === undefined) return;
    const scopedKey = scopedSettingKey(key, actor);

    if (value === null) {
      await this.db.delete(aiSettings).where(eq(aiSettings.key, scopedKey));
      return;
    }

    await this.db
      .insert(aiSettings)
      .values({ key: scopedKey, value, updatedBy: actorId })
      .onConflictDoUpdate({
        target: aiSettings.key,
        set: { value, updatedBy: actorId, updatedAt: new Date() },
      });
  }
}
