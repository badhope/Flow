import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import {
  copilotActions,
  copilotConversations,
  copilotMessages,
} from '../../database/schema';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { CopilotToolService } from './copilot-tool.service';
import { COPILOT_TOOLS, getTool } from './copilot-tools';
import { buildToolContracts, policyFingerprint, actionIdempotencyKey } from './copilot-tool-contract';
import {
  buildToolCatalog,
  parseCopilotDecision,
  toChatHistory,
  validateToolArgs,
} from './copilot-protocol';
import type {
  CopilotAction,
  CopilotActionResolveResult,
  CopilotConversation,
  CopilotConversationDetail,
  CopilotMessage,
  CopilotSendResult,
  CopilotToolsView,
} from '../../../shared/api.interface';

/** 单轮最多循环次数：防止模型陷入工具调用死循环 */
const MAX_STEPS = 6;

/** 待审批动作有效期：24h。过期后不可执行，防止陈旧审批被误触发。 */
const ACTION_TTL_MS = 24 * 60 * 60 * 1000;

/** processing 租约：超过该时长未回写即视为进程中断，可被回收。 */
const ACTION_LEASE_MS = 2 * 60 * 1000;
/** 单轮最多生成 3 个待审批动作，避免一次刷出大量确认卡片 */
const MAX_PENDING_ACTIONS_PER_TURN = 3;

