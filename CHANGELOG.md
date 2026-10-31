# 更新日志 / Changelog

本项目所有重要变更均记录于本文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [1.22.0] — 2026-10-31

**主题：从「电商模板 + 后台」重构为「AI 原生平台」；同时补齐多租户安全短板。**

### Security

- AI Agent 按卖家隔离：趋势、选品、历史报告、自定义 Agent 的查询与操作全部加 seller 作用域；
  管理员保留跨店视图。
- 模型配置作用域化：`llm_*` 改为 `{userId}:` 前缀键，任意卖家无法读写他人或平台配置；
  未配置时回退环境变量，不串用他人密钥。
- 巡检与通知设置按卖家作用域；定时调度只由平台（admin）配置驱动。
- 演示支付生产门禁：`NODE_ENV=production` 下 `provider=demo` 默认 403，
  需显式 `ALLOW_DEMO_PAYMENT=true` 才放行。
- 出站 URL 防 SSRF：webhook 地址、巡检通知地址、LLM Base URL 统一拒绝环回、私网、
  CGNAT、链路本地与裸主机名。
- 依赖：nodemailer 7.0.13 → 10.3.1，multer 通过 overrides 升至 2.5.0；`npm audit --omit=dev` 归零。

### Added

- 双模态设计系统（`docs/DESIGN-SYSTEM.md`）：买家浅色、卖家深色，统一 token / 字阶 / 动效 / 图表配色。
- 全局 AI 命令面板（⌘K）：导航与自然语言共用一个入口，AI 兜底始终排第一。
- Agent 运行轨迹组件：步骤状态、工具名、耗时、可折叠。
- 人工审批门禁卡片：仅 `pending` 可批准/拒绝，高风险工具标红。
- 卖家页面原语：`SellerPageHeader` / `FlowPanel` / `FlowStat` / `FlowEmpty` / `FlowStatus`。
- 首页自然语言意图入口：接入真实导购会话，AI 不可用时回退关键词搜索。
- 管理员创建入口：`npm run admin:create`。
- 产品路线图（`docs/ROADMAP.md`）。
- 前端测试基础设施：vitest + jsdom + testing-library，新增 21 个用例（组件行为与纯函数）。

### Changed

- 卖家看板重做为 12 栏布局：今日 AI 简报 + KPI + 趋势/分类图 + 待处理队列；
  巡检接口失败时显示失败态，不再伪装成「暂无异常」。
- AI 分析中心改为 Agent 控制台：指标概览与 Agent 名册前置，模型设置后置。
- 商品管理页改为统一标题区 + sticky 工具栏；订单/退款/优惠券/集合/CMS/审计/运费模板统一页面头。
- 买家端主色统一为 token（`--flow-ink` / `--flow-accent`），移除页面内硬编码品牌 hex。
- 侧栏恢复审计日志入口；Copilot 支持 `?c=` / `?q=` 深链；Dashboard 支持「交给副驾」预填。

### Fixed

- 巡检数据 actor 契约错位（`sellerId` vs `userId`）导致的跨卖家告警可见。
- 命令面板连续 Enter / 双击会重复创建会话并重复发送。
- 审批卡对已执行动作仍显示批准按钮，导致无效请求。
- 首页意图参数与商品列表参数不一致（`q` vs `keyword`）。
- 历史页面在深色工作台下出现浅色块与低对比文字（兼容层映射到 token）。

### Verification

- `npm run type:check`：前后端 0 错误
- `npm run lint`：0 问题
- `npm test`：36 文件 / 215 用例全通过（原 34 / 198）
- `npm run build`：通过
- `npm audit --omit=dev`：0 漏洞
- 变异验证：移除 AI 兜底逻辑后 2 个前端用例转红；移除退款数量 clamp 后 1 个后端用例转红

---

## [1.21.1] — 2026-10-24

仓库统一命名与 CI 全绿。

### Changed
- **仓库名统一为 `Flow`**（五端）：GitHub `X33834/Flow`、`Morningstar202604/Flow`、`badhope/Flow`；
  Gitee `badhope/Flow`；GitCode `badhope/Flow`。旧 `GlobalEcom` / `GlobalEcom-AI` 地址自动 301/302 跳转。
- README / CONTRIBUTING / SECURITY / DEPLOY / ARCHITECTURE 的克隆地址与镜像链接同步为 `Flow`；
  README 顶部新增三端镜像入口。
- `package.json` 增加 `repository` / `homepage` / `bugs` 字段，指向 `X33834/Flow`。
- 依赖升级：react/react-dom 19.3.1、NestJS 12.2.0、vite 8.3.5、vitest 5.0.5、puppeteer-core 25.16.0、
  lucide-react 1.61.0；清理 27 个未使用的传递依赖（`@aws-sdk/*` 等）。
- Dependabot 收敛：github-actions 分组并忽略主版本；docker 忽略 `node` 主版本。

### Fixed
- **CI E2E 红灯根因**：本地渠道模拟器的 webhook 回调指向 3000（无 `STRIPE_WEBHOOK_SECRET` 的降级实例），
  导致 `stripe-webhook` 验签 400。改为回调持有 mock 密钥的 3100 实例。
- **CI SEO 断言失败**：smoke job 只构建了 server，SPA 的 `index.html` 不存在导致无法注入 meta；
  改为启动前执行完整 `npm run build`。
- 三套渠道冒烟补 429 重试，避免连续运行触发认证限流（5 次/分/IP）。
- CI 失败时自动输出两实例与 mock 日志，便于定位。

### Verification
- 三仓 GitHub Actions：`Lint / Typecheck / Test / Build` 与 `E2E Smoke (Postgres)` 全绿（`f9d1e35`）。
- 本地：lint 0 / 双端 typecheck 0 / 166 单测 / build 通过 / `smoke:all` 6 套全通过。
- 9 个 Dependabot PR 已全部关闭（依赖已集中升级），三仓开放 PR 数为 0。

---

## [1.21.0] — 2026-10-24

定位强化：把「AI 原生跨境出口电商」从功能清单做成可展示、可集成、可运营的开源产品。

### Added
- **SEO / 发现层**：`/sitemap.xml`、`/robots.txt`、`/llms.txt`、`/api/openapi.json`、
  `/api/seo/meta`；服务端在 index.html 注入 title/description/canonical/OG/Twitter/JSON-LD（商品 Organization/Product），
  卖家与交易页自动 noindex。`client/src/lib/seo.ts` 负责客户端路由切换后的同步。
  路由在 `server/main.ts` 根路径直接注册（而非 controller），避免 `/api` 前缀影响 sitemap/robots 的站点根路径。
- **Stripe 站内支付**：`PayResponse.clientSecret` + `stripePublishableKey` + `/checkout/stripe` 支付确认页
  （Stripe.js PaymentElement）；未配置公钥时诚实提示到渠道后台确认，不再把「创建支付单」误报为支付成功。
- **PayPal 支付确认**：`POST /api/payments/paypal/capture`，校验归属与 capture 金额后幂等入账；
  本地 mock provider 增加 capture 端点。
- **商品运营效率**：CSV 导出（`GET /api/products/export/csv`）、批量上下架（`POST /api/products/bulk-status`）、
  卖家端多选操作条；SPU/SKU 变体 CRUD 路由（`/api/products/:id/variants`、`/api/products/variants/:variantId`）。
- **评价增强**：评价图片（最多 6 张）、卖家回复、verifiedPurchase、helpfulCount 透出。
- **店面体验**：搜索联想下拉、相关商品推荐、最近浏览、页脚真实链接与支付/退货/配送信任标识、
  Hero 品牌色统一（#0B1F3A → #00C2B8）。
- **工程能力**：`scripts/cli.mjs`（health/products/search/order/ai-test/export/openapi）、
  `npm run smoke:all`（embedded-postgres 一键跑 6 套 E2E）、`npm run capture:all`（一键重建截图+视频，缺构建产物时自动构建）、`scripts/mock-smtp.mjs`。
- **安全与可观测**：安全响应头中间件（CSP/HSTS/nosniff/Referrer-Policy/Permissions-Policy）、
  `X-Request-Id` 请求追踪、全局异常过滤器（生产脱敏，统一错误结构）、静态资源 immutable 缓存、优雅关闭。

### Fixed
- **订单详情跨租户读取**：`GET /api/orders/:id` 此前对任意卖家放行；现在卖家只能读本店订单，
  买家按 userId/sessionId 归属，管理员可跨店（`getOrderDetail` 统一 actor 语义）。
- **订单状态跨租户写入**：`updateStatus` 增加卖家归属校验，杜绝改他店订单状态/发货。
- **支付入账并发重复**：`markOrderPaid` 改为 `UPDATE ... WHERE status='pending_payment' RETURNING` 原子抢占，
  并发 webhook 不再重复累计销量/积分/库存流水。
