# Flow — 架构说明

| 项 | 内容 |
|---|---|
| 应用 | Flow 出口电商平台（AI 原生跨境出货台） |
| 版本 | v1.22.0 / 2026-11-01 |
| 仓库形态 | Monorepo（client + server + shared + scripts） |

---

## 一、整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                        浏览器（用户）                          │
│  ┌──────────────────────┐      ┌──────────────────────────┐  │
│  │   买家商城 (B2C)      │      │  卖家 AI 工作台 (Seller)  │  │
│  │  React 19 + Vite     │      │  React 19 + Vite         │  │
│  │  Tailwind + shadcn/ui │      │  + ECharts 看板          │  │
│  └─────────┬────────────┘      └────────────┬─────────────┘  │
│            │   credentials: include (HttpOnly Cookie)        │
└────────────┼─────────────────────────────────┼───────────────┘
             ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│            NestJS 12 API 网关（单一 Node 进程）                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Middleware: jwt-auth → csrf-header → rate-limit      │  │
│  │  Guards: RolesGuard (buyer/seller)                    │  │
│  │  Filter: 全局异常脱敏过滤器                             │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌─────────────┬─────────────┬─────────────┬───────────────┐ │
│  │  Auth       │  Products   │  Orders     │  Payments     │ │
│  │  (JWT+OAuth)│  Categories │  Cart       │  Coupons      │ │
│  │  Reviews    │  Favorites  │  Logistics  │  Inquiry      │ │
│  │  Dashboard │  Audit      │  AI (5 Agent+Gateway)        │ │
│  └─────────────┴─────────────┴─────────────┴───────────────┘ │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
               ▼                              ▼
   ┌──────────────────────┐      ┌──────────────────────────────┐
   │  PostgreSQL 16       │      │  外部 OpenAI 兼容 LLM 端点    │
   │  + pg_trgm (GIN)      │◄────►│  (DeepSeek / 火山方舟 / ...) │
   │  + pg_trgm            │      │  - /v1/chat/completions      │
   │  Drizzle ORM          │      │  - embeddings（未启用）     │
   └──────────────────────┘      └──────────────────────────────┘
               ▲
               │
   ┌───────────┴────────────┐
   │  Stripe / PayPal /    │
   │  17TRACK / Google OAuth│
   └───────────────────────┘
