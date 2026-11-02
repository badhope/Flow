# Flow 出口电商平台 — 部署指南

| 项 | 内容 |
|---|---|
| 应用 | Flow（出口电商平台） |
| 技术栈 | React 19 + NestJS 12（Express 5）+ Drizzle ORM + PostgreSQL 16（pg_trgm） |
| 文档版本 | v1.22.0 / 2026-11-01 |

---

## 一、环境要求

| 组件 | 要求 |
|---|---|
| 操作系统 | Ubuntu 22.04 / Debian 12 / 任意支持 Docker 的 Linux |
| Docker | ≥ 24.x |
| Docker Compose | ≥ v2 |
| 内存 | ≥ 2GB（PostgreSQL + Node 服务） |
| 磁盘 | ≥ 20GB |
| 网络 | 可访问外网（调用 LLM / Stripe / PayPal / 17TRACK API） |

---

## 二、获取密钥清单

仅在实际需要时通过安全渠道配置各服务商凭据，禁止提交 `.env` 或记录密钥。AI 未配置返回 400；生产支付默认拒绝演示通道；物流查询未配置或失败时可能回退演示轨迹。配置标志不等于渠道已验收。

| 环境变量 | 用途 | 获取位置 |
|---|---|---|
| `LLM_BASE_URL` | AI 大模型端点 | DeepSeek `https://api.deepseek.com`；或火山方舟 / OpenAI / 通义等 OpenAI 兼容地址 |
| `LLM_API_KEY` | AI 大模型密钥 | 对应服务商控制台（DeepSeek 为 `sk-xxx`） |
| `LLM_MODEL` | 模型名（可选） | 如 `deepseek-chat` |
| `JWT_SECRET` | 登录签名密钥 | 自生成：`openssl rand -hex 32`（生产必填，≥32 位） |
| `STRIPE_SECRET_KEY` | 真实收款 | Stripe Dashboard → Developers → API keys（`sk_live_...`） |
| `STRIPE_PUBLISHABLE_KEY` | 站内卡支付（Stripe.js） | Stripe Dashboard → Developers → API keys（`pk_live_...`，公钥可公开；未配置时仅创建支付单并提示到渠道后台确认） |
| `STRIPE_WEBHOOK_SECRET` | Stripe 回调验签 | Stripe Dashboard → Webhooks → 新增 endpoint 后获取 |
| `PAYPAL_CLIENT_ID` | PayPal 收款 | PayPal Developer → Apps & Credentials |
| `PAYPAL_CLIENT_SECRET` | PayPal 收款 | 同上 |
| `PAYPAL_MODE` | 沙箱/正式 | `sandbox` 或 `live` |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook 验签 | PayPal Developer → Webhooks |
| `GOOGLE_CLIENT_ID` | Google 登录 | Google Cloud Console → OAuth 同意屏 → 凭据 |
| `GOOGLE_CLIENT_SECRET` | Google 登录 | 同上 |
| `17TRACK_API_KEY` | 物流轨迹 | 17TRACK 开放平台申请；发货异步尽力注册，查询失败或无可用轨迹时回退演示时间线 |
| `SMTP_ALLOWED_HOSTS` | 生产巡检邮件主机允许列表 | 逗号分隔主机名；未设置或不匹配时 SMTP 配置不生效 |
| `DATABASE_URL` | 数据库连接 | 见 docker-compose 默认值，按需修改 |
| `CORS_ORIGINS` | 允许的前端域名（逗号分隔；生产未设置时回退 `APP_URL`） | 如 `https://your-shop.com` |
| `TRUST_PROXY` | 反向代理后还原真实客户端 IP | nginx/caddy 后部署设为 `1`（否则审计与限流拿到代理 IP） |
| `SELLER_REGISTRATION_CODE` | 卖家自助注册邀请码 | 自定；不设置则禁止卖家自助注册（演示数据用 `SEED_DEMO_DATA`） |
| `SEED_DEMO_DATA` | 非生产演示数据 | `true` 且数据库没有用户时写入；production 设置为 `true` 会拒绝启动 |
| `COOKIE_DOMAIN` | Cookie 作用域 | 如 `.your-shop.com` |

---

## 三、快速启动