- **退款并发重复打款**：审批前原子抢占 `requested → approved`，并发第二请求 409；渠道失败自动回滚状态允许重试。
- **退款数量校验**：行项数量必须为正整数、不可重复、不可超过购买数量与历史已退数量（防刷库存）。
- **结算丢失 variantId**：下单 payload 透传规格；服务端对多规格商品缺失 variantId 直接拒绝（不再静默选首个规格）。
- **优惠券规则**：改码重复检查修正（原条件恒不命中导致 500）；`coupon_usage` 真实写入；适用范围
  （product/category）参与校验；免运费券在下单时把运费归零。
- **CSV 导入行错位**：以原始行号回填价格/库存（此前失败行会串行）；导入与创建路径统一走上架门禁。
- **公开草稿泄露**：`GET /api/products/:id` 公开访问仅返回 active；卖家只能读本店草稿；集合详情过滤下架商品。
- **卖家看板/巡检/审计/咨询跨店泄露**：全部按 `sellerId` 聚合或过滤；咨询会话新增 `seller_id`（迁移 0007），
  未分配会话可由首个回复卖家接管，已归属他人则拒绝。
- **前端状态崩溃**：`OrderStatus` 补齐 `refunded` / `partially_refunded`，卖家订单表与买家徽章不再因未知状态白屏。
- **列表筛选分页**：订单/退款/商品筛选切换时回到第 1 页；退款关键字真正下发。
- **多变体改价误导**：卖家端对多规格商品禁用价格/库存输入并提示到规格中维护。
- **移动端**：咨询页左右栏在窄屏堆叠；商品弹窗网格响应式；订单表横向滚动。
- **可访问性**：购物车加减/删除、收藏、客服发送/悬浮球、订单详情按钮补齐 `aria-label`/`aria-pressed`。

### Verification
- 单测 **166/166**（29 文件；新增 SEO/OpenAPI 3 例、租户管理员内部调用 1 例）
- `npm run lint` 0、双端 `type:check` 0、`npm run build` 通过
- `npm run smoke:all`（6 套）：workflows 16 步、degraded、交易 19 步、providers 18 步、copilot 19 步、shopper 9 步全通过
  （embedded-postgres 17.5 + mock providers，无需 Docker）

---

## [1.20.0] — 2026-10-23

多租户数据隔离加固 + 商品查询能力补全 + 死代码与依赖清理 + 仓库治理。

### Added
- **多租户数据隔离（fail-closed）**，新公共模块 `server/common/tenant/tenant-scope.ts`
  （`isPlatformAdmin` / `canAccessSellerResource` / `resolveSingleSellerId`）
  - 商品：公开列表强制 `status=active`（`?status=draft` 不再泄露草稿）；卖家 `scope=mine` 仅见本店；
    更新 / 删除校验归属（非本店商品 403）
  - 订单：卖家列表仅返回本店订单；`GET /api/orders/seller/:id` 详情归属校验；跨卖家购物车禁止合单
  - 优惠券：卖家列表只返回本店券，更新校验归属
  - 退款：列表 / 详情 / 批准 / 拒绝全链路 `assertSellerOwnsRefund`（管理员可跨店）
  - **副驾读工具按卖家隔离**：`list_orders` / `list_products` / `list_low_stock` / `list_pending_refunds`
    只返回本店数据（admin 可跨店），与写工具归属校验同口径——模型不再基于别家商品生成无法执行的动作
- **商品查询能力**（`product-query.ts` / `product-visibility.ts`，纯函数 + 单测）
  - 价格区间过滤（EXISTS 匹配在售规格，参数化 SQL）+ `price_asc` / `price_desc` 排序（NULLS LAST）
  - 排序白名单 `normalizeSortBy`（未知值回退 newest）；`validatePriceRange` 拒绝负数 / NaN / 区间倒挂
- **客户端 IP 唯一出口** `server/common/http/client-ip.ts`：orders / products 控制器去重；
  不再直接信任 `X-Forwarded-For`（未配反代时可被伪造绕过限流与审计）
- **前端首屏优化**：路由级代码分割（React.lazy + Suspense）+ vendor manualChunks（react / radix 分包）
- **仓库治理**：GitHub Actions CI（lint / typecheck / test:coverage / build + postgres:16-alpine 容器跑
  workflows / degraded / 交易闭环三套 E2E）、Dependabot（npm 周更分组、拒绝 semver-major 自动升级）、
  `.editorconfig` / `.gitattributes`(LF) / `.nvmrc`(22)、Prettier（`npm run format` / `format:check`）、
  `GOVERNANCE.md` / `SUPPORT.md` / PR 模板

### Removed
- 66 个未使用的前端组件文件：shadcn/ui 组件（accordion / alert-dialog / avatar / breadcrumb /
  carousel / chart / command / drawer 等）与文件图标
- 依赖清理 27 项：17 个未用 Radix 包 + `dayjs` / `recharts` / `cmdk` / `vaul` /
  `embla-carousel-react` / `react-day-picker` / `react-resizable-panels` / `next-themes` /
  `input-otp` / `@tailwindcss/vite`

### Fixed
- 依赖清单与实际使用不符：`nanoid`（coupons 在用）未声明；`react` / `react-dom` / `echarts-for-react`
  错放在 devDependencies；`@types/bcrypt` / `postcss-import` 归位 devDependencies
- `npm run smoke` 脚本入口缺失（`scripts/smoke.mjs` 一直存在但没有 package.json 条目）

### Verification
- 单测 **162/162**（新增 17 例：client-ip 4 / tenant-scope 5 / product-query 3 / product-visibility 5）
- `npm run lint` 0 问题、双端 `type:check` 0 错误、`npm run build` 通过
- E2E 全量（embedded-postgres 17.5 + mock LLM 双实例）：`smoke:workflows` 16 步、`smoke:degraded`、
  `smoke` 19 步交易闭环、`smoke:copilot` 19 步、`smoke:shopper` 9 步全部通过
- 冒烟过程实测发现并修复：副驾读工具未按卖家隔离，多步计划整批批准时引用演示卖家商品被 403 拒绝

---

## [1.19.0] — 2026-10-23

通知预览、AI 文案质量抽检、PG 环境对拍。

### Added
- **通知预览**：`GET /api/copilot/watch/preview?format=plain|markdown|html`
  - 用**当前真实告警数据**渲染（不发任何通知），设置页可实时看效果
  - 邮件表单内新增「预览 markdown / 预览 HTML」按钮
- **AI 文案质量抽检**（`copy-quality.ts`，纯启发式、零 LLM 成本）
  - 6 类检查：英文标题长度、卖点数量与长度、长描述长度、SEO 关键词数、占位词/空泛套话、英文标题混入中文
  - 每命中一项扣 15 分，输出问题清单与总分；`needsReview` 标记进入人工复核队列
  - `GET /api/copilot/products/copy-quality`、`POST /api/copilot/products/:id/mark-reviewed`
- 数据库：`products.copy_source`（manual / ai / reviewed，迁移 `0006_copy_review.sql`）
  - 一键补全后自动标记为 `ai`；复核通过标记为 `reviewed` 并移出队列

### Verification
- 单测 **145/145**（新增 7 例：质量评估各项规则与边界）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `smoke:copilot` **19 步**（新增：通知三格式预览、文案抽检 2 个待复核 + 复核标记生效）
- `smoke:shopper` 9 步、`smoke:workflows` 16 步、`smoke:providers` 18 步全部通过
- 真浏览器：漏斗弹窗显示「AI 文案质量抽检 1 个待复核 / 70 分 / 卖点不足、长描述不足」+ 复核通过按钮；
  设置页「预览 markdown」渲染出真实告警（含 emoji 级别与统计行），控制台无错误
- 环境对拍：embedded-postgres 17.5 与 compose 的 `postgres:17-alpine` 同大版本，`pg_trgm` 可用，同一套迁移与冒烟结论一致

### Fixed
- 商品 `update()` 的字段白名单未包含 `copySource`，导致补全标记被静默丢弃（抽检一直是 0 个）
- `smoke:copilot` 增加幂等清理（遗留固定优惠码、巡检配置），可重复执行

---

## [1.18.0] — 2026-10-23

通知分层排版 + 体检一键补全 + 环境故障后的完整 E2E 复验。

### Added
- **按渠道排版**（`copilot-digest-format.ts`）
  - webhook → markdown（飞书/钉钉/企微可渲染列表与加粗）
  - email → HTML 表格（级别/问题/详情三列，按严重度着色）
  - 日志 → 纯文本
  - 三种格式同源数据；HTML 对标题/详情做完整转义（防注入）
- **体检一键补全文案**：`POST /api/copilot/products/backfill-copy`
  - 只补空缺字段（英文标题/长描述/卖点/SEO），已填内容不覆盖
  - 逐条返回结果，单品失败不影响其余；图片与库存仍需人工处理
  - 副驾漏斗弹窗「一键补全文案」按钮，补全后自动刷新体检结果

