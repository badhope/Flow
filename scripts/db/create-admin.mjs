#!/usr/bin/env node
/**
 * 创建平台管理员账号（唯一入口；代码中 role='admin' 只认库内数据）。
 *
 * 用法：
 *   node scripts/db/create-admin.mjs <email> <password> [name]
 *
 * 规则：
 * - 密码至少 8 位且同时含字母与数字（与注册口径一致）
 * - 邮箱已存在时：若为 admin 则幂等成功（可重置密码），否则拒绝（防止把买家/卖家提权）
 * - 需 DATABASE_URL 环境变量（本地或 docker compose exec server 内运行）
 */
import postgres from 'postgres';
import bcrypt from 'bcrypt';

const [email, password, name = 'Platform Admin'] = process.argv.slice(2);

if (!email || !password) {
  console.error('用法: node scripts/db/create-admin.mjs <email> <password> [name]');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('密码至少 8 位且必须同时包含字母与数字');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[create-admin] DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await sql`
    SELECT id, role FROM users WHERE email = ${normalizedEmail} LIMIT 1
  `;

  if (existing.length > 0) {
    const row = existing[0];
    if (row.role === 'admin') {
      const hash = await bcrypt.hash(password, 10);
      await sql`
        UPDATE users SET password_hash = ${hash}, updated_at = now() WHERE id = ${row.id}
      `;
      console.log(`管理员已存在，密码已重置: ${normalizedEmail}`);
    } else {
      console.error(`拒绝：${normalizedEmail} 已存在且角色为 ${row.role}，不允许提权为 admin`);
      process.exitCode = 1;
    }
  } else {
    const hash = await bcrypt.hash(password, 10);
    await sql`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (${normalizedEmail}, ${hash}, ${name}, 'admin')
    `;
    console.log(`管理员已创建: ${normalizedEmail}`);
  }
} catch (err) {
  console.error('[create-admin] failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
