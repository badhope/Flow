import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CopilotService } from './copilot.service';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import type { CopilotToolService } from './copilot-tool.service';
import { copilotActions, copilotConversations, copilotMessages } from '../../database/schema';

interface Row extends Record<string, unknown> {
  id: string;
}

/** 最小内存假库：按表对象路由，仅实现本服务用到的链式调用 */
function createFakeDb(seed: {
  conversations?: Row[];
  messages?: Row[];
  actions?: Row[];
}) {
  const tables = new Map<unknown, Row[]>([
    [copilotConversations, seed.conversations ?? []],
    [copilotMessages, seed.messages ?? []],
    [copilotActions, seed.actions ?? []],
  ]);
  let idSeq = 0;
  const nextId = (): string => {
    idSeq += 1;
    return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
  };

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const rows = tables.get(table) ?? [];
        const builder = {
          where: () => builder,
          orderBy: () => builder,
          limit: async (n: number) => rows.slice(0, n),
          groupBy: () => builder,
          then: undefined,
        };
        // 支持 await db.select().from(...).where(...)（无 limit 时直接返回 rows）
        Object.defineProperty(builder, 'then', {
          value: (resolve: (value: Row[]) => void) => resolve(rows),
        });
        return builder;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const doInsert = async (): Promise<Row[]> => {
          const row: Row = {
            id: nextId(),
            createdAt: new Date(),
            updatedAt: new Date(),
            resolvedAt: null,
            ...values,
          };
          (tables.get(table) ?? []).push(row);
          return [row];
        };
        return {
          returning: doInsert,
          // 生产代码用 onConflictDoNothing 兜住幂等键并发；mock 需同形，
          // 否则测试只验证了"能插"，验证不到"冲突时怎么办"。
          onConflictDoNothing: () => ({ returning: doInsert }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const rows = tables.get(table) ?? [];
            const target = rows[rows.length - 1];
            Object.assign(target, patch);
            return [target];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => undefined }),
    execute: async () => [],
  };
  return { db, tables };
}

function createGateway(script: Array<Record<string, unknown>>) {
  let index = 0;
  return {
    isConfigured: vi.fn(async () => true),
    chat: vi.fn(async () => {
      const content = JSON.stringify(script[Math.min(index, script.length - 1)]);
      index += 1;
      return { content };
    }),
  } as unknown as AiGatewayService & { isConfigured: ReturnType<typeof vi.fn>; chat: ReturnType<typeof vi.fn> };
}

function createTools() {
  return {
    runReadTool: vi.fn(async () => ({ ok: true, content: 'GMV：$100' })),
    runWriteTool: vi.fn(async () => ({ ok: true, content: '订单已发货', summary: '已执行' })),
    describeImpact: vi.fn(async () => '匹配订单 1 条'),
  } as unknown as CopilotToolService & { runReadTool: ReturnType<typeof vi.fn>; runWriteTool: ReturnType<typeof vi.fn> };
}

const conversationRow: Row = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: 'seller-1',
  sessionId: null,
  title: '新对话',
  channel: 'seller',
  createdAt: new Date('2026-10-21T00:00:00Z'),
  updatedAt: new Date('2026-10-21T00:00:00Z'),
};

