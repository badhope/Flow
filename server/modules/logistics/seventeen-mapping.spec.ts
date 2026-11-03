import { describe, expect, it } from 'vitest';
import { mapSeventeenResponse } from './seventeen-mapping';

/** 17TRACK v2.2 gettrackinfo 的真实响应形状（字段按官方文档裁剪） */
const apiResponse = {
  code: 0,
  data: {
    accepted: [
      {
        number: 'SF123456789',
        carrier: 3011,
        last_event: {
          time_iso: '2026-10-30T08:12:00+08:00',
          description: '已签收',
          location: '深圳',
        },
        events: [
          {
            time_iso: '2026-10-28T09:00:00+08:00',
            description: '运输中',
            location: '深圳',
            stage: 'transit',
          },
          {
            time_iso: '2026-10-29T14:00:00+08:00',
            description: '到达国际口岸',
            location: '深圳',
            stage: 'transit',
          },
          {
            time_iso: '2026-10-30T08:12:00+08:00',
            description: '已签收',
            location: '目的国',
            stage: 'delivered',
          },
        ],
      },
    ],
    rejected: [] as Array<{ number: string; error: { code: number; message: string } }>,
  },
};

describe('seventeen-mapping R1: 官方响应 → 应用轨迹模型', () => {
  it('R1: events 全量映射为时间倒序的应用事件', () => {
    const result = mapSeventeenResponse(apiResponse);
    expect(result.demo).toBe(false);
    expect(result.events).toHaveLength(3);
    // 最新事件在前
    expect(result.events[0].description).toBe('已签收');
    expect(result.events[0].status).toBe('delivered');
    expect(result.events[2].description).toBe('运输中');
  });

  it('R1: 事件保留原始时间与地点', () => {
    const result = mapSeventeenResponse(apiResponse);
    expect(result.events[0].time).toBe('2026-10-30T08:12:00+08:00');
    expect(result.events[0].location).toBe('目的国');
  });

  it('R1: last_event 缺失时用 events[0] 兜底', () => {
    const copy = structuredClone(apiResponse);
    delete (copy.data.accepted[0] as Record<string, unknown>).last_event;
    const result = mapSeventeenResponse(copy);
    expect(result.events[0].description).toBe('已签收');
  });
});

describe('seventeen-mapping R2: 拒单与脏数据 fail-closed', () => {
  it('R2: 被拒绝的单号不产生事件', () => {
    const copy = structuredClone(apiResponse);
    copy.data.rejected = [{ number: 'SF123456789', error: { code: -18019901, message: '单号不存在' } }];
    copy.data.accepted = [];
    const result = mapSeventeenResponse(copy);
    expect(result.demo).toBe(true);
    expect(result.events).toHaveLength(0);
  });

  it('R2: 事件缺时间戳的条目被剔除，不产生 undefined', () => {
    const copy = structuredClone(apiResponse);
    (copy.data.accepted[0].events as Array<Record<string, unknown>>).push({ description: '坏数据' });
    const result = mapSeventeenResponse(copy);
    expect(result.events.every((e) => typeof e.time === 'string' && e.time.length > 0)).toBe(true);
  });

  it('R2: 空 accepted 时回退演示时间线', () => {
    const copy = structuredClone(apiResponse);
    copy.data.accepted = [];
    const result = mapSeventeenResponse(copy);
    expect(result.demo).toBe(true);
  });
});
