-- 0008: ai_settings.key 从 varchar(50) 拓宽到 varchar(120)
-- 原因：卖家作用域键格式为 `{uuid36}:{key36}`，最长
--   `{uuid}:copilot_watch_last_snapshot` = 36 + 1 + 27 = 64 字符，
--   超出原 50 上限，导致巡检设置写入 500（E2E copilot 冒烟发现）。
ALTER TABLE "ai_settings" ALTER COLUMN "key" TYPE varchar(120);