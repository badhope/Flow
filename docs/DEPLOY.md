# Flow 出口电商平台 — 部署指南

| 项 | 内容 |
|---|---|
| 应用 | Flow（出口电商平台） |
| 技术栈 | React 19 + NestJS 12（Express 5）+ Drizzle ORM + PostgreSQL 16（pg_trgm） |
| 文档版本 | v1.21.0 / 2026-10-24 |

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

部署前在各服务商处申请以下密钥，填入 `.env`。**未填的能力自动进入演示模式，不会阻断启动。**

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
| `GOOGLE_CLIENT_ID` | Google 登录 | Google Cloud Console → OAuth 同意屏 → 凭据 |
| `GOOGLE_CLIENT_SECRET` | Google 登录 | 同上 |
| `17TRACK_API_KEY` | 真实物流轨迹 | 17TRACK 开放平台申请；发货自动注册运单，查询失败自动回退演示时间线 |
| `DATABASE_URL` | 数据库连接 | 见 docker-compose 默认值，按需修改 |
| `CORS_ORIGINS` | 允许的前端域名（逗号分隔；生产未设置时回退 `APP_URL`） | 如 `https://your-shop.com` |
| `TRUST_PROXY` | 反向代理后还原真实客户端 IP | nginx/caddy 后部署设为 `1`（否则审计与限流拿到代理 IP） |
| `SELLER_REGISTRATION_CODE` | 卖家自助注册邀请码 | 自定；不设置则禁止卖家自助注册（演示数据用 `SEED_DEMO_DATA`） |
| `SEED_DEMO_DATA` | 首次启动写入演示数据 | `true`（仅空库生效）：演示卖家/买家、商品、优惠码 TEST10 |
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
docker compose logs -f app

# 5. 访问
#    买家端: http://localhost:3000/
#    卖家端: http://localhost:3000/seller/dashboard
```

---

## 四、首次初始化

1. **数据库扩展**：`docker/postgres/init.sql` 首次启动自动执行 `CREATE EXTENSION vector` 与 `pg_trgm`。
2. **建表**：应用启动时 Drizzle 自动同步表结构（users / products / orders / payments / reviews / favorites / coupons / logistics / audit_logs / ai_usage_log 等）。
3. **种子数据**：预置示例商品与分类；首个卖家账号可通过注册接口后在数据库把 `role` 改为 `seller`。
4. **创建平台管理员**（跨店运营必需）：

   ```bash
   # 宿主机直连（DATABASE_URL 指向库），或 docker compose exec server sh 后执行
   npm run admin:create -- admin@example.com <强密码> "Platform Admin"
   # 已存在的 admin 邮箱重复执行 = 重置密码；买家/卖家邮箱会被拒绝提权
   ```

5. **生产必做**：务必设置 `JWT_SECRET`，否则应用会拒绝启动。

---

## 五、常用命令

```bash
# 停止
docker compose down

# 停止并删除数据卷（慎用）
docker compose down -v

# 查看状态
docker compose ps

# 升级代码后重建
git pull && docker compose up -d --build

# 数据库备份
docker compose exec postgres pg_dump -U flow flow > backup_$(date +%F).sql

# 数据库恢复
docker compose exec -T postgres psql -U flow flow < backup_2026-09-30.sql
```

---

## 六、升级与备份建议

- **升级**：先 `pg_dump` 备份，再 `git pull` + `docker compose up -d --build`；Drizzle 表结构为增量同步，建议升级前备份。
- **备份**：每日定时 `pg_dump`；对象（商品图片）目前为 URL 引用，无需备份本地文件。
- **日志**：`ai_usage_log`、`audit_logs` 会持续增长，建议定期归档。

---

## 七、常见问题

| 现象 | 排查 |
|---|---|
| 应用启动即退出 | 检查 `JWT_SECRET` 是否设置（生产环境缺失会拒启动） |
| AI 功能返回 400 | 检查 `LLM_BASE_URL` / `LLM_API_KEY` 是否填对 |
| 支付仍是演示模式 | 未配 `STRIPE_SECRET_KEY` / `PAYPAL_CLIENT_ID`，属正常 |
| Google 登录不可用 | 未配 `GOOGLE_CLIENT_ID/SECRET`，前端显示"即将上线" |
| 物流为模拟时间线 | 未配 `17TRACK_API_KEY`，属正常 |
| 登录后换设备要重新登录 | token 在 HttpOnly Cookie 中，浏览器级隔离；匿名购物车用"跨设备迁移码"导出/导入 |
| 跨域 / Cookie 不生效 | 检查 `CORS_ORIGINS`、`COOKIE_DOMAIN` 与实际访问域名一致 |
| Stripe 支付后订单未变更 | 确认 webhook 已指向 `{APP_URL}/api/payments/stripe-webhook` 且 `STRIPE_WEBHOOK_SECRET` 正确 |
| PayPal 支付后订单未变更 | 确认 webhook 已指向 `{APP_URL}/api/payments/paypal-webhook`（事件 `PAYMENT.CAPTURE.COMPLETED`）且 `PAYPAL_WEBHOOK_ID` 正确 |
| 升级旧库数据 | 1.2.0 起使用 `npm run db:migrate` 管理结构；用 `db:push` 建的旧库请先备份再执行迁移 |


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
npm run smoke:all     # 一键全量 E2E（embedded-postgres，无需 Docker）
npm run capture:all   # 重建 30 张截图 + 演示视频（需本机 Chrome/Edge + ffmpeg；缺构建时自动 npm run build）
npm run cli -- health # CLI 健康检查
```
