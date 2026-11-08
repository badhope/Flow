import { http } from '../lib/http';
import type { StockBatch } from '@shared/api.interface';

export async function listBatches(limit = 200): Promise<StockBatch[]> {
  const { data } = await http.get<StockBatch[]>('/api/batches', { params: { limit } });
  return data;
}

/** 临期/过期看板 */
export async function listExpiringBatches(days = 30): Promise<StockBatch[]> {
  const { data } = await http.get<StockBatch[]>('/api/batches/expiring', { params: { days } });
  return data;
}

export async function listBatchesByVariant(variantId: string): Promise<StockBatch[]> {
  const { data } = await http.get<StockBatch[]>(`/api/batches/variant/${variantId}`);
  return data;
}

export async function createBatch(input: {
  warehouseId: string; variantId: string; batchNo: string; quantity: number;
  producedAt?: string; expiresAt?: string; note?: string;
}): Promise<StockBatch> {
  const { data } = await http.post<StockBatch>('/api/batches', input);
  return data;
}

export async function getBatchDrift(): Promise<{
  count: number; healthy: boolean;
  items: Array<{ warehouseId: string; variantId: string; warehouseStock: number; batchTotal: number; diff: number }>;
}> {
  const { data } = await http.get('/api/batches/drift');
  return data;
}

export async function repairBatchDrift(): Promise<{ repaired: number }> {
  const { data } = await http.post('/api/batches/drift/repair');
  return data;
}
