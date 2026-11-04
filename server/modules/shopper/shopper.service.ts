import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { copilotActions, copilotConversations, copilotMessages } from '../../database/schema';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { ShopperAnalyticsService } from './shopper-analytics.service';
import { ShopperToolService } from './shopper-tool.service';
import { SHOPPER_TOOLS, getShopperTool } from './shopper-tools';
import { buildToolContracts } from '../copilot/copilot-tool-contract';
import {
  buildToolCatalog,
  parseCopilotDecision,
  toChatHistory,
  validateToolArgs,
} from '../copilot/copilot-protocol';
import type {
  CopilotAction,
  CopilotActionResolveResult,
  CopilotConversation,
  CopilotConversationDetail,
  CopilotMessage,
  CopilotSendResult,
  CopilotToolsView,
} from '../../../shared/api.interface';

const MAX_STEPS = 5;
const MAX_PENDING_ACTIONS_PER_TURN = 2;

export interface ShopperContext {
  userId?: string;
  sessionId?: string;
}

/**
 * 买家端 AI 导购：与卖家副驾同一套 ReAct + 人工确认框架，但工具集完全不同。
 * - 只读：搜索 / 分类 / 详情 / 我的购物车
 * - 写：只有 add_to_cart（需买家确认后执行）
 * 对话按 (userId | sessionId) 归属，买家之间互不可见。
 */
@Injectable()
export class ShopperService {
  private readonly logger = new Logger(ShopperService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly gateway: AiGatewayService,
    private readonly tools: ShopperToolService,
    private readonly analytics: ShopperAnalyticsService,
  ) {}

  /** 买家没有 userId 时用 sessionId 作为会话归属键 */
  private ownerFilter(ctx: ShopperContext) {
    const base = eq(copilotConversations.channel, 'shopper');
    if (ctx.userId) {
      return and(base, eq(copilotConversations.userId, ctx.userId));
    }
    const sessionId = ctx.sessionId ?? '';
    return and(base, eq(copilotConversations.sessionId, sessionId));
  }

  async listConversations(ctx: ShopperContext): Promise<CopilotConversation[]> {
    const rows = await this.db
      .select()
      .from(copilotConversations)
      .where(this.ownerFilter(ctx))
      .orderBy(desc(copilotConversations.updatedAt))
      .limit(30);
    return rows.map((row) => this.mapConversation(row));
  }

  async createConversation(ctx: ShopperContext): Promise<CopilotConversation> {
    if (!ctx.userId && !ctx.sessionId) {
      throw new BadRequestException('无法识别会话，请刷新页面后重试');
    }
    const inserted = await this.db
      .insert(copilotConversations)
      .values({
        userId: ctx.userId ?? null,
        sessionId: ctx.userId ? null : (ctx.sessionId as string),
        title: '新对话',
        channel: 'shopper',
      })
      .returning();

    await this.analytics.track({
      userId: ctx.userId ?? null,
      sessionId: ctx.sessionId ?? null,
      stage: 'viewed',
      conversationId: inserted[0].id,
    });

    return this.mapConversation(inserted[0]);
  }