```

---

## 二、Monorepo 目录分层

```
Flow/
├── client/        # React 19 + Vite 前端（买家端 + 卖家端双端同仓）
│   └── src/
│       ├── pages/         # 买家 14 页面 + 卖家 12 页面（含 CMS/集合详情/404）
│       ├── components/     # shadcn/ui 基础组件 + 业务组件
│       ├── api/           # fetch 封装（credentials: include）
│       ├── contexts/      # AuthContext / LanguageContext
│       └── i18n/          # zh / en / es / pt 四语言
├── server/        # NestJS 12 后端
│   ├── modules/       # 业务模块（auth/products/orders/ai/copilot/...）
│   ├── common/        # middleware / guards / filters
│   └── database/      # Drizzle schema
├── shared/        # 前后端共享 TypeScript 类型与 DTO 接口
├── scripts/       # 运维脚本（种子数据 / 备份等）
├── docker/        # postgres init.sql（建扩展）
├── docker-compose.yml
└── .env.example
```

---

## 三、前后端分层

### 前端（client/）
- **路由层**：React Router v7，买家端 `/`、卖家端 `/seller/*` 由 `SellerRouteGuard` 渲染期拦截。
- **数据层**：`src/api/*.ts` 统一 `fetch(..., { credentials: include, headers: { 'X-Requested-With': 'XMLHttpRequest' } })`，token 完全不落地 localStorage。
- **状态层**：`AuthContext`（当前用户）、`LanguageContext`（四语言切换）。
- **UI 层**：Tailwind CSS + shadcn/ui 原子组件 + ECharts 图表。

### 后端（server/）
- **入口**：NestJS `AppModule` 注册业务模块 + 全局中间件。
- **中间件链**：`jwt-auth.middleware`（从 HttpOnly Cookie 或 Authorization 头解析 JWT，挂 `req.user`）→ `csrf-header.middleware`（非 GET 强制 `X-Requested-With`）→ 业务路由。
- **守卫**：`RolesGuard` 按 `@Roles('seller')` 装饰器校验；买家接口默认登录态即可。
- **异常**：`exception.filter.ts` 生产环境剥离 stack，仅返 `{ code, message, timestamp }`。
- **ORM**：Drizzle ORM，由 `scripts/db/migrate.mjs` 按 `drizzle/*.sql` 执行版本化迁移；金额计算统一 `decimal.js`。

---

## 四、数据库表（PostgreSQL 16）

| 分组 | 表 | 说明 |
|---|---|---|
| 账号 | `users` | id / email / password_hash(bcrypt) / role(buyer\|seller) / google_id / created_at |
| 商品 | `products` | 多语言字段（title_zh/en/es/pt 等）/ price(decimal) / stock / status(draft\|active\|inactive) / images |
| 商品 | `categories` | 分类树 |
| 商品 | `product_variants` | SKU 级价格/库存/规格值；当前未启用向量检索，SupportAgent 走 ILIKE 关键词召回；向量检索在路线图中 |
| 交易 | `cart_items` | user_id 或 session_id 双轨，匿名登录后事务合并 |
| 交易 | `orders` / `order_items` | order_no(nanoid+日期前缀) / status / 金额后端重算 |
| 交易 | `payments` | provider(stripe\|paypal\|demo) / status / 第三方交易号（唯一索引做 webhook 幂等锚点） |
| 营销 | `reviews` | 仅已购用户可评（verifiedPurchase），支持图片；聚合评分在 products |
| 营销 | `favorites` | (user_id, product_id) 联合唯一 |
| 营销 | `coupons` | 原子核销 `UPDATE ... WHERE used_count < total_quantity`；`coupon_usage` 记录每用户次数 |
| 客服 | `inquiry_sessions` / `inquiry_messages` | 买家咨询会话，卖家可见 |
| 物流 | `logistics` | carrier / tracking_no / 轨迹节点，17TRACK 接入点 |
| AI | `ai_reports` | TrendAgent 生成的趋势报告落库 |
| AI | `ai_usage_log` | 每次 LLM 调用计量（token / 耗时 / 成功率） |
| 审计 | `audit_logs` | 9 类写操作前后值 diff + IP |
| 审计 | `cart_recovery_codes` | 匿名购物车跨设备迁移码（24h 一次性） |
| 运营 | `inquiry_sessions.seller_id` | 咨询会话归属卖家；未分配会话可由首个回复的卖家接管 |

扩展：`pg_trgm` + GIN 索引（商品标题模糊搜索）。

---

## 五、AI Gateway 调用链路

```
Controller (5 Agent 之一)
    │  构造 messages[] + response_format? + temperature
    ▼
AiGatewayService.chat()
    │  POST {LLM_BASE_URL}/v1/chat/completions
    │  Headers: Authorization: Bearer {LLM_API_KEY}
    │  Body: { model, messages, response_format?, temperature }
    ▼
OpenAI 兼容端点（DeepSeek / 火山方舟 / OpenAI / 通义 / 智谱 ...）
    │
    ▼
解析 choices[0].message.content → JSON.parse（若要求 JSON）
    │
    ├──► 成功：logUsage(success=true, tokens, duration_ms) → ai_usage_log
    └──► 失败：logUsage(success=false, error_message) → 仍落库，向 Controller 抛 400/500
```

- **未配 `LLM_API_KEY`**：Gateway 在调用前即返回 400「未配置 LLM API Key」，**绝不返回假数据**。
- **检索**：SupportAgent 当前版本使用 products 表 `ILIKE` 关键词匹配（`pg_trgm` GIN 索引加速）；向量检索为后续扩展点，代码中不虚构未启用的能力。

---

## 六、认证与 CSRF 方案

| 层 | 机制 |
|---|---|
| 登录 | `POST /api/auth/register` / `/login`：bcrypt 校验 → 签发 JWT（2h）→ **仅** `Set-Cookie: flow_auth=...; HttpOnly; Secure(生产); SameSite=Lax; Path=/` |
| 前端 | 彻底移除 localStorage token，所有 fetch 带 `credentials: include` |
| 鉴权中间件 | 全局 `jwt-auth.middleware` 优先读 Cookie，兼容 `Authorization: Bearer`；未匹配则 401 |
| CSRF | 全局 `csrf-header.middleware`：所有非 GET 请求必须带 `X-Requested-With: XMLHttpRequest`，缺失 403 |
| 续期 | `POST /api/auth/refresh` 校验旧 Cookie 后滑动签发新 2h Cookie |
| 安全头 | 全局 `SecurityHeadersMiddleware`：CSP / X-Frame-Options / nosniff / Referrer-Policy / HSTS（生产） |
| 追踪 | 每个请求分配 `X-Request-Id`，异常响应体与日志共用，便于定位 |
| 异常 | `AllExceptionsFilter`：生产环境统一脱敏 5xx，返回 `{statusCode,message,error,requestId,timestamp,path}` |
| 登出 | `POST /api/auth/logout` 调 `clearAuthCookie` |
| 角色 | `RolesGuard` + 前端 `SellerRouteGuard`（渲染期拦截，无跳转窗口） |

> 该方案下 XSS 无法窃取 token（HttpOnly），跨站表单提交无法伪造（CSRF 头校验），token 有效期仅 2h 缩小暴露窗口。


---

## 七、SEO 与机器可读发现层

纯 SPA 的天然短板是首屏无 meta。当前版本采用 **SEO-lite**：服务端在返回 `index.html` 前按路径解析元信息并注入，无需引入 SSR 框架。

| 端点 | 作用 |
|---|---|
| `GET /sitemap.xml` | 上架商品 + 启用集合 + 已发布 CMS 页面，含 lastmod |
| `GET /robots.txt` | 允许公开页、屏蔽卖家/结算/订单/API，声明 sitemap |
| `GET /llms.txt` | 面向 AI 代理的站点说明、公开 API 清单与 MCP 接入方式 |
| `GET /.well-known/agent-card.json` | Agent Card（A2A 约定）：机器可读的技能、鉴权与能力边界 |
| `GET /api/openapi.json` | OpenAPI 3.1 描述（商品/购物车/订单/支付/健康检查/MCP） |
| `GET /api/seo/meta?path=` | 单页元信息（title/description/canonical/JSON-LD），客户端路由切换时复用 |

实现位置：`SeoService`（`server/modules/seo/seo.service.ts`）负责数据与渲染；路由在 `server/main.ts` 直接注册，
确保 `/sitemap.xml`、`/robots.txt`、`/llms.txt` 位于站点根路径（不受 `/api` 前缀与 SPA 回退影响）。
`buildOpenApiSpec()`（`server/modules/seo/openapi.ts`）为手写 OpenAPI 3.1，零新增依赖。

注入内容：`title`、`description`、`canonical`、`robots`、OpenGraph、Twitter Card、组织/商品 JSON-LD；卖家与交易页面自动 `noindex`。

**绝对 URL 解析顺序**：`APP_URL` → 请求的 `Host` / `X-Forwarded-Proto` → `localhost:3000` 兜底。
早先只读 `APP_URL`，未配置时所有对外地址（sitemap / llms.txt / agent card）都写成 `localhost:3000`，
在预览部署与自托管环境是静默错误。

---

## 七之二、Agent 互操作层（MCP）

外部 Agent 通过 **MCP（Model Context Protocol）** 接入，端点 `POST /api/mcp`，传输为 **Streamable HTTP**，
报文为 JSON-RPC 2.0。支持协议版本 `2025-11-25` / `2025-06-18` / `2025-03-26`（客户端请求哪个就回显哪个）。

| 方法 | 行为 |
|---|---|
| `initialize` | 返回 `protocolVersion` / `capabilities.tools` / `serverInfo`；不声明未实现的 resources/prompts |
| `tools/list` | 返回 5 个只读工具的 `inputSchema`（JSON Schema）与 `annotations`（`readOnlyHint` 等） |
| `tools/call` | 执行只读工具；**业务错误走 `result.isError`**，让客户端模型能读到原因并自我修正 |
| `ping` | 心跳 |
| 其他 | `-32601`（方法不存在）/ `-32600`（报文非法）/ `-32602`（工具不存在或不可调用） |

**能力边界是刻意的**：写工具（批准退款、改价、回复买家）**不通过 MCP 暴露**，调用时返回 `-32602` 并说明
"请在 Flow 工作台人工审批"。原因：这些动作会移动真实资金或对外发声，必须经过审批卡。

**工具定义单一来源**：`copilot-tool-contract.ts` 的一份声明同时生成

1. 模型看到的文本工具目录
2. 前端的风险元数据（替代原先 `ApprovalCard.tsx` 里手工维护的 `TOOL_META`）
3. MCP 的 `inputSchema` 与 `annotations`
4. OpenAPI 的工具 schema

`policyFingerprint()` 为每个写动作固化审批时的语义指纹；工具定义变更后，旧 `pending` 审批自动失效。

---

## 八、多租户边界（fail-closed）

| 资源 | 读 | 写 |
|---|---|---|
| 商品 | 公开仅 `active`；卖家可读本店草稿 | 归属校验 + 上架门禁 |
| 订单 | 买家按 userId/sessionId；卖家按 `sellerId`（管理员跨店） | 状态流转校验归属 |
| 支付/物流 | 同上，卖家不能读他店流水/轨迹 | 登记运单校验归属 |
| 退款 | 列表/详情按订单归属 | 审批/拒绝校验归属 + 原子抢占防并发重复打款 |
| 优惠券 | 卖家仅本店 | 归属校验 |
| 看板/巡检/审计/咨询 | 按 `sellerId` 过滤（历史无归属数据仅管理员可见） | — |

公共判定集中在 `server/common/tenant/tenant-scope.ts`，并有单元测试覆盖（含管理员无 userId 的内部调用场景）。
