import { isPlatformAdmin, type ActorRole } from '../../common/tenant/tenant-scope';

export interface SettingActor {
  userId?: string;
  role?: ActorRole;
}

/** 平台级键的前缀分隔符 */
const SCOPE_PREFIX_SEP = ':';

/**
 * ai_settings 作用域键规则：
 * - admin → 平台全局键（无前缀，历史行为兼容）
 * - seller → `{userId}:{key}`，互不可见、不可覆盖全局键
 * - seller 无 userId → 回退全局键形式（仅用于查询；写入路径另行 fail-closed）
 */
export function scopedSettingKey(key: string, actor: SettingActor): string {
  if (isPlatformAdmin(actor.role) || !actor.userId) return key;
  return `${actor.userId}${SCOPE_PREFIX_SEP}${key}`;
}

/** 判定是否为平台全局键（无归属前缀） */
export function isPlatformSettingKey(key: string): boolean {
  return !key.includes(SCOPE_PREFIX_SEP);
}
