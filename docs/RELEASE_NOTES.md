# Flow v1.22.0 发布说明

**发布时间**：2026-11-01
**仓库**：[GitHub](https://github.com/X33834/Flow) · [Gitee](https://gitee.com/badhope/Flow) · [GitCode](https://gitcode.com/badhope/Flow)
**定位**：AI 原生跨境出口电商平台（买家商城 + 卖家 AI 工作台）

## 本次发布的四个关键词

1. **可信**：修掉 5 类会导致真实资金/数据错误的缺陷（跨租户订单读写、退款并发重复打款、支付并发重复入账、退款数量越界、优惠券限次失效）。
2. **可运营**：卖家端补齐批量上下架、CSV 导出、规格 CRUD、筛选分页修复、移动端布局。
3. **可展示**：30 张自动截图 + 约 70 秒演示视频 + 社交预览图 + 展示型 README。
4. **可集成**：OpenAPI 3.1、sitemap / robots / llms.txt、CLI、服务端 SEO 注入、请求 ID。

## 验证记录

| 项目 | 结果 |
|---|---|
| `npm run lint` | 0 问题 |
| `npm run type:check` | 前后端 0 错误 |
| `npm test` | 256/256 通过（42 文件） |
| GitHub Actions | 三仓 quality + E2E 全绿（commit 5499cf3） |
| `npm run build` | 通过 |
| `npm run smoke:all` | 6 套全通过（workflows / degraded / transaction / providers / copilot / shopper） |

## 本版变更（1.22.0）

- 仓库名统一为 `Flow`（五端），旧地址自动跳转
- CI 修复：mock webhook 回调目标、SEO 断言前完整构建、429 重试、失败日志转储
- 依赖升级并清理 27 个未使用传递依赖；Dependabot 收敛，开放 PR 清零

## 升级注意

1. 执行 `npm run db:migrate`（新增 `drizzle/0007_inquiry_seller_scope.sql` 与 `drizzle/0008_ai_settings_key_width.sql`）。
2. 如需站内 Stripe 卡支付，新增 `STRIPE_PUBLISHABLE_KEY`（仅公钥，可公开）。
3. 咨询会话新增卖家归属：历史无归属会话对所有卖家可见，首个回复者接管。
4. `npm run smoke:all` 使用嵌入式 PostgreSQL（devDependency），不需要 Docker。

## 已知边界（诚实说明）

- 未内置 Region/多币种与税费引擎，价格统一 USD；多币种在 Roadmap。
- 未内置向量检索：SupportAgent 使用 `pg_trgm` 关键词召回。
- 17TRACK 仅在配置 API Key 后为真实轨迹；未配置时为演示时间线（界面明确标注 demo）。
- `npm run format:check` 非门禁：仓库历史文件尚未全量格式化，新增文件遵循既有风格。