  async getTools(): Promise<CopilotToolsView> {
    // 与卖家侧共用 copilot-tool-contract 的投射，风险/标签/JSON Schema 单一来源
    const contracts = buildToolContracts(SHOPPER_TOOLS);
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
        params: (SHOPPER_TOOLS.find((t) => t.name === c.name)?.params ?? []).map((param) => ({
          name: param.name,
          type: param.type,
          required: param.required === true,
          description: param.description,
        })),
      })),
    };
  }

  private isOwner(
    row: { userId: string | null; sessionId: string | null },
    ctx: ShopperContext,
  ): boolean {
    if (ctx.userId) return row.userId === ctx.userId;
    return !!ctx.sessionId && row.sessionId === ctx.sessionId;
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
    return `你是 Flow 跨境电商商城的「AI 导购」，帮助买家挑选商品、了解详情、加入购物车。

## 可用工具
${buildToolCatalog(SHOPPER_TOOLS)}

## 输出协议（必须严格遵守）
每次回复只输出一个 JSON 对象，不要输出额外文字、不要用 markdown 代码块：
- 调用工具：{"tool":"工具名","args":{...},"thought":"一句话说明"}
- 结束回答：{"final":"给买家看的答复（不说谎、不编造商品）"}

## 工作规则
1. 推荐商品前必须先调用 search_products 或 get_product_detail 获取真实数据；禁止编造商品名、价格、库存或评分。
2. 只推荐 status=active 且有货的商品；缺货要如实告知。
3. 加购前先确认商品 ID 与数量；提交后系统会要求买家确认，你不能说"已加购"，只能说"已提交确认"。
4. 不承诺未提供的服务（如"明天必达""终身保修"），不编造优惠活动。
5. 用买家提问的语言回答（默认中文），语气简洁友好，推荐时说明理由。`;
  }

  async sendMessage(
    ctx: ShopperContext,
    conversationId: string,
    input: string,
  ): Promise<CopilotSendResult> {
    const conversation = await this.db
      .select()
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conversationId))
      .limit(1);
    if (conversation.length === 0 || !this.isOwner(conversation[0], ctx)) {
      throw new NotFoundException('对话不存在');
    }

    if (!(await this.gateway.isConfigured())) {
      throw new BadRequestException(
        'AI 导购暂未开启：店铺还没有配置模型。你可以直接浏览商品或使用智能客服。',
      );
    }

    const userMessage = await this.insertMessage({ conversationId, role: 'user', content: input });

    const historyRows = await this.db
      .select({ role: copilotMessages.role, content: copilotMessages.content, toolName: copilotMessages.toolName })
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
    let reply = '';

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const completion = await this.gateway.chat(messages, {
        agent: 'shopper',
        temperature: 0.4,
        maxTokens: 1000,
        responseFormat: 'json',
      });
      const decision = parseCopilotDecision(completion.content);

      if (decision.type === 'final') {
        reply = decision.reply;
        break;
      }
      if (decision.type === 'invalid') {
        reply = '抱歉，我没太理解，可以换个说法吗？';
        break;
      }

      const tool = getShopperTool(decision.tool);
      if (!tool) {
        messages.push({ role: 'assistant', content: completion.content });
        messages.push({ role: 'user', content: `[系统] 工具 ${decision.tool} 不存在，请从目录中选择。` });
        continue;
      }

      const validation = validateToolArgs(tool, decision.args);
      if (!validation.ok) {
        messages.push({ role: 'assistant', content: completion.content });
        messages.push({
          role: 'user',
          content: `[系统] 参数不合法：${validation.errors.join('；')}。请修正后重试。`,
        });
        continue;
      }

      if (tool.kind === 'read') {
        const result = await this.tools.runReadTool(tool, validation.args, ctx);
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

        // 商品级漏斗：记录本次被推荐到的每个商品（详情页也算一次推荐）
        for (const productId of result.productIds ?? []) {
          await this.analytics.track({
            userId: ctx.userId ?? null,
            sessionId: ctx.sessionId ?? null,
            stage: 'product_recommended',
            conversationId,
            productId,
          });
        }

        if (tool.name === 'search_products') {
          // 零结果单独记 search_miss：这是"买家在找但店里没有"的需求信号，喂给选品 Agent
          const resultCount = result.resultCount ?? 0;
          await this.analytics.track({
            userId: ctx.userId ?? null,
            sessionId: ctx.sessionId ?? null,
            stage: resultCount > 0 ? 'recommended' : 'search_miss',
            conversationId,
            keyword: String(validation.args.keyword ?? ''),
          });
        }

        messages.push({ role: 'assistant', content: completion.content });
        messages.push({ role: 'user', content: `[工具 ${tool.name} 的执行结果]\n${content}` });
        continue;
      }

      if (newActions.length >= MAX_PENDING_ACTIONS_PER_TURN) {
        messages.push({ role: 'assistant', content: completion.content });
        messages.push({ role: 'user', content: '[系统] 待确认动作已达上限，请先让买家确认。' });
        continue;
      }

      const summary = tool.summarize?.(validation.args) ?? `${tool.name}`;
      const actionRow = await this.db
        .insert(copilotActions)
        .values({
          conversationId,
          userId: ctx.userId ?? null,
          sessionId: ctx.userId ? null : (ctx.sessionId as string),
          toolName: tool.name,
          kind: 'write',
          summary,
          args: JSON.stringify(validation.args),
          status: 'pending',
        })
        .returning();
      const action = this.mapAction(actionRow[0]);
      newActions.push(action);
      toolTrace.push({ tool: tool.name, kind: 'write', ok: true });

      const messageRow = await this.insertMessage({
        conversationId,
        role: 'assistant',
        content: `已准备好：${summary}。确认后我再帮你加入购物车。`,
        toolName: tool.name,
        toolArgs: JSON.stringify(validation.args),
        actionId: action.id,
      });
      newMessages.push(this.mapMessage(messageRow));

      messages.push({ role: 'assistant', content: completion.content });
      messages.push({
        role: 'user',
        content: `[系统] 动作已提交买家确认（id=${action.id}），尚未执行。请继续说明或输出 final。`,
      });
    }

    if (!reply) reply = '已准备好待确认的操作，请确认后继续。';

    newMessages.push(this.mapMessage(await this.insertMessage({ conversationId, role: 'assistant', content: reply })));

    await this.db
      .update(copilotConversations)
      .set({ updatedAt: new Date() })
      .where(eq(copilotConversations.id, conversationId));

    return { conversationId, reply, messages: newMessages, actions: newActions, toolTrace };
  }

  async resolveAction(ctx: ShopperContext, actionId: string, approve: boolean): Promise<CopilotActionResolveResult> {
    const rows = await this.db.select().from(copilotActions).where(eq(copilotActions.id, actionId)).limit(1);
    if (rows.length === 0) throw new NotFoundException('操作不存在');
    const actionRow = rows[0];
    if (!this.isOwner(actionRow, ctx)) {
      throw new NotFoundException('操作不存在');
    }
    if (actionRow.status !== 'pending') {
      throw new BadRequestException(`该操作已处理（${actionRow.status}）`);
    }

    if (!approve) {
      const updated = await this.db
        .update(copilotActions)
        .set({ status: 'rejected', resolvedAt: new Date() })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return { action: this.mapAction(updated[0]), ok: true, message: '已取消。' };
    }

    const tool = getShopperTool(actionRow.toolName);
    if (!tool || tool.kind !== 'write') {
      const updated = await this.db
        .update(copilotActions)
        .set({ status: 'failed', errorMessage: '工具不存在', resolvedAt: new Date() })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return { action: this.mapAction(updated[0]), ok: false, message: '执行失败' };
    }

    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(actionRow.args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      // 参数校验分支处理
    }
    const validation = validateToolArgs(tool, args);
    if (!validation.ok) {
      const updated = await this.db
        .update(copilotActions)
        .set({ status: 'failed', errorMessage: validation.errors.join('；'), resolvedAt: new Date() })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return { action: this.mapAction(updated[0]), ok: false, message: `执行失败：${validation.errors.join('；')}` };
    }

    try {
      const result = await this.tools.runWriteTool(tool, validation.args, ctx);
      const updated = await this.db
        .update(copilotActions)
        .set({
          status: result.ok ? 'executed' : 'failed',
          result: result.content,
          errorMessage: result.ok ? null : result.content,
          resolvedAt: new Date(),
        })
        .where(eq(copilotActions.id, actionId))
        .returning();

      if (result.ok && tool.name === 'add_to_cart') {
        await this.analytics.track({
          userId: ctx.userId ?? null,
          sessionId: ctx.sessionId ?? null,
          stage: 'cart_confirmed',
          conversationId: actionRow.conversationId,
          productId: typeof validation.args.productId === 'string' ? validation.args.productId : null,
        });
      }

      return { action: this.mapAction(updated[0]), ok: result.ok, message: result.content };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = await this.db
        .update(copilotActions)
        .set({ status: 'failed', errorMessage: message, resolvedAt: new Date() })
        .where(eq(copilotActions.id, actionId))
        .returning();
      return { action: this.mapAction(updated[0]), ok: false, message: `执行失败：${message}` };
    }
  }

  async getConversationDetail(ctx: ShopperContext, conversationId: string): Promise<CopilotConversationDetail> {
    const rows = await this.db
      .select()
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conversationId))
      .limit(1);
    if (rows.length === 0 || !this.isOwner(rows[0], ctx)) throw new NotFoundException('对话不存在');

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
      conversation: this.mapConversation(rows[0]),
      messages: messageRows.map((row) => this.mapMessage(row)),
      actions: actionRows.map((row) => this.mapAction(row)),
    };
  }
}
