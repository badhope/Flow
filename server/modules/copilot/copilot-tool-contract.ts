import type { CopilotParamSpec, CopilotToolDefinition } from './copilot-protocol';

/**
 * 工具契约层：把一份声明同时投射成四种消费形态，杜绝「三处各写一遍」的漂移。
 *
 *   1. 给模型看的文本目录（buildToolCatalog）
 *   2. 给模型用的 JSON Schema（toJsonSchema）——可直接用于 OpenAI tools[].function.parameters
 *   3. 给前端渲染审批卡用的风险元数据（toolRisk）
 *   4. 给 MCP / 外部 Agent 的 inputSchema（同 2）
 *
 * 之前 `ApprovalCard.tsx` 里有一份手工维护的 TOOL_META，服务端改了工具语义前端不会跟着变，
 * 高风险动作可能被显示成低风险。现在风险等级由服务端唯一声明，前端通过 /api/copilot/tools 消费。
 */

/** 风险等级决定审批 UI 的强调程度与是否要求二次确认 */
export type ToolRisk = 'low' | 'medium' | 'high';

export interface ToolPolicy {
  risk: ToolRisk;
  /** 是否为不可逆的资金/对外动作（退款、打款、对外发信） */
  irreversible: boolean;
  /** 中文短名，用于审批卡标题；缺失时回退到工具名 */
  labelZh: string;
  labelEn: string;
}

/**
 * 按工具名声明策略。新增工具必须在这里登记，否则 `assertPolicyCoverage` 会在测试中报错——
 * 这是刻意的：漏登记就等于漏了风险标注。
 */
const POLICY: Record<string, ToolPolicy> = {
  get_store_overview: { risk: 'low', irreversible: false, labelZh: '读取店铺概况', labelEn: 'Store overview' },
  list_orders: { risk: 'low', irreversible: false, labelZh: '查询订单', labelEn: 'List orders' },
  list_products: { risk: 'low', irreversible: false, labelZh: '查询商品', labelEn: 'List products' },
  list_low_stock: { risk: 'low', irreversible: false, labelZh: '查询低库存', labelEn: 'Low stock' },
  list_pending_refunds: { risk: 'low', irreversible: false, labelZh: '查询待处理退款', labelEn: 'Pending refunds' },
  update_order_status: { risk: 'medium', irreversible: false, labelZh: '修改订单状态', labelEn: 'Change order status' },
  approve_refund: { risk: 'high', irreversible: true, labelZh: '批准退款（真实打款）', labelEn: 'Approve refund (real payout)' },
  reject_refund: { risk: 'medium', irreversible: false, labelZh: '拒绝退款申请', labelEn: 'Reject refund' },
  update_product_status: { risk: 'low', irreversible: false, labelZh: '商品上下架', labelEn: 'Toggle product status' },
  create_coupon: { risk: 'medium', irreversible: false, labelZh: '创建优惠券', labelEn: 'Create coupon' },
  create_draft_product: { risk: 'low', irreversible: false, labelZh: '创建商品草稿', labelEn: 'Create product draft' },
  send_inquiry_reply: { risk: 'low', irreversible: false, labelZh: '回复买家咨询', labelEn: 'Reply to buyer' },
  // 买家侧导购工具（SHOPPER_TOOLS）。与卖家工具共用同一契约层与风险词汇，
  // 但两侧工具名零交集，不存在越权调用的可能。
  search_products: { risk: 'low', irreversible: false, labelZh: '搜索商品', labelEn: 'Search products' },
  list_categories: { risk: 'low', irreversible: false, labelZh: '浏览分类', labelEn: 'List categories' },
  get_product_detail: { risk: 'low', irreversible: false, labelZh: '查看商品详情', labelEn: 'Product detail' },
  get_my_cart: { risk: 'low', irreversible: false, labelZh: '查看购物车', labelEn: 'View cart' },
  add_to_cart: { risk: 'low', irreversible: false, labelZh: '加入购物车', labelEn: 'Add to cart' },
};