### Verification（本轮完整执行，环境已恢复）
- 单测 **138/138**（新增 7 例：三种排版格式、HTML 转义、超 10 条截断、渠道映射）
- `npm run lint` 0 问题、双端 `type:check` 0 错误、`npm run build` 通过
- `smoke:copilot` **17 步**全通过（含邮件通道降级、体检、一键补全 2/2）
- `smoke:shopper` 9 步、`smoke:workflows` 16 步、`smoke:providers` 18 步全部通过
- 真浏览器：漏斗弹窗体检面板、巡检设置邮件表单（SMTP 七字段 + 主题模板）渲染正确，控制台无错误

### Fixed
- **补跑 v1.17.0 未执行的 E2E**：Docker Desktop 引擎故障期间跳过的三套冒烟全部补跑通过；
  改用 `embedded-postgres`（仅本地开发依赖）绕过容器环境，验证结论与容器内一致

---

## [1.17.0] — 2026-10-22

SMTP 邮件通知 + 邮件主题模板 + 在售商品批量体检。

### Added
- **SMTP 邮件通道**（`nodemailer@7.0.9`，零运行时依赖，1.7MB）
  - 通知分层重构：`NotifyTransport`（只负责发一次，标注是否可重试）+ `CopilotNotifyService`（重试/熔断编排）
  - 邮件连接/握手/套接字分别 8s/8s/10s 超时；认证类错误（EAUTH/EENVELOPE）判为永久失败不重试
  - 熔断键按通道隔离（不同 webhook / 不同 SMTP 互不影响）
- **邮件主题模板**：支持 `{{count}}` / `{{critical}}` / `{{newCount}}` 占位，默认「【Flow 店铺巡检】N 项待处理（严重 X / 新增 Y）」
- **在售商品批量体检**：`GET /api/products/audit/active?limit=200`
  - 扫描已有 active 商品，返回不合规商品与缺失项（只读，不自动改状态）
  - 副驾漏斗弹窗内「在售商品体检 → 立即检查」可一键列出历史遗留的不完整在售商品
- 巡检设置界面新增邮件通道表单（SMTP 主机/端口/发件人/收件人/账号/密码/SSL/主题模板）

### Verification
- 单测 **131/131**（新增 6 例：主题模板渲染与截断、通知重试/永久失败/熔断隔离、邮件配置校验）
- `npm run lint` 0 问题、双端 `type:check` 0 错误、`npm run build` 通过

### NOT VERIFIED（本轮环境故障，必须复测）
- **端到端冒烟未跑通**：本机 Docker Desktop 引擎在验证阶段异常（`docker ps` 返回 500，Postgres 连接超时），
  `smoke:copilot`（含新增的邮件通道与批量体检断言）、`smoke:shopper`、`smoke:workflows` 本轮**未执行**。
  恢复 Docker 后请依次执行：
  `npm run build && npm run mock:providers` + 应用启动，然后 `npm run smoke:copilot` / `smoke:shopper` / `smoke:workflows`。
- 真实 SMTP 服务器未测试（仅配置校验路径与单测覆盖）

---

## [1.16.0] — 2026-10-22

通知可靠性（重试 + 熔断）与草稿上架门禁。

### Added
- **通知重试与熔断**（`copilot-notify-retry.ts` 纯函数 + `CopilotNotifyService` 集成）
  - 指数退避重试：默认 3 次，间隔 400ms → 800ms，上限 4s
  - 4xx（除 429）判定为永久失败，不重试（避免对着错误配置反复打）
  - 连续失败 3 次熔断该通道 5 分钟，冷却后自动 half-open 重试；熔断状态写入巡检摘要
- **草稿商品上架门禁**（`product-publish-check.ts`）
  - 6 项 fail-closed 校验：中英文标题 / 商品图 / 售价 > 0 / 库存 > 0 / 描述 / 分类
  - `PATCH /api/products/:id {status:'active'}` 未通过返回 400 并列出缺失项
  - `GET /api/products/:id/publish-readiness` 供前端在编辑弹窗内实时展示检查清单
  - 商品管理页状态开关失败时展示后端原因（此前只 console.error，点了没反应）

### Verification
- 单测 125/125（新增 11 例：退避序列/熔断状态机/成功重置、上架门禁 6 项规则与提示）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `smoke:copilot` 14 步（新增：缺图零库存被拒 → 补齐后通过 → active）、`smoke:shopper` 9 步、`smoke:workflows` 16 步全通过
- 真浏览器：商品编辑弹窗显示"上架检查：1 项待补齐"及逐项 ✓/✗ 与修复提示，控制台无错误

---

## [1.15.0] — 2026-10-22

巡检通知外发 + 草稿商品 AI 补全 + 多副本互斥实测。

### Added
- **巡检通知**：`CopilotNotifyService`（零新依赖，原生 fetch）
  - `POST` JSON `{text, msgtype, content:{text}}`，同时兼容飞书 / 企业微信 / 钉钉 / Slack 的文本消息格式
  - `notifyKind`（none|webhook）/ `notifyUrl` / `notifyOnlyOnNew`（默认 true，无新增不打扰）
  - 8 秒超时；发送失败返回原因并降级为"通知未发送"，**绝不影响巡检主流程**
- **草稿商品 AI 补全**：批准 `create_draft_product` 后自动调 CopywriterAgent
  - 生成英文标题 / 卖点 / 长描述 / SEO 关键词并写回草稿
  - 模型未配置或调用失败时诚实提示，商品仍会创建（降级不阻断）
- 前端：巡检设置新增「通知渠道 / Webhook 地址 / 仅新增时通知」控件
- 验证脚本：`npm run verify:watch-mutex`（两个实例同库并发 8 次巡检，断言仅 1 次执行、7 次被互斥跳过）

### Verification
- 单测 114/114（新增 5 例：通知未配置/非法地址/成功载荷/上游 5xx/网络异常）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `smoke:copilot` 13 步（新增：webhook 真实推送 + 草稿 AI 文案断言）、`smoke:shopper` 9 步、`smoke:workflows` 16 步全通过
- `verify:watch-mutex`：并发 8 次 → 执行 1 次 / 跳过 7 次，快照与锁释放均正确
- 真浏览器：巡检设置显示通知渠道下拉、Webhook 输入、仅新增开关，控制台无错误

---

## [1.14.0] — 2026-10-22

定时巡检（零新依赖）+ 缺口一键建草稿 + 商品级漏斗。

### Added
- **定时巡检**：`CopilotWatchService`（Node 原生定时器，不引入 `@nestjs/schedule`）
  - `GET/PUT /api/copilot/watch`（enabled / intervalMinutes 5-1440），`POST /api/copilot/watch/run` 手动触发
  - 跨实例互斥：`ai_settings` 单行 `UPDATE ... WHERE updated_at < now() - lease` 原子租约
  - 只对**新增**告警生成摘要（`diffNewInsights`），避免每轮重复提醒；摘要写日志，通知渠道留待接入
- **缺口一键建草稿**：`POST /api/copilot/shopper-demand-gaps/draft` 生成 `create_draft_product` 待确认动作
  - 新增副驾工具 `create_draft_product`（第 12 个工具，写操作，审批后创建 draft 商品）
  - 批准前不落任何商品；批准后状态为 `draft`，价格/标题为占位值需人工补全
- **商品级漏斗**：`GET /api/copilot/shopper-product-funnel?days=30`
  - 每商品推荐/加购/下单会话数与加购转化率；下单阶段按 `order_items` + 会话归属联真实订单
  - 导购工具结果新增 `productIds`，详情查看也计入"被推荐"
- 前端：漏斗弹窗新增「商品级漏斗」表格与缺口「建草稿」按钮；巡检设置新增定时巡检开关/间隔/立即执行

### Verification
- 单测 109/109（新增 7 例：巡检摘要 diff、商品级漏斗转化率/空数据/除零）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `smoke:copilot` 13 步（新增定时巡检与建草稿）、`smoke:shopper` 9 步（新增商品级漏斗）、`smoke:workflows` 16 步全通过
- 真浏览器：漏斗弹窗显示需求缺口（含建草稿按钮）与商品级漏斗表格；巡检设置显示定时巡检开关，控制台无错误

---

## [1.13.0] — 2026-10-22

需求缺口闭环：导购零结果搜索 → 卖家可分析 → 选品 Agent 真实需求输入。

### Added
- **零结果搜索记录**：`search_products` 返回 0 条时记 `search_miss` 阶段（不再算作 `recommended`），含关键词、会话、时间
- **需求缺口接口**：`GET /api/copilot/shopper-demand-gaps?days=90&limit=10`，按搜索次数降序返回词/次数/去重人数/最近时间
- **副驾漏斗面板**新增「需求缺口」区块：每条缺口带「让副驾分析」一键把缺口交给副驾
- **选品 Agent 接入真实需求**：`SelectService` 生成建议前自动读取近 90 天零结果词并注入提示词，优先推荐本店真实未成交需求
- 副驾工具结果新增 `resultCount`，用于区分"有结果"与"零结果"（不影响模型可见文本）

