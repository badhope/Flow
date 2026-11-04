# 连接外部 Agent（MCP）

Flow 通过 **MCP（Model Context Protocol）** 向外部 Agent 暴露店铺的**只读**能力。
Claude Desktop、Cursor、任何 MCP 客户端都可以直接连接。

## 端点

| 项 | 值 |
|---|---|
| 地址 | `POST {站点}/api/mcp` |
| 传输 | Streamable HTTP（无状态，无 session） |
| 报文 | JSON-RPC 2.0 |
| 协议版本 | `2025-11-25` / `2025-06-18` / `2025-03-26` |
| 鉴权 | 卖家或管理员会话 Cookie（与工作台同一套登录） |
| 探活 | `GET /api/mcp/health`（公开，不含用户数据） |

## 能力边界

**只有只读工具通过 MCP 暴露。** 写工具（批准退款、改价、回复买家）调用时返回 `-32602`，
并说明必须回到 Flow 工作台人工审批。

这不是没做完，而是产品边界：

```
外部 Agent ──读──▶ 店铺真实数据（安全、幂等、按租户隔离）
外部 Agent ──写──▶ ✗ 拒绝
                    └─ 人类在审批卡上确认 → 站内业务服务执行
```

理由很直接：这些动作会移动真实资金或对外发声。让 Agent 绕过审批，等于把差异化设计拆掉。

## 可用工具

| 工具 | 作用 |
|---|---|
| `get_store_overview` | GMV、订单数、访客数、商品数、今日数据、待发货数 |
| `list_orders` | 按状态/订单号查询订单 |
| `list_products` | 查询商品（价格、库存、销量、状态） |
| `list_low_stock` | 低于阈值的变体列表 |
| `list_pending_refunds` | 待卖家处理的退款申请 |

每个工具的 `inputSchema` 由 `server/modules/copilot/copilot-tool-contract.ts` 统一生成，
与站内审批卡、OpenAPI 共用同一份声明——不存在"文档写一套、实现另一套"。

## 用 curl 手工验证

```bash
# 1. 登录拿会话 Cookie
curl -c cookies.txt -X POST https://your-site/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"email":"seller@example.com","password":"..."}'

# 2. 握手
curl -b cookies.txt -X POST https://your-site/api/mcp \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'

# 3. 列出工具
curl -b cookies.txt -X POST https://your-site/api/mcp \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 4. 调用
curl -b cookies.txt -X POST https://your-site/api/mcp \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_store_overview","arguments":{}}}'
```

`X-Requested-With` 是站点的 CSRF 校验要求，所有非 GET 请求都要带。

## 错误语义

| 场景 | 返回 |
|---|---|
| 未知方法（如 `resources/list`） | `-32601` |
| 报文非法 / 批量请求 | `-32600` |
| 未知工具、或试图调用写工具 | `-32602`，`message` 说明原因 |
| 未登录 | `-32001` |
| 工具执行业务失败 | `200` + `result.isError: true` |

最后一条是刻意设计：业务错误放在 `result` 里，客户端模型才能读到原因并自我修正；
如果塞进 JSON-RPC `error`，多数客户端会直接中断，模型看不到细节。

## Agent Card

`GET /.well-known/agent-card.json` 返回 A2A 约定的能力声明，包含技能列表、
鉴权方式、以及显式的 `x-flow-mcp.writeToolsExcluded = true`。

外部框架可以据此自动发现端点，不必读文档。

## 已知边界

- 无 SSE 流式响应；工具调用是请求-响应。
- 无 OAuth 2.1 授权服务器；当前复用工作台会话 Cookie。
  面向第三方开发者的场景需要先补 API Key 体系（见 `docs/ROADMAP.md`）。
- 不实现 `resources` / `prompts` / `sampling`，`capabilities` 里也不声明它们。
