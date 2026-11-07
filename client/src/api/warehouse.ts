import { http } from '../lib/http';
import type { Warehouse, StockTransfer, WarehouseStockRow } from '@shared/api.interface';

export async function listWarehouses(): Promise<Warehouse[]> {
  const { data } = await http.get<Warehouse[]>('/api/warehouses');
  return data;
}

export async function createWarehouse(input: {
  name: string; code: string; country?: string; priority?: number;
}): Promise<Warehouse> {
  const { data } = await http.post<Warehouse>('/api/warehouses', input);
  return data;
}

export async function updateWarehouse(id: string, input: Partial<Warehouse>): Promise<Warehouse> {
  const { data } = await http.put<Warehouse>(`/api/warehouses/${id}`, input);
  return data;
}

export async function deleteWarehouse(id: string): Promise<void> {
  await http.delete(`/api/warehouses/${id}`);
}

export async function getVariantStock(variantId: string): Promise<WarehouseStockRow[]> {
  const { data } = await http.get<WarehouseStockRow[]>(`/api/warehouses/stock/${variantId}`);
  return data;
}

export async function setWarehouseStock(
  warehouseId: string, variantId: string, stock: number, safetyStock = 0,
): Promise<void> {
  await http.put(`/api/warehouses/${warehouseId}/stock/${variantId}`, { stock, safetyStock });
}

export async function listTransfers(limit = 50): Promise<StockTransfer[]> {
  const { data } = await http.get<StockTransfer[]>('/api/warehouses/transfers', { params: { limit } });
  return data;
}

export async function createTransfer(input: {
  variantId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; note?: string;
}): Promise<StockTransfer> {
  const { data } = await http.post<StockTransfer>('/api/warehouses/transfers', input);
  return data;
}

export async function completeTransfer(id: string): Promise<StockTransfer> {
  const { data } = await http.post<StockTransfer>(`/api/warehouses/transfers/${id}/complete`);
  return data;
}

export async function cancelTransfer(id: string): Promise<StockTransfer> {
  const { data } = await http.post<StockTransfer>(`/api/warehouses/transfers/${id}/cancel`);
  return data;
}
