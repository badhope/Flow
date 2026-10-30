import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { aiAgents } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { buildOwnerVisibilityCondition, andOptional, type SellerActor } from './seller-scope';
import { AiGatewayService } from './ai-gateway.service';
import { BUILTIN_AGENTS } from './agent-registry';
import { parseLlmJson } from './llm-json';
import { normalizeAgentSlug, renderPromptTemplate } from './llm-config';
import type {
  AgentListResult,
  CustomAgent,
  RunAgentResult,
} from '../../../shared/api.interface';
import type { CreateAgentDto, RunAgentDto, UpdateAgentDto } from './dto/ai-settings.dto';

export type { AgentListResult, CustomAgent, RunAgentResult };
export type CustomAgentView = CustomAgent;

/**
 * 自定义 Agent：用户可创建任意数量的通用 Agent（系统提示词 + 输入模板），
 * 内置 5 个专业 Agent 由代码定义、在列表中只读展示。
 */
@Injectable()
export class CustomAgentsService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly gateway: AiGatewayService,
    private readonly auditService: AuditService,
  ) {}

  async list(actor: SellerActor): Promise<AgentListResult> {
    const rows = await this.db
      .select()
      .from(aiAgents)
      .where(andOptional(
        buildOwnerVisibilityCondition(aiAgents.createdBy, actor),
      ))
      .orderBy(desc(aiAgents.createdAt));
    return {
      builtin: BUILTIN_AGENTS,
      custom: rows.map((row) => this.mapAgent(row)),
    };
  }

  async create(dto: CreateAgentDto, actorId: string): Promise<CustomAgentView> {
    const slug = normalizeAgentSlug(dto.slug) ?? `agent-${Date.now().toString(36)}`;

    const existing = await this.db.select({ id: aiAgents.id }).from(aiAgents).where(eq(aiAgents.slug, slug));
    if (existing.length > 0) {
      throw new ConflictException(`标识 ${slug} 已存在`);
    }

    const inserted = await this.db
      .insert(aiAgents)
      .values({
        slug,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? '',
        systemPrompt: dto.systemPrompt,
        userPromptTemplate: dto.userPromptTemplate ?? '{{input}}',
        responseFormat: dto.responseFormat ?? 'text',
        temperature: String(dto.temperature ?? 0.7),
        maxTokens: dto.maxTokens ?? 2000,
        enabled: dto.enabled ?? true,
        createdBy: actorId,
      })
      .returning();

    await this.audit('ai.agent_create', inserted[0].id, actorId, undefined, {
      slug,
      name: dto.name,
      responseFormat: dto.responseFormat ?? 'text',
    });

    return this.mapAgent(inserted[0]);
  }

  async update(id: string, dto: UpdateAgentDto, actor: SellerActor): Promise<CustomAgentView> {
    const rows = await this.db
      .select()
      .from(aiAgents)
      .where(andOptional(
        eq(aiAgents.id, id),
        buildOwnerVisibilityCondition(aiAgents.createdBy, actor),
      ));
    if (rows.length === 0) {
      throw new NotFoundException('Agent 不存在');
    }
    const actorId = actor.userId ?? '';
    const before = this.mapAgent(rows[0]);

    const patch: Partial<typeof aiAgents.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined) patch.description = dto.description.trim();
    if (dto.systemPrompt !== undefined) patch.systemPrompt = dto.systemPrompt;
    if (dto.userPromptTemplate !== undefined) patch.userPromptTemplate = dto.userPromptTemplate;
    if (dto.responseFormat !== undefined) patch.responseFormat = dto.responseFormat;
    if (dto.temperature !== undefined) patch.temperature = String(dto.temperature);
    if (dto.maxTokens !== undefined) patch.maxTokens = dto.maxTokens;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;

    const updated = await this.db.update(aiAgents).set(patch).where(eq(aiAgents.id, id)).returning();
    const after = this.mapAgent(updated[0]);

    await this.audit('ai.agent_update', id, actorId, { name: before.name, enabled: before.enabled }, {
      name: after.name,
      enabled: after.enabled,
    });

    return after;
  }

  async remove(id: string, actor: SellerActor): Promise<{ success: boolean }> {
    const rows = await this.db
      .select()
      .from(aiAgents)
      .where(andOptional(
        eq(aiAgents.id, id),
        buildOwnerVisibilityCondition(aiAgents.createdBy, actor),
      ));
    if (rows.length === 0) {
      throw new NotFoundException('Agent 不存在');
    }
    const actorId = actor.userId ?? '';

    await this.db.delete(aiAgents).where(eq(aiAgents.id, id));
    await this.audit('ai.agent_delete', id, actorId, { slug: rows[0].slug, name: rows[0].name }, undefined);
    return { success: true };
  }

  /** 运行自定义 Agent：模板渲染 → 网关调用（用量计入 ai_usage_log，agent=custom:<slug>） */
  async run(id: string, dto: RunAgentDto, actor: SellerActor): Promise<RunAgentResult> {
    const rows = await this.db
      .select()
      .from(aiAgents)
      .where(andOptional(
        eq(aiAgents.id, id),
        buildOwnerVisibilityCondition(aiAgents.createdBy, actor),
      ));
    if (rows.length === 0) {
      throw new NotFoundException('Agent 不存在');
    }
    const actorId = actor.userId ?? '';
    const agent = rows[0];
    if (!agent.enabled) {
      throw new ConflictException('该 Agent 已停用');
    }

    const userPrompt = renderPromptTemplate(agent.userPromptTemplate, dto.input);
    const result = await this.gateway.chat(
      [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: Number(agent.temperature),
        maxTokens: agent.maxTokens,
        responseFormat: agent.responseFormat === 'json' ? 'json' : 'text',
        agent: `custom:${agent.slug}`,
        userId: actorId,
      },
    );

    if (agent.responseFormat === 'json') {
      return { content: result.content, parsed: parseLlmJson<unknown>(result.content) };
    }
    return { content: result.content };
  }

  private mapAgent(row: typeof aiAgents.$inferSelect): CustomAgentView {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      systemPrompt: row.systemPrompt,
      userPromptTemplate: row.userPromptTemplate,
      responseFormat: row.responseFormat === 'json' ? 'json' : 'text',
      temperature: Number(row.temperature),
      maxTokens: row.maxTokens,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async audit(
    action: string,
    entityId: string,
    actorId: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
  ): Promise<void> {
    try {
      void this.auditService.log({
        action,
        entity: 'ai_agent',
        entityId,
        before,
        after,
        userId: actorId,
        role: 'seller',
      });
    } catch {
      // 审计失败不影响主流程
    }
  }
}
