import { http } from '../lib/http';
import type { CustomsDeclaration } from '@shared/api.interface';

export async function listCustomsDeclarations(limit = 50): Promise<CustomsDeclaration[]> {
  const { data } = await http.get<CustomsDeclaration[]>('/api/customs', { params: { limit } });
  return data;
}

export async function getCustomsByOrder(orderId: string): Promise<CustomsDeclaration | null> {
  const { data } = await http.get<CustomsDeclaration | null>(`/api/customs/order/${orderId}`);
  return data;
}

/** 生成报关单（幂等：已有则返回已有的） */
export async function generateCustoms(orderId: string): Promise<CustomsDeclaration> {
  const { data } = await http.post<CustomsDeclaration>(`/api/customs/order/${orderId}`);
  return data;
}

export async function fileCustoms(id: string): Promise<CustomsDeclaration> {
  const { data } = await http.post<CustomsDeclaration>(`/api/customs/${id}/file`);
  return data;
}

export async function getBrokerConfig(): Promise<import('@shared/api.interface').CustomsBrokerConfig | null> {
  const { data } = await http.get<import('@shared/api.interface').CustomsBrokerConfig | null>('/api/customs/broker/config');
  return data;
}

export async function saveBrokerConfig(input: {
  endpoint: string; provider?: string; credentials?: Record<string, string>;
  signingSecret?: string; enabled?: boolean;
}): Promise<import('@shared/api.interface').CustomsBrokerConfig> {
  const { data } = await http.post<import('@shared/api.interface').CustomsBrokerConfig>('/api/customs/broker/config', input);
  return data;
}

/** 向报关行真实提交 */
export async function submitToBroker(id: string): Promise<import('@shared/api.interface').CustomsDeclaration> {
  const { data } = await http.post<import('@shared/api.interface').CustomsDeclaration>(`/api/customs/${id}/submit`);
  return data;
}
