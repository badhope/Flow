-- 0013: 批次 / 效期追踪
--
-- 设计取舍：批次是**分仓库存的子维度**，不是替代品。
-- warehouse_stock.stock 仍然是"该仓该 SKU 的总量"（既有查询全靠它），
-- 批次库存按 (warehouse, variant, batch) 记录明细。
-- 约束：SUM(批次库存) = warehouse_stock.stock，由服务层在事务内保证。
--
-- 为什么不把 stock 拆掉重做：全站有大量查询依赖聚合字段，
-- 拆表意味着所有读取路径都要改，风险远大于收益。

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "variant_id" uuid NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  -- 供应商/内部批次号，同一 SKU 可有多批
  "batch_no" varchar(64) NOT NULL,
  "quantity" integer NOT NULL DEFAULT 0,
  -- 生产日期与到期日：到期日是 FIFO 与临期预警的依据
  "produced_at" timestamptz,
  "expires_at" timestamptz,
  -- supplier=采购入库 / transfer=调拨 / return=退货入库
  "source" varchar(20) NOT NULL DEFAULT 'supplier',
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_batches_unique"
  ON "stock_batches" ("warehouse_id", "variant_id", "batch_no");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_batches_expiry_idx"
  ON "stock_batches" ("expires_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_batches_variant_idx"
  ON "stock_batches" ("variant_id", "warehouse_id");

--> statement-breakpoint
-- 订单行记录实际消耗的批次（快照），用于追溯与召回
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "batch_allocations" jsonb NOT NULL DEFAULT '[]'::jsonb;

--> statement-breakpoint
-- 老数据兼容：为已有分仓库存生成一个"无批次号"的默认批次，
-- 保证 SUM(批次) = warehouse_stock.stock 这条不变量从一开始就成立。
INSERT INTO "stock_batches" ("seller_id", "variant_id", "warehouse_id", "batch_no", "quantity", "source", "note")
SELECT
  w."seller_id",
  ws."variant_id",
  ws."warehouse_id",
  'LEGACY',
  ws."stock",
  'supplier',
  '迁移生成的默认批次（历史库存无批次信息）'
FROM "warehouse_stock" ws
JOIN "warehouses" w ON w."id" = ws."warehouse_id"
WHERE ws."stock" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "stock_batches" b
    WHERE b."warehouse_id" = ws."warehouse_id" AND b."variant_id" = ws."variant_id"
  );