### Verification
- 单测 102/102（新增 3 例：缺口排序/空关键词过滤/limit 裁剪）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `smoke:shopper` 8 步（新增：零结果搜索 → 缺口出现）、`smoke:copilot` 11 步、`smoke:workflows` 16 步全通过
- 真浏览器：漏斗弹窗显示缺口「机械键盘… 1 次 · 1 人」与「让副驾分析」入口，控制台无错误

---

## [1.12.0] — 2026-10-22

巡检可配置化 + 导购转化漏斗。

### Added
- **巡检阈值可配置**：4 项阈值（低库存 / 退款超时 / 未支付超时 / 未签收天数）存入 `ai_settings`，副驾侧栏「巡检设置」可视化调整
  - `GET/PUT /api/copilot/insights/thresholds`；逐字段区间校验，非法 JSON/越界值回退默认（fail-safe）；变更写审计
- **导购转化漏斗**：`shopper_events` 记录 viewed / recommended / cart_confirmed，下单阶段联真实订单（登录按 userId、匿名按订单快照 sessionId）
  - `GET /api/copilot/shopper-funnel?days=30`：四阶段去重会话数 + 逐级转化率 + 整体转化 + 买家热搜词 TOP 10
  - 副驾侧栏「导购漏斗」面板：条形漏斗 + 热词标签
- 迁移 `0005_shopper_funnel.sql`（`shopper_events` 表 + 3 个索引）

### Verification
- 单测 99/99（新增 10 例：阈值合并/裁剪/脏数据回退、漏斗转化率/空数据/热词过滤/days 裁剪）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `smoke:copilot` 11 步（新增阈值保存→生效→越界拒绝→复原）、`smoke:shopper` 7 步（新增漏斗四阶段含真实订单）、`smoke:workflows` 16 步全通过
- 真浏览器：巡检设置弹窗保存生效；导购漏斗弹窗四阶段与热词正确渲染，控制台无错误

---

## [1.11.0] — 2026-10-22

新增 **买家端 AI 导购**：与卖家副驾共用 Agent 框架，工具集物理隔离。

### Added
- `server/modules/shopper/`：买家侧工具调用 Agent（5 个工具：搜索 / 分类 / 详情 / 我的购物车 / 加购）
  - `shopper-tools.ts`：独立注册表，与卖家 11 个工具零交集；`add_to_cart` 为唯一写工具
  - `shopper-tool.service.ts`：只读查询 + 加购（复用 `CartService`，库存校验与原逻辑一致）
  - `shopper.service.ts`：ReAct 循环（≤5 步）、加购待确认、匿名 session 归属
- `GET/POST /api/shopper/*`：工具目录、会话、消息、动作确认（匿名可用，按 `x-session-id` 隔离）
- 前端 `ShopperWidget`：买家全站右下角浮窗（多语言 4 语、快捷问题、加购确认卡片、会话恢复）
- 数据库：`copilot_conversations.channel`（seller / shopper）+ `session_id`，`copilot_actions.session_id`（迁移 `0004_shopper_channel.sql`）
- 联调：mock LLM 新增导购确定性决策；`scripts/smoke-shopper.mjs` + `npm run smoke:shopper`

### Security
- 买家工具集与卖家工具集分离注册，导购侧查询卖家工具名直接拒绝（单元测试断言零交集）
- 加购同样走人工确认，未确认前购物车不变
- 匿名会话按 sessionId 归属，其他 session 访问返回 404

### Verification
- 单测 89/89（新增 9 例：工具隔离、加购待确认、确认执行、越权、未配置降级）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `npm run smoke:shopper` 6 步、`npm run smoke:copilot` 10 步全通过
- 真浏览器验收：首页浮窗打开、推荐链路、加购确认后购物车真实增加、控制台无错误

---

## [1.10.1] — 2026-10-22

新增 **AI 运营副驾（Copilot）**：把 AI 从"生成内容"推进到"执行运营"，写操作强制人工审批。

### Added
- `server/modules/copilot/`：工具调用 Agent（ReAct，单轮 ≤6 步）+ 人工审批门禁
  - `copilot-tools.ts`：11 个工具注册表（5 只读 + 6 写），参数声明类型/枚举/范围/正则/长度
  - `copilot-protocol.ts`：模型输出协议解析（工具调用 / 最终答复）、工具目录生成、历史折叠
  - `copilot-tool.service.ts`：读工具查询；写工具全部委托既有领域服务（订单状态机 / 退款审批 / 商品状态 / 优惠券 / 咨询）
  - `copilot.service.ts`：循环编排、待审批动作落库、审批执行与越权校验
- 数据库：`copilot_conversations` / `copilot_messages` / `copilot_actions`（迁移 `0002_copilot_workbench.sql` / `0003_copilot_batch.sql`）
- 前端：`/seller/copilot` 运营副驾页（多会话、快捷指令、工具执行折叠展示、待确认动作卡片、批准/拒绝）
- **多步计划执行**：同一轮生成的多个写动作共享批次号，卖家「批准整批」按序执行、失败即停；左侧常驻「店铺巡检」面板（低库存 / 超时退款 / 未支付订单 / 长期未签收），点一条即可让副驾接手
- 共享类型：`CopilotConversation` / `CopilotMessage` / `CopilotAction` / `CopilotBatchResolveResult` / `CopilotInsight` 等
- 联调：mock LLM 新增副驾确定性决策；`scripts/smoke-copilot.mjs` + `npm run smoke:copilot`

### Security
- 写工具在模型循环内**永不执行**，只落 `pending` 动作；仅会话所有者可批准，重复审批/越权均拒绝
- 未知工具名、未知参数、越界取值在执行前拒绝，避免模型幻觉触达业务服务
- 全部副驾端点为 seller/admin（买家 403）

### Known issues
- `npm run dev:server` 已从 `tsx watch` 改为 `tsc --watch` + `node --watch`（tsx 不产出发射型装饰器元数据，导致 Nest 依赖解析失败）；如仍遇 ESM-only 依赖问题，可回退 `tsx watch server/main.ts` 并显式使用 `@Inject(...)`

### Verification
- 单测 80/80（新增 28 例：协议解析、参数校验、审批门禁、越权、降级、批次顺序执行与失败即停）
- `npm run lint` / `npm run type:check` / `npm run build` 全绿
- `npm run smoke:copilot` 10 步（读工具 → 待审批 → 批准执行 → 拒绝无副作用 → 巡检识别低库存 → 多步计划整批执行 → 越权 403）
- 既有 `smoke:providers` 18 步、`smoke:workflows` 16 步全部通过
- `npm run dev:server` 启动验证（health 200）；真浏览器验收副驾页（巡检面板、待确认卡片、整批批准、控制台无错误）

---

## [1.9.0] — 2026-10-15

收尾：移动端适配、错误可观测、地址簿接线、自动化截图与演示视频。

### Added（展示资产 · 全部自动化生成）
- `scripts/capture/screenshots.mjs` + `npm run capture`：Puppeteer 全页截图（1440 宽，本机 Chrome 复用，不下载浏览器）
- `scripts/capture/record-demo.mjs` + `npm run capture:video`：CDP screencast 抓帧 → ffmpeg 合成 **90 秒演示视频**（1280×720 H.264）与 README 内联 GIF
- `scripts/capture/seed-demo.mjs`：截图/录屏专用演示数据（6 个带图商品、6 笔订单含 1 笔待审批退款、3 个首页楼层集合、3 张优惠券、2 个 CMS 页面、评价/咨询/地址/收藏/购物车/审计）
- `client/public/demo/*.png`：演示商品图（此前无图，截图中商品是灰色占位块）
- **截图从 16 张扩到 27 张**：补齐此前从未被截图的集合楼层、集合详情、收藏、地址、优惠券、退款、运费模板、集合管理、CMS、审计日志；全部为 **Flow** 新品牌
- `docs/social-preview.png` 重制为新品牌（原图是旧 GlobalEcom 横版 logo，且内容是 JPEG 伪装成 .png）

### Fixed
- **地址簿接口契约错位**（既有 bug）：`getAddresses()` 读 `data.items`，后端实际返回裸数组 → `undefined.length` 使 `/addresses` 与 `/checkout` 白屏崩溃；现做形状兼容
- **结算页不复用地址簿**：地址簿全站无入口（`/addresses` 无任何链接指向）且结算页不读取已存地址 → 买家端用户菜单与移动端抽屉加入口；结算页自动预填默认地址并支持一键切换
- **移动端完全无导航**：买家端 `<768px` 导航/搜索/卖家中心全隐藏，卖家端侧栏写死 `w-60` 导致手机不可用 → 两端均接入 `Sheet` 抽屉导航
- **21 处错误被静默吞掉**：`catch` 只 `console.error`，用户看到"空列表/点了没反应/加载不出"，把网络故障伪装成无数据 → 新增统一 `notifyError`，11 个页面补齐用户可见反馈；地址页区分"加载失败"与"确实为空"
- `AICenterPage` 的 Agent 弹窗缺高度约束（小屏保存按钮被推出视口）
- `CmsPageView` 用原生 `<a href="/">` 导致整页刷新丢 SPA 状态 → 改用 `<Link>`
- `ChatWidget` 滚动失效（`ScrollArea` 的滚动容器是 viewport，设 `scrollTop` 无效）→ 改用 `scrollIntoView`
- 买家端「申请退款」按钮无状态门控（待付款/已取消也能点）且提交后无成功反馈
- `client/src/App.tsx` 与 `app.tsx` 大小写重复（Linux CI 下有导入歧义）
- `<html lang>` 静态写死 `zh` 且默认语言为 `en`，现按语言运行时同步；默认语言改为跟随浏览器

