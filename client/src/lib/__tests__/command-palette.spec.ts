import { describe, expect, it } from 'vitest';
import { buildPaletteItems, type PaletteNavItem } from '@/lib/command-palette';

const nav: PaletteNavItem[] = [
  { id: 'n-copilot', label: 'AI 运营副驾', hint: '对话 · 工具调用 · 审批', path: '/seller/copilot' },
  { id: 'n-dash', label: '数据看板', hint: 'GMV · 趋势 · 分类', path: '/seller/dashboard' },
  { id: 'n-products', label: '商品管理', hint: 'SPU/SKU', path: '/seller/products' },
];

describe('command-palette R4: 命令面板匹配与 AI 兜底', () => {
  it('R4: 空输入只返回导航项，不出现 AI 兜底', () => {
    const items = buildPaletteItems('', nav);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.kind === 'navigate')).toBe(true);
  });

  it('R4: 有输入时 AI 动作排在最前（保证自然语言优先）', () => {
    const items = buildPaletteItems('退款', nav);
    expect(items[0].kind).toBe('ask');
    expect(items[0].label).toContain('退款');
  });

  it('R4: 中文标签与英文提示都可命中', () => {
    expect(buildPaletteItems('看板', nav).some((i) => i.id === 'n-dash')).toBe(true);
    expect(buildPaletteItems('gmv', nav).some((i) => i.id === 'n-dash')).toBe(true);
  });

  it('R4: 无匹配导航时仍保留 AI 兜底（不会走到死路）', () => {
    const items = buildPaletteItems('把低库存商品清仓', nav);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('ask');
  });

  it('R4: 空白输入不生成 AI 动作', () => {
    expect(buildPaletteItems('   ', nav).every((i) => i.kind === 'navigate')).toBe(true);
  });

  it('R4: 匹配大小写不敏感', () => {
    expect(buildPaletteItems('gmv', nav).some((i) => i.kind === 'navigate')).toBe(true);
    expect(buildPaletteItems('GMV', nav).some((i) => i.kind === 'navigate')).toBe(true);
  });
});
