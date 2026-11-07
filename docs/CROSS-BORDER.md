# 跨境交易链路

四块能力构成 Flow 的跨境底座：多币种、清关单据、库存预留、卖家结算。
它们不是并列的功能点，而是一条链：**报价 → 清关 → 履约 → 结款**。

---

## 一、多币种

### 汇率从哪来

`FxService` 从 `open.er-api.com` 拉取（免费、无需 key、每日更新）。
启动 20 秒后自动刷新一次，之后按需刷新。

**失败时的行为是刻意的**：网络不可用时保留库中已有汇率，`source` 标记为 `manual`，
让运维一眼看出「这份汇率不是最新的」。绝不 fallback 到 1:1——那会让一张 100 EUR
的订单被当成 100 USD，误差比不更新汇率还大。

### 汇率表语义

`currencies.rate_to_usd` 表示 **1 USD = rate 个该币种**。换算走 USD 中转：

```
A 转 B：amount / rateA × rateB
```

这样只需维护一张相对 USD 的表，不用维护 N² 个币种对。

| 币种 | 小数位 | 说明 |
|---|---|---|
| USD / EUR / GBP / CNY / CAD / AUD / SGD / HKD | 2 | |
| JPY / KRW | 0 | 没有小数位，显示 `¥100` 而非 `¥100.00` |

### 订单为什么快照汇率

汇率每天都在变。订单落库时同时写入 `currency`、`exchange_rate`、`base_total_amount`
（USD 基准额）。退款、结算、对账都按快照复算，不会因为今天的汇率而改变上个月的账。

### 接口

| 端点 | 说明 |
|---|---|
| `GET /api/fx/rates` | 公开，可选币种与汇率 |
| `GET /api/fx/convert?amount=&from=&to=` | 公开，换算 |
| `POST /api/fx/refresh` | 管理员，手动刷新 |
| `POST /api/fx/rates` | 管理员，手工设置（公开源长期不可用时的兜底） |

---

## 二、清关单据

### 数据来源

商品级字段（`products`）：

| 字段 | 用途 |
|---|---|
| `hs_code` | HS 编码，6–10 位数字。前 6 位国际统一，后几位各国细分 |
| `origin_country` | 原产国，影响关税优惠（RCEP/USMCA） |
| `customs_name_en` | 报关英文品名（与展示标题分开：报关有格式要求） |
| `customs_material_en` | 材质描述 |

### 生成规则

`POST /api/customs/order/:orderId` 生成一单一单据：

- **行项目快照**。商品后续改价改名不影响已生成的单据。
- **申报价值用成交价**（`order_items.unit_price`，已含币种折算），不是 listing 原价。
  折扣后的实际支付金额才是海关认定的完税价格，用原价申报属于高报，用 0 申报属于低报。
- **缺 HS 码不阻断生成，但阻断申报**。生成时给出显式告警，`markFiled` 会拒绝
  并列出具体 SKU——海关不认「忘了填」，与其等退单不如在系统里拦住。
- **幂等**。同一订单重复调用返回已有单据。

### 接口

| 端点 | 说明 |
|---|---|
| `GET /api/customs` | 卖家单据列表（按 sellerId 隔离） |
| `GET /api/customs/order/:orderId` | 按订单查，无单据返回 `null` |
| `POST /api/customs/order/:orderId` | 生成（幂等） |
| `POST /api/customs/:id/file` | 标记已申报（缺 HS 码会 400） |

---

## 三、库存预留

### 它解决什么

此前只有「下单即扣 `stock`」一种状态，无法回答：

- 这个 SKU 有多少是被未支付订单占着、多少是真可用？
- 支付成功后该把占用转成什么？

`stock_reservations` 不改扣减语义，只增加可观测性：

```
下单 → soft / active  ──支付──→  consumed / hard
                     ──取消/超时──→  released
```

`stock` 仍然表示「实时可售」，所有既有查询不变。

### 为什么不做成「先预留、支付才扣」

