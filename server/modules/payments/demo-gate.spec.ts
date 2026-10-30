import { describe, expect, it } from 'vitest';
import { isDemoPaymentAllowed } from './demo-gate';

describe('demo-gate R8: 演示支付生产门禁', () => {
  it('R8: 开发环境默认允许（本地演示/冒烟依赖此通道）', () => {
    expect(isDemoPaymentAllowed({ nodeEnv: 'development' })).toBe(true);
    expect(isDemoPaymentAllowed({ nodeEnv: undefined })).toBe(true);
  });

  it('R8: 生产环境未显式开启时拒绝（fail-closed）', () => {
    expect(isDemoPaymentAllowed({ nodeEnv: 'production' })).toBe(false);
  });

  it('R8: 生产环境仅在 ALLOW_DEMO_PAYMENT=true 时放行', () => {
    expect(
      isDemoPaymentAllowed({ nodeEnv: 'production', allowDemoPayment: 'true' }),
    ).toBe(true);
    expect(
      isDemoPaymentAllowed({ nodeEnv: 'production', allowDemoPayment: 'false' }),
    ).toBe(false);
    expect(
      isDemoPaymentAllowed({ nodeEnv: 'production', allowDemoPayment: '1' }),
    ).toBe(false);
  });
});
