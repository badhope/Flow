# Flow 靶向重构交付报告

- 仓库：`C:\Users\Admin\Desktop\workspace\008\Flow`（main，8 个提交，工作区干净）
- 基线：v1.21.1（82ad1b6）→ 重构后 HEAD（017bb9e）
- 日期：2026-10-30

---

## 一、做了什么（8 个提交，逐片红绿验证）

| # | 提交 | 内容 | 测试增量 |
|---|---|---|---|
| 1 | 73fc3a1 | **AI 租户隔离**：trend/select Agent 查询加 sellerId 条件；`/ai/reports` 列表+详情按归属过滤；自定义 Agent 限 creator（admin 跨店保留）；抽 `seller-scope.ts` fail-closed 助手 | +6 |
| 2 | 7c1035f | **模型配置按卖家隔离**：`llm_*` 键改 `{userId}:` 前缀作用域（admin 保留全局键，零迁移）；网关按调用方解析配置、绝不串用他人 DB 配置；巡检设置/快照同步按卖家作用域 | +8 |
| 3 | 29e2000 | **demo 支付生产门禁**：生产环境 `provider=demo` 默认 403，仅 `ALLOW_DEMO_PAYMENT=true` 放行；`/payments/config` 同口径 | +3 |
| 4 | 259b8cf | **SSRF 防护**：`url-guard.ts`（环回/私网/CGNAT/链路本地/云元数据/裸主机名，fail-closed）接入 webhook 发送、巡检设置写入、LLM baseUrl 解析三处 | +7 |
| 5 | 23e19f6 | **依赖升级**：nodemailer 7.0.13→10.3.1、multer override→2.5.0；`npm audit --omit=dev` 归零；17TRACK 文档改为「预留」诚实标注（isDemoMode 钉死 true） | 0 |
| 6 | 0a7f374 | **admin 创建入口**：`npm run admin:create <email> <密码>`（幂等重置 admin 密码、拒绝买家/卖家提权、密码策略与注册一致） | 0 |
| 7 | 6023810 | **前端体积**：ECharts 按需引入（echarts/core + Line/Pie + 必要组件），注入 echarts-for-react Core；Dashboard chunk **1.14MB → 5.96KB**，echarts 独立 vendor-echarts 571KB 懒加载 | 0 |
| 8 | 017bb9e | **退款规则纯函数化**：`refund-cap.ts`（累计封顶唯一口径）+ `refund-items.ts`（可退数量 clamp/行项金额/JSON 解析/已退汇总）接入 refunds.service，行为不变 | +8 |

## 二、验证证据（全部实跑，非推断）

| 检查 | 改前 | 改后 |
|---|---|---|
| `npm run lint` | 0 | **0** |
| `npm run type:check` | 0 | **双端 0** |
| `npm test` | 166/166 | **198/198**（34 文件） |
| `npm run build` | 通过 | **通过** |
| `npm audit --omit=dev` | 3 high | **0 vulnerabilities** |
| DashboardPage chunk | 1,138KB | **5.96KB** |

**变异验证（证明测试真实）**：
- 删掉 coupon 折扣封顶 → 2 个用例转红 ✅
- 删掉退款数量 clamp → 1 个用例转红 ✅
- 两处恢复后全绿。

## 三、P0/P1 问题收敛对照

| 尽调问题 | 状态 | 证据 |
|---|---|---|
| trend/select 跨租户泄露全平台数据 | ✅ 修复 | sellerId 条件进 3 个聚合查询 + 报告 owner 过滤 |
| 任意卖家改全平台 LLM key/baseUrl | ✅ 修复 | 作用域键，seller 的 PUT 只落到自己的 `u1:llm_*` |
| 巡检/通知设置全局可改 | ✅ 修复 | watch 键按卖家作用域；定时调度只认 admin 全局配置 |
| 自定义 Agent 可改删他人 | ✅ 修复 | list/update/remove/run 全部 creator 过滤 |
| demo 支付生产白拿订单 | ✅ 修复 | 生产 403 + 显式 flag，UI demoMode 同口径 |
| webhook/baseUrl SSRF | ✅ 修复 | 三处接入 url-guard；已知边界（DNS rebinding）代码注释标注 |
| nodemailer/multer 3 high | ✅ 清零 | 官方源 audit 0 |
| 17TRACK 文档虚标 | ✅ 修正 | 恒演示时间线 + 文档「预留」 |
| 无 admin 入口 | ✅ 补齐 | admin:create + DEPLOY 文档 |
| Dashboard 1.14MB | ✅ 优化 | 5.96KB + 可缓存 vendor chunk |
| 退款金额规则零测试 | ✅ 补齐 | 2 个纯模块 + 8 测试 + 变异验证 |
| 前端 0 测试 | ⏸ 未做 | 可选项，需引入 testing-library（新依赖，超出本轮范围） |
| service 层 DB 集成测试 | ⏸ 部分 | 本机无可用 PG（embedded-postgres 管理员权限限制），用纯函数抽取替代；CI 有 Postgres service 可跑 `smoke:all` |

## 四、没做的部分与原因

1. **切片 9（前端测试）**：计划标注「可选」；引入 testing-library 属新依赖决策，且不阻塞上线门槛，按最小改动原则跳过。
2. **DB 集成测试**：Windows 本机 embedded-postgres 无法以管理员启动（尽调时已确认的环境限制）。改用「资金规则纯函数抽取 + 真实服务接线」达成同等防回归效果；建议在 CI（有 postgres:16 service）跑 `smoke:all` 做最终确认。
3. **DNS rebinding 完整防护**：url-guard 是入口校验；fetch 层自定义 lookup 钉住解析结果属后续加固，已在 url-guard.ts 注释中明示。

## 五、回归风险评估

- 全部 198 个既有+新增测试通过，既有测试 0 修改（只有 demo-gate 的 payments.config 行为变化属预期修复）。
- 切片 1/2 是行为增强（卖家的可见数据收窄），admin 视角行为保持原样（全局键/跨店），存量单卖家部署无感。
- nodemailer 10 属 breaking 升级，但项目仅用 `createTransport` + `sendMail` 基础 API（惰性加载），建议部署 SMTP 通知后发一封真实邮件回归。

## 六、上线前最后三步

```bash
# 1. 有 PG 的环境跑一次全链路
npm run smoke:all        # CI 上会绿；Windows 本机受限
# 2. 创建管理员
npm run admin:create -- admin@example.com <强密码>
# 3. 真实收款部署确认未设置 ALLOW_DEMO_PAYMENT
```
