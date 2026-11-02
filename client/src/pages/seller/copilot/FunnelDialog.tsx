import React from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ShopperDemandGap, ShopperFunnelResponse, ShopperProductFunnelResponse } from '@shared/api.interface';

export interface CopyAuditItem {
  productId: string;
  title: string;
  score: number;
  needsReview: boolean;
  issues: Array<{ label: string }>;
}

export interface CopyAuditState {
  total: number;
  needsReview: number;
  averageScore: number;
  items: CopyAuditItem[];
}

interface FunnelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  funnel: ShopperFunnelResponse | null;
  funnelLoading: boolean;
  demandGaps: ShopperDemandGap[];
  productFunnel: ShopperProductFunnelResponse | null;
  draftingKeyword: string | null;
  auditResult: Array<{ id: string; title: string; missing: string[] }> | null;
  auditing: boolean;
  backfilling: boolean;
  copyAudit: CopyAuditState | null;
  copyAuditing: boolean;
  onAnalyze: () => void;
  onCreateDraft: (keyword: string) => void;
  onAudit: () => void;
  onBackfill: () => void;
  onCopyAudit: () => void;
  onMarkReviewed: (productId: string) => void;
}

/** Shopping-funnel analytics: conversion, demand gaps, product funnel, catalog audit. */
const FunnelDialog: React.FC<FunnelDialogProps> = ({
  open,
  onOpenChange,
  funnel,
  funnelLoading,
  demandGaps,
  productFunnel,
  draftingKeyword,
  auditResult,
  auditing,
  backfilling,
  copyAudit,
  copyAuditing,
  onAnalyze,
  onCreateDraft,
  onAudit,
  onBackfill,
  onCopyAudit,
  onMarkReviewed,
}) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AI 导购转化漏斗（近 30 天）</DialogTitle>
            <DialogDescription>按会话去重统计；数据来自导购实际对话与加购确认。</DialogDescription>
          </DialogHeader>
          {funnelLoading && !funnel && (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          )}
          {funnel && (
            <div className="space-y-4">
              <div className="space-y-2">
                {funnel.stages.map((stage, index) => {
                  const max = funnel.stages[0]?.sessions || 1;
                  const width = Math.max(4, Math.round((stage.sessions / max) * 100));
                  return (
                    <div key={stage.stage}>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                        <span>
                          {index + 1}. {stage.label}
                        </span>
                        <span>
                          {stage.sessions} 会话
                          {index > 0 && (
                            <span className="ml-2 text-slate-400">
                              转化 {(stage.conversionFromPrevious * 100).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded bg-slate-100">
                        <div
                          className="h-2.5 rounded bg-[var(--flow-accent)]"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                整体转化（打开 → 下单）：
                <span className="ml-1 font-semibold text-[var(--flow-text-1)]">
                  {(funnel.overallConversion * 100).toFixed(1)}%
                </span>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>需求缺口（搜索零结果的词，近 90 天）</span>
                  {demandGaps.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-normal text-[var(--flow-accent)] hover:underline"
                      onClick={onAnalyze}
                    >
                      让副驾分析
                    </button>
                  )}
                </div>
                {demandGaps.length === 0 ? (
                  <div className="text-xs text-slate-400">暂无零结果搜索</div>
                ) : (
                  <div className="space-y-1">
                    {demandGaps.map((gap) => (
                      <div key={gap.keyword} className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                        <span className="min-w-0 flex-1 truncate">{gap.keyword}</span>
                        <span className="shrink-0 text-amber-700">{gap.misses} 次 · {gap.sessions} 人</span>
                        <button
                          type="button"
                          className="shrink-0 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                          disabled={draftingKeyword === gap.keyword}
                          onClick={() => onCreateDraft(gap.keyword)}
                        >
                          {draftingKeyword === gap.keyword ? '生成中…' : '建草稿'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">商品级漏斗（被推荐 → 加购，按推荐量排序）</div>
                {!productFunnel || productFunnel.items.length === 0 ? (
                  <div className="text-xs text-slate-400">暂无商品级数据</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded border border-slate-200">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium">商品</th>
                          <th className="px-1 py-1 text-right font-medium">推荐</th>
                          <th className="px-1 py-1 text-right font-medium">加购</th>
                          <th className="px-1 py-1 text-right font-medium">转化</th>
                          <th className="px-2 py-1 text-right font-medium">库存</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productFunnel.items.map((item) => (
                          <tr key={item.productId} className="border-t border-slate-100">
                            <td className="max-w-[140px] truncate px-2 py-1 text-slate-700">{item.title}</td>
                            <td className="px-1 py-1 text-right text-slate-600">{item.recommendedSessions}</td>
                            <td className="px-1 py-1 text-right text-slate-600">{item.cartSessions}</td>
                            <td className={`px-1 py-1 text-right ${item.cartRate < 0.2 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {(item.cartRate * 100).toFixed(0)}%
                            </td>
                            <td className="px-2 py-1 text-right text-slate-500">{item.totalStock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>在售商品体检</span>
                  <div className="flex items-center gap-2">
                    {auditResult && auditResult.length > 0 && (
                      <button
                        type="button"
                        className="text-xs font-normal text-indigo-600 hover:underline"
                        onClick={() => onBackfill()}
                        disabled={backfilling}
                      >
                        {backfilling ? '补全中…' : '一键补全文案'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs font-normal text-[var(--flow-accent)] hover:underline"
                      onClick={() => onAudit()}
                      disabled={auditing}
                    >
                      {auditing ? '检查中…' : '立即检查'}
                    </button>
                  </div>
                </div>
                {auditResult === null ? (
                  <div className="text-xs text-slate-400">点击检查，找出信息不完整的历史在售商品</div>
                ) : auditResult.length === 0 ? (
                  <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                    全部在售商品信息完整
                  </div>
                ) : (
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {auditResult.map((item) => (
                      <div key={item.id} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                        <div className="font-medium">{item.title}</div>
                        <div className="opacity-80">缺：{item.missing.join('、')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>AI 文案质量抽检</span>
                  <button
                    type="button"
                    className="text-xs font-normal text-[var(--flow-accent)] hover:underline"
                    onClick={() => onCopyAudit()}
                    disabled={copyAuditing}
                  >
                    {copyAuditing ? '抽检中…' : '开始抽检'}
                  </button>
                </div>
                {copyAudit === null ? (
                  <div className="text-xs text-slate-400">对 AI 生成的文案做启发式质量检查</div>
                ) : copyAudit.total === 0 ? (
                  <div className="text-xs text-slate-400">暂无 AI 生成的文案</div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-xs text-slate-600">
                      共 {copyAudit.total} 个，待复核 {copyAudit.needsReview} 个，平均分 {copyAudit.averageScore}
                    </div>
                    <div className="max-h-32 space-y-1 overflow-y-auto">
                      {copyAudit.items.map((item) => (
                        <div key={item.productId} className={`rounded border px-2 py-1 text-xs ${item.needsReview ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                            <span className="shrink-0">{item.score} 分</span>
                            {item.needsReview && (
                              <button
                                type="button"
                                className="shrink-0 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[11px] hover:bg-amber-100"
                                onClick={() => onMarkReviewed(item.productId)}
                              >
                                复核通过
                              </button>
                            )}
                          </div>
                          {item.issues.length > 0 && (
                            <div className="mt-0.5 opacity-80">{item.issues.map((issue) => issue.label).join('、')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">买家热搜词 TOP 10</div>
                {funnel.topQueries.length === 0 ? (
                  <div className="text-xs text-slate-400">暂无搜索记录</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {funnel.topQueries.map((item) => (
                      <Badge key={item.keyword} variant="secondary" className="text-xs">
                        {item.keyword} · {item.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
);

export default FunnelDialog;