// 行为契约（R2/R3）：写操作绝不随模型输出执行，必须卖家显式批准
describe('CopilotService 审批门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('R2: 模型请求写工具时只创建 pending 动作，不调用写工具', async () => {
    const { db, tables } = createFakeDb({ conversations: [conversationRow] });
    const gateway = createGateway([
      { tool: 'update_order_status', args: { orderNo: 'ORD20261021ABC123', status: 'shipped' } },
      { final: '已提交发货确认' },
    ]);
    const tools = createTools();
    const service = new CopilotService(db as never, gateway, tools);

    const result = await service.sendMessage('seller-1', 'seller', conversationRow.id, '把订单发了');

    expect(tools.runWriteTool).not.toHaveBeenCalled();
    expect(tools.runReadTool).not.toHaveBeenCalled();
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].status).toBe('pending');
    expect(result.actions[0].toolName).toBe('update_order_status');
    expect(result.toolTrace).toEqual([{ tool: 'update_order_status', kind: 'write', ok: true }]);
    expect(tables.get(copilotActions)).toHaveLength(1);
    expect(String(tables.get(copilotActions)![0].status)).toBe('pending');
  });

  it('R2: 批准后通过业务服务执行并标记 executed', async () => {
    const actionRow: Row = {
      id: '00000000-0000-4000-8000-000000000010',
      conversationId: conversationRow.id,
      userId: 'seller-1',
      toolName: 'update_order_status',
      kind: 'write',
      summary: '把订单 ORD20261021ABC123 状态改为 shipped',
      args: JSON.stringify({ orderNo: 'ORD20261021ABC123', status: 'shipped' }),
      status: 'pending',
      result: null,
      errorMessage: null,
      createdAt: new Date(),
      resolvedAt: null,
    };
    const { db } = createFakeDb({ conversations: [conversationRow], actions: [actionRow] });
    const gateway = createGateway([{ final: 'ok' }]);
    const tools = createTools();
    const service = new CopilotService(db as never, gateway, tools);

    const result = await service.resolveAction('seller-1', 'seller', actionRow.id, true);

    expect(tools.runWriteTool).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.action.status).toBe('executed');
  });

  it('R3: 拒绝后不调用写工具并标记 rejected', async () => {
    const actionRow: Row = {
      id: '00000000-0000-4000-8000-000000000011',
      conversationId: conversationRow.id,
      userId: 'seller-1',
      toolName: 'create_coupon',
      kind: 'write',
      summary: '创建优惠券 SAVE10',
      args: JSON.stringify({ code: 'SAVE10', type: 'percent', value: 10 }),
      status: 'pending',
      result: null,
      errorMessage: null,
      createdAt: new Date(),
      resolvedAt: null,
    };
    const { db } = createFakeDb({ conversations: [conversationRow], actions: [actionRow] });
    const gateway = createGateway([{ final: 'ok' }]);
    const tools = createTools();
    const service = new CopilotService(db as never, gateway, tools);

    const result = await service.resolveAction('seller-1', 'seller', actionRow.id, false, '先不发券');

    expect(tools.runWriteTool).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.action.status).toBe('rejected');
  });

  it('R3: 他人动作不可审批（越权）', async () => {
    const actionRow: Row = {
      id: '00000000-0000-4000-8000-000000000012',
      conversationId: conversationRow.id,
      userId: 'seller-2',
      toolName: 'create_coupon',
      kind: 'write',
      summary: '创建优惠券',
      args: '{}',
      status: 'pending',
      result: null,
      errorMessage: null,
      createdAt: new Date(),
      resolvedAt: null,
    };
    const { db } = createFakeDb({ conversations: [conversationRow], actions: [actionRow] });
    const service = new CopilotService(db as never, createGateway([{ final: 'ok' }]), createTools());

    await expect(
      service.resolveAction('seller-1', 'seller', actionRow.id, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('R2: 已处理动作不可重复审批', async () => {
    const actionRow: Row = {
      id: '00000000-0000-4000-8000-000000000013',
      conversationId: conversationRow.id,
      userId: 'seller-1',
      toolName: 'create_coupon',
      kind: 'write',
      summary: '创建优惠券',
      args: '{}',
      status: 'executed',
      result: 'done',
      errorMessage: null,
      createdAt: new Date(),
      resolvedAt: new Date(),
    };
    const { db } = createFakeDb({ conversations: [conversationRow], actions: [actionRow] });
    const service = new CopilotService(db as never, createGateway([{ final: 'ok' }]), createTools());

    await expect(
      service.resolveAction('seller-1', 'seller', actionRow.id, true),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('R2: 未配置模型时诚实拒绝，不写入任何消息', async () => {
    const { db, tables } = createFakeDb({ conversations: [conversationRow] });
    const gateway = {
      isConfigured: vi.fn(async () => false),
      chat: vi.fn(),
    } as unknown as AiGatewayService;
    const service = new CopilotService(db as never, gateway, createTools());

    await expect(
      service.sendMessage('seller-1', 'seller', conversationRow.id, '你好'),
    ).rejects.toThrow('AI 模型未配置');
    expect(tables.get(copilotMessages)).toHaveLength(0);
  });

  it('R1: 读工具执行结果回填，模型随后给出最终答复', async () => {
    const { db, tables } = createFakeDb({ conversations: [conversationRow] });
    const gateway = createGateway([
      { tool: 'get_store_overview', args: {} },
      { final: '店铺 GMV 为 $100' },
    ]);
    const tools = createTools();
    const service = new CopilotService(db as never, gateway, tools);

    const result = await service.sendMessage('seller-1', 'seller', conversationRow.id, '店铺概况');

    expect(tools.runReadTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'get_store_overview' }),
      {},
      { userId: 'seller-1', role: 'seller' },
    );
    expect(tools.runWriteTool).not.toHaveBeenCalled();
    expect(result.reply).toBe('店铺 GMV 为 $100');
    expect(result.toolTrace).toEqual([{ tool: 'get_store_overview', kind: 'read', ok: true }]);

    const roles = tables.get(copilotMessages)!.map((row) => row.role);
    expect(roles).toEqual(['user', 'tool', 'assistant']);
  });

  it('R2: 参数非法时不执行读工具，改为提示模型修正', async () => {
    const { db } = createFakeDb({ conversations: [conversationRow] });
    const gateway = createGateway([
      { tool: 'list_orders', args: { limit: 999 } },
      { final: '已修正' },
    ]);
    const tools = createTools();
    const service = new CopilotService(db as never, gateway, tools);

    await service.sendMessage('seller-1', 'seller', conversationRow.id, '看订单');

    expect(tools.runReadTool).not.toHaveBeenCalled();
  });

  it('R2: 未知工具名被拒绝，不落任何动作', async () => {
    const { db, tables } = createFakeDb({ conversations: [conversationRow] });
    const gateway = createGateway([
      { tool: 'execute_sql', args: { sql: 'DROP TABLE users' } },
      { final: '无法执行该操作' },
    ]);
    const tools = createTools();
    const service = new CopilotService(db as never, gateway, tools);

    const result = await service.sendMessage('seller-1', 'seller', conversationRow.id, '删库');

    expect(tools.runWriteTool).not.toHaveBeenCalled();
    expect(result.actions).toHaveLength(0);
    expect(tables.get(copilotActions)).toHaveLength(0);
  });
});
