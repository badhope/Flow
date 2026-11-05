import { http } from '../lib/http';
import type { FxRateList, FxConversion } from '@shared/api.interface';

/** 可选币种与汇率（公开接口，买家端切换币种用） */
export async function getFxRates(): Promise<FxRateList> {
  const { data } = await http.get<FxRateList>('/api/fx/rates');
  return data;
}

/** 币种换算（结账页预览用） */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
): Promise<FxConversion> {
  const qs = new URLSearchParams({
    amount: amount.toFixed(2),
    from,
    to,
  });
  const { data } = await http.get<FxConversion>(`/api/fx/convert?${qs.toString()}`);
  return data;
}
