import { describe, expect, it } from 'vitest';
import { COPILOT_TOOLS, getTool } from './copilot-tools';
import {
  actionIdempotencyKey,
  buildToolContracts,
  policyFingerprint,
  stableHash,
  toJsonSchema,
  toolPolicy,
  toolsMissingPolicy,
} from './copilot-tool-contract';

/**
 * 工具契约层存在的原因：同一份工具定义此前散落在三个地方
 * （服务端参数声明、Copilot 文本目录、前端 ApprovalCard 的 TOOL_META），
 * 加一个工具要改三处，且风险等级靠人肉同步——高风险动作可能被显示成低风险。
 * 这些用例把"单一事实源"钉死。
 */
describe('tool contract', () => {
  it('C1: 每个工具都必须有显式风险策略（漏登记即测试失败）', () => {
    expect(toolsMissingPolicy(COPILOT_TOOLS)).toEqual([]);
  });

  it('C2: 资金类动作标为 high 且 irreversible', () => {
    const refund = toolPolicy('approve_refund');
    expect(refund.risk).toBe('high');
    expect(refund.irreversible).toBe(true);

    // 只读查询不该被标成高风险（否则审批疲劳，卖家会无脑点过）
    expect(toolPolicy('get_store_overview').risk).toBe('low');
    expect(toolPolicy('get_store_overview').irreversible).toBe(false);
  });

  it('C3: 未知工具回落到保守默认值而不是 low', () => {
    const unknown = toolPolicy('some_future_tool');
    expect(unknown.risk).toBe('medium');
    expect(unknown.irreversible).toBe(false);
  });

  it('C4: JSON Schema 与参数声明同源（必填/枚举/范围都在）', () => {
    const tool = getTool('update_order_status');
    expect(tool).toBeDefined();
    const schema = toJsonSchema(tool!);

    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);

    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.orderNo).toBeDefined();
    expect(properties.status.enum).toBeDefined();
    expect(Array.isArray(properties.status.enum)).toBe(true);

    const required = schema.required as string[];
    expect(required).toContain('orderNo');
    expect(required).toContain('status');
  });

  it('C5: 数值参数带 min/max，字符串带 maxLength', () => {
    const tool = getTool('list_orders');
    const schema = toJsonSchema(tool!);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.limit.minimum).toBe(1);
    expect(props.limit.maximum).toBe(20);
    expect(props.limit.type).toBe('integer');
    expect(props.keyword.maxLength).toBeDefined();
  });

  it('C6: 无参数工具生成合法的空对象 schema', () => {
    const tool = getTool('get_store_overview');
    const schema = toJsonSchema(tool!);
    expect(schema.properties).toEqual({});
    expect(schema.required).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
  });

  it('C7: 契约输出包含风险与不可逆标记，供前端渲染', () => {
    const contracts = buildToolContracts(COPILOT_TOOLS);
    expect(contracts.length).toBe(COPILOT_TOOLS.length);
    for (const contract of contracts) {
      expect(['low', 'medium', 'high']).toContain(contract.risk);
      expect(typeof contract.irreversible).toBe('boolean');
      expect(contract.labelZh.length).toBeGreaterThan(0);
      expect(contract.inputSchema).toBeDefined();
    }
  });

  it('C8: 策略指纹随工具语义变化，同语义稳定', () => {
    const tool = getTool('create_coupon')!;
    const a = policyFingerprint(tool);
    const b = policyFingerprint(tool);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);

    // 改一个影响语义的字段（参数上限）指纹必须变
    const mutated = {
      ...tool,
      params: tool.params.map((p) => (p.name === 'value' ? { ...p, max: 999 } : p)),
    };
    expect(policyFingerprint(mutated)).not.toBe(a);
  });

  it('C9: 幂等键只由会话/工具/参数决定，与参数书写顺序无关', () => {
    const k1 = actionIdempotencyKey('conv-1', 'create_coupon', { code: 'A', value: 10 });
    const k2 = actionIdempotencyKey('conv-1', 'create_coupon', { value: 10, code: 'A' });
    expect(k1).toBe(k2);

    // 换会话 / 换工具 / 换参数都必须换键
    expect(actionIdempotencyKey('conv-2', 'create_coupon', { code: 'A', value: 10 })).not.toBe(k1);
    expect(actionIdempotencyKey('conv-1', 'create_draft_product', { code: 'A', value: 10 })).not.toBe(k1);
    expect(actionIdempotencyKey('conv-1', 'create_coupon', { code: 'B', value: 10 })).not.toBe(k1);
  });

  it('C10: 稳定哈希对相同输入恒定、对不同输入区分', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(stableHash('')).toHaveLength(16);
  });
});
