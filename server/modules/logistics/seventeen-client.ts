import type { SeventeenApiResponse } from './seventeen-mapping';

const SEVENTEEN_API = 'https://api.17track.net/track/v2.2';
const TIMEOUT_MS = 8000;

export interface RegisterItem {
  number: string;
  carrier?: number;
}

/**
 * 17TRACK v2.2 HTTP 客户端（fetch，8s 超时）。
 * 错误统一抛出，由调用方决定降级（物流查询失败回退演示时间线，不阻断下单）。
 * API_BASE 可注入便于测试。
 */
export async function registerTrackings(
  apiKey: string,
  items: RegisterItem[],
  apiBase: string = SEVENTEEN_API,
): Promise<void> {
  const res = await fetch(`${apiBase}/register`, {
    method: 'POST',
    headers: { '17token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`17TRACK register HTTP ${res.status}`);
  const body = (await res.json()) as { code?: number };
  if (body.code !== 0) throw new Error(`17TRACK register code=${body.code}`);
}

export async function fetchTrackInfo(
  apiKey: string,
  numbers: string[],
  apiBase: string = SEVENTEEN_API,
): Promise<SeventeenApiResponse> {
  const res = await fetch(`${apiBase}/gettrackinfo`, {
    method: 'POST',
    headers: { '17token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(numbers.map((number) => ({ number }))),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`17TRACK gettrackinfo HTTP ${res.status}`);
  const body = (await res.json()) as SeventeenApiResponse;
  if (body.code !== 0) throw new Error(`17TRACK gettrackinfo code=${body.code}`);
  return body;
}
