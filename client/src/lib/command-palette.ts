/**
 * 命令面板的匹配规则（纯函数，便于测试且与渲染解耦）：
 * - 空输入：只给导航
 * - 有输入：AI 兜底永远排第一（自然语言优先于页面跳转）
 * - 导航命中 label 或 hint，大小写不敏感
 */
export interface PaletteNavItem {
  id: string;
  label: string;
  hint?: string;
  path: string;
}

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  kind: 'navigate' | 'ask';
  path?: string;
  query?: string;
}

export function buildPaletteItems(query: string, nav: PaletteNavItem[]): PaletteItem[] {
  const q = query.trim();
  if (!q) {
    return nav.map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.hint,
      kind: 'navigate' as const,
      path: item.path,
    }));
  }

  const lower = q.toLowerCase();
  const matched = nav
    .filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        (item.hint ?? '').toLowerCase().includes(lower),
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.hint,
      kind: 'navigate' as const,
      path: item.path,
    }));

  return [
    { id: 'ask-ai', label: `问 AI：${q}`, hint: '交给运营副驾', kind: 'ask' as const, query: q },
    ...matched,
  ];
}
