import { Decimal } from 'decimal.js';

/**
 * 跨境订单税务与完税成本计算。
 *
 * 为什么必须做：本项目是「跨境」平台，但此前 `computeOrderPricing` 把税额写死为 0，
 * DTO 里预留了 `taxAmount` 字段却从不赋值，也没有 HS 编码/关税/VAT 的概念。
 * 对跨境交易而言这不是"少个功能"，而是**报价不成立**——
 * 买家结账看到的金额低于实际到手成本，卖家要自己吞掉差额或事后追讨。
 *
 * 设计原则（按可靠性优先，而不是"看起来智能"）：
 *   1. **确定性**：同样的输入永远得到同样的税，不调用任何外部服务。
 *   2. **可解释**：每一分钱都能说出依据（哪条税率、哪个门槛、哪段运费）。
 *   3. **宁严勿松**：目的国未配置税率时，明确标记 `unknown` 并让调用方决定
 *      （默认按 0 计但打标），绝不假装"免税"。
 *   4. **可覆盖**：卖家级配置 > 目的国默认表，便于真实业务微调。
 */

/** 目的地计税配置 */
export interface TaxRule {
  /** ISO 3166-1 alpha-2 国家代码 */
  country: string;
  /** 增值税/消费税税率（百分比，如 20 表示 20%） */
  vatRate: number;
  /** 关税税率（百分比） */
  dutyRate: number;
  /**
   * 关税起征点（货值低于该值**免关税**，不等于免 VAT）。
   * 欧盟 IOSS 的 150 EUR、日本的 10,000 JPY 都是这个含义：
   * VAT/GST 通常仍按低值征收，只有关税被免除。
   */
  deMinimis?: number;
  /** 税基是否含运费（欧盟 VAT 含运费，美国销售税通常不含） */
  taxableShipping: boolean;
  /** 展示给卖家的说明 */
  note?: string;
}

/**
 * 自由文本国家名 -> ISO 代码的别名表。
 *
 * 存在的理由：订单表里的 `shippingCountry` 是历史自由文本字段，
 * 老数据存的是 "Germany"、"美国" 这类写法。税务匹配只认 ISO 代码，
 * 不做归一就会静默零税——买家少付的钱由卖家承担。
 */
const COUNTRY_ALIASES: Record<string, string> = {
  'united states': 'US', 'usa': 'US', 'america': 'US', '美国': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB', '英国': 'GB',
  'germany': 'DE', 'deutschland': 'DE', '德国': 'DE',
  'france': 'FR', '法国': 'FR',
  'italy': 'IT', 'italia': 'IT', '意大利': 'IT',
  'spain': 'ES', 'españa': 'ES', 'espana': 'ES', '西班牙': 'ES',
  'netherlands': 'NL', 'holland': 'NL', '荷兰': 'NL',
  'japan': 'JP', '日本': 'JP',
  'canada': 'CA', '加拿大': 'CA',
  'australia': 'AU', '澳大利亚': 'AU',
  'singapore': 'SG', '新加坡': 'SG',
  'china': 'CN', '中国': 'CN',
  'south korea': 'KR', 'korea': 'KR', '韩国': 'KR',
};

/** 把自由文本国家归一为 ISO 代码；无法识别时返回大写原值（交由税率表判定 unknown） */
export function normalizeCountry(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
  // 已经是两位代码
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return raw.toUpperCase();
}

/**
 * 目的国默认税率表。
 *
 * 数值来源为各国公开的跨境电商通用税率（标准档），用于**报价预估**而非最终清关；
 * 真实清关金额以目的国海关认定为准，这一点必须在 UI 上明确说明，
 * 不能让买家以为这是"法定税额"。
 *
 * 只收录本项目主要目标市场；未收录的国家会返回 null，由调用方标记为 unknown。
 */