那会让 `stock` 失去「实时可售」的含义，所有既有查询都要跟着改，风险远大于收益。
当前做法是**在扣减的同时留下一条可追踪的占用记录**，语义不变、信息更全。

### 一致性保证

- 预留创建与库存扣减**同一个事务**。
- 预留释放与库存回补**同一个事务**——否则会出现「库存已回补但预留还挂着」的幽灵占用。
- 同一订单同一变体只允许一条 `active` 预留（部分唯一索引）。

---

## 四、卖家结算

### 计算口径

```
应结 = 周期内已支付订单的 USD 基准额
     − 该周期发生的退款
     − 佣金（毛额 × 费率 + 固定手续费 × 单数）
```

三条硬规则：

1. **一律用 USD 基准额**（订单落库时的快照），不按当前汇率换算——否则同一笔订单
   在不同时间结算会得到不同金额。
2. **佣金费率快照到结算单**。卖家改费率不影响已生成的结算单。
3. **退款按退款发生时间归属**，不按原订单时间。「这个月退了上个月的单」体现在本月
   结算里，符合现金流事实。

### 佣金规则

`commission_rules`：`seller_id` 为 `NULL` 表示全局默认（初始 8%）。
卖家专属规则优先于全局默认。

### 接口

| 端点 | 说明 |
|---|---|
| `GET /api/settlements` | 卖家看自己的，管理员看全部 |
| `GET /api/settlements/summary` | 待结算 / 已结算 / 单数 / 最近一次 |
| `GET /api/settlements/commission` | 我的佣金规则 |
| `POST /api/settlements/generate` | 管理员，按周期生成（幂等） |
| `POST /api/settlements/:id/pay` | 管理员，标记已打款 |
| `POST /api/settlements/commission` | 管理员，配置费率 |

### 退款对佣金的影响

退款从毛额中扣除，但**佣金仍按毛额计**——支付通道费在收款时已经发生，不会因为退款
退回。这是行业惯例，也写在测试里（S3）。

全退订单的净额会被夹到 0，不出现「平台倒欠卖家」的负数。

---

## 五、数据表

| 表 | 用途 |
|---|---|
| `currencies` | 币种、汇率、小数位 |
| `customs_declarations` | 清关单据（行项目 JSON 快照） |
| `stock_reservations` | 库存占用记录 |
| `commission_rules` | 平台抽成规则 |
| `settlements` | 结算单 |

迁移：`drizzle/0011_cross_border_core.sql`（加法式变更，不破坏既有数据）。

---

## 六、多仓

### 为什么

不只是"多几个地址"：仓库决定从哪发货、是否跨境、以及同一 SKU 有货时的选仓顺序。

### 选仓规则

按顺序，写死在代码里而非靠人记忆：

1. **目的国本地仓优先**——时效最好、通常无关税
2. 其次按 `priority` 升序（运营可调）
3. 同优先级按**可用量降序**——尽量一仓发完，避免拆单

可用量 = 分仓库存 − 安全库存。安全库存是预警线，不能拿来卖。

任一商品无法完全满足就拒绝下单，不静默少发。并且区分两种失败：
"仓库没配"和"真的没货"——前者报"库存不足"会让人查错方向。

### 聚合字段如何保持一致

`warehouse_stock` 是真相来源，但全站大量查询依赖 `product_variants.stock`
与 `products.total_stock`。每次扣减/回补都在**同一事务内**按分仓总和重算这两个字段。

否则会出现"分仓有货但商品显示售罄"，或反过来——这类不一致极难排查。

### 调拨

创建即冻结调出仓库存（避免超卖），完成时入库到目标仓，取消则退回。
总库存在调拨前后守恒。

### 历史数据自愈

种子数据、迁移前创建的商品只有聚合库存，没有分仓记录。
下单时若发现某变体没有任何分仓记录，会自动把聚合库存补写进默认仓——
这样升级不会导致"老商品全部无法下单"，也不需要人工跑一次性脚本。