### Changed（i18n 收口）
- 新增 `t.address.*`（46 键 × 4 语，此前地址页 236 个中文字符零 i18n）与退款相关文案（`requestRefund` / `refundSubmitted` / `common.lastUpdated`）
- 新增 `client/src/utils/locale.ts`：`getLocale` / `formatDateTime` / `formatDate` / `pickLocalized`（类目·集合·CMS 内容仅中英双语，西/葡统一回退英文，行为显式可预期）
- 新增 `client/src/lib/error-feedback.ts`：统一错误出口（含后端 message 提取）

### Verification
- lint 0 问题 / 双端 strict typecheck 0 错误 / 单测 52/52 / 构建通过
- 全新 compose 部署 healthy
- 截图脚本可复跑（27/27 成功）；视频 1 分 10 秒、1.8MB、ffmpeg 校验无错误

---

## [1.8.0] — 2026-10-15

品牌更名 **GlobalEcom AI → Flow**（更简短好记），并修复全量审查发现的问题。

### Changed
- **产品更名**：用户可见品牌统一为 **Flow**（`Flow — 让跨境生意更简单`），仓库名与远程地址保持不变
  - 界面：页头/侧栏 logo alt、首页 hero、登录注册页、页脚公司/入驻文案、版权行
  - 标识符：Cookie `globalecom_auth`→`flow_auth`、`globalecom_oauth_state`→`flow_oauth_state`；localStorage `globalecom_*`→`flow_*`（user / session_id / language / last_visit_date）；JWT 开发默认密钥 → `flow-dev-*`
  - 工程：package 名 `globalecom-ai`→`flow`（含 lockfile）、Docker 容器名与默认库/用户/密码 `globalecom*`→`flow*`（仍可用环境变量覆盖，不破坏既有部署）、CI 与 `.env.example`、`drizzle.config.ts` 默认连接串同步
  - 文档：README / AGENTS / CONTRIBUTING / SECURITY / LICENSE / docs 全部更新

### Fixed
- **`client/index.html` 残留模板占位**：`JSON.parse('{{{__platform__}}}')` 未被构建替换，每次页面加载都抛错（且全仓无任何使用方）→ 删除该段脚本
- **favicon 生产环境 404**：`<link rel="icon">` 指向源码路径 `/src/assets/branding/logo-icon.png` → 改为 `/favicon.svg`（已在 `client/public/` 中并正确打包）

### Docs
- `AGENTS.md`：修正过期技术栈（NestJS 10 → 12 / Express 5 + strict）；补齐模块清单（集合详情、退款管理、CSV 导入、运营楼层）；**更正数据库表清单**（原文档列出的 `product_images`、`shop_settings` 并不存在，现按 schema 实际 35 张表分组列出）；新增 AI 配置优先级、无 Key 降级、自定义 Agent、模型适配要点与验证入口
- `.gitignore`：补充 `.serena/`、浏览器截图 profile 与本地验证残留

### Verification
- `npm ci`（包名变更后重装）→ lint 0 问题 → 双端 strict typecheck 0 错误 → 单测 52/52 → 构建通过
- 全新 compose 部署 healthy → 三条冒烟全过：`smoke-workflows` 16 步 / `smoke-ai-degraded` 6 步 / `smoke` 19 步
- 无头浏览器复核首页与集合详情：品牌名渲染正确、favicon 200、无控制台报错

---

## [1.7.1] — 2026-10-15

真实大模型实测：五 Agent 全链路对接国产模型（云知声 u2-flash）跑通，修复思考型模型适配。

### Fixed（真实模型实测暴露）
- **思考型模型输出被截断**：reasoning 类模型（云知声 u2-flash / DeepSeek-reasoner 等）先输出大段思维链，原 max_tokens（1500）下正文尚未开始即被截断（`finish_reason=length`、`content` 为空）。网关现按模型名自动将思考型模型的预算提升至 ≥6000，各 Agent 仍只声明"答案需要多少 token"
- **响应字段差异容错**：部分网关把正文放在 `reasoning_content` / `output_text` / `text` 而非 `content`，网关按 `content → reasoning_content → output_text → text` 顺序取首个非空值
- 截断错误信息明确化：区分"被 max_tokens 截断（建议提高预算或改用非思考模型）"与"返回为空"

### Verified（真实模型端到端，非 mock）
使用本地直连的国产模型端点（OpenAI 兼容）完成实测：
- 连通测试：`{"ok":true,"model":"u2-flash"}`
- **商品文案**：生成专业英文标题 + 5 条卖点（结构化 JSON 正确解析）
- **多语言翻译**：中→日准确（"この折りたたみウォーターカップは…"）、中→西准确
- **智能客服**：正确引用店铺政策（30 天无理由退换），三层检索生效
- **选品建议**：基于类目+热销数据输出 6 个差异化选品方向
- **趋势分析**：基于真实 SQL 聚合输出 2061 字报告，落库且历史可回看
- **用量统计**：9 次调用按 Agent 分别入账（token/成功率真实计量）

---

## [1.7.0] — 2026-10-15

买家端运营楼层 + 集合详情页：卖家建的集合真正出现在前台。

### Added
- **首页运营楼层**：卖家标记为「首页推荐」的集合自动成为首页楼层，横向滚动展示集合内商品（一次查询取回集合+商品+变体，不随集合数增长）
  - 楼层标题/描述按当前语言自动切换（zh/en/es/pt）
  - 楼层右上角「查看全部」进入集合详情
- **集合详情页**（`/collections/:slug`，买家公开）：渐变头部 + 集合信息 + 全部上架商品网格，支持收藏
- 后端公开端点：`GET /api/collections/storefront`（楼层）、`GET /api/collections/by-slug/:slug`（详情）、`GET /api/products/by-ids?ids=`（批量商品）
- 商品图优雅占位：空图或加载失败时展示占位图形，取代破图图标（全站商品卡受益）

### Changed
- 首页数据加载合并为一次并发请求（分类、热销、新品、楼层），并统一收藏状态批量查询
- 楼层/详情复用 `ProductsService` 的完整商品映射（含变体），确保楼层商品可直接加购

### Verification
- `smoke-workflows` 扩至 16 步并覆盖楼层/详情/批量商品（含"楼层商品必须是含变体的完整对象"断言）
- 视觉验收：无头浏览器截图核对首页楼层与集合详情页渲染（含无图商品的占位降级）

---

## [1.6.0] — 2026-10-14

全工作流实测：把"跑不通的工作流"逐个跑通（16 步端到端 + 5 个真实断裂点修复）。

### Fixed（真实断裂点，均由端到端冒烟暴露）
- **商品集合模块从未被注册**：`CollectionsModule` 不在 AppModule，`/api/collections/*` 全部 404，卖家集合页与首页运营楼层完全不可用
- **集合契约错位**：后端/数据库用 `titleZh/titleEn/descriptionZh/coverImage`，shared 契约与前端却用 `name/description/image`，卖家"新建集合"必然 400
- **CMS 契约错位**：数据库为双语 `title_zh/title_en/content_zh/content_en/is_published`，而服务层 DTO、shared 契约、买卖两端页面全用单语 `title/content/status/isPublic`，CMS 页面创建必然 400，买家页字段也不存在
- **CMS 列表过滤与搜索失效**：前端传 `status=draft|published` + `keyword`，后端只认 `isPublished` 且不支持 keyword，发布态筛选与搜索框形同虚设
- **CSV 批量导入必然失败**：`cover_image` 为 NOT NULL，导入却写 null → 全事务回滚，所有行报"数据库写入失败"
- **界面建商品无法下单**：界面创建只填价格/库存不建变体，而购物车/下单走变体 → 库存扣不动；同时界面编辑的价格/库存被静默丢弃
- **购物车迁移码恢复 500**：`ON CONFLICT (session_id, product_id, variant_id)` 无对应唯一约束，跨设备购物车恢复（README 宣传能力）必然 500
- **登录合并购物车 500 且丢规格**：同样 ON CONFLICT 问题，且并入时丢弃 `variantId`

### Added
- `scripts/smoke-workflows.mjs`（16 步、零凭据依赖）：认证/购物车/收藏/地址/商品(含变体)/CSV/搜索/履约/物流/评价/集合/CMS/咨询/看板/审计/越权拦截，全部端到端断言；CI 中与降级冒烟、业务冒烟、渠道冒烟同实例执行
- 商品创建 DTO 支持 `variants`（嵌套校验）；无变体时自动生成默认变体，与 CSV 导入口径一致
- 界面编辑商品的价格/库存同步到（唯一）变体并重算聚合库存；无变体商品自动补建
- CMS 列表支持 `status`（published/draft）与 `keyword`（中英标题+slug）过滤；买家 CMS 页按当前语言择一渲染

