import { http } from '../lib/http';
import type { Settlement, SettlementSummary, CommissionRule } from '@shared/api.interface';

export async function listSettlements(limit = 50): Promise<Settlement[]> {
  const { data } = await http.get<Settlement[]>('/api/settlements', { params: { limit } });
  return data;
}

export async function getSettlementSummary(): Promise<SettlementSummary> {
  const { data } = await http.get<SettlementSummary>('/api/settlements/summary');
  return data;
}

export async function getMyCommission(): Promise<CommissionRule> {
  const { data } = await http.get<CommissionRule>('/api/settlements/commission');
  return data;
}

export async function getSettlement(id: string): Promise<Settlement> {
  const { data } = await http.get<Settlement>(`/api/settlements/${id}`);
  return data;
}