/**
 * AI 运营副驾：工具调用 Agent（ReAct 循环）+ 人工审批门禁。
 *
 * 安全模型（fail-closed）：
 * 1. 读工具在循环内直接执行，结果回填模型；
 * 2. 写工具一律不执行，只落 `copilot_actions(status=pending)` 并回报模型"已提交待确认"；
 * 3. 只有会话所有者显式调用 approve 才通过既有业务服务执行；
 * 4. 未注册工具名、参数非法、越权操作均在执行前拒绝。
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly gateway: AiGatewayService,
    private readonly tools: CopilotToolService,
  ) {}

  // ==================== 会话 ====================

  async listConversations(userId: string): Promise<CopilotConversation[]> {
    const rows = await this.db
      .select()
      .from(copilotConversations)
      .where(and(eq(copilotConversations.userId, userId), eq(copilotConversations.channel, 'seller')))
      .orderBy(desc(copilotConversations.updatedAt))
      .limit(50);

    if (rows.length === 0) return [];

    const pendingRows = await this.db
      .select({ conversationId: copilotActions.conversationId, pending: count() })
      .from(copilotActions)
      .where(and(eq(copilotActions.userId, userId), eq(copilotActions.status, 'pending')))
      .groupBy(copilotActions.conversationId);
    const pendingByConversation = new Map(
      pendingRows.map((row) => [row.conversationId, Number(row.pending)]),
    );

    return rows.map((row) => ({
      ...this.mapConversation(row),
      pendingActionCount: pendingByConversation.get(row.id) ?? 0,
    }));
  }

  async createConversation(userId: string, title?: string): Promise<CopilotConversation> {
    const inserted = await this.db
      .insert(copilotConversations)
      .values({ userId, title: title?.trim() || '新对话', channel: 'seller' })
      .returning();
    return this.mapConversation(inserted[0]);
  }

  async removeConversation(userId: string, conversationId: string): Promise<{ success: boolean }> {
    await this.loadConversation(userId, conversationId);
    await this.db.delete(copilotConversations).where(eq(copilotConversations.id, conversationId));
    return { success: true };
  }

  async getConversationDetail(userId: string, conversationId: string): Promise<CopilotConversationDetail> {
    const conversation = await this.loadConversation(userId, conversationId);

    const [messageRows, actionRows] = await Promise.all([
      this.db
        .select()
        .from(copilotMessages)
        .where(eq(copilotMessages.conversationId, conversationId))
        .orderBy(asc(copilotMessages.createdAt)),
      this.db
        .select()
        .from(copilotActions)
        .where(eq(copilotActions.conversationId, conversationId))
        .orderBy(desc(copilotActions.createdAt)),
    ]);

    return {
      conversation: this.mapConversation(conversation),
      messages: messageRows.map((row) => this.mapMessage(row)),
      actions: actionRows.map((row) => this.mapAction(row)),
    };
  }

  // ==================== 对话主循环 ====================

  async sendMessage(userId: string, role: string, conversationId: string, input: string): Promise<CopilotSendResult> {
    const conversation = await this.loadConversation(userId, conversationId);

    if (!(await this.gateway.isConfigured({ userId, role }))) {
      throw new BadRequestException(
        'AI 模型未配置：请先在「AI 分析中心 → 模型设置」填写模型 API，再使用 AI 运营副驾。',
      );
    }

    const userMessage = await this.insertMessage({
      conversationId,
      role: 'user',
      content: input,
    });

    if (conversation.title === '新对话') {
      await this.db
        .update(copilotConversations)
        .set({ title: this.deriveTitle(input), updatedAt: new Date() })
        .where(eq(copilotConversations.id, conversationId));
    }

    const historyRows = await this.db
      .select({
        role: copilotMessages.role,
        content: copilotMessages.content,
        toolName: copilotMessages.toolName,
      })
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, conversationId))
      .orderBy(asc(copilotMessages.createdAt));

    const messages = [
      { role: 'system' as const, content: this.buildSystemPrompt() },
      ...toChatHistory(historyRows),
    ];

    const newMessages: CopilotMessage[] = [this.mapMessage(userMessage)];
    const newActions: CopilotAction[] = [];
    const toolTrace: CopilotSendResult['toolTrace'] = [];
    /** 同一轮的所有写动作共享批次号，卖家可一次批准整批（按序执行、失败即停） */
    let currentBatchId: string | null = null;
    let reply = '';

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const completion = await this.gateway.chat(messages, {
        agent: 'copilot',
        userId,
        role,
        temperature: 0.2,
        maxTokens: 1200,
        responseFormat: 'json',
      });

      const decision = parseCopilotDecision(completion.content);

      if (decision.type === 'final') {
        reply = decision.reply;
        break;
      }

      if (decision.type === 'invalid') {
        reply = `副驾未能理解模型返回：${decision.error}。请换一种说法重试。`;
        break;
      }

      const tool = getTool(decision.tool);
      if (!tool) {
        const hint = `工具 ${decision.tool} 不存在。可用工具见目录，请重新选择。`;
        messages.push({ role: 'assistant', content: completion.content });
        messages.push({ role: 'user', content: `[系统] ${hint}` });
        continue;
      }

      const validation = validateToolArgs(tool, decision.args);
      if (!validation.ok) {
        const hint = `工具 ${tool.name} 参数不合法：${validation.errors.join('；')}。请修正后重试。`;
        messages.push({ role: 'assistant', content: completion.content });
        messages.push({ role: 'user', content: `[系统] ${hint}` });
        continue;
      }

      if (tool.kind === 'read') {
        const result = await this.tools.runReadTool(tool, validation.args, { userId, role });
        const content = result.ok ? result.content : `执行失败：${result.content}`;
        const messageRow = await this.insertMessage({
          conversationId,
          role: 'tool',
          content,
          toolName: tool.name,
          toolArgs: JSON.stringify(validation.args),
          toolOk: result.ok,
        });
        newMessages.push(this.mapMessage(messageRow));
        toolTrace.push({ tool: tool.name, kind: 'read', ok: result.ok });

        messages.push({ role: 'assistant', content: completion.content });
        messages.push({ role: 'user', content: `[工具 ${tool.name} 的执行结果]\n${content}` });
        continue;
      }

      // 写操作：只落待审批动作，绝不执行
      if (newActions.length >= MAX_PENDING_ACTIONS_PER_TURN) {
        messages.push({ role: 'assistant', content: completion.content });
        messages.push({
          role: 'user',
          content: `[系统] 本轮待审批动作已达 ${MAX_PENDING_ACTIONS_PER_TURN} 个上限，请先让卖家确认，不要再提交新动作。`,
        });
        continue;
      }

      const summary = tool.summarize?.(validation.args) ?? `${tool.name} ${JSON.stringify(validation.args)}`;
      if (!currentBatchId) currentBatchId = randomUUID();
      // 同会话 + 同工具 + 同参数只允许一条在途动作：模型重复提议时复用已有 pending，
      // 不制造第二张审批卡（部分唯一索引兜底并发）。
      const idempotencyKey = actionIdempotencyKey(conversationId, tool.name, validation.args);
      // 先查同键在途动作：命中则复用，不再插新卡（也避免把已存在的卡片重复展示给卖家）
      const existing = await this.db
        .select()
        .from(copilotActions)
        .where(and(
          eq(copilotActions.idempotencyKey, idempotencyKey),
          eq(copilotActions.status, 'pending'),
        ))
        .limit(1);

      let actionRow = existing;
      if (existing.length === 0) {
        const inserted = await this.db
          .insert(copilotActions)
          .values({
            conversationId,
            userId,
            toolName: tool.name,
            kind: 'write',
            summary,
            args: JSON.stringify(validation.args),
            status: 'pending',
            batchId: currentBatchId,
            idempotencyKey,
            // 审批有效期：过期动作不可执行，避免旧卡片被翻出来打款
            expiresAt: new Date(Date.now() + ACTION_TTL_MS),
            // 固化审批时的工具语义指纹，工具定义变更后旧审批自动失效
            policySnapshot: policyFingerprint(tool),
          })
          .onConflictDoNothing({ target: copilotActions.idempotencyKey, where: sql`${copilotActions.idempotencyKey} IS NOT NULL` })
          .returning();
        actionRow = inserted.length > 0
          ? inserted
          : await this.db
            .select()
            .from(copilotActions)
            .where(and(
              eq(copilotActions.idempotencyKey, idempotencyKey),
              eq(copilotActions.status, 'pending'),
            ))
            .limit(1);
      }

      const action = this.mapAction(actionRow[0]);
      newActions.push(action);
      toolTrace.push({ tool: tool.name, kind: 'write', ok: true });

      const actionMessageRow = await this.insertMessage({
        conversationId,
        role: 'assistant',
        content: `已生成待确认操作：${summary}。请在下方确认后执行。`,
        toolName: tool.name,
        toolArgs: JSON.stringify(validation.args),
        actionId: action.id,
      });
      newMessages.push(this.mapMessage(actionMessageRow));

      messages.push({ role: 'assistant', content: completion.content });
      messages.push({
        role: 'user',
        content: `[系统] 动作已提交卖家确认（id=${action.id}），尚未执行。请继续向卖家解释，或输出 final。`,
      });
    }

    if (!reply) {
      reply = '已处理完成，请在下方确认待执行操作。';
    }

    const assistantRow = await this.insertMessage({
      conversationId,
      role: 'assistant',
      content: reply,
    });
    newMessages.push(this.mapMessage(assistantRow));

    await this.db
      .update(copilotConversations)
      .set({ updatedAt: new Date() })
      .where(eq(copilotConversations.id, conversationId));

    return {
      conversationId,
      reply,
      messages: newMessages,
      actions: newActions,
      toolTrace,
    };
  }

  // ==================== 动作审批 ====================

  async resolveAction(
    userId: string,
    role: string,
    actionId: string,
    approve: boolean,
    reason?: string,
  ): Promise<CopilotActionResolveResult> {
    const rows = await this.db
      .select()
      .from(copilotActions)
      .where(eq(copilotActions.id, actionId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('操作不存在');
    }

    const actionRow = rows[0];
    if (actionRow.userId !== userId) {
      throw new ForbiddenException('无权操作该动作');
    }
    if (actionRow.status !== 'pending') {
      throw new BadRequestException(`该操作已处理（${actionRow.status}），不能重复审批`);
    }

    // 过期审批一律不可执行：宁可让卖家重新发起，也不让陈旧卡片触发真实打款
    if (actionRow.expiresAt && actionRow.expiresAt.getTime() <= Date.now()) {
      const expired = await this.db
        .update(copilotActions)
        .set({
          status: 'failed',
          errorMessage: '该操作已超过有效期（24 小时），请重新发起',
          resolvedAt: new Date(),
        })
        .where(and(eq(copilotActions.id, actionId), eq(copilotActions.status, 'pending')))
        .returning();
      return {
        action: this.mapAction(expired[0] ?? actionRow),
        ok: false,
        message: '该操作已超过有效期（24 小时），请重新发起。',
      };
    }

    // 工具语义变更后旧审批失效：审批卡的描述与实际执行语义必须一致
    const liveTool = getTool(actionRow.toolName);
    if (!liveTool || (actionRow.policySnapshot && actionRow.policySnapshot !== policyFingerprint(liveTool))) {
      const stale = await this.db
        .update(copilotActions)
        .set({
          status: 'failed',
          errorMessage: '工具定义已变更，该审批已失效，请重新发起',
          resolvedAt: new Date(),
        })
        .where(and(eq(copilotActions.id, actionId), eq(copilotActions.status, 'pending')))
        .returning();
      return {
        action: this.mapAction(stale[0] ?? actionRow),
        ok: false,
        message: '工具定义已变更，该审批已失效，请重新发起。',
      };
    }

    if (!approve) {
      const now = new Date();
      const updated = await this.db
        .update(copilotActions)
        .set({
          status: 'rejected',
          result: reason?.trim() || null,
          resolvedAt: now,
        })
        .where(and(eq(copilotActions.id, actionId), eq(copilotActions.status, 'pending')))
        .returning();
      if (updated.length === 0) throw new ConflictException('该操作已被其他请求处理，请刷新后重试');

      return {
        action: this.mapAction(updated[0]),
        ok: true,
        message: '已拒绝，操作未执行。',
      };
    }

    // 原子抢占：只有一个并发请求能把 pending -> processing，真实写操作在抢占后执行。
    const claimedRows = await this.db
      .update(copilotActions)
      .set({ status: 'processing', leaseUntil: new Date(Date.now() + ACTION_LEASE_MS) })
      .where(and(
        eq(copilotActions.id, actionId),
        eq(copilotActions.userId, userId),
        eq(copilotActions.status, 'pending'),
      ))
      .returning();
    if (claimedRows.length === 0) {
      throw new ConflictException('该操作已被其他请求处理，请刷新后重试');
    }
    const claimedAction = claimedRows[0];

    const tool = getTool(claimedAction.toolName);
    if (!tool || tool.kind !== 'write') {
      const updated = await this.db
        .update(copilotActions)
        .set({
          status: 'failed',
          errorMessage: '工具不存在或不是写操作',
          resolvedAt: new Date(),
        })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return {
        action: this.mapAction(updated[0]),
        ok: false,
        message: '执行失败：工具不存在或不是写操作。',
      };
    }

    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(claimedAction.args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // 落到下面的参数校验失败分支
    }

    const validation = validateToolArgs(tool, args);
    if (!validation.ok) {
      const updated = await this.db
        .update(copilotActions)
        .set({
          status: 'failed',
          errorMessage: `参数校验失败：${validation.errors.join('；')}`,
          resolvedAt: new Date(),
        })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return {
        action: this.mapAction(updated[0]),
        ok: false,
        message: `执行失败：${validation.errors.join('；')}`,
      };
    }

    try {
      const result = await this.tools.runWriteTool(tool, validation.args, { userId, role });
      const now = new Date();
      const updated = await this.db
        .update(copilotActions)
        .set({
          status: result.ok ? 'executed' : 'failed',
          result: result.content,
          errorMessage: result.ok ? null : result.content,
          resolvedAt: now,
          leaseUntil: null,
        })
        .where(eq(copilotActions.id, actionId))
        .returning();

      return {
        action: this.mapAction(updated[0]),
        ok: result.ok,
        message: result.content,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`动作 ${actionId} 执行失败：${message}`);
      // 释放租约，避免这条动作永远停在 processing
      await this.db
        .update(copilotActions)
        .set({ leaseUntil: null })
        .where(eq(copilotActions.id, actionId));
      const updated = await this.db
        .update(copilotActions)
        .set({ status: 'failed', errorMessage: message, resolvedAt: new Date() })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return {
        action: this.mapAction(updated[0]),
        ok: false,
        message: `执行失败：${message}`,
      };
    }
  }

  // ==================== 批次审批（多步计划） ====================

  /**
   * 整批审批：按创建顺序逐个执行，**失败即停**（后续动作保持 pending，不做任何静默跳过）。
   * 拒绝整批时全部标记 rejected。
   */
  async resolveBatch(
    userId: string,
    role: string,
    batchId: string,
    approve: boolean,
    reason?: string,
  ): Promise<{ actions: CopilotAction[]; ok: boolean; message: string }> {
    const rows = await this.db
      .select()
      .from(copilotActions)
      .where(and(eq(copilotActions.batchId, batchId), eq(copilotActions.userId, userId)))
      .orderBy(asc(copilotActions.createdAt));

    if (rows.length === 0) {
      throw new NotFoundException('批次不存在');
    }
    const pendingRows = rows.filter((row) => row.status === 'pending');
    if (pendingRows.length === 0) {
      throw new BadRequestException('该批次没有待处理动作');
    }

    if (!approve) {
      const now = new Date();
      const resolved: CopilotAction[] = [];
      for (const row of pendingRows) {
        const updated = await this.db
          .update(copilotActions)
          .set({ status: 'rejected', result: reason?.trim() || null, resolvedAt: now })
          .where(eq(copilotActions.id, row.id))
          .returning();
        resolved.push(this.mapAction(updated[0]));
      }
      return { actions: resolved, ok: true, message: '已拒绝整批操作，均未执行。' };
    }

    const resolved: CopilotAction[] = [];
    for (const row of pendingRows) {
      const result = await this.resolveAction(userId, role, row.id, true);
      resolved.push(result.action);
      if (!result.ok) {
        return {
          actions: resolved,
          ok: false,
          message: `第 ${resolved.length} 步执行失败：${result.message}。后续步骤已停止，仍待确认。`,
        };
      }
    }

    return {
      actions: resolved,
      ok: true,
      message: `整批 ${resolved.length} 个操作已按顺序执行完成。`,
    };
  }

  /**
   * 从需求缺口一键建草稿商品：不直接写库，生成一个 pending 动作，
   * 与所有写操作走同一道审批门禁（卖家仍需点"批准执行"）。
   */
  async createDraftFromGap(
    userId: string,
    role: string,
    keyword: string,
    categoryId?: string,
  ): Promise<{ conversationId: string; action: CopilotAction }> {
    const cleanKeyword = keyword.trim().slice(0, 100);
    if (!cleanKeyword) throw new BadRequestException('关键词不能为空');

    const conversation = await this.createConversation(userId, `补款：${cleanKeyword}`);

    await this.insertMessage({
      conversationId: conversation.id,
      role: 'user',
      content: `买家在导购里搜「${cleanKeyword}」但没有结果，帮我建一个草稿商品`,
    });

    const tool = getTool('create_draft_product');
    if (!tool) throw new BadRequestException('工具未注册');

    const rawArgs: Record<string, unknown> = {
      titleZh: cleanKeyword,
      titleEn: cleanKeyword,
      descZh: `针对买家搜索需求「${cleanKeyword}」新增的草稿商品，请补充卖点与图片。`,
      price: 0.01,
      stock: 0,
      ...(categoryId ? { categoryId } : {}),
    };
    const validation = validateToolArgs(tool, rawArgs);
    if (!validation.ok) {
      throw new BadRequestException(`参数不合法：${validation.errors.join('；')}`);
    }

    const summary = tool.summarize?.(validation.args) ?? `创建草稿商品 ${cleanKeyword}`;
    const inserted = await this.db
      .insert(copilotActions)
      .values({
        conversationId: conversation.id,
        userId,
        toolName: tool.name,
        kind: 'write',
        summary,
        args: JSON.stringify(validation.args),
        status: 'pending',
      })
      .returning();

    const action = this.mapAction(inserted[0]);
    await this.insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: `已生成待确认操作：${summary}。价格与标题是占位值，批准后请在「商品管理」里补全图片、卖点与真实售价。`,
      toolName: tool.name,
      toolArgs: JSON.stringify(validation.args),
      actionId: action.id,
    });

    return { conversationId: conversation.id, action };
  }

  // ==================== 工具目录 ====================

  /**
   * 回收卡在 processing 的动作。
   *
   * 抢占 pending → processing 之后，进程可能在"已调渠道、未回写"之间崩溃。没有回收时
   * 这条动作会永久停在 processing：卖家看不到、也不能重试。这里把租约过期的动作标为
   * failed 并保留证据（可能已产生真实副作用），交由人工核对，绝不自动重试。
   *
   * 同时把过期的 pending 动作标为失败——陈旧审批不该还能点。
   */
  async reclaimStaleActions(): Promise<{ reclaimed: number; expired: number }> {
    const now = new Date();
    const reclaimed = await this.db
      .update(copilotActions)
      .set({
        status: 'failed',
        errorMessage: '执行中断（进程退出或超时），可能已产生副作用，请人工核对后重新发起',
        resolvedAt: now,
        leaseUntil: null,
      })
      .where(and(
        eq(copilotActions.status, 'processing'),
        lt(copilotActions.leaseUntil, now),
      ))
      .returning({ id: copilotActions.id });

    const expired = await this.db
      .update(copilotActions)
      .set({
        status: 'failed',
        errorMessage: '待审批超时（24 小时），已自动失效',
        resolvedAt: now,
      })
      .where(and(
        eq(copilotActions.status, 'pending'),
        lt(copilotActions.expiresAt, now),
      ))
      .returning({ id: copilotActions.id });

    if (reclaimed.length > 0 || expired.length > 0) {
      this.logger.warn(
        `copilot 审批回收：中断 ${reclaimed.length} 条，过期 ${expired.length} 条`,
      );
    }
    return { reclaimed: reclaimed.length, expired: expired.length };
  }

  getTools(): CopilotToolsView {
    // 契约由 copilot-tool-contract 单一投射：风险等级/不可逆标记/JSON Schema 与
    // 审批卡、MCP 端点共用同一份声明，不再由前端手工维护 TOOL_META。
    const contracts = buildToolContracts(COPILOT_TOOLS);
    return {
      tools: contracts.map((c) => ({
        name: c.name,
        description: c.description,
        kind: c.kind,
        risk: c.risk,
        irreversible: c.irreversible,
        labelZh: c.labelZh,
        labelEn: c.labelEn,
        inputSchema: c.inputSchema,
        params: (COPILOT_TOOLS.find((t) => t.name === c.name)?.params ?? []).map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required === true,
          description: p.description,
        })),
      })),
    };
  }

  async describeActionImpact(userId: string, actionId: string): Promise<string> {
    const rows = await this.db
      .select()
      .from(copilotActions)
      .where(and(eq(copilotActions.id, actionId), eq(copilotActions.userId, userId)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('操作不存在');

    const tool = getTool(rows[0].toolName);
    if (!tool) return '';
    try {
      const args = JSON.parse(rows[0].args) as Record<string, unknown>;
      return await this.tools.describeImpact(tool, args);
    } catch {
      return '';
    }
  }

  // ==================== 内部 ====================

  private async loadConversation(userId: string, conversationId: string) {
    const rows = await this.db
      .select()
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conversationId))
      .limit(1);
    if (rows.length === 0 || rows[0].userId !== userId || rows[0].channel !== 'seller') {
      throw new NotFoundException('对话不存在');
    }
    return rows[0];
  }

  private async insertMessage(params: {
    conversationId: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolName?: string;
    toolArgs?: string;
    toolOk?: boolean;
    actionId?: string;
  }) {
    const inserted = await this.db
      .insert(copilotMessages)
      .values({
        conversationId: params.conversationId,
        role: params.role,
        content: params.content,
        toolName: params.toolName ?? null,
        toolArgs: params.toolArgs ?? null,
        toolOk: params.toolOk ?? null,
        actionId: params.actionId ?? null,
      })
      .returning();
    return inserted[0];
  }

  private buildSystemPrompt(): string {
    return `你是 Flow 跨境电商平台的「AI 运营副驾」，服务对象是店铺卖家。你通过调用工具读取真实店铺数据并执行运营操作。

## 可用工具
${buildToolCatalog(COPILOT_TOOLS)}

## 输出协议（必须严格遵守）
每次回复只输出一个 JSON 对象，不要输出任何额外文字、不要用 markdown 代码块：
- 需要调用工具时：{"tool":"工具名","args":{...},"thought":"一句话说明为什么"}
- 结束回答时：{"final":"给卖家看的最终答复（中文，简洁，可用 markdown 列表）"}

## 工作规则
1. 先读后写：涉及数据的问题必须先调用读工具获取真实数据，禁止编造任何订单号、金额、库存或统计数字。
2. 写操作只能通过工具提出，提交后系统会要求卖家人工确认；你绝不能声称"已执行"，只能说"已提交确认"。
3. 工具参数必须严格符合目录中的名称、类型与取值；不确定时先调用读工具确认目标 ID / 单号。
4. 一次只提交一个工具调用；拿到结果后再决定下一步。
5. 多步计划（如"清库存促销"=建券 + 下架 + 改价）：先把需要的读查询做完，再逐个提交写动作；同一轮提交的多个写动作会组成一个批次，卖家可一次批准整批（按顺序执行、失败即停）。提交时在 thought 中写清这是计划的第几步。
6. 若工具返回失败，向卖家如实说明失败原因，不要假装成功。
7. 回答使用中文；涉及金额保留原样；不要输出与卖家问题无关的内容。`;
  }

  private deriveTitle(input: string): string {
    const text = input.replace(/\s+/g, ' ').trim();
    return text.length > 40 ? `${text.slice(0, 40)}…` : text || '新对话';
  }

  private mapConversation(row: typeof copilotConversations.$inferSelect): CopilotConversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapMessage(row: typeof copilotMessages.$inferSelect): CopilotMessage {
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as CopilotMessage['role'],
      content: row.content,
      toolName: row.toolName ?? undefined,
      toolArgs: row.toolArgs ?? undefined,
      toolOk: row.toolOk ?? undefined,
      actionId: row.actionId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapAction(row: typeof copilotActions.$inferSelect): CopilotAction {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
    return {
      id: row.id,
      conversationId: row.conversationId,
      toolName: row.toolName,
      kind: row.kind === 'read' ? 'read' : 'write',
      summary: row.summary,
      args,
      status: row.status as CopilotAction['status'],
      batchId: row.batchId ?? undefined,
      result: row.result ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : undefined,
    };
  }
}