### Verification
- `smoke-workflows` 16/16 ALL PASSED；`smoke` 19/19；`smoke-ai-degraded` 6/6；`smoke-providers` 18/18；单测 52/52；lint 0；双端 strict TS 0 错误

---

## [1.5.1] — 2026-10-14

Key 全凭商家自选：多服务商预填、无 Key 全功能照常运行（并用冒烟钉死）。

### Added
- 模型设置新增**服务商一键预填**：DeepSeek / 通义千问 / 智谱 GLM / OpenAI / 火山方舟（Key 用商家自己的账号；也可手填任意 OpenAI 兼容端点）
- `scripts/smoke-ai-degraded.mjs` + CI 步骤：在**无任何模型 Key** 的实例上验证——AI 端点统一诚实拒绝（含计量如实记录失败）、设置与 Agent 管理可用、核心交易闭环照常（CI 中与 19 步业务冒烟同实例执行）
- 买家侧客服组件未配置时禁用输入并显示「智能客服暂未开放」（四语言）

### Fixed
- **非 v1 版本路径服务商被拼错端点**：网关由"总是追加 /v1/chat/completions"改为智能组装（`buildChatCompletionsUrl`）——智谱 `/api/paas/v4`、火山方舟 `/api/v3`、通义 compatible-mode 等路径现在都能正确拼出 `/chat/completions`（R14 契约测试 4 组 10 断言）

### Verification
- 单测 52/52；无 Key 降级冒烟 6/6 ALL PASSED + 同实例 19 步业务冒烟 ALL PASSED；providers 18 步回归 ALL PASSED；compose 部署回归通过

---

## [1.5.0] — 2026-10-14

模型配置自有化 + 自定义 Agent：卖家在界面里填模型、建自己的 Agent，未配置时全站诚实提示。

### Added
- **模型设置（界面配置）**：卖家工作台「AI 分析中心 → 模型设置」填写 Base URL / API Key / 模型名；保存即生效（网关按调用解析配置，无需重启）；Key 永不明文回显（掩码 `sk-****1234`）；支持一键清除回退；「测试连通」真实调用模型并回显上游 HTTP 状态（401=Key 错 / 404=BaseURL 或模型名错）
- **配置优先级**：界面设置（DB）> 环境变量（引导默认值）> 未配置；字段级合并；变更写审计（只记掩码）
- **自定义 Agent**：任意数量用户自建 Agent（系统提示词 + `{{input}}` 模板渲染 + 文本/JSON 输出 + temperature/maxTokens + 启停），创建后可立即试跑；JSON 模式自动解析；用量独立入账（`custom:<slug>`）并出现在用量统计
- 内置 5 个 Agent 在「我的 Agent」中只读展示（各带专属数据管线），与自定义 Agent 并列
- 统一诚实提示 `LLM_NOT_CONFIGURED_MESSAGE`：未配置时所有 AI 端点、卖家横幅、客服组件使用同一文案口径——「请填写模型」，绝不返回假数据
- `ai_settings` / `ai_agents` 两张表 + 迁移 `0001`；settings/agents 接口全部 seller 鉴权

### Changed
- AI 网关重构：配置从构造期缓存改为按调用解析（`resolveConfig`，纯函数 `resolveLlmConfig` 承载优先级逻辑并有单测锁定）
- 上游失败信息回显 HTTP 状态，便于在模型设置页定位问题
- 买家侧客服组件未配置时保持既有"配置中"提示（不引导买家去配置）

### Verification
- 单测 48/48（新增：配置优先级/掩码/模板渲染 R12、网关诚实拒绝 R13）
- `smoke-providers` 扩至 18 步 ALL PASSED：模型设置链路（env→db→掩码→连通测试→清除回退）、自定义 Agent 全生命周期（创建→模板贯穿→JSON 解析→用量入账→停用拒绝→删除）+ 原有 5 Agent 与 Stripe/PayPal 钱链路

---

## [1.4.0] — 2026-10-14

渠道联调闭环：内置本地渠道模拟器，AI 与支付链路在无真实凭据下完成全链路实测。

### Added
- `scripts/mock-providers.mjs` 本地渠道模拟器（联调/CI 专用，非生产代码）：同时扮演 Stripe（payment_intents / refunds）、PayPal（oauth token / checkout orders / captures refunds）与 OpenAI 兼容 LLM，并支持以**真实 HMAC 签名**回调应用的 Stripe webhook
- `scripts/smoke-providers.mjs` 渠道全链路冒烟（13 步）：五个 AI Agent（文案 JSON / 翻译 / 选品 / 趋势落库回看 / 客服会话落库 / 用量统计 5/5 入账）+ Stripe（intent → 签名 webhook 幂等入账 → 全额退款渠道调用）+ PayPal（下单 → capture 退款出款，含金额/币种/Bearer 断言）
- CI 新增 `providers` job：Postgres service + 模拟器 + 应用 + 全链路断言，每次提交自动执行
- `STRIPE_API_BASE` / `PAYPAL_API_BASE`：API 基址覆盖（对接代理或联调环境；默认官方地址，生产安全性不变）
- PayPal 证书拉取抽为 `loadWebhookCert` protected 缝：单测注入本地密钥对覆盖验签全路径（篡改/证书域注入/缺头/错算法/多场景），生产仍只信任 PayPal 官方域
- 共享 `parseLlmJson`（剥离代码围栏 + 502 明确报错），SelectAgent 补上此前缺失的容错解析

### Fixed
- **支付流水"pending 与 paid 并存"**：渠道预建 pending 流水（Stripe intent / PayPal order）在 webhook 入账时就地升级为 paid（由模拟器真实回调链路暴露）
- 模拟 LLM 分类器对 select 提示词的误判（上下文数据含 `titleEn` 字样，改用各 Agent 独有输出字段判别）

### Verification
- 单测 37/37（新增 PayPal 验签 R10 / 退款 R11 契约）
- `smoke-providers` 13 步 ALL PASSED；常规 19 步冒烟与 compose 部署回归不受影响

---

## [1.3.0] — 2026-10-14

技术债清算与现代化：类型安全基线、测试纵深、依赖升级、CI 强化。

### Added
- 双端 TypeScript strict 模式全量开启（服务端修复 32 处空值收窄/类型建模问题，客户端零存量问题）
- 单元测试扩展至 30 例：订单状态机（合法/非法迁移矩阵）、Stripe webhook 验签（自签 HMAC：篡改/过期/轮换多签名/缺字段）、优惠券折扣口径（percent 舍入/fixed/封顶/浮点）
- 覆盖率工具链（@vitest/coverage-v8），CI 上传 lcov 产物（纯逻辑模块 100%；数据库链路由 19 步端到端冒烟覆盖）
- 优惠券批量生成端点（POST /api/coupons/generate-bulk，此前服务层方法无路由）
- 端到端冒烟从 13 步扩到 19 步：优惠券闭环、取消订单库存/券量回补、非法状态迁移拒绝、游客下单（session 归属）、累计退款上限、全退款库存/销量/积分对账
- i18n：买家端新增「运费/积分」文案补齐 zh/en/es/pt 四语；买家头部展示会员积分

### Changed
- 依赖升级：NestJS 10 → 12（Express 5）；@nestjs/{common,core,platform-express,jwt,throttler,axios} 全部升级至兼容最新版
- 请求校验：cart（增改/迁移码）、reviews、payments、coupons（建/改/校验/批量）接入 class-validator DTO（配合全局 ValidationPipe 的 whitelist/forbidNonWhitelisted 真正生效）
- 退款状态机：partially_refunded 订单允许继续申请剩余退款（申请与审批两端均执行累计上限校验，fail fast）
- 订单状态迁移判定抽为纯模块 `order-status.ts`；优惠券折扣抽为纯模块 `coupon-discount.ts`
- 优惠券/退款控制器客户端 IP 统一取 `req.ip`（反代场景由 TRUST_PROXY 控制），不再直接信任 XFF

### Removed
- 死依赖：@nestjs/swagger、@nestjs/config、@tanstack/react-query、pg、@types/pg（全库零引用）

### Verification
- `npm ci`（全新 lockfile）→ lint 0 错误 → 双端 strict typecheck 0 错误 → 30/30 单元测试 → 完整构建
- 对全新数据库执行迁移后跑 19 步冒烟：ALL PASSED（Nest 12 / Express 5 运行时验证，含静态托管与中间件链路无回归）

---

## [1.2.0] — 2026-10-14

全量重构：修复不可运行的生产路径，补齐支付/退款闭环，安全基线落地，文档与实现对齐。

