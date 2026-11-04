import React from 'react';
import { BarChart3, CheckCircle2, Clock, Coins, Loader2, Sparkles, Zap } from 'lucide-react';
import { FlowPanel } from '@/components/seller/SellerUI';
import type { AIUsageStats } from '@shared/api.interface';

interface UsagePanelProps {
  zh: boolean;
  stats: AIUsageStats | null;
  loading: boolean;
}

/** Cumulative AI usage, split by agent. Read-only. */
const UsagePanel: React.FC<UsagePanelProps> = ({ zh, stats, loading }) => (
  <FlowPanel
    title={zh ? 'AI 用量统计' : 'AI usage'}
    description={zh ? '累计调用量与资源消耗' : 'Cumulative calls and resource use'}
    icon={BarChart3}
  >
    {loading ? (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ) : stats ? (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              总调用次数
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900">{stats.totalCalls.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              总耗时(秒)
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900">{(stats.totalDurationMs / 1000).toFixed(1)}</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Token 总量
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              成功率
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900">{(stats.successRate * 100).toFixed(1)}%</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              累计成本 (USD)
            </div>
            {/*
              null 表示所用模型不在价目表里，显示「未收录」而不是 $0.00——
              后者会让人以为"这个月没花钱"，是更糟的误导。
            */}
            <div className="mt-1 text-xl font-bold text-slate-900">
              {stats.totalCostUsd === null
                ? <span className="text-sm font-medium text-muted-foreground">未收录</span>
                : `$${Number(stats.totalCostUsd).toFixed(4)}`}
            </div>
          </div>
        </div>
        {stats.byAgent.length > 0 && (
          <div className="pt-2">
            <div className="mb-2 text-xs font-medium text-muted-foreground">按 Agent 分布</div>
            <div className="space-y-2">
              {stats.byAgent.map((stat) => (
                <div key={stat.agent} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-sm font-medium capitalize text-slate-700">{stat.agent}</span>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{stat.calls} 次</span>
                    <span>{stat.inputTokens + stat.outputTokens} tokens</span>
                    {stat.cachedInputTokens > 0 && (
                      <span className="text-[var(--flow-ok,#16a34a)]">
                        缓存 {Math.round((stat.cachedInputTokens / Math.max(1, stat.inputTokens)) * 100)}%
                      </span>
                    )}
                    <span>{stat.costUsd === null ? '—' : `$${Number(stat.costUsd).toFixed(4)}`}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : null}
  </FlowPanel>
);

export default UsagePanel;
