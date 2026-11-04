-- 0009: 资金与审批链路的可靠性地基
--
-- 三组改动，全部服务于「不可逆副作用必须可对账、可重放、不重复」：
--
-- 1) orders.idempotency_key —— 下单幂等锚点
--    同一买家/会话用同一幂等键重复提交（双击、超时重试、网关重放）只应产生一张订单。
--    唯一索引用部分索引（WHERE idempotency_key IS NOT NULL），历史数据与未提供键的
--    调用不受影响。
--
-- 2) refunds 幂等与在途状态
--    - provider_refund_id：渠道退款单号。渠道返回后立刻落库（不等业务事务），
--      使「渠道已退、业务写库失败」时仍能对账，绝不会被当成未退款再次发起。
--    - provider_state：none | inflight | succeeded | failed，渠道调用前后的显式状态。
--    - idempotency_key：调用渠道时使用的幂等键，重试沿用同一个值。
--
-- 3) copilot_actions 生命周期
--    - expires_at：待审批动作的过期时间，过期即不可执行（防旧审批被翻出来执行）。
--    - lease_until：processing 状态的租约，超时可被回收为 failed，避免永久悬挂。
--    - policy_snapshot：审批时固化的工具定义指纹（风险等级 + 参数 schema hash），
--      工具定义变更后旧审批自动失效。
--    - idempotency_key + 部分唯一索引：同一会话内同工具同参数只允许一条在途动作。

--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotency_key_idx"
  ON "orders" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "provider_refund_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "provider_state" varchar(16) NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_provider_refund_idx"
  ON "refunds" ("provider_refund_id")
  WHERE "provider_refund_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_provider_state_idx"
  ON "refunds" ("provider_state", "created_at");
--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN IF NOT EXISTS "lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN IF NOT EXISTS "policy_snapshot" text;
--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copilot_actions_idempotency_idx"
  ON "copilot_actions" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copilot_actions_lease_idx"
  ON "copilot_actions" ("status", "lease_until");
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "cached_input_tokens" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "cost_usd" numeric(12, 6);
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "trace_id" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_log_trace_idx" ON "ai_usage_log" ("trace_id");
