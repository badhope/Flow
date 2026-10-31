/**
 * 演示支付环境门禁（fail-closed）：仅显式 development/test 环境放行。
 */
export function isDemoPaymentAllowed(env: {
  nodeEnv?: string;
  allowDemoPayment?: string;
}): boolean {
  return env.nodeEnv === 'development' || env.nodeEnv === 'test';
}
