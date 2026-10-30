/**
 * 演示支付生产门禁（fail-closed）：
 * - 开发环境默认放行（本地演示 / CI 冒烟依赖此通道）
 * - 生产环境默认拒绝；仅当 ALLOW_DEMO_PAYMENT=true 显式开启才放行
 *   （对应「演示平台」部署形态；真实收款部署必须不设该变量）
 */
export function isDemoPaymentAllowed(env: {
  nodeEnv?: string;
  allowDemoPayment?: string;
}): boolean {
  if (env.nodeEnv !== 'production') return true;
  return env.allowDemoPayment === 'true';
}