const DEFAULT_RULES: Record<string, Omit<TaxRule, 'country'>> = {
  // 欧盟（IOSS 统一规则：≤150 EUR 免征关税，VAT 按目的国标准税率）
  DE: { vatRate: 19, dutyRate: 0, deMinimis: 150, taxableShipping: true, note: 'EU IOSS：≤150 EUR 免关税' },
  FR: { vatRate: 20, dutyRate: 0, deMinimis: 150, taxableShipping: true, note: 'EU IOSS：≤150 EUR 免关税' },
  IT: { vatRate: 22, dutyRate: 0, deMinimis: 150, taxableShipping: true, note: 'EU IOSS：≤150 EUR 免关税' },
  ES: { vatRate: 21, dutyRate: 0, deMinimis: 150, taxableShipping: true, note: 'EU IOSS：≤150 EUR 免关税' },
  NL: { vatRate: 21, dutyRate: 0, deMinimis: 150, taxableShipping: true, note: 'EU IOSS：≤150 EUR 免关税' },
  // 英国（£135 以下由卖家代征 VAT）
  GB: { vatRate: 20, dutyRate: 0, deMinimis: 135, taxableShipping: true, note: '≤£135 由卖家代征 VAT' },
  // 美国：无联邦 VAT，各州销售税差异极大，这里不臆造州税
  US: { vatRate: 0, dutyRate: 0, taxableShipping: false, note: '美国无联邦增值税；州销售税需按 Nexus 单独配置' },
  // 日本：进口消费税 10%，货值 ≤10000 JPY 免税
  JP: { vatRate: 10, dutyRate: 0, deMinimis: 10000, taxableShipping: true, note: '≤10,000 JPY 免税' },
  // 加拿大
  CA: { vatRate: 5, dutyRate: 0, deMinimis: 40, taxableShipping: true, note: 'GST 5%；≤CAD 40 免税' },
  // 澳大利亚：GST 10%，低值进口商品也需征收
  AU: { vatRate: 10, dutyRate: 0, taxableShipping: true, note: '低值进口商品同样征收 GST' },
  // 新加坡：GST 9%
  SG: { vatRate: 9, dutyRate: 0, taxableShipping: true, note: '低值商品由卖家代征 GST' },
  // 中国（跨境电商零售进口：增值税 13% × 70% = 9.1%，此处按常见综合税率给出）
  CN: { vatRate: 9.1, dutyRate: 0, taxableShipping: true, note: '跨境电商零售进口综合税率' },
};

export interface TaxBreakdownItem {
  /** duty=关税 / vat=增值税消费税 */
  kind: 'duty' | 'vat';
  /** 税基（货值或货值+运费） */
  base: string;
  /** 税率百分比 */
  rate: number;
  /** 计算出的税额 */
  amount: string;
  label: string;
}

export interface TaxComputation {
  /** 合计税额 */
  total: string;
  /** 明细，用于结账页逐条展示 */
  breakdown: TaxBreakdownItem[];
  /** known=已按目的国规则计算 / unknown=未收录该国家，税额按 0 计 */
  status: 'known' | 'unknown';
  /** 是否触发起征点免税 */
  deMinimisApplied: boolean;
  /** 面向买家/卖家的说明（含"预估非最终"声明） */
  note: string;
}

export interface TaxInput {
  /** 商品小计（不含运费） */
  subtotal: string | number;
  /** 运费 */
  shippingFee: string | number;
  /** 折扣金额（税基通常为折后价） */
  discountAmount?: string | number;
  /** ISO 国家代码 */
  country: string;
  /** 卖家级覆盖规则（优先于默认表） */
  override?: TaxRule | null;
}

const SCALE = 2;

/**
 * 计算税额。
 *
 * 顺序很重要：先用**折后**货值判断起征点，再决定是否征税。
 * 若先用原价判断，会出现"打完折明明低于起征点却仍被征税"的错误。
 */