```bash
# 1. 克隆代码后进入项目根目录
git clone https://github.com/X33834/Flow.git
cd Flow

# 2. 复制环境变量模板并填入密钥
cp .env.example .env
vim .env

# 3. 启动全部服务（自动执行数据库迁移 + pg_trgm 扩展；前端由服务端同源托管）
docker compose up -d --build

# 4. 查看日志
docker compose logs -f server

# 5. 访问
#    买家端: http://localhost:3000/
#    卖家端: http://localhost:3000/seller/dashboard
```

---

## 四、首次初始化

1. **数据库扩展**：`docker/postgres/init.sql` 首次启动自动执行 `CREATE EXTENSION pg_trgm`。
2. **建表**：容器启动时执行 `scripts/db/migrate.mjs` 逐个应用 `drizzle/*.sql` 迁移（users / products / orders / payments / reviews / favorites / coupons / logistics / audit_logs / ai_usage_log 等）。
3. **种子数据**：默认 Compose 的 `environment` 强制 `NODE_ENV=production`，覆盖 `.env`。生产设置 `SEED_DEMO_DATA=true` 会导致启动失败，不是静默跳过。演示请使用本地 development 进程、独立空数据库并显式启用该变量；已有用户时跳过。生产账号使用安全注册流程创建。
4. **创建平台管理员**（跨店运营必需）：

   使用 `npm run admin:create -- <邮箱> <密码> "Platform Admin"`，运行环境的 `DATABASE_URL` 必须指向目标库。脚本通过命令行参数接收密码，可能暴露于进程列表或 shell 历史；仅在受控主机上使用，避免记录命令，并限制进程访问。容器内可用 `docker compose exec server` 执行。已存在的 admin 邮箱重复执行会重置密码；买家/卖家邮箱会被拒绝提权。

5. **生产必做**：务必设置 `JWT_SECRET`，否则应用会拒绝启动。

---

## 五、常用命令

```bash
# 停止
docker compose down

# 查看状态
docker compose ps

# 升级代码后重建
git pull && docker compose up -d --build

# 数据库备份
docker compose exec -T postgres pg_dump -U flow flow > backup_$(date +%F).sql

# 数据库恢复
docker compose exec -T postgres psql -U flow flow < backup_2026-09-30.sql
```

---

## 六、升级与备份建议

- **网络与 HTTPS**：默认 Compose 发布应用端口，PostgreSQL 默认绑定宿主机 `127.0.0.1:5432`，并非完全不发布；`POSTGRES_PORT` 可以改变绑定，切勿将数据库暴露到公网。将应用端口限制在可信网络或防火墙后，由可信反向代理终止 HTTPS，配置证书自动续期、`APP_URL=https://实际域名`、正确的 `CORS_ORIGINS` 和仅与实际可信代理跳数一致的 `TRUST_PROXY`。验证证书、HTTPS 页面、登录 Cookie 和两个 webhook 的 HTTPS 可达性；不要把应用 HTTP 端口绕过代理公开。
- **升级与回滚**：升级前记录当前镜像/代码版本、配置和迁移版本，暂停写入并用 `pg_dump` 备份；在隔离库演练恢复并确认备份可读。先在隔离环境测试新版本迁移，再部署。失败时停止写入，恢复旧镜像及对应配置；若迁移不向后兼容，先确认数据丢失窗口，再将升级前快照恢复到隔离库验证，之后按维护流程恢复目标库。单纯回退镜像不会撤销迁移；恢复快照会丢弃快照之后的写入，须先保留当前库快照并核对。`docker compose down` 不删除卷；不要对有价值数据运行 `down -v`。
- **备份**：每日定时 `pg_dump` 并加密、限制访问，定期隔离恢复演练；示例命令中的用户名和数据库名需按 `POSTGRES_USER`、`POSTGRES_DB` 调整。对象（商品图片）目前为 URL 引用。
- **日志**：`ai_usage_log`、`audit_logs` 会持续增长，建议定期归档，日志与备份均需防止泄露。

---

## 七、常见问题

