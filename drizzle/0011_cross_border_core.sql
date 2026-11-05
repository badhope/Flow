-- 0011: 多币种 + HS 编码 + 库存预留 + 卖家结算
--
-- 四块一起上，因为它们共享"跨境交易全链路"这一条主线：
--   1. 多币种：订单/支付必须记录币种与结算汇率，否则跨境报价无法复算
--   2. HS 编码：商品级的报关品目，清关单据的依据
--   3. 库存预留：区分"已扣减"与"临时占用"，避免超卖
--   4. 卖家结算：平台抽成与结算单，卖家侧的对账基础
--
-- 全部采用可空 / 有默认值的加法式变更，不破坏既有数据。

--> statement-breakpoint
-- ========== 1. 多币种 ==========

-- 平台外币种表：由定时任务从公开汇率源刷新，也可手工覆盖
CREATE TABLE IF NOT EXISTS "currencies" (
  "code" varchar(3) PRIMARY KEY,
  "name_zh" varchar(50) NOT NULL DEFAULT '',
  "name_en" varchar(50) NOT NULL DEFAULT '',
  "symbol" varchar(8) NOT NULL DEFAULT '',
  "decimal_digits" integer NOT NULL DEFAULT 2,
  -- 相对 USD 的汇率：1 USD = rate 个该币种
  "rate_to_usd" decimal(18, 8) NOT NULL DEFAULT '1',
  "rate_source" varchar(20) NOT NULL DEFAULT 'manual',
  "rate_updated_at" timestamptz,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
INSERT INTO "currencies" ("code", "name_zh", "name_en", "symbol", "rate_to_usd", "rate_source", "enabled")
VALUES
  ('USD', '美元', 'US Dollar', '$', 1, 'builtin', true),
  ('EUR', '欧元', 'Euro', '€', 0.92, 'builtin', true),
  ('GBP', '英镑', 'British Pound', '£', 0.79, 'builtin', true),
  ('CNY', '人民币', 'Chinese Yuan', '¥', 7.10, 'builtin', true),
  ('JPY', '日元', 'Japanese Yen', '¥', 149.50, 'builtin', true),
  ('CAD', '加元', 'Canadian Dollar', 'C$', 1.36, 'builtin', true),
  ('AUD', '澳元', 'Australian Dollar', 'A$', 1.52, 'builtin', true),
  ('SGD', '新加坡元', 'Singapore Dollar', 'S$', 1.34, 'builtin', true),
  ('KRW', '韩元', 'South Korean Won', '₩', 1330.00, 'builtin', true),
  ('HKD', '港币', 'Hong Kong Dollar', 'HK$', 7.82, 'builtin', true)
ON CONFLICT ("code") DO NOTHING;

--> statement-breakpoint
-- 订单币种 + 下单时的结算汇率（汇率变动后仍能复算历史订单）
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "currency" varchar(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "exchange_rate" decimal(18, 8) NOT NULL DEFAULT '1',
  -- 以 USD 计的金额，用于跨币种统计与结算（避免每次查询都做汇率换算）
  ADD COLUMN IF NOT EXISTS "base_total_amount" decimal(12, 2) NOT NULL DEFAULT '0';

--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "exchange_rate" decimal(18, 8) NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS "base_amount" decimal(12, 2) NOT NULL DEFAULT '0';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_currency_idx" ON "orders" ("currency");

--> statement-breakpoint
-- ========== 2. HS 编码 / 清关 ==========

ALTER TABLE "products"
  -- 国际统一商品编码（Harmonized System），清关必填
  ADD COLUMN IF NOT EXISTS "hs_code" varchar(20),
  -- 原产国（影响关税优惠，如 RCEP/USMCA）
  ADD COLUMN IF NOT EXISTS "origin_country" varchar(2),
  -- 报关用英文品名与材质（与展示标题分开，报关有格式要求）
  ADD COLUMN IF NOT EXISTS "customs_name_en" varchar(255),
  ADD COLUMN IF NOT EXISTS "customs_material_en" varchar(255);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_hs_code_idx" ON "products" ("hs_code");

--> statement-breakpoint
-- 清关单据：一单一记录，JSON 存行项目快照（商品改动不影响历史单据）
CREATE TABLE IF NOT EXISTS "customs_declarations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "declaration_no" varchar(40) NOT NULL UNIQUE,
  "seller_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- draft=已生成 / filed=已申报 / cleared=已放行
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "destination_country" varchar(2) NOT NULL DEFAULT '',
  "origin_country" varchar(2) NOT NULL DEFAULT '',
  -- 申报总价值（订单币种 + USD 双记）
  "declared_value" decimal(12, 2) NOT NULL DEFAULT '0',
  "declared_currency" varchar(3) NOT NULL DEFAULT 'USD',
  "declared_value_usd" decimal(12, 2) NOT NULL DEFAULT '0',
  -- 行项目快照：[{ hsCode, description, quantity, unitValue, origin, weightKg }]
  "line_items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "filed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customs_declarations_order_idx" ON "customs_declarations" ("order_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_seller_idx" ON "customs_declarations" ("seller_id");

--> statement-breakpoint
-- ========== 3. 库存预留 ==========

-- 预留记录：active=占用中 / consumed=已转为实际扣减 / released=已释放
--
-- 为什么需要它：此前只有"下单即扣减"一种状态。取消/超时能回补，
-- 但无法表达"暂时占用、到期自动释放"这种更细的粒度，
-- 也无法回答"这个 SKU 有多少是被订单占用、多少是真可用"。
CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_no" varchar(32),
  "quantity" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  -- soft=下单时软预留（可被释放）/ hard=支付后转硬扣减
  "kind" varchar(10) NOT NULL DEFAULT 'soft',
  "expires_at" timestamptz,
  "released_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_reservations_variant_status_idx"
  ON "stock_reservations" ("variant_id", "status");
CREATE INDEX IF NOT EXISTS "stock_reservations_order_idx"
  ON "stock_reservations" ("order_id");
-- 同一订单同一变体只允许一条 active 预留，避免重复占用
CREATE UNIQUE INDEX IF NOT EXISTS "stock_reservations_active_unique"
  ON "stock_reservations" ("order_id", "variant_id")
  WHERE "status" = 'active';

--> statement-breakpoint
-- ========== 4. 卖家结算 / 佣金 ==========

-- 平台抽成规则：按卖家可配，缺省用全局默认
CREATE TABLE IF NOT EXISTS "commission_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  -- 百分比，如 8.00 表示 8%
  "rate" decimal(6, 3) NOT NULL DEFAULT '8.000',
  -- 固定手续费（每单），用于覆盖支付通道成本
  "fixed_fee" decimal(10, 2) NOT NULL DEFAULT '0',
  -- 固定手续费的币种
  "fixed_fee_currency" varchar(3) NOT NULL DEFAULT 'USD',
  "note" varchar(255),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
-- seller_id 为 NULL 表示全局默认规则
CREATE UNIQUE INDEX IF NOT EXISTS "commission_rules_seller_unique"
  ON "commission_rules" ("seller_id") WHERE "seller_id" IS NOT NULL;

--> statement-breakpoint
INSERT INTO "commission_rules" ("seller_id", "rate", "fixed_fee", "note")
SELECT NULL, 8.000, 0, '平台默认抽成 8%'
WHERE NOT EXISTS (SELECT 1 FROM "commission_rules" WHERE "seller_id" IS NULL);

--> statement-breakpoint
-- 结算单：按周期汇总已履约订单，扣除退款与佣金
CREATE TABLE IF NOT EXISTS "settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "settlement_no" varchar(40) NOT NULL UNIQUE,
  "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- pending=待确认 / paid=已打款 / cancelled=已取消
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'USD',
  -- 汇总金额（结算币种）
  "gross_amount" decimal(12, 2) NOT NULL DEFAULT '0',
  "refund_amount" decimal(12, 2) NOT NULL DEFAULT '0',
  "commission_amount" decimal(12, 2) NOT NULL DEFAULT '0',
  "net_amount" decimal(12, 2) NOT NULL DEFAULT '0',
  -- 订单数
  "order_count" integer NOT NULL DEFAULT 0,
  "refund_count" integer NOT NULL DEFAULT 0,
  -- 佣金规则快照（费率改动不影响历史结算单）
  "commission_rate" decimal(6, 3) NOT NULL DEFAULT '0',
  "fixed_fee_total" decimal(12, 2) NOT NULL DEFAULT '0',
  -- 明细快照：[{ orderNo, paidAt, gross, refund, commission, net }]
  "line_items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "paid_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_seller_status_idx"
  ON "settlements" ("seller_id", "status");
CREATE INDEX IF NOT EXISTS "settlements_period_idx"
  ON "settlements" ("period_start", "period_end");