export function computeTax(input: TaxInput): TaxComputation {
  const country = normalizeCountry(input.country);
  const known = country && Object.prototype.hasOwnProperty.call(DEFAULT_RULES, country)
    ? { country, ...DEFAULT_RULES[country] }
    : null;
  const rule = input.override ?? known;

  if (!rule) {
    return {
      total: '0.00',
      breakdown: [],
      status: 'unknown',
      deMinimisApplied: false,
      note: country
        ? `未收录 ${country} 的税率规则，税额按 0 预估；实际清关可能产生额外费用`
        : '未提供收货国家，税额按 0 预估',
    };
  }

  const subtotal = Decimal.max(new Decimal(input.subtotal || 0), 0);
  const shipping = Decimal.max(new Decimal(input.shippingFee || 0), 0);
  const discount = Decimal.min(Decimal.max(new Decimal(input.discountAmount || 0), 0), subtotal);

  // 折后货值：起征点判定与关税税基都用它
  const netGoods = subtotal.minus(discount);

  // 起征点只豁免关税。VAT/GST 在低值进口中通常照收，
  // 把两者混为一谈会让平台少收 VAT —— 这在欧盟属于违规。
  const dutyExempt = rule.deMinimis !== undefined && netGoods.lessThanOrEqualTo(rule.deMinimis);

  const breakdown: TaxBreakdownItem[] = [];
  let total = new Decimal(0);

  // 关税：只按货值计（运费不计入关税税基，国际惯例）
  if (!dutyExempt && rule.dutyRate > 0) {
    const duty = netGoods.mul(rule.dutyRate).div(100);
    total = total.plus(duty);
    breakdown.push({
      kind: 'duty',
      base: netGoods.toFixed(SCALE),
      rate: rule.dutyRate,
      amount: duty.toFixed(SCALE),
      label: `关税 ${rule.dutyRate}%`,
    });
  }

  // VAT/GST：不受关税起征点影响
  if (rule.vatRate > 0) {
    const vatBase = rule.taxableShipping ? netGoods.plus(shipping) : netGoods;
    const vat = vatBase.mul(rule.vatRate).div(100);
    total = total.plus(vat);
    breakdown.push({
      kind: 'vat',
      base: vatBase.toFixed(SCALE),
      rate: rule.vatRate,
      amount: vat.toFixed(SCALE),
      label: `增值税 ${rule.vatRate}%`,
    });
  }

  return {
    total: total.toFixed(SCALE),
    breakdown,
    status: 'known',
    deMinimisApplied: dutyExempt,
    note: buildNote(rule, dutyExempt),
  };
}

function buildNote(rule: TaxRule, dutyExempt: boolean): string {
  const parts: string[] = [];
  if (dutyExempt && rule.deMinimis !== undefined) {
    parts.push(`货值未超过起征点 ${rule.deMinimis}，免征关税（增值税仍按低值征收）`);
  }
  if (rule.note) parts.push(rule.note);
  // 必须声明这是预估：清关金额由目的国海关最终认定
  parts.push('税额为下单预估，最终以目的国海关认定为准');
  return parts.join('；');
}

/** 查询某国的规则（供设置页展示"已支持哪些市场"） */
export function getTaxRule(country: string): TaxRule | null {
  const code = (country ?? '').trim().toUpperCase();
  // 用 hasOwn 而不是直接下标：`DEFAULT_RULES['constructor']` 会拿到原型上的函数，
  // 让任意字符串都被判为"已收录"。
  if (!code || !Object.prototype.hasOwnProperty.call(DEFAULT_RULES, code)) return null;
  return { country: code, ...DEFAULT_RULES[code] };
}

/** 已支持的国家列表（含税率摘要），用于卖家端展示 */
export function listSupportedCountries(): Array<{ country: string; vatRate: number; dutyRate: number; deMinimis?: number }> {
  return Object.entries(DEFAULT_RULES).map(([country, rule]) => ({
    country,
    vatRate: rule.vatRate,
    dutyRate: rule.dutyRate,
    deMinimis: rule.deMinimis,
  }));
}
