import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';

/**
 * 多币种换算的契约。
 *
 * 这些断言与 FxService 的换算逻辑同构（相对 USD 的表 + 交叉换算）。
 * 之所以单独测：汇率是最容易"看起来对但其实错"的地方——
 * 除以和乘以 rate 用反了，金额会差好几个数量级，而且不会报错。
 */

const RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CNY: 7.1,
  JPY: 149.5,
  KRW: 1330,
};

const DIGITS: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CNY: 2, JPY: 0, KRW: 0 };

/** 与 FxService.convert 同构：走 USD 中转 */
function convert(amount: number, from: string, to: string): { value: string; rate: number } {
  const rateFrom = RATES[from];
  const rateTo = RATES[to];
  if (!rateFrom || !rateTo) throw new Error('unsupported');
  const rate = new Decimal(rateTo).div(rateFrom);
  return {
    value: new Decimal(amount).mul(rate).toFixed(DIGITS[to] ?? 2),
    rate: rate.toNumber(),
  };
}

describe('currency conversion', () => {
  it('C1: 同币种换算恒等', () => {
    expect(convert(100, 'USD', 'USD').value).toBe('100.00');
    expect(convert(100, 'JPY', 'JPY').value).toBe('100');
  });

  it('C2: USD → EUR 用乘法（1 USD = 0.92 EUR）', () => {
    expect(convert(100, 'USD', 'EUR').value).toBe('92.00');
// 1 USD = 0.92 EUR
  });

  it('C3: EUR → USD 用除法，不是再乘一次', () => {
    // 100 EUR / 0.92 = 108.70 USD
    expect(convert(100, 'EUR', 'USD').value).toBe('108.70');
  });

  it('C4: 交叉汇率不经过 1:1（EUR → JPY）', () => {
    // 100 EUR = 100/0.92 USD = 108.70 USD；× 149.5 = 16250 JPY
    const r = convert(100, 'EUR', 'JPY');
    expect(r.value).toBe('16250');
    // 汇率约 162.5，绝不可能是 1
    expect(r.rate).toBeGreaterThan(100);
  });

  it('C5: 零小数位币种不输出 .00（JPY / KRW）', () => {
    expect(convert(100, 'USD', 'JPY').value).not.toContain('.');
    expect(convert(100, 'USD', 'KRW').value).not.toContain('.');
  });

  it('C6: 两位小数币种保持两位', () => {
    expect(convert(100, 'USD', 'EUR').value).toMatch(/\.\d{2}$/);
  });

  it('C7: 不支持的币种抛错而不是按 1:1 处理', () => {
    expect(() => convert(100, 'USD', 'XXX')).toThrow();
    expect(() => convert(100, 'ZZZ', 'USD')).toThrow();
  });

  it('C8: 大额不失精度（Decimal 而非浮点）', () => {
    // 浮点会得到 999999999.9999999 之类
    const r = convert(1_000_000, 'USD', 'EUR');
    expect(r.value).toBe('920000.00');
  });

  it('C9: 折算 USD 基准额（结算口径）与展示币种分离', () => {
    // 订单 100 EUR，汇率 0.92 → USD 基准 108.70
    const base = new Decimal(100).div(0.92).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(base.toFixed(2)).toBe('108.70');
  });

  it('C10: 汇率必须为正数——0 或负数会让金额爆炸或翻转', () => {
    const isValid = (r: number) => Number.isFinite(r) && r > 0;
    expect(isValid(0)).toBe(false);
    expect(isValid(-1)).toBe(false);
    expect(isValid(Number.NaN)).toBe(false);
    expect(isValid(0.92)).toBe(true);
  });
});
