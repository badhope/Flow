import React from 'react';
import {
  AlertTriangle,
  Bot,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Settings2,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CopilotConversation, CopilotInsightsView, CopilotInsight } from '@shared/api.interface';

interface ConversationSidebarProps {
  conversations: CopilotConversation[];
  activeId: string | null;
  loadingList: boolean;
  insights: CopilotInsightsView | null;
  insightsLoading: boolean;
  sending: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRefreshInsights: () => void;
  onOpenFunnel: () => void;
  onOpenThresholds: () => void;
  onInsightClick: (prompt: string) => void;
}

/** Left rail: conversation list plus the always-on store watch feed. */
const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeId,
  loadingList,
  insights,
  insightsLoading,
  sending,
  onNew,
  onSelect,
  onDelete,
  onRefreshInsights,
  onOpenFunnel,
  onOpenThresholds,
  onInsightClick,
}) => (
  <Card className="flow-panel hidden w-64 shrink-0 flex-col overflow-hidden border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] md:flex">
    <div className="flex items-center justify-between border-b border-[var(--flow-line-1)] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--flow-text-1)]">
        <Bot className="h-4 w-4" />
        对话
      </div>
      <Button size="sm" variant="outline" onClick={onNew}>
        <MessageSquarePlus className="h-4 w-4" />
        新建
      </Button>
    </div>

    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-1 p-2">
        {loadingList && (
          <div className="flex items-center gap-2 py-3 text-sm text-[var(--flow-text-3)]">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中
          </div>
        )}
        {!loadingList && conversations.length === 0 && (
          <div className="px-2 py-3 text-sm text-[var(--flow-text-3)]">还没有对话，直接开始提问即可。</div>
        )}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`group flex items-center gap-1 rounded-md px-2 py-2 text-sm ${
              activeId === conversation.id
                ? 'bg-[var(--flow-accent-soft)] text-[var(--flow-text-1)]'
                : 'text-[var(--flow-text-2)] hover:bg-[var(--flow-surface-2)]'
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onSelect(conversation.id)}
            >
              {conversation.title}
              {(conversation.pendingActionCount ?? 0) > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {conversation.pendingActionCount} 待确认
                </Badge>
              )}
            </button>
            <button
              type="button"
              aria-label="删除对话"
              className="hidden shrink-0 text-slate-400 hover:text-red-500 group-hover:block"
              onClick={() => onDelete(conversation.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ScrollArea>

    <div className="border-t p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--flow-text-2)]">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          店铺巡检
          {(insights?.insights.length ?? 0) > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {insights?.insights.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="导购漏斗"
            className="text-slate-400 hover:text-slate-600"
            onClick={onOpenFunnel}
          >
            <TrendingUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="巡检设置"
            className="text-slate-400 hover:text-slate-600"
            onClick={onOpenThresholds}
          >
            <Settings2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="刷新巡检"
            className="text-slate-400 hover:text-slate-600"
            onClick={onRefreshInsights}
            disabled={insightsLoading}
          >
            <RefreshCw className={`h-3 w-3 ${insightsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
        {insightsLoading && !insights && (
          <div className="px-1 py-2 text-xs text-slate-400">正在检查…</div>
        )}
        {insights && insights.insights.length === 0 && (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
            暂无异常
          </div>
        )}
        {(insights?.insights ?? []).map((insight: CopilotInsight) => (
          <button
            key={insight.id}
            type="button"
            className={`block w-full rounded border px-2 py-1.5 text-left text-xs hover:brightness-[0.97] ${
              insight.severity === 'critical'
                ? 'border-red-200 bg-red-50 text-red-800'
                : insight.severity === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
            title={insight.detail}
            onClick={() => onInsightClick(insight.prompt)}
            disabled={sending}
          >
            <div className="font-medium">{insight.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[11px] opacity-80">{insight.detail}</div>
          </button>
        ))}
      </div>
    </div>
  </Card>
);

export default ConversationSidebar;
