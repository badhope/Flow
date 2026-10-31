import { describe, expect, it } from 'vitest';
import { isDemoPaymentAllowed } from './demo-gate';

describe('demo-gate R8: 演示支付环境门禁', () => {
  it.each(['development', 'test'])('仅显式开发环境 %s 默认放行', (nodeEnv) => {
    expect(isDemoPaymentAllowed({ nodeEnv })).toBe(true);
    expect(isDemoPaymentAllowed({ nodeEnv, allowDemoPayment: 'false' })).toBe(
      true,
    );
  });

  it.each([undefined, 'unknown', 'staging', 'production'])(
    '缺失或非开发环境 %s 默认拒绝',
    (nodeEnv) => {
      expect(isDemoPaymentAllowed({ nodeEnv })).toBe(false);
    },
  );

  it.each([undefined, 'unknown', 'staging', 'production'])(
    'ALLOW_DEMO_PAYMENT=true 不能绕过环境 %s',
    (nodeEnv) => {
      expect(isDemoPaymentAllowed({ nodeEnv, allowDemoPayment: 'true' })).toBe(
        false,
      );
    },
  );

  it('仅开发环境接受无关的非 true 放行值，因为环境本身已明确', () => {
    expect(
      isDemoPaymentAllowed({ nodeEnv: 'development', allowDemoPayment: '1' }),
    ).toBe(true);
    expect(
      isDemoPaymentAllowed({ nodeEnv: 'test', allowDemoPayment: 'false' }),
    ).toBe(true);
  });
});
