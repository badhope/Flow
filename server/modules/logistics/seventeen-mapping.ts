/**
 * 17TRACK v2.2 响应 → 应用轨迹模型的纯映射层。
 * 与 HTTP 客户端解耦，便于对官方响应形状做单元测试。
 * fail-closed：缺字段的脏数据被剔除，无有效事件时回退演示时间线（demo=true）。
 */

export interface SeventeenEvent {
  time_iso?: string;
  description?: string;
  location?: string;
  stage?: string;
}

export interface SeventeenAcceptedItem {
  number?: string;
  carrier?: number;
  last_event?: SeventeenEvent;
  events?: SeventeenEvent[];
}

export interface SeventeenApiResponse {
  code?: number;
  data?: {
    accepted?: SeventeenAcceptedItem[];
    rejected?: Array<{ number?: string; error?: { code?: number; message?: string } }>;
  };
}

export interface TrackingEvent {
  time: string;
  status: string;
  location: string;
  description: string;
}

export interface MappedTracking {
  events: TrackingEvent[];
  /** true = 无真实轨迹可用（被拒单 / 空数据），调用方应回退演示时间线 */
  demo: boolean;
}

/** stage 兜底：官方 stage 缺失时按描述关键词归类 */
function stageToStatus(stage: string | undefined, description: string): string {
  if (stage) return stage;
  const d = description.toLowerCase();
  if (/签收|delivered|signed/.test(d)) return 'delivered';
  if (/运输|transit|arrived/.test(d)) return 'in_transit';
  return 'update';
}

export function mapSeventeenResponse(res: SeventeenApiResponse): MappedTracking {
  const accepted = res.data?.accepted ?? [];

  const events: TrackingEvent[] = accepted
    .flatMap((item) => {
      const source = (item.events ?? []).slice();
      // 官方建议以 last_event 为准；events 缺失时用 last_event 兜底
      if (item.last_event && source.length === 0) source.push(item.last_event);
      return source;
    })
    .filter((e): e is Required<Pick<SeventeenEvent, 'time_iso'>> & SeventeenEvent =>
      typeof e.time_iso === 'string' && e.time_iso.length > 0)
    .map((e) => ({
      time: e.time_iso,
      status: stageToStatus(e.stage, e.description ?? ''),
      location: e.location ?? '',
      description: e.description ?? '',
    }))
    .sort((a, b) => (a.time < b.time ? 1 : -1)); // 最新在前

  return {
    events,
    demo: accepted.length === 0 || events.length === 0,
  };
}