| 现象 | 排查 |
|---|---|
| 应用启动即退出 | 检查 `JWT_SECRET` 是否设置（生产环境缺失会拒启动） |
| AI 功能返回 400 | 检查 `LLM_BASE_URL` / `LLM_API_KEY` 是否填对 |
| 无可用支付渠道 | `/api/payments/config` 的 `demoMode` 仅在两个渠道均未配置且演示门禁允许时为 true；生产默认关闭。Stripe 需 secret key，PayPal 需 client ID 和 secret。配置标志不保证 webhook 或凭据有效 |
| Google 登录不可用 | 未配 `GOOGLE_CLIENT_ID/SECRET`，前端显示"即将上线" |
| 物流为模拟时间线 | 未配 `17TRACK_API_KEY`，属正常 |
| 登录后换设备要重新登录 | token 在 HttpOnly Cookie 中，浏览器级隔离；匿名购物车用"跨设备迁移码"导出/导入 |
| 跨域 / Cookie 不生效 | 检查 `CORS_ORIGINS`、`COOKIE_DOMAIN` 与实际访问域名一致 |
| Stripe 支付后订单未变更 | 确认 webhook 已指向 `{APP_URL}/api/payments/stripe-webhook` 且 `STRIPE_WEBHOOK_SECRET` 正确 |
| PayPal 支付后订单未变更 | 分别检查买家回跳 capture 和 webhook；确认 webhook 指向 `{APP_URL}/api/payments/paypal-webhook`、事件及 ID 正确。真实 webhook 协议兼容性尚未确认，见下方隔离验收 |
| 升级旧库数据 | 1.2.0 起使用 `npm run db:migrate` 管理结构；用 `db:push` 建的旧库请先备份再执行迁移 |


---

## 八、隔离沙箱验收

以下是将来由授权人员执行的操作，不是本次已完成的真实服务验证。准备独立数据库、应用实例、域名和沙箱账号，禁止指向生产库、正式支付密钥、真实客户或生产收件人；隔离实例启用 HTTPS，限制管理入口及出站访问，仅放行所需沙箱服务。使用测试商品、测试订单和测试邮箱。秘密通过受控配置注入，禁止粘贴凭据、签名、完整请求体、邮箱、运单号或客户数据到证据；销毁或撤销临时凭据按组织流程执行。默认 Compose 容器名固定为 `flow-server`/`flow-postgres`，并与同名实例冲突；使用独立主机或另行准备隔离编排，不要直接复用生产容器和卷。

**配置与 mock 基线**：在隔离实例中保留 `ALLOW_DEMO_PAYMENT` 未设置；分别检查 `GET /api/payments/config` 的 `stripeConfigured`、`paypalConfigured`、`demoMode`。前两项只检查对应凭据是否存在，不检查有效性或 webhook；`demoMode` 仅在两个渠道均未配置且门禁允许时为 true，不是总开关。演示支付仅允许显式 `development` 或 `test` 环境；生产环境即使设置 `ALLOW_DEMO_PAYMENT` 也不会放行。未配置渠道的支付请求会进入演示路径并受此门禁约束，不代表真实收款。

`npm run build && npm run smoke:all` 包含本地模拟器冒烟；mock 使用本地替身与测试签名，不能证明第三方 sandbox、真实证书、网络或 webhook 协议。记录 mock 与以下实际服务商测试为独立结果。