### Fixed（阻断级）
- `npm ci` / `npm install` 干净检出即可安装（升级 react 19 不兼容的 Radix 老版本；lockfile 重建为公共 registry）
- 编译产物启动路径修复（入口 `dist-server/server/main.js`；消除运行时无法解析的路径别名）
- Docker 镜像可构建（`npm ci` 多阶段；Debian 基础镜像避免 bcrypt 原生编译问题）；容器同进程托管前端（SPA 回退）与 `/api/health`
- 生产环境浏览器端 API 全部可用（统一单层 `/api` 前缀，移除 `/api/api` 双前缀；`VITE_API_BASE_URL` 语义修正）
- 数据库迁移机制（`scripts/db/migrate.mjs` + `drizzle/` 迁移文件，启动时自动执行；不再依赖 `drizzle-kit push`）
- `orders.user_id` 允许为空（游客结算此前必然违反非空约束）
- 卖家看板裸 SQL 列名修复（`_created_at` → `created_at`，此前运行时必报错）
- 退款申请查询 enum 列误用 ILIKE 修复；订单关键词搜索 uuid 列 ILIKE 修复

### Added（真实性补齐）
- Stripe webhook 端点（`/api/payments/stripe-webhook`）：时间戳容忍 + 恒定时间签名比较 + 幂等入账
- PayPal 真实退款（`POST /v2/payments/captures/{id}/refunds`）；移除"伪造退款成功"的占位逻辑
- 统一支付入账 `markOrderPaid`：demo / Stripe / PayPal / 卖家手动标记共用；按渠道流水号幂等；销量改为支付成功时累计
- 运费接入结算：服务端按运费模板重算（重量/件数/满额包邮/特殊地区），买家结算页展示报价
- AI 客服对话会话落库（卖家「咨询管理」可回看）；TrendAgent 报告落库 + 「AI 分析中心 → 历史报告」回看
- 访客统计：`visits` 埋点 + 看板按浏览器会话去重（取代"咨询会话数"伪口径）
- 会员积分：支付成功按 1 美元 1 分累计，退款按金额回滚，`/api/auth/me` 返回
- pg_trgm GIN 索引（商品标题模糊搜索真正走索引）；翻译支持泰文（12 种语言与文档一致）
- 演示数据种子（`SEED_DEMO_DATA=true`）：演示卖家/买家/商品/优惠码 TEST10 自动写入
- 单元测试（Vitest）：订单金额、退款金额判定、运费规则；CI 增加真实端到端冒烟 job（Postgres service + 下单/支付/退款全链路断言）
- `TRUST_PROXY`（反代下真实客户端 IP）、`COOKIE_DOMAIN`、`SELLER_REGISTRATION_CODE`（卖家注册邀请码；未配置则禁止卖家自助注册）、`CORS_ORIGINS` 生效

### Changed
- 安全：CSRF 中间件真正注册（webhook 白名单豁免）；登录/注册 5 次/分、AI 公开端点 10 次/分限流；移除可被 XFF 伪造绕过的内存限流；Google OAuth 增加 state 校验
- 订单状态机：仅允许合法迁移（如 pending_payment → paid/shipped 之外一律拒绝）
- 退款：部分退款必须向渠道传递明确金额（修复"按金额部分退款实际全额退"的账实不符）；累计退款不得超过支付金额；整单退款才回补库存
- 认证 DTO（class-validator）：注册/登录与 AI 端点请求现在会被真实校验（此前 ValidationPipe 因缺少 DTO 类而形同虚设）
- 配置加载：`dotenv` 在进程启动最早阶段加载；JWT 密钥校验延迟到依赖注入阶段（消除 `.env` 读取顺序问题）
- ESLint：启用 react-hooks 规则；修复全部历史 lint 错误（仓库首次 `eslint .` 零错误）

### Removed
- 死代码：orders 内两套重复退款实现、Fulfillment/Notes 无路由方法（约 320 行）、`EMBEDDING_*` 残留配置、重复 axios 拦截器、未使用的 `@nestjs/config` 注入
- 假路径：`drizzle-kit push` 启动脚本、"npx 在线拉取"占位

### Migration Notes
- 1.2.0 起数据库结构由 `drizzle/` 迁移管理：`npm run db:migrate`（或启动时自动执行）。此前用 `db:push` 管理的旧库请先备份；`sold` 销量口径改为"支付时累计"，历史数据不追溯。
- 卖家自助注册默认关闭：维护演示环境请在 `.env` 配置 `SELLER_REGISTRATION_CODE` 或使用 `SEED_DEMO_DATA=true`。

### Verification
- `npm ci`（干净检出）→ `npm run lint`（0 错误）→ `npm run type:check`（双端 0 错误）→ `npm run test`（15/15 通过）→ `npm run build`（服务端 + 前端）
- `docker build` 成功；`docker compose up` 后全链路冒烟通过（注册 → 运费报价 9.00 → 下单 39.00 → 演示支付 → 部分退款，13 项断言全部通过）

---

## [1.1.1] — 2026-10-09

死代码全量剥离 & 飞书依赖清除 — 每行代码经前向追踪，零无用声明残留。

### Changed
- README 架构图与技术栈：移除 `pgvector` 向量检索相关描述（已确认 `EmbeddingService` 全无用）
- `docker-compose.yml`：Postgres 镜像 `pgvector/pgvector:pg16` → `postgres:16-alpine`
- `docker/postgres/init.sql`：移除 `CREATE EXTENSION vector`
- `server/database/database.provider.ts`：注入 `ConfigService` 读 `DATABASE_URL`，修复 env 顺序启动崩溃

### Removed（经 grep 全项目前向追踪确认无引用）
- `server/modules/embedding/` — `EmbeddingService` 空壳（`isReady()` 永返 false，向量检索永返 `[]`）
- `server/modules/hello/` — 占位示例模块
- `server/modules/view/` — 脚手架 catch-all 路由
- `client/src/pages/ExamplePage/` — 全部注释掉的死文件
- `shared/api.interface.ts` 中 `ShopFAQ` 类型 — 从未引用
- 数据库死表：`productEmbeddings`、`inquiries`（已被 `inquirySessions`+`inquiryMessages` 取代）
- 前端 8 个从未被调用的 API 函数：买家侧 inquiry 会话、分类管理 CRUD、Google OAuth 状态、支付记录查询
- `client/src/index.tsx` 重复 `<Toaster>`
- 58 处前端 `console.info` 噪音日志

### Verification
- `tsc -p tsconfig.json` → 0 errors
- `tsc -p tsconfig.app.json` → 0 errors
- `vite build` → ✓ built in 1.73s (3019 modules)

---

## [1.1.0] — 2026-10-01

开源发布准备：文档体系全面对标成熟开源项目，项目转为 **MIT License** 开源。

