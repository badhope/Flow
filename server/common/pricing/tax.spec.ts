import { describe, expect, it } from 'vitest';
import { computeTax, getTaxRule, listSupportedCountries, normalizeCountry } from './tax';

/**
 * 跨境税额计算的契约。
 *
 * 背景：此前 taxAmount 被硬编码为 0，跨境订单报价低于真实到手成本。
 * 这些用例把"必须算对"的边界钉死：起征点、税基是否含运费、未收录国家的诚实降级。
 */
describe('cross-border tax', () => {
  it('T1: 欧盟国家按折后货值 + 运费计 VAT', () => {
    // DE: VAT 19%，含运费，起征点 150
    const r = computeTax({
      subtotal: '100.00',
      shippingFee: '10.00',
      discountAmount: '0',
      country: 'DE',
    });
    expect(r.status).toBe('known');
    // (100 + 10) * 19% = 20.90
    expect(r.total).toBe('20.90');
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].kind).toBe('vat');
    expect(r.breakdown[0].base).toBe('110.00');
  });

  it('T2: 折扣会降低 VAT 税基', () => {
    const full = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country: 'DE' });
    const discounted = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '20.00', country: 'DE' });
    // 100*19% = 19.00 → 80*19% = 15.20
    expect(full.total).toBe('19.00');
    expect(discounted.total).toBe('15.20');
  });

  it('T3: 起征点只免关税，VAT 仍按低值征收', () => {
    // 折后货值 100 <= 150，免关税；但 VAT 照收（EU IOSS 真实规则）
    const r = computeTax({
      subtotal: '200.00',
      shippingFee: '10.00',
      discountAmount: '100.00',
      country: 'DE',
    });
    expect(r.deMinimisApplied).toBe(true);
    // (100 + 10) * 19% = 20.90
    expect(r.total).toBe('20.90');
    expect(r.note).toContain('起征点');
    expect(r.note).toContain('增值税仍按低值征收');
  });

  it('T4: 超过起征点后正常计税', () => {
    const r = computeTax({ subtotal: '300.00', shippingFee: '0', discountAmount: '0', country: 'DE' });
    expect(r.deMinimisApplied).toBe(false);
    expect(r.total).toBe('57.00'); // 300 * 19%
  });

  it('T5: 美国不含运费计税（各州差异大，只算 0 联邦税）', () => {
    const r = computeTax({ subtotal: '100.00', shippingFee: '20.00', discountAmount: '0', country: 'US' });
    expect(r.status).toBe('known');
    // 美国联邦 VAT = 0，不应凭空产生税额
    expect(r.total).toBe('0.00');
    expect(r.note).toContain('州销售税');
  });

  it('T6: 未收录国家返回 unknown 而不是假装免税', () => {
    const r = computeTax({ subtotal: '100.00', shippingFee: '5.00', discountAmount: '0', country: 'ZZ' });
    expect(r.status).toBe('unknown');
    expect(r.total).toBe('0.00');
    // 必须明确告知可能产生额外费用，不能让买家以为免税
    expect(r.note).toContain('未收录');
    expect(r.note).toContain('额外费用');
  });

  it('T7: 国家代码大小写不敏感', () => {
    const upper = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country: 'JP' });
    const lower = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country: 'jp' });
    expect(upper.total).toBe(lower.total);
    expect(upper.status).toBe('known');
  });

  it('T8: 日本起征点 10000 只影响关税，消费税照收', () => {
    const under = computeTax({ subtotal: '9000', shippingFee: '0', discountAmount: '0', country: 'JP' });
    expect(under.deMinimisApplied).toBe(true);
    // 消费税 10% 仍要收：9000 * 10% = 900
    expect(under.total).toBe('900.00');

    const over = computeTax({ subtotal: '20000', shippingFee: '0', discountAmount: '0', country: 'JP' });
    expect(over.deMinimisApplied).toBe(false);
    expect(over.total).toBe('2000.00');
  });

  it('T9: 卖家级覆盖规则优先于默认表', () => {
    const r = computeTax({
      subtotal: '100.00',
      shippingFee: '0',
      discountAmount: '0',
      country: 'DE',
      override: { country: 'DE', vatRate: 5, dutyRate: 10, taxableShipping: false, note: '自定义' },
    });
    // duty 10% = 10.00，vat (100)*5% = 5.00 → 合计 15.00
    expect(r.total).toBe('15.00');
    expect(r.breakdown).toHaveLength(2);
    expect(r.breakdown[0].kind).toBe('duty');
    expect(r.breakdown[1].kind).toBe('vat');
  });

  it('T10: 空国家不崩，返回 unknown', () => {
    const r = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country: '' });
    expect(r.status).toBe('unknown');
    expect(r.total).toBe('0.00');
  });

  it('T11: 折扣不会把税基算成负数', () => {
    const r = computeTax({
      subtotal: '100.00',
      shippingFee: '0',
      discountAmount: '500.00', // 折扣大于货值
      country: 'DE',
    });
    // 税基应为 0 而不是负数（负数会产生负税，等于凭空退税）
    expect(Number(r.total)).toBeGreaterThanOrEqual(0);
    expect(r.total).toBe('0.00');
  });

  it('T14: 原型链上的键不能被当作已收录国家', () => {
    // `{}['constructor']` 会返回函数；若不显式 hasOwn 检查，
    // 任意畸形国家代码都会被判为"已知"，从而静默零税。
    for (const evil of ['constructor', '__proto__', 'toString']) {
      const r = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country: evil });
      expect(r.status).toBe('unknown');
    }
  });

  it('T12: 规则查询与市场列表可用', () => {
    expect(getTaxRule('DE')?.vatRate).toBe(19);
    expect(getTaxRule('ZZ')).toBeNull();
    const list = listSupportedCountries();
    expect(list.length).toBeGreaterThan(8);
    expect(list.find((c) => c.country === 'JP')?.vatRate).toBe(10);
  });

  it('T13: 每笔税额都带"预估非最终"声明', () => {
    for (const country of ['DE', 'US', 'JP', 'AU']) {
      const r = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country });
      expect(r.note).toContain('海关');
    }
  });
});

describe('country normalization', () => {
  it('N1: 自由文本国家名归一为 ISO 代码（历史数据兼容）', () => {
    expect(normalizeCountry('Germany')).toBe('DE');
    expect(normalizeCountry('germany')).toBe('DE');
    expect(normalizeCountry('德国')).toBe('DE');
    expect(normalizeCountry('united states')).toBe('US');
    expect(normalizeCountry('美国')).toBe('US');
    expect(normalizeCountry('UK')).toBe('GB');
  });

  it('N2: 已是代码的原样返回（大写）', () => {
    expect(normalizeCountry('de')).toBe('DE');
    expect(normalizeCountry('JP')).toBe('JP');
  });

  it('N3: 无法识别时返回大写原值，交由税率表判定 unknown', () => {
    expect(normalizeCountry('Atlantis')).toBe('ATLANTIS');
    expect(normalizeCountry('')).toBe('');
  });

  it('N4: 归一后能真正算出税（而不是静默零税）', () => {
    // 老数据存的是 "Germany"，此前会匹配不到税率
    const r = computeTax({ subtotal: '100.00', shippingFee: '0', discountAmount: '0', country: 'Germany' });
    expect(r.status).toBe('known');
    expect(r.total).toBe('19.00');
  });
});
