/**
 * 收货国家/地区列表。
 *
 * 为什么必须用下拉而不是自由文本：跨境税务按 ISO 3166-1 alpha-2 国家代码匹配税率，
 * 自由输入会出现 "Germany" / "de" / "德国" 三种写法，税率匹配不上 → 静默零税。
 * 这既是体验问题，也是合规问题。
 *
 * 覆盖范围：主要目标市场 + 常见目的地。code 必须与 server/common/pricing/tax.ts
 * 的键一致（大写 ISO 代码），否则结账页显示有税、实际算出无税。
 */
export interface CountryOption {
  code: string;
  nameZh: string;
  nameEn: string;
  nameEs: string;
  namePt: string;
}

export const COUNTRIES: readonly CountryOption[] = [
  { code: 'US', nameZh: '美国', nameEn: 'United States', nameEs: 'Estados Unidos', namePt: 'Estados Unidos' },
  { code: 'GB', nameZh: '英国', nameEn: 'United Kingdom', nameEs: 'Reino Unido', namePt: 'Reino Unido' },
  { code: 'DE', nameZh: '德国', nameEn: 'Germany', nameEs: 'Alemania', namePt: 'Alemanha' },
  { code: 'FR', nameZh: '法国', nameEn: 'France', nameEs: 'Francia', namePt: 'França' },
  { code: 'IT', nameZh: '意大利', nameEn: 'Italy', nameEs: 'Italia', namePt: 'Itália' },
  { code: 'ES', nameZh: '西班牙', nameEn: 'Spain', nameEs: 'España', namePt: 'Espanha' },
  { code: 'NL', nameZh: '荷兰', nameEn: 'Netherlands', nameEs: 'Países Bajos', namePt: 'Países Baixos' },
  { code: 'JP', nameZh: '日本', nameEn: 'Japan', nameEs: 'Japón', namePt: 'Japão' },
  { code: 'CA', nameZh: '加拿大', nameEn: 'Canada', nameEs: 'Canadá', namePt: 'Canadá' },
  { code: 'AU', nameZh: '澳大利亚', nameEn: 'Australia', nameEs: 'Australia', namePt: 'Austrália' },
  { code: 'SG', nameZh: '新加坡', nameEn: 'Singapore', nameEs: 'Singapur', namePt: 'Singapura' },
  { code: 'CN', nameZh: '中国', nameEn: 'China', nameEs: 'China', namePt: 'China' },
  { code: 'KR', nameZh: '韩国', nameEn: 'South Korea', nameEs: 'Corea del Sur', namePt: 'Coreia do Sul' },
  { code: 'HK', nameZh: '中国香港', nameEn: 'Hong Kong SAR', nameEs: 'Hong Kong', namePt: 'Hong Kong' },
  { code: 'TW', nameZh: '中国台湾', nameEn: 'Taiwan Region', nameEs: 'Taiwán', namePt: 'Taiwan' },
  { code: 'MY', nameZh: '马来西亚', nameEn: 'Malaysia', nameEs: 'Malasia', namePt: 'Malásia' },
  { code: 'TH', nameZh: '泰国', nameEn: 'Thailand', nameEs: 'Tailandia', namePt: 'Tailândia' },
  { code: 'VN', nameZh: '越南', nameEn: 'Vietnam', nameEs: 'Vietnam', namePt: 'Vietnã' },
  { code: 'ID', nameZh: '印度尼西亚', nameEn: 'Indonesia', nameEs: 'Indonesia', namePt: 'Indonésia' },
  { code: 'PH', nameZh: '菲律宾', nameEn: 'Philippines', nameEs: 'Filipinas', namePt: 'Filipinas' },
  { code: 'IN', nameZh: '印度', nameEn: 'India', nameEs: 'India', namePt: 'Índia' },
  { code: 'AE', nameZh: '阿联酋', nameEn: 'United Arab Emirates', nameEs: 'Emiratos Árabes', namePt: 'Emirados Árabes' },
  { code: 'SA', nameZh: '沙特阿拉伯', nameEn: 'Saudi Arabia', nameEs: 'Arabia Saudita', namePt: 'Arábia Saudita' },
  { code: 'BR', nameZh: '巴西', nameEn: 'Brazil', nameEs: 'Brasil', namePt: 'Brasil' },
  { code: 'MX', nameZh: '墨西哥', nameEn: 'Mexico', nameEs: 'México', namePt: 'México' },
  { code: 'CL', nameZh: '智利', nameEn: 'Chile', nameEs: 'Chile', namePt: 'Chile' },
  { code: 'ZA', nameZh: '南非', nameEn: 'South Africa', nameEs: 'Sudáfrica', namePt: 'África do Sul' },
  { code: 'NZ', nameZh: '新西兰', nameEn: 'New Zealand', nameEs: 'Nueva Zelanda', namePt: 'Nova Zelândia' },
  { code: 'CH', nameZh: '瑞士', nameEn: 'Switzerland', nameEs: 'Suiza', namePt: 'Suíça' },
  { code: 'NO', nameZh: '挪威', nameEn: 'Norway', nameEs: 'Noruega', namePt: 'Noruega' },
] as const;

/** 按当前语言取国家名 */
export function countryLabel(code: string, language: string): string {
  const c = COUNTRIES.find((x) => x.code === code.toUpperCase());
  if (!c) return code;
  switch (language) {
    case 'zh': return c.nameZh;
    case 'es': return c.nameEs;
    case 'pt': return c.namePt;
    default: return c.nameEn;
  }
}

/** 常见地址自动补全/校验用：把历史遗留的自由文本国家名归一为 ISO 代码 */
export function normalizeCountryCode(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  // 已经是合法代码
  if (COUNTRIES.some((c) => c.code === upper)) return upper;
  // 按任一语言名称匹配（历史数据里存过 "Germany"、"德国"）
  const lower = raw.toLowerCase();
  const found = COUNTRIES.find((c) =>
    c.nameEn.toLowerCase() === lower
    || c.nameZh === raw
    || c.nameEs.toLowerCase() === lower
    || c.namePt.toLowerCase() === lower);
  return found ? found.code : null;
}
