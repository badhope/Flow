import { Controller, Get, Post, Body, Req, Res, UseGuards, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RolesGuard } from '../../common/guards/roles.guard';
import { COPILOT_TOOLS } from '../copilot/copilot-tools';
import { buildToolContracts } from '../copilot/copilot-tool-contract';
import { CopilotToolService } from '../copilot/copilot-tool.service';

/**
 * MCP（Model Context Protocol）只读服务端。
 *
 * 为什么只读：Flow 的写操作必须过人审门禁（copilot_actions 的 pending → 人工批准），
 * 把写工具暴露给外部 Agent 等于绕过这道门禁。因此这里**只暴露 read 类工具**，
 * 写操作永远走站内审批。这是刻意的能力边界，不是没做完。
 *
 * 协议实现要点（对齐 MCP 2025-06-18 / 2025-11-25 规范）：
 *   - 传输：Streamable HTTP，单一端点，POST 收 JSON-RPC、响应可为单个 JSON。
 *     未实现 SSE 流式响应与 session（本服务无状态，便于多副本部署）。
 *   - `initialize` 必须返回 protocolVersion / capabilities / serverInfo。
 *   - `tools/list` 返回 inputSchema（JSON Schema），并带 MCP 标准 annotations
 *     （readOnlyHint / destructiveHint / idempotentHint / openWorldHint）。
 *   - `tools/call` 的业务错误放在 `result.isError = true`，而不是 JSON-RPC error——
 *     这样客户端模型能看到错误并自我修正。
 *   - 未知方法返回 JSON-RPC -32601；参数错误 -32602。
 *   - 不实现 `resources` / `prompts` / `sampling`，capabilities 里不声明它们。
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  /** 支持的协议版本；客户端请求的版本在此列表内则回显，否则回落到最新 */
  private static readonly SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
  private static readonly LATEST_PROTOCOL_VERSION = '2025-11-25';
  private static readonly SERVER_INFO = { name: 'flow-commerce', version: '1.0.0' };

  constructor(private readonly tools: CopilotToolService) {}

  /**
   * 健康探测：不含任何用户数据，供客户端/负载均衡在建立会话前确认端点存活。
   * 因此刻意不挂 RolesGuard —— 鉴权发生在 @Post() 上。
   */
  @Get('health')
  health(): { ok: boolean; transport: string; protocolVersion: string } {
    return {
      ok: true,
      transport: 'streamable-http',
      protocolVersion: McpController.LATEST_PROTOCOL_VERSION,
    };
  }

  @Post()
  @UseGuards(new RolesGuard(['seller', 'admin']))
  async handle(
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // RoleGuard 已保证有身份；这里再取一次并做类型收窄，避免把 undefined 传进工具层
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || !role) {
      res.status(200).json(this.errorResponse(null, -32001, 'Unauthorized'));
      return;
    }
    const actor = { userId, role };

    // JSON-RPC 批量请求：MCP 2025-03-26 起已不要求支持批量，这里明确拒绝而非静默忽略
    if (Array.isArray(body)) {
      res.status(200).json(this.errorResponse(null, -32600, 'Batch requests are not supported'));
      return;
    }

    const request = body as { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      res.status(200).json(this.errorResponse(request?.id ?? null, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    const id = request.id ?? null;

    try {
      switch (request.method) {
        case 'initialize':
          res.status(200).json(this.resultResponse(id, this.handleInitialize(request.params)));
          return;

        case 'notifications/initialized':
          // 通知没有响应体（客户端发完就不等回复），返回 202 是规范推荐
          res.status(202).end();
          return;

        case 'ping':
          res.status(200).json(this.resultResponse(id, {}));
          return;

        case 'tools/list':
          res.status(200).json(this.resultResponse(id, this.handleToolsList()));
          return;

        case 'tools/call':
          res.status(200).json(await this.handleToolsCall(id, request.params, actor));
          return;

        default:
          res.status(200).json(this.errorResponse(id, -32601, `Method not found: ${request.method}`));
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP 请求失败：${request.method} — ${message}`);
      res.status(200).json(this.errorResponse(id, -32603, 'Internal error'));
    }
  }

  private handleInitialize(params: Record<string, unknown> | undefined): Record<string, unknown> {
    const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
    const protocolVersion = (McpController.SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : McpController.LATEST_PROTOCOL_VERSION;

    return {
      protocolVersion,
      capabilities: {
        // 只声明 tools：本服务没有 resources/prompts/sampling，
        // 声明了却没有实现会让客户端在调用时拿到 method not found。
        tools: { listChanged: false },
      },
      serverInfo: McpController.SERVER_INFO,
      instructions:
        'Flow commerce MCP server — read-only access to a seller store. '
        + 'All write operations (refunds, price changes, replies) require human approval in the Flow workbench and are intentionally not exposed here.',
    };
  }

  private handleToolsList(): { tools: Array<Record<string, unknown>> } {
    const contracts = buildToolContracts(COPILOT_TOOLS).filter((c) => c.kind === 'read');

    return {
      tools: contracts.map((c) => ({
        name: c.name,
        title: c.labelZh,
        description: c.description,
        inputSchema: c.inputSchema,
        annotations: {
          // 全部只读：这是能力边界，不是默认值
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
    };
  }

  private async handleToolsCall(
    /** JSON-RPC 的 id 在 params 之外，必须由调用方显式传入，不能从 params 里取 */
    id: string | number | null,
    params: Record<string, unknown> | undefined,
    actor: { userId: string; role: string },
  ): Promise<Record<string, unknown>> {
    const name = typeof params?.name === 'string' ? params.name : '';
    const rawArgs = params?.arguments;

    if (!name) {
      return this.errorResponse(id, -32602, 'Missing tool name');
    }

    const tool = COPILOT_TOOLS.find((t) => t.name === name);
    if (!tool || tool.kind !== 'read') {
      // 未知工具与「已知但不可通过 MCP 调用」要区分开：后者更值得提示原因
      const known = COPILOT_TOOLS.find((t) => t.name === name);
      return this.errorResponse(
        id,
        -32602,
        known
          ? `Tool "${name}" is a write operation and is not available over MCP; approve it in the Flow workbench`
          : `Unknown tool: ${name}`,
      );
    }

    const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs))
      ? rawArgs as Record<string, unknown>
      : {};

    const result = await this.tools.runReadTool(tool, args, actor);

    // 业务错误放 result.isError，让客户端模型能读到并自我修正
    return this.resultResponse(id, {
      content: [{ type: 'text', text: result.ok ? result.content : `Error: ${result.content}` }],
      isError: !result.ok,
    });
  }

  private resultResponse(id: string | number | null, result: unknown): Record<string, unknown> {
    return { jsonrpc: '2.0', id, result };
  }

  private errorResponse(id: string | number | null, code: number, message: string): Record<string, unknown> {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
