import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { McpController } from './mcp.controller';
import { COPILOT_TOOLS } from '../copilot/copilot-tools';

/**
 * MCP 协议契约。参考规范：2025-06-18 / 2025-11-25。
 *
 * 这些用例覆盖的是「客户端会怎么用」而不是「服务端内部怎么实现」：
 * 握手 → 列工具 → 调工具 → 错误语义。协议实现出错时，客户端会静默失败，
 * 所以必须把报文形状钉死。
 */

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    end() { return this; },
  };
  return res as unknown as Response & { statusCode: number; body: any };
}

function makeController(runReadTool = vi.fn(async () => ({ ok: true, content: 'result' }))) {
  const tools = { runReadTool } as unknown as ConstructorParameters<typeof McpController>[0];
  return { controller: new McpController(tools), runReadTool };
}

const sellerReq = { user: { id: 'seller-1', role: 'seller' } } as any;

describe('MCP server', () => {
  it('M1: initialize 返回协议版本、tools 能力与服务器信息', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      sellerReq,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.result.protocolVersion).toBe('2025-06-18');
    expect(res.body.result.capabilities.tools).toBeDefined();
    expect(res.body.result.serverInfo.name).toBe('flow-commerce');
    // 不声明未实现的 capability，否则客户端会调用到不存在的 method
    expect(res.body.result.capabilities.resources).toBeUndefined();
    expect(res.body.result.capabilities.prompts).toBeUndefined();
  });

  it('M2: 未知协议版本回落到最新版，而不是报错', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      sellerReq,
      res,
    );
    expect(res.body.result.protocolVersion).toBe('2025-11-25');
  });

  it('M3: tools/list 只暴露只读工具，且带 inputSchema 与 annotations', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sellerReq, res);

    const tools = res.body.result.tools as Array<Record<string, any>>;
    expect(tools.length).toBeGreaterThan(0);

    const readToolNames = COPILOT_TOOLS.filter((t) => t.kind === 'read').map((t) => t.name);
    const writeToolNames = COPILOT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.name);

    for (const tool of tools) {
      expect(readToolNames).toContain(tool.name);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }

    // 写工具绝不能出现在这里：这是 MCP 的能力边界
    for (const writeName of writeToolNames) {
      expect(tools.map((t) => t.name)).not.toContain(writeName);
    }
  });

  it('M4: tools/call 调用只读工具并返回 content 数组', async () => {
    const { controller, runReadTool } = makeController();
    const res = mockRes();
    await controller.handle(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_store_overview', arguments: {} },
      },
      sellerReq,
      res,
    );
    expect(runReadTool).toHaveBeenCalledTimes(1);
    expect(res.body.result.content).toEqual([{ type: 'text', text: 'result' }]);
    expect(res.body.result.isError).toBe(false);
  });

  it('M5: 工具业务失败走 result.isError，而不是 JSON-RPC error', async () => {
    const { controller } = makeController(vi.fn(async () => ({ ok: false, content: '库存不足' })));
    const res = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_orders', arguments: {} } },
      sellerReq,
      res,
    );
    // 关键：没有 error 字段，模型才能读到失败原因并自我修正
    expect(res.body.error).toBeUndefined();
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain('库存不足');
  });

  it('M6: 拒绝通过 MCP 调用写工具，并说明原因', async () => {
    const { controller, runReadTool } = makeController();
    const res = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'approve_refund', arguments: {} } },
      sellerReq,
      res,
    );
    expect(runReadTool).not.toHaveBeenCalled();
    expect(res.body.error.code).toBe(-32602);
    expect(res.body.error.message).toContain('write operation');
  });

  it('M7: 未知工具与未知方法分别返回正确的错误码', async () => {
    const { controller } = makeController();

    const unknownTool = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      sellerReq,
      unknownTool,
    );
    expect(unknownTool.body.error.code).toBe(-32602);
    expect(unknownTool.body.error.message).toContain('Unknown tool');

    const unknownMethod = mockRes();
    await controller.handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, sellerReq, unknownMethod);
    expect(unknownMethod.body.error.code).toBe(-32601);
  });

  it('M8: 非法 JSON-RPC 报文被拒绝（-32600）', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle({ id: 1, method: 'initialize' }, sellerReq, res);
    expect(res.body.error.code).toBe(-32600);
  });

  it('M9: 批量请求明确拒绝而不是静默忽略', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle([{ jsonrpc: '2.0', id: 1, method: 'ping' }], sellerReq, res);
    expect(res.body.error.code).toBe(-32600);
    expect(res.body.error.message).toContain('Batch');
  });

  it('M10: 未认证请求返回 -32001', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', id: 8, method: 'tools/list' },
      { user: undefined } as any,
      res,
    );
    expect(res.body.error.code).toBe(-32001);
  });

  it('M11: notifications/initialized 返回 202 且无响应体', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      sellerReq,
      res,
    );
    expect(res.statusCode).toBe(202);
    expect(res.body).toBeUndefined();
  });

  it('M12: ping 返回空结果（客户端心跳）', async () => {
    const { controller } = makeController();
    const res = mockRes();
    await controller.handle({ jsonrpc: '2.0', id: 9, method: 'ping' }, sellerReq, res);
    expect(res.body.result).toEqual({});
  });
});