### Added
- **MIT LICENSE**：项目正式开源（此前为"仅展示、版权归公司"）。
- **README 全面重写（中英双语）**：新增产品 Hero（品牌 Logo）、产品截图展示区（16 张页面截图随仓库分发，收录于 `docs/screenshots/`）、5 个 AI Agent 详表、架构总览、快速开始（Docker 一键 + 本地开发 + 演示账号）、文档目录、路线图、贡献指引、安全与 License 章节；徽章扩展至 8 枚（四平台 / 版本 / Stars / MIT / TypeScript / PRs Welcome）。
- **CONTRIBUTING.md**：贡献指南（开发环境、代码规范、提交信息格式、PR 流程、文档贡献）。
- **SECURITY.md**：安全策略（漏洞私密报告流程、处理承诺、已开展的安全基线、部署安全建议）。
- **CODE_OF_CONDUCT.md**：社区行为准则（Contributor Covenant 2.1）。
- **docs/screenshots/**：16 张真实页面截图归档（买家 8 张 + 卖家 6 张 + AI 2 张），README 与文档引用本地路径，不依赖外部 CDN 短链。

### Changed
- README 版权声明由"仅展示、不放开源许可"更新为 **MIT License** 开源。

### Verification
- README 内所有图片引用均为仓库内本地路径（`client/src/assets/branding/`、`docs/screenshots/`），可离线渲染。
- README 中所有功能描述与 `docs/` 四份文档、CHANGELOG 历史逐项核对一致，无虚构内容。

---

## [1.0.0] — 2026-09-30

品牌打磨 + 部署准备 + 收官全量审查修复，正式版本号 v1.0.0。

### Added
- 品牌资产全端应用：4 套 Logo（主标 / 反白 / 图标 / 文字标）+ 品牌色（深海军蓝 `#0B1F3A` + 科技青 `#00C2B8`）+ Favicon，覆盖买家端、卖家端、登录页与浏览器标签页。
- 部署交付物：`docker-compose.yml`、`.env.example`、`docs/DEPLOY.md`。

### Fixed（收官全量审查 7 项）
- 修复 3 处 `req.userContext.userId` 引用崩溃（`products.controller.ts` / `categories.controller.ts` / `ai.controller.ts`），统一改为 `req.user?.id` 并补空值校验。
- 修复卖家商品上下架 404：`client/api/products.ts` 的 `updateProductStatus` 复用 `updateProduct(id, { status })`，消除不存在的 `/products/:id/status` 端点。
- 修复 `.env.example` 中 `PORT=3000` 与代码 `process.env.SERVER_PORT` 不一致，统一为 `SERVER_PORT`。
- 清理 `reviews.controller.ts` / `favorites.controller.ts` 中 5 处 `as any` 类型断言。

### Verification
- 收官回归 25 项全通过：交易闭环 10/10、账号鉴权 3/3、评价/收藏/优惠券/CSV/四语言 10/10、AI 状态 1/1、安全抽查（越权 403、CSRF 403）2/2。

---

## [0.5.0] — 2026-09-30

P2 加固 4 项：认证 Cookie 化、AI 计量落库、匿名购物车跨设备同步、操作审计。

### Added
- **HttpOnly Cookie 全替代 + CSRF 头校验**：登录/注册/刷新接口仅通过 `Set-Cookie`（HttpOnly、生产 Secure、SameSite=Lax、Path=/）下发 JWT，响应体不再返回 token 明文；新增 `POST /api/auth/refresh` 滑动续期（2h）与 `POST /api/auth/logout` 清 Cookie；全局 `X-Requested-With: XMLHttpRequest` 头校验，缺失 403；前端彻底移除 localStorage token 读写，统一 `credentials: include`。
- **ai_usage_log AI 计量落库**：新建 `ai_usage_log` 表（agent / model / input_tokens / output_tokens / duration_ms / success / error_message / user_id / created_at），`ai-gateway.service.ts` 每次 LLM 调用（成功+失败）均落库；新增 `GET /api/ai/usage-stats` 聚合接口，卖家 AI 分析中心顶部展示调用次数 / 总耗时 / Token / 成功率。
- **匿名购物车跨设备同步**：新建 `cart_recovery_codes` 表（12 位随机码、24h 有效、一次性）；`GET /api/cart/export-code` 导出、`POST /api/cart/import-code` 事务内按 product_id 数量合并；买家购物车页新增"跨设备迁移码"导出/导入卡片。
- **audit_logs 操作审计**：新建 `audit_logs` 表（actor / action / target / before_value / after_value JSONB / ip）；`audit.service.log()` fire-and-forget 写入；在订单创建、订单状态变更、支付、商品改价、商品上下架、CSV 导入、优惠券创建、优惠券核销等 9 类写操作埋点；新增卖家端"操作审计日志"页面，支持筛选与 before/after 展开。

### Changed
- JWT 中间件 `forRoutes` 不支持通配，改为逐条列出约 50 条受保护路径；`register` 支持可选 `role` 参数（buyer/seller，默认 buyer）；移除 `app.module` 重复全局 JWT 中间件。

---

## [0.4.0] — 2026-09-30

安全加固 P0 致命 14 项 + P1 重要 16 项。

### Security / Fixed（P0 致命 14 项）
- **IDOR 越权修复**：订单详情、支付接口、支付记录查询、咨询消息接口均增加 userId / sessionId 归属校验，seller/admin 放行，不匹配 403。
- **支付鉴权**：demo 支付也校验订单归属，防止任意人代付。
- **PayPal Webhook 验签**：完整 RSA-SHA256 验签 + 证书 URL 白名单，验签失败拒绝。
- **优惠券并发超用**：改为原子 `UPDATE ... WHERE used_count < usage_limit RETURNING`，0 行回滚。
- **JWT_SECRET 强制**：生产环境缺失或长度 <32 字符直接抛异常拒启动；开发保留默认值 + 警告。
- **异常脱敏**：全局异常过滤器生产环境仅返 code/message/timestamp，stack 仅记服务端日志。
- **XSS 净化**：Markdown 渲染接入 DOMPurify + URL 协议白名单（仅 http/https/mailto），img 加 lazy。
- **路由守卫**：SellerRouteGuard 渲染期拦截（loading 骨架 / 未登录 Navigate / 非 seller 403），消除 useEffect 跳转窗口。
- **金额后端重算**：下单只传 productId+quantity，后端从 DB `products.price` 重算，不信任前端金额。
- **输入校验**：结算收货信息（姓名/手机正则/邮编/地址长度/支付方式枚举）zod 前后端同规则校验。
- **图片校验**：商品图片 URL 必须 http/https、≤500 字符、≤10 张；CSV ≤10MB、MIME 白名单。
- **decimal.js 精度**：订单金额、优惠券折扣全部改用 decimal.js 精确运算，保留 2 位。
- **事务化**：购物车合并、物流与订单状态变更均包裹在 db.transaction 中。
- **索引 / 限流 / 密码强度 / 通配符转义**：补 `idx_orders_created_at_status` 等索引；登录注册 IP+email 粒度每分钟 5 次限流；密码 ≥8 位且含字母+数字；商品搜索 `% _ \` 转义后按字面匹配。

### Security / Fixed（P1 重要 16 项）
- 取消订单事务内回补库存（stock+、soldCount-、优惠券 used_count 回退）。
- 购物车加购改 `INSERT ... ON CONFLICT DO UPDATE` 原子累加，消除 TOCTOU。
- Dashboard 默认 90 天时间窗聚合；订单搜索启用 pg_trgm + GIN 索引；购物车合并改批量 upsert；首页收藏检查改 `/api/favorites/check-batch` 批量接口消除 N+1。
- Google OAuth 回调完整实现（code 换 token → userinfo → 自动建号 → 签 JWT），未配 key 友好提示。
- CSV 导入 10MB 上限；订单号改用 nanoid + 日期前缀防并发碰撞。

---

## [0.3.0] — 2026-09-27

查漏补缺 12 项：账号体系、真实支付演示接入、评价/收藏/优惠券、CSV 导入、小语种、pgvector、物流接入点。

### Added
- **账号体系**：users 表 + bcrypt 哈希 + JWT 中间件 + RolesGuard（buyer/seller）+ 前端 SellerRouteGuard；购物车/订单关联 user_id，登录后合并匿名购物车。
- **Google OAuth 链路**：Google Strategy + 回调代码完整，缺密钥进入"待配置"状态，前端显示"即将上线"。
- **Stripe / PayPal 演示接入**：`payments` 表 + StripeService（PaymentIntent / webhook / 退款）+ PayPalService（create / capture / webhook），缺密钥走演示支付，订单状态流转真实。
- **商品评价**：`product_reviews` 表，已购买才能评价，详情页展示 avgRating / reviewCount。
- **收藏 / 心愿单**：`favorites` 表（联合唯一），心形按钮 + 我的收藏页。
- **优惠券**：`coupons` 表，卖家 CRUD + 结算校验 + 订单记录 coupon_id / discount_amount。
- **CSV 批量导入**：`POST /api/products/import` + 模板下载 + 成功/失败统计。
- **四语言**：新增 es / pt 翻译包，语言切换器 4 选项，商品内容回退英文。
- **pgvector 向量检索**：`product_embeddings` 表（vector(1536) + HNSW 索引），SupportAgent 升级为"向量检索优先，无 EMBEDDING_API_KEY 时回退关键词匹配"。
- **17Track 物流接入点**：`logistics` 表 + `17track.service.ts` 完整 API 代码，发货填承运商/运单号，订单跟踪页 5 节点时间线。

---

## [0.2.0] — 2026-09-25

逐模块深度检查后修复 3 个 bug。

### Fixed
- 咨询管理页 `sessions.find is not a function`：API 返回分页对象 `{items,total,...}` 被当数组使用，修正为读取 `result.items`。
- 中英语言切换点击无效：`toggleLanguage()` 只发 CustomEvent 未调 `setLanguage()`，改为直接调用 LanguageContext 的 setter。
- AI 未配置 key 时前端无友好提示：AI 分析中心加醒目提示条（列出 3 个环境变量）；客服浮窗未配置时显示引导语。

---

## [0.1.0] — 2026-09-25

MVP 交易闭环首发。

### Added
- **买家商城 6 模块**：首页（商品展示/分类导航/推荐/搜索入口）、商品列表（筛选/排序/分页/搜索）、商品详情（图片/描述/规格/加购/多语言）、购物车（增删改/数量调整/价格计算）、下单（收货信息/支付方式/订单提交）、订单跟踪（列表/详情/物流状态时间线）。
- **卖家 AI 工作台 5 模块**：运营数据看板（GMV/订单量/访客数，SQL 真实聚合）、商品管理（CRUD/上下架/库存）、订单管理（列表/状态流转/发货）、咨询管理（会话列表/回复）、AI 分析中心（5 Agent 入口）。
- **5 个 AI Agent 代码链路**：CopywriterAgent / SupportAgent / TrendAgent / SelectAgent / TranslationAgent，统一经 `ai-gateway.service.ts` 走 OpenAI 兼容协议真实调用，未配 key 诚实报错 400，不返回假数据。
- **PostgreSQL 持久化**：products / categories / orders / order_items / cart_items / inquiry_sessions / inquiry_messages / ai_reports / shop_settings 等表，行级安全 RLS。
- **买卖数据打通**：买家下单卖家可见、卖家上下架买家可见，双向实时验证。
- **中英双语**：界面 + 商品多语言字段切换。