const FALLBACK_POLICY: ToolPolicy = {
  risk: 'medium',
  irreversible: false,
  labelZh: '',
  labelEn: '',
};

export function toolPolicy(name: string): ToolPolicy {
  return POLICY[name] ?? FALLBACK_POLICY;
}

/** 把参数声明转成 JSON Schema（draft 2020-12 子集，兼容 OpenAI strict mode 之外的一般用法） */
export function toJsonSchema(definition: CopilotToolDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const spec of definition.params) {
    properties[spec.name] = paramToSchema(spec);
    if (spec.required) required.push(spec.name);
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
    // 工具参数一律拒绝未知字段：模型多给的键不该被静默忽略
    additionalProperties: false,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

function paramToSchema(spec: CopilotParamSpec): Record<string, unknown> {
  if (spec.type === 'number') {
    const schema: Record<string, unknown> = { type: spec.integer ? 'integer' : 'number', description: spec.description };
    if (spec.min !== undefined) schema.minimum = spec.min;
    if (spec.max !== undefined) schema.maximum = spec.max;
    return schema;
  }
  if (spec.type === 'boolean') {
    return { type: 'boolean', description: spec.description };
  }
  const schema: Record<string, unknown> = { type: 'string', description: spec.description };
  if (spec.enum && spec.enum.length > 0) schema.enum = [...spec.enum];
  if (spec.maxLength !== undefined) schema.maxLength = spec.maxLength;
  // RegExp 无法直接进 JSON；用 pattern 的 source 表达，保持两端口径一致
  if (spec.pattern) schema.pattern = spec.pattern.source;
  return schema;
}

/** 完整工具契约（供 /api/copilot/tools 与 MCP tools/list 复用） */
export interface ToolContract {
  name: string;
  description: string;
  kind: 'read' | 'write';
  risk: ToolRisk;
  irreversible: boolean;
  labelZh: string;
  labelEn: string;
  inputSchema: Record<string, unknown>;
}

export function buildToolContracts(definitions: readonly CopilotToolDefinition[]): ToolContract[] {
  return definitions.map((def) => {
    const policy = toolPolicy(def.name);
    return {
      name: def.name,
      description: def.description,
      kind: def.kind,
      risk: policy.risk,
      irreversible: policy.irreversible,
      labelZh: policy.labelZh || def.name,
      labelEn: policy.labelEn || def.name,
      inputSchema: toJsonSchema(def),
    };
  });
}

/**
 * 审批时固化的策略指纹。工具定义或风险等级变化后，旧 pending 动作的指纹不再匹配，
 * 审批接口据此拒绝执行——避免"卖家看到的是旧描述，实际执行的是新语义"。
 */
export function policyFingerprint(definition: CopilotToolDefinition): string {
  const policy = toolPolicy(definition.name);
  const payload = JSON.stringify({
    kind: definition.kind,
    risk: policy.risk,
    irreversible: policy.irreversible,
    params: definition.params.map((p) => ({
      name: p.name,
      type: p.type,
      required: Boolean(p.required),
      enum: p.enum ? [...p.enum] : undefined,
      min: p.min,
      max: p.max,
      maxLength: p.maxLength,
    })),
  });
  return stableHash(payload);
}

/** 与 Node crypto 解耦的稳定短哈希（FNV-1a 64 位，足够做指纹，不用于安全场景） */
export function stableHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 审批幂等键：同会话 + 同工具 + 同参数 → 同一键，重复提交只落一条 pending */
export function actionIdempotencyKey(
  conversationId: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const normalized = JSON.stringify(args, Object.keys(args).sort());
  return `act_${stableHash(`${conversationId}|${toolName}|${normalized}`)}`;
}

/** 测试用：确认注册表里每个工具都有显式策略 */
export function toolsMissingPolicy(definitions: readonly CopilotToolDefinition[]): string[] {
  return definitions.filter((d) => !POLICY[d.name]).map((d) => d.name);
}