---

### 库存写入的唯一入口

`StockService` 是分仓与聚合字段的**唯一写入点**。任何改动库存的代码路径
（商品创建、变体增删改、CSV 导入、下单扣减、取消回补、退款回补）都必须经过它。

为什么必须收敛：`warehouse_stock` 是下单时的真相来源，而全站查询读的是
`product_variants.stock` / `products.total_stock`。两者漂移不会报错，
只会表现为「商品显示有货但从哪个仓都发不出」，或「退款后库存凭空增加」。
此前 5 处代码各写各的、只有 2 处写了分仓——每加一个新入口就漏一次。

### 漂移巡检

```bash
GET  /api/warehouses/stock-drift           # 列出不一致的变体
POST /api/warehouses/stock-drift/repair    # 以分仓为准修复
```

这类问题不会抛异常，只能主动查。没有巡检就只能等买家投诉。

**规则：分仓是真相来源。** 修复时以 `SUM(warehouse_stock)` 重算聚合值，
而不是反过来——因为发货能力由分仓决定。

---

## 七、报关行对接

### 为什么需要适配器

各家报关服务商接口形态差异极大（REST+JSON / XML / FTP），不可能穷举。
`broker-adapter.ts` 定义一个最小契约，由 `generic_http` 实现：

```
请求  { declarationNo, destinationCountry, originCountry, declaredValue,
        declaredCurrency, lineItems[], sellerRef }
响应  { reference, status: 'accepted'|'rejected'|'pending', message? }
```

### 签名

`X-Flow-Signature: sha256=<hmac(secret, rawBody)>`——与 Stripe webhook 同款，
对方可用共享密钥做恒定时间校验。没有签名密钥时退化为 `Bearer` token，不裸奔。

### 重试策略

只对**网络错误与 5xx** 重试（指数退避，最多 3 次）。
4xx 是报文问题，重试只会重复触发对方校验日志，还可能被判为攻击。

### 状态流转

| 回执 | 单据状态 |
|---|---|
| `accepted` | `filed` |
| `rejected` | 保持 `draft`，`last_error` 记录原因 |
| `pending` | 保持 `draft`，等待对方异步回调 |

失败同样写回 `last_error` 与 `attempt_count`，可重试，不静默吞掉。

---

## 八、真实打款（Stripe Connect）

### 流程

1. 卖家开通收款账户 → 创建 Express 账户 → 保存 `acct_xxx` → 返回 onboarding 链接
2. 卖家填完资料 → 刷新账户状态（`payouts_enabled`）
3. 管理员在结算单上点"打款" → `POST /v1/transfers` → 回执写入 `payout_id`

### 幂等

Stripe 侧用结算单号做 `Idempotency-Key`；本地用条件更新（`status='pending'`）抢占。
两层保证重复点击不会打两次款——这是这类系统最贵的 bug。

### 前置条件

任一不满足就拒绝，不静默降级：结算单为 pending、卖家账户已验证、Stripe 已配置。

---

## 九、汇率刷新

定时刷新（`FX_REFRESH_MINUTES`，默认 15 分钟），双源回退：

1. `open.er-api.com`（每日更新）
2. `api.frankfurter.dev`（欧洲央行数据，工作日更新）

任一成功即停止；全部失败保留库中旧值并标记 `source=manual`，绝不 fallback 1:1。

---

## 十、已知边界

- **汇率仍是"分钟级"而非"秒级"**。做外汇敏感定价需要 WebSocket 行情源。
- **报关行只实现通用 HTTP 适配器**。对接具体服务商（如中国单一窗口）需要按对方
  协议另写适配器——表结构与状态回写已经就绪，换适配器不用改表。
- **打款只支持 Stripe Connect**。PayPal Payouts / 银行转账需要另加 provider。
- **多仓不覆盖"批次/效期"**。同一 SKU 的不同批次（生产日期、保质期）尚未分维度追踪。
