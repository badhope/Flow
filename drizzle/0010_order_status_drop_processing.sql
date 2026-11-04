-- 0010: 删除 order_status 里从未使用的 'processing'
--
-- 背景：`order_status` 枚举声明了 processing，但状态机（order-status.ts）没有任何
-- 迁移指向它，业务代码也从不写入。它对外暴露成一个真实可用的状态，前端下拉框、
-- API 文档、Copilot 工具参数都按它生成，等于给集成方发了一个「永远达不到」的选项。
--
-- PostgreSQL 不支持 DROP VALUE，用「新建枚举 + 换列」的标准做法。表数据里若存在
-- 该值先归一为 paid（语义上最接近：已付款未发货），再切换。
--> statement-breakpoint
UPDATE "orders" SET "status" = 'paid' WHERE "status" = 'processing';
--> statement-breakpoint
ALTER TYPE "order_status" RENAME TO "order_status_old";
--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM (
  'pending_payment', 'paid', 'shipped',
  'delivered', 'cancelled', 'refunded', 'partially_refunded'
);
--> statement-breakpoint
ALTER TABLE "orders"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "order_status" USING "status"::text::"order_status";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending_payment';
--> statement-breakpoint
DROP TYPE "order_status_old";