1. **Stripe 测试模式**：仅注入 Stripe 测试密钥、公钥和测试 webhook secret，不设置指向 mock 的 `STRIPE_API_BASE`。向隔离 HTTPS 地址配置 `payment_intent.succeeded` 回调 `/api/payments/stripe-webhook`。使用 Stripe 提供的测试付款方式创建并确认一笔测试订单，核对服务商测试事件投递结果及应用订单从待支付到已支付、支付记录金额/币种。重投同一事件，确认订单和支付记录不重复；另用缺失或无效签名请求验证拒绝且状态不变。测试模式付款不是实际收款。
2. **PayPal sandbox capture**：设置 `PAYPAL_MODE=sandbox` 和沙箱客户端凭据，不设置 mock 的 `PAYPAL_API_BASE`。用沙箱买家批准一笔隔离订单并返回应用，由 `/api/payments/paypal/capture` 完成 capture；分别核对 PayPal sandbox capture 状态、应用订单及支付记录。回跳 capture 成功不证明 webhook 成功。
3. **PayPal sandbox webhook，单独验收且当前不确定**：配置沙箱 webhook ID 和 HTTPS `/api/payments/paypal-webhook`，订阅 `PAYMENT.CAPTURE.COMPLETED`，以实际沙箱事件检查投递状态、应用验签及订单关联；重投确认无重复入账，缺少或篡改签名应拒绝且无状态变化。当前实现对解析后的 body 重新 `JSON.stringify`，并以 `transmissionId|transmissionTime|webhookId|SHA256(body)` 构造签名输入、从受限 PayPal 域拉取证书；其与 PayPal 当前官方 webhook 签名协议及原始字节处理是否兼容**未验证**。对照 PayPal 当前官方规范和真实事件独立确认；验签失败或无法确认时记录阻塞，不得以 mock 或 capture 成功替代，也不要绕过验签投入生产。
4. **17TRACK**：仅使用获授权的测试 key 与可查询的测试运单。隔离订单发货注册后，`registerTracking` 返回的 `isDemo=false` 只表示 key 已配置；远程注册异步执行、失败不阻断发货，不能证明注册成功。检查脱敏的注册结果/日志及服务商侧记录；再查询订单物流，`isDemo=false` 表示本次查询映射到了非演示轨迹，`true` 表示演示时间线。分别测试无 key 和隔离网络阻断/查询失败，确认回退 `isDemo=true`；查询结果和注册响应的标志含义不可混用。真实测试运单不可用时标记未验证。
5. **SMTP allowlist**：在隔离 production 实例设置 `SMTP_ALLOWED_HOSTS` 为受控测试 SMTP 主机，使用仅接收测试邮件的邮箱或捕获服务；在卖家巡检设置中配置 `notifyKind=email` 和 `notifySmtp` 的 host、port、secure、from、to 及需要的认证。制造隔离测试告警并运行巡检，确认允许主机接收一封测试邮件；再配置不在 allowlist 的主机，确认配置被忽略、无邮件出站。匹配为去空格、大小写不敏感的精确主机名；空列表默认拒绝，限制仅在 production 生效。避免记录 SMTP 密码、收发地址、邮件正文及原始设置。应用只有有告警且满足 `notifyOnlyOnNew` 条件才发送，必要时在隔离环境关闭该条件测试。

**证据模板**：为每项分别记录执行日期、隔离环境标识、版本、mock/真实 sandbox、测试项、预期与实际状态、重复投递/拒绝结果、通过/失败/未验证及原因；订单、事件、运单等只保留不可逆脱敏标识或末几位，禁止记录密钥、token、签名、个人信息或完整日志。上线前独立复核并保管证据。

---

## 九、SEO 与机器可读端点

部署后可直接访问（无需额外配置）：

| 路径 | 说明 |
|---|---|
| `/sitemap.xml` | 商品 / 集合 / CMS 页面 sitemap（动态生成） |
| `/robots.txt` | 爬虫规则 + sitemap 地址 |
| `/llms.txt` | 面向 AI 代理的站点说明与公开 API 清单 |
| `/api/openapi.json` | OpenAPI 3.1 描述 |
| `/api/seo/meta?path=/products/xxx` | 页面元信息（title/description/JSON-LD） |

> `APP_URL` 必须配置为对外域名，sitemap / canonical / OG 链接才会使用正确地址。

---

## 十、验证与演示资产

```bash
npm run build && npm run smoke:all     # 先构建，再跑全量 E2E（embedded-postgres；Docker 可选）
npm run capture:all   # 重建 31 张截图 + 演示视频（需本机 Chrome/Edge + ffmpeg；缺构建时自动 npm run build）
npm run cli -- health # CLI 健康检查
```

若使用已有本机 PostgreSQL 而非 embedded 实例，`npm run e2e:local` 要求显式指定一个可丢弃库，且不会清理未知进程：

```bash
# 库名必须以 flow_e2e_ 开头、位于本机；E2E_RESET_DATABASE=yes 表示同意清空该库
E2E_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/flow_e2e_check' \
E2E_RESET_DATABASE=yes \
npm run e2e:local
```

未设置这两个变量时脚本会直接退出，不会删除任何数据库。
