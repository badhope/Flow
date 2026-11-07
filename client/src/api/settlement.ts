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

export async function getPayoutAccount(): Promise<import('@shared/api.interface').PayoutAccount> {
  const { data } = await http.get<import('@shared/api.interface').PayoutAccount>('/api/settlements/payout-account');
  return data;
}

export async function createPayoutAccount(input: { email: string; country?: string }): Promise<{ accountId: string; onboardingUrl: string }> {
  const { data } = await http.post<{ accountId: string; onboardingUrl: string }>('/api/settlements/payout-account', input);
  return data;
}

export async function refreshPayoutAccount() {
  const { data } = await http.post('/api/settlements/payout-account/refresh');
  return data;
}
