-- 0012: 多仓 + 报关行对接 + Stripe Connect 打款
--
-- 三块共享同一条主线：把"平台"从"单店工具"推进到"可运营的跨境基础设施"。
--   1. 多仓：仓库维度、分仓库存、调拨单
--   2. 报关行：申报回执、对接凭据、失败重试
--   3. 打款：Stripe Connect 账户与转账流水
--
-- 继续采用加法式变更；既有单仓数据自动归入默认仓。

--> statement-breakpoint
-- ========== 1. 多仓 ==========

CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "code" varchar(32) NOT NULL,
  -- 仓库所在国（决定发货时效与是否跨境）
  "country" varchar(2) NOT NULL DEFAULT 'CN',
  "address" text,
  "contact_name" varchar(100),
  "contact_phone" varchar(30),
  -- 优先级：同一 SKU 多仓有货时，数字小的优先发货
  "priority" integer NOT NULL DEFAULT 100,
  "is_default" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_seller_code_unique"
  ON "warehouses" ("seller_id", "code");

--> statement-breakpoint
-- 每个卖家一个默认仓（承接历史单仓数据）
INSERT INTO "warehouses" ("seller_id", "name", "code", "country", "is_default", "priority")
SELECT DISTINCT p."seller_id", '默认仓', 'DEFAULT', 'CN', true, 100
FROM "products" p
WHERE NOT EXISTS (
  SELECT 1 FROM "warehouses" w WHERE w."seller_id" = p."seller_id" AND w."code" = 'DEFAULT'
);

--> statement-breakpoint
-- 分仓库存：真实可售数量按仓拆分
CREATE TABLE IF NOT EXISTS "warehouse_stock" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "stock" integer NOT NULL DEFAULT 0,
  -- 安全库存：低于该值触发预警（不参与可售计算）
  "safety_stock" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_stock_unique"
  ON "warehouse_stock" ("warehouse_id", "variant_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_stock_variant_idx"
  ON "warehouse_stock" ("variant_id");

--> statement-breakpoint
-- 把既有变体库存灌入默认仓，保证升级后库存不丢
INSERT INTO "warehouse_stock" ("warehouse_id", "variant_id", "stock")
SELECT w."id", v."id", v."stock"
FROM "product_variants" v
JOIN "products" p ON p."id" = v."product_id"
JOIN "warehouses" w ON w."seller_id" = p."seller_id" AND w."code" = 'DEFAULT'
WHERE NOT EXISTS (
  SELECT 1 FROM "warehouse_stock" ws WHERE ws."warehouse_id" = w."id" AND ws."variant_id" = v."id"
);

--> statement-breakpoint
-- 库存预留增加仓库维度
ALTER TABLE "stock_reservations"
  ADD COLUMN IF NOT EXISTS "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE SET NULL;

--> statement-breakpoint
-- 订单行记录发货仓
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE SET NULL;

--> statement-breakpoint
-- 调拨单：仓间转移
CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_no" varchar(40) NOT NULL UNIQUE,
  "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "from_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "to_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL,
  -- pending=待发货 / shipped=在途 / completed=已入库 / cancelled=已取消
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "note" text,
  "shipped_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_transfers_seller_idx"
  ON "stock_transfers" ("seller_id", "status");

--> statement-breakpoint
-- ========== 2. 报关行对接 ==========

-- 报关行凭据与配置（按卖家，可对接不同报关服务商）
CREATE TABLE IF NOT EXISTS "customs_broker_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- 适配器类型：generic_http=通用 JSON 接口
  "provider" varchar(32) NOT NULL DEFAULT 'generic_http',
  "endpoint" text NOT NULL,
  -- 凭据以 JSON 保存（apiKey / secret / accountId 等，按适配器解释）
  "credentials" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 签名密钥（HMAC-SHA256 体签名）
  "signing_secret" text,
  "enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customs_broker_configs_seller_unique"
  ON "customs_broker_configs" ("seller_id");

--> statement-breakpoint
-- 申报回执：每次向报关行提交都留一条，失败可重试
ALTER TABLE "customs_declarations"
  ADD COLUMN IF NOT EXISTS "broker_ref" varchar(120),
  ADD COLUMN IF NOT EXISTS "broker_status" varchar(40),
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;

--> statement-breakpoint
-- ========== 3. Stripe Connect 打款 ==========

-- 卖家收款账户
CREATE TABLE IF NOT EXISTS "payout_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" varchar(30) NOT NULL DEFAULT 'stripe',
  -- Stripe Connect 账户 id（acct_xxx）
  "external_account_id" varchar(120) NOT NULL,
  -- pending=资料未完成 / verified=可收款 / restricted=受限
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "currency" varchar(3) NOT NULL DEFAULT 'USD',
  "country" varchar(2) NOT NULL DEFAULT 'CN',
  "payouts_enabled" boolean NOT NULL DEFAULT false,
  "details_submitted" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payout_accounts_seller_provider_unique"
  ON "payout_accounts" ("seller_id", "provider");

--> statement-breakpoint
-- 结算单增加打款流水
ALTER TABLE "settlements"
  ADD COLUMN IF NOT EXISTS "payout_id" varchar(120),
  ADD COLUMN IF NOT EXISTS "payout_provider" varchar(30),
  ADD COLUMN IF NOT EXISTS "payout_error" text;
