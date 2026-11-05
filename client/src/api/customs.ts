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
