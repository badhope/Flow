import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Settings2,
  TrendingUp,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Markdown } from '@/components/ui/markdown';
import AgentTrace, { type TraceStep } from '@/components/AgentTrace';
import ApprovalCard from '@/components/ApprovalCard';
import { copilotApi } from '@/api';
import type {
  CopilotAction,
  CopilotConversation,
  CopilotConversationDetail,
  CopilotInsight,
  CopilotInsightThresholds,
  CopilotInsightsView,
  CopilotMessage,
  ShopperDemandGap,
  ShopperFunnelResponse,
  ShopperProductFunnelResponse,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { extractErrorMessage, notifyError } from '@/lib/error-feedback';

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: '店铺概况', prompt: '看一下店铺概况，今天表现怎么样？' },
  { label: '待发货订单', prompt: '帮我查一下待发货的订单' },
  { label: '库存预警', prompt: '哪些商品库存偏低？' },
  { label: '待审批退款', prompt: '现在有哪些待审批的退款？' },
];

const CopilotPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CopilotConversationDetail | null>(null);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CopilotAction | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [insights, setInsights] = useState<CopilotInsightsView | null>(null);
  const [insightsLoading, setInsightsLoading] = useState<boolean>(false);
  const [thresholdsOpen, setThresholdsOpen] = useState<boolean>(false);
  const [thresholdsDraft, setThresholdsDraft] = useState<CopilotInsightThresholds | null>(null);
  const [thresholdsSaving, setThresholdsSaving] = useState<boolean>(false);
  const [funnel, setFunnel] = useState<ShopperFunnelResponse | null>(null);
  const [funnelLoading, setFunnelLoading] = useState<boolean>(false);
  const [funnelOpen, setFunnelOpen] = useState<boolean>(false);
  const [demandGaps, setDemandGaps] = useState<ShopperDemandGap[]>([]);
  const [productFunnel, setProductFunnel] = useState<ShopperProductFunnelResponse | null>(null);
  const [watch, setWatch] = useState<{
    enabled: boolean;
    intervalMinutes: number;
    notifyKind: 'webhook' | 'email' | 'none';
    notifyUrl?: string;
    notifySmtp?: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
      to: string;
    };
    notifyOnlyOnNew: boolean;
    notifySubjectTemplate: string;
  } | null>(null);
  const [watchSaving, setWatchSaving] = useState<boolean>(false);
  const [watchRunning, setWatchRunning] = useState<boolean>(false);
  const [draftingKeyword, setDraftingKeyword] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<Array<{ id: string; title: string; missing: string[] }> | null>(null);
  const [auditing, setAuditing] = useState<boolean>(false);
  const [backfilling, setBackfilling] = useState<boolean>(false);
  const [preview, setPreview] = useState<{ subject: string; body: string; format: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [copyAudit, setCopyAudit] = useState<{
    total: number;
    needsReview: number;
    averageScore: number;
    items: Array<{ productId: string; title: string; score: number; issues: Array<{ key: string; label: string; detail: string }>; needsReview: boolean }>;
  } | null>(null);
  const [copyAuditing, setCopyAuditing] = useState<boolean>(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchInsights = useCallback(async (): Promise<void> => {
    try {
      setInsightsLoading(true);
      setInsights(await copilotApi.getCopilotInsights());
    } catch (err) {
      notifyError(err, '获取店铺巡检失败');
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const openFunnel = async (): Promise<void> => {
    setFunnelOpen(true);
    if (funnel) return;
    try {
      setFunnelLoading(true);
      const [funnelData, gaps, productData, watchData] = await Promise.all([
        copilotApi.getShopperFunnel(30),
        copilotApi.getShopperDemandGaps(90),
        copilotApi.getShopperProductFunnel(30),
        copilotApi.getWatchSettings(),
      ]);
      setFunnel(funnelData);
      setDemandGaps(gaps);
      setProductFunnel(productData);
      setWatch(watchData);
    } catch (err) {
      notifyError(err, '读取导购漏斗失败');
    } finally {
      setFunnelLoading(false);
    }
  };

  const saveWatch = async (patch: Partial<{
    enabled: boolean;
    intervalMinutes: number;
    notifyKind: 'webhook' | 'email' | 'none';
    notifyUrl?: string;
    notifySmtp?: {
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      pass?: string;
      from: string;
      to: string;
    };
    notifyOnlyOnNew: boolean;
    notifySubjectTemplate: string;
  }>): Promise<void> => {
    if (!watch) return;
    try {
      setWatchSaving(true);
      const next = await copilotApi.updateWatchSettings({ ...watch, ...patch });
      setWatch(next);
      toast.success(next.enabled ? `定时巡检已开启，每 ${next.intervalMinutes} 分钟` : '定时巡检已关闭');
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '保存定时巡检设置失败'));
    } finally {
      setWatchSaving(false);
    }
  };

  const runWatch = async (): Promise<void> => {
    try {
      setWatchRunning(true);
      const result = await copilotApi.runWatchNow();
      toast.success(result.message.split('\n')[0]);
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '巡检执行失败'));
    } finally {
      setWatchRunning(false);
    }
  };

  const createDraft = async (keyword: string): Promise<void> => {
    try {
      setDraftingKeyword(keyword);
      const result = await copilotApi.createDraftFromGap(keyword);
      setFunnelOpen(false);
      await loadConversation(result.conversationId);
      toast.success('已生成草稿商品待确认，请在下方批准');
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '生成草稿失败'));
    } finally {
      setDraftingKeyword(null);
    }
  };

  const auditActive = async (): Promise<void> => {
    try {
      setAuditing(true);
      setAuditResult(await copilotApi.auditActiveProducts());
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '体检失败'));
    } finally {
      setAuditing(false);
    }
  };

  const backfillAll = async (): Promise<void> => {
    if (!auditResult || auditResult.length === 0) return;
    try {
      setBackfilling(true);
      const results = await copilotApi.backfillProductCopy(auditResult.map((item) => item.id));
      const okCount = results.filter((item) => item.ok && item.filled.length > 0).length;
      toast.success(`已补全 ${okCount}/${results.length} 个商品文案${okCount < results.length ? '（其余需人工处理图片或库存）' : ''}`);
      setAuditResult(await copilotApi.auditActiveProducts());
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '批量补全失败'));
    } finally {
      setBackfilling(false);
    }
  };

  const loadPreview = async (format: 'plain' | 'markdown' | 'html'): Promise<void> => {
    try {
      setPreviewLoading(true);
      const data = await copilotApi.previewDigest(format);
      setPreview({ subject: data.subject, body: data.body, format: data.format });
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '预览失败'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const runCopyAudit = async (): Promise<void> => {
    try {
      setCopyAuditing(true);
      setCopyAudit(await copilotApi.auditAiCopy(100));
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '文案抽检失败'));
    } finally {
      setCopyAuditing(false);
    }
  };

  const markReviewed = async (productId: string): Promise<void> => {
    try {
      await copilotApi.markCopyReviewed(productId);
      toast.success('已标记为人工复核通过');
      await runCopyAudit();
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '标记失败'));
    }
  };

  const openThresholds = async (): Promise<void> => {
    try {
      const [current, watchData] = await Promise.all([
        copilotApi.getCopilotInsightThresholds(),
        copilotApi.getWatchSettings(),
      ]);
      setThresholdsDraft(current);
      setWatch(watchData);
      setThresholdsOpen(true);
    } catch (err) {
      notifyError(err, '读取巡检设置失败');
    }
  };

  const saveThresholds = async (): Promise<void> => {
    if (!thresholdsDraft) return;
    try {
      setThresholdsSaving(true);
      const saved = await copilotApi.updateCopilotInsightThresholds(thresholdsDraft);
      setThresholdsDraft(saved);
      setThresholdsOpen(false);
      toast.success('巡检阈值已保存，立即生效');
      await fetchInsights();
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '保存失败'));
    } finally {
      setThresholdsSaving(false);
    }
  };

  const fetchConversations = useCallback(async (): Promise<CopilotConversation[]> => {
    try {
      setLoadingList(true);
      const rows = await copilotApi.listCopilotConversations();
      setConversations(rows);
      return rows;
    } catch (err) {
      notifyError(err, '获取对话列表失败');
      return [];
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadConversation = useCallback(async (id: string): Promise<void> => {
    try {
      setLoadingDetail(true);
      const data = await copilotApi.getCopilotConversation(id);
      setDetail(data);
      setActiveId(id);
    } catch (err) {
      notifyError(err, '加载对话失败');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const rows = await fetchConversations();
      const requestedId = searchParams.get('c');
      if (requestedId && rows.some((row) => row.id === requestedId)) {
        await loadConversation(requestedId);
        setSearchParams({}, { replace: true });
        return;
      }
      if (rows.length > 0) {
        await loadConversation(rows[0].id);
      }
    })();
    void fetchInsights();
  }, [fetchConversations, loadConversation, fetchInsights, searchParams, setSearchParams]);

  useEffect(() => {
    const prompt = searchParams.get('q');
    if (!prompt || sending) return;
    setSearchParams({}, { replace: true });
    void handleSend(prompt);
  }, [searchParams, sending, setSearchParams]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [detail?.messages.length, sending]);

  const handleNewConversation = async (): Promise<void> => {
    try {
      const created = await copilotApi.createCopilotConversation();
      setConversations((prev) => [created, ...prev]);
      setActiveId(created.id);
      setDetail({ conversation: created, messages: [], actions: [] });
    } catch (err) {
      notifyError(err, '创建对话失败');
    }
  };

  const handleDeleteConversation = async (id: string): Promise<void> => {
    try {
      await copilotApi.deleteCopilotConversation(id);
      setConversations((prev) => prev.filter((item) => item.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setDetail(null);
      }
      toast.success('对话已删除');
    } catch (err) {
      notifyError(err, '删除对话失败');
    }
  };

  const handleSend = async (text?: string): Promise<void> => {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    let conversationId = activeId;
    try {
      setSending(true);
      if (!conversationId) {
        const created = await copilotApi.createCopilotConversation();
        conversationId = created.id;
        setActiveId(created.id);
        setConversations((prev) => [created, ...prev]);
      }

      const optimistic: CopilotMessage = {
        id: `local-${Date.now()}`,
        conversationId,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      setDetail((prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, optimistic] }
          : prev,
      );
      setInput('');

      const result = await copilotApi.sendCopilotMessage(conversationId, content);

      setDetail((prev) => {
        const base = prev ?? { conversation: { id: conversationId!, title: '新对话', createdAt: '', updatedAt: '' }, messages: [], actions: [] };
        const known = new Set(base.messages.map((m) => m.id));
        const appended = result.messages.filter((m) => !known.has(m.id));
        const actionById = new Map(base.actions.map((a) => [a.id, a]));
        for (const action of result.actions) actionById.set(action.id, action);
        return {
          ...base,
          messages: [...base.messages.filter((m) => !m.id.startsWith('local-')), ...appended],
          actions: Array.from(actionById.values()),
        };
      });

      // 刷新标题与列表排序
      const rows = await fetchConversations();
      const current = rows.find((row) => row.id === conversationId);
      if (current) {
        setDetail((prev) => (prev ? { ...prev, conversation: current } : prev));
      }
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '发送失败，请重试'));
    } finally {
      setSending(false);
    }
  };

  const handleApprove = async (action: CopilotAction): Promise<void> => {
    setResolvingId(action.id);
    try {
      const result = await copilotApi.resolveCopilotAction(action.id, true);
      setDetail((prev) =>
        prev
          ? { ...prev, actions: prev.actions.map((a) => (a.id === action.id ? result.action : a)) }
          : prev,
      );
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '执行失败'));
    } finally {
      setResolvingId(null);
    }
  };

  const handleReject = async (): Promise<void> => {
    if (!rejectTarget) return;
    setResolvingId(rejectTarget.id);
    try {
      const result = await copilotApi.resolveCopilotAction(rejectTarget.id, false, rejectReason);
      setDetail((prev) =>
        prev
          ? { ...prev, actions: prev.actions.map((a) => (a.id === rejectTarget.id ? result.action : a)) }
          : prev,
      );
      toast.success(result.message);
      setRejectTarget(null);
      setRejectReason('');
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '拒绝失败'));
    } finally {
      setResolvingId(null);
    }
  };

  const pendingBatchIds = Array.from(
    new Set(
      (detail?.actions ?? [])
        .filter((action) => action.status === 'pending' && action.batchId)
        .map((action) => action.batchId as string),
    ),
  );

  const handleApproveBatch = async (batchId: string): Promise<void> => {
    setResolvingId(batchId);
    try {
      const result = await copilotApi.resolveCopilotBatch(batchId, true);
      const byId = new Map(result.actions.map((action) => [action.id, action]));
      setDetail((prev) =>
        prev
          ? { ...prev, actions: prev.actions.map((action) => byId.get(action.id) ?? action) }
          : prev,
      );
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      notifyError(err, extractErrorMessage(err, '批量执行失败'));
    } finally {
      setResolvingId(null);
    }
  };

  const renderBatchCard = (batchId: string): React.ReactNode => {
    const batchActions = (detail?.actions ?? []).filter(
      (action) => action.batchId === batchId && action.status === 'pending',
    );
    if (batchActions.length === 0) return null;
    return (
      <div key={`batch-${batchId}`} className="flow-panel mb-3 border-[var(--flow-accent)]/30 bg-[var(--flow-accent-soft)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--flow-accent)]">
              <ListChecks className="h-3.5 w-3.5" />
              <span className="font-semibold">多步计划 · 共 {batchActions.length} 步（按顺序执行，失败即停）</span>
            </div>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-[var(--flow-text-1)]">
              {batchActions.map((action) => (
                <li key={action.id}>{action.summary}</li>
              ))}
            </ol>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={() => void handleApproveBatch(batchId)}
              disabled={resolvingId === batchId}
            >
              {resolvingId === batchId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              批准整批
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderActionCard = (action: CopilotAction): React.ReactNode => (
    <ApprovalCard
      key={action.id}
      action={action}
      busy={resolvingId === action.id}
      onApprove={async () => handleApprove(action)}
      onReject={async () => {
        setRejectTarget(action);
        setRejectReason('');
      }}
    />
  );

  const renderMessage = (message: CopilotMessage): React.ReactNode => {
    if (message.role === 'tool') {
      return (
        <div key={message.id} className="flex justify-center">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] px-3 py-2 text-xs text-[var(--flow-text-2)]">
            <details>
              <summary className="cursor-pointer select-none">
                <span className="flow-mono text-[var(--flow-text-1)]">{message.toolName}</span>
                <span className="ml-2">{message.toolOk ? '执行成功' : '执行失败'}</span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[var(--flow-text-2)]">{message.content}</pre>
            </details>
            <AgentTrace
              steps={[{
                id: `${message.id}-tool`,
                label: message.toolOk ? '读取真实店铺数据' : '读取数据失败',
                tool: message.toolName,
                status: message.toolOk ? 'done' : 'failed',
                detail: message.toolArgs ? '参数已校验' : undefined,
              }]}
              defaultOpen={false}
            />
          </div>
        </div>
      );
    }

    const isUser = message.role === 'user';
    const action = message.actionId
      ? detail?.actions.find((item) => item.id === message.actionId)
      : undefined;

    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`min-w-0 max-w-[85%] ${isUser ? 'order-2' : ''}`}>
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm ${
              isUser
                ? 'bg-[var(--flow-accent)] text-[var(--flow-accent-ink)]'
                : 'border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] text-[var(--flow-text-1)]'
            }`}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            ) : (
              <Markdown className="flow-body prose-sm max-w-none text-[var(--flow-text-1)]">{message.content}</Markdown>
            )}
          </div>
          {action && renderActionCard(action)}
        </div>
      </div>
    );
  };

  return (
    <div className="flow-dark flow-radial-glow flex h-[calc(100vh-56px)] min-h-[560px] gap-3 -m-4 p-3 lg:-m-6 lg:p-4">
      {/* 会话列表 */}
      <Card className="flow-panel hidden w-64 shrink-0 flex-col overflow-hidden border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] md:flex">
        <div className="flex items-center justify-between border-b border-[var(--flow-line-1)] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--flow-text-1)]">
            <Bot className="h-4 w-4" />
            对话
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleNewConversation()}>
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
                  activeId === conversation.id ? 'bg-[var(--flow-accent-soft)] text-[var(--flow-text-1)]' : 'text-[var(--flow-text-2)] hover:bg-[var(--flow-surface-2)]'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => void loadConversation(conversation.id)}
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
                  onClick={() => void handleDeleteConversation(conversation.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* 店铺巡检：常驻左侧，随时可点一条让副驾处理 */}
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
                onClick={() => void openFunnel()}
              >
                <TrendingUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="巡检设置"
                className="text-slate-400 hover:text-slate-600"
                onClick={() => void openThresholds()}
              >
                <Settings2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="刷新巡检"
                className="text-slate-400 hover:text-slate-600"
                onClick={() => void fetchInsights()}
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
                onClick={() => void handleSend(insight.prompt)}
                disabled={sending}
              >
                <div className="font-medium">{insight.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] opacity-80">{insight.detail}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 对话区 */}
      <Card className="flow-panel flex min-w-0 flex-1 flex-col overflow-hidden border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]">
        <div className="flex items-center justify-between border-b border-[var(--flow-line-1)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--flow-accent-soft)] text-[var(--flow-accent)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--flow-text-1)]">AI 运营副驾</div>
              <div className="text-xs text-[var(--flow-text-3)]">
                读取真实数据 · 写操作需要人工批准
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="md:hidden" onClick={() => void handleNewConversation()}>
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {(!detail || detail.messages.length === 0) && !loadingDetail && (
              <div className="mx-auto max-w-2xl py-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B1F3A] text-white">
                  <Bot className="h-7 w-7" />
                </div>
                <h2 className="text-lg font-semibold text-slate-800">今天想处理什么？</h2>
                <p className="mt-1 text-sm text-slate-500">
                  副驾会先查真实数据再回答；发货、退款、发券等写操作一律要你点确认。
                </p>
                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {QUICK_PROMPTS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      onClick={() => void handleSend(item.prompt)}
                      disabled={sending}
                    >
                      <span>{item.label}</span>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadingDetail && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载对话
              </div>
            )}

            {detail?.messages.map(renderMessage)}

            {pendingBatchIds.length > 0 && (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                {pendingBatchIds.map((batchId) => renderBatchCard(batchId))}
              </div>
            )}

            {sending && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> 副驾正在查询与思考…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <CardContent className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="例如：把订单 ORD... 标记为已发货；或：哪些商品库存偏低？"
              rows={2}
              className="resize-none"
              disabled={sending}
            />
            <Button
              onClick={() => void handleSend()}
              disabled={sending || input.trim().length === 0}
              className="h-10"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              发送
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldAlert className="h-3.5 w-3.5" />
            写操作会先生成待确认动作，未经你批准不会执行
          </div>
        </CardContent>
      </Card>

      <Dialog open={funnelOpen} onOpenChange={setFunnelOpen}>
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
                          className="h-2.5 rounded bg-[#00C2B8]"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                整体转化（打开 → 下单）：
                <span className="ml-1 font-semibold text-[#0B1F3A]">
                  {(funnel.overallConversion * 100).toFixed(1)}%
                </span>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>需求缺口（搜索零结果的词，近 90 天）</span>
                  {demandGaps.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-normal text-[#00C2B8] hover:underline"
                      onClick={() => {
                        setFunnelOpen(false);
                        void handleSend(
                          `买家在导购里搜了这些词但店里没有：${demandGaps.map((gap) => gap.keyword).join('、')}。请基于真实需求给出补货/上架建议`,
                        );
                      }}
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
                          onClick={() => void createDraft(gap.keyword)}
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
                        onClick={() => void backfillAll()}
                        disabled={backfilling}
                      >
                        {backfilling ? '补全中…' : '一键补全文案'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs font-normal text-[#00C2B8] hover:underline"
                      onClick={() => void auditActive()}
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
                    className="text-xs font-normal text-[#00C2B8] hover:underline"
                    onClick={() => void runCopyAudit()}
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
                                onClick={() => void markReviewed(item.productId)}
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
            <Button variant="outline" onClick={() => setFunnelOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={thresholdsOpen} onOpenChange={setThresholdsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>巡检设置</DialogTitle>
            <DialogDescription>调整告警阈值，保存后立即生效（留空或超范围会被拒绝）。</DialogDescription>
          </DialogHeader>
          {watch && (
            <div className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-700">定时巡检</div>
                  <div className="text-xs text-slate-500">后台按间隔自动巡检，只记录新增告警（默认关闭）</div>
                </div>
                <Switch
                  checked={watch.enabled}
                  disabled={watchSaving}
                  onCheckedChange={(checked) => void saveWatch({ enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">间隔（分钟，5-1440）</span>
                <Input
                  type="number"
                  className="w-24"
                  value={watch.intervalMinutes}
                  disabled={watchSaving}
                  onChange={(event) => setWatch({ ...watch, intervalMinutes: Number(event.target.value) })}
                  onBlur={() => void saveWatch({ intervalMinutes: watch.intervalMinutes })}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">通知渠道</span>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                  value={watch.notifyKind}
                  disabled={watchSaving}
                  onChange={(event) => {
                    const kind = event.target.value as 'webhook' | 'email' | 'none';
                    setWatch({ ...watch, notifyKind: kind });
                    void saveWatch({ notifyKind: kind });
                  }}
                >
                  <option value="none">只写日志</option>
                  <option value="webhook">Webhook（飞书/企微/钉钉/Slack）</option>
                  <option value="email">邮件（SMTP）</option>
                </select>
              </div>
              {watch.notifyKind === 'webhook' && (
                <>
                  <Input
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    value={watch.notifyUrl ?? ''}
                    disabled={watchSaving}
                    onChange={(event) => setWatch({ ...watch, notifyUrl: event.target.value })}
                    onBlur={() => void saveWatch({ notifyUrl: watch.notifyUrl ?? '' })}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={watch.notifyOnlyOnNew}
                      disabled={watchSaving}
                      onChange={(event) => {
                        const onlyNew = event.target.checked;
                        setWatch({ ...watch, notifyOnlyOnNew: onlyNew });
                        void saveWatch({ notifyOnlyOnNew: onlyNew });
                      }}
                    />
                    仅在出现新增告警时通知
                  </label>
                </>
              )}
              {watch.notifyKind === 'email' && (
                <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">
                  {[
                    { key: 'host' as const, label: 'SMTP 主机', placeholder: 'smtp.example.com' },
                    { key: 'port' as const, label: '端口', placeholder: '587' },
                    { key: 'from' as const, label: '发件人', placeholder: 'bot@example.com' },
                    { key: 'to' as const, label: '收件人', placeholder: 'owner@example.com' },
                    { key: 'user' as const, label: '用户名（可选）', placeholder: 'bot@example.com' },
                    { key: 'pass' as const, label: '密码（可选）', placeholder: '••••••' },
                  ].map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-2">
                      <span className="shrink-0 text-xs text-slate-600">{field.label}</span>
                      <Input
                        className="h-8 flex-1 text-xs"
                        placeholder={field.placeholder}
                        value={
                          field.key === 'port'
                            ? String(watch.notifySmtp?.port ?? 587)
                            : String(watch.notifySmtp?.[field.key] ?? '')
                        }
                        disabled={watchSaving}
                        onChange={(event) => {
                          const smtp = {
                            host: watch.notifySmtp?.host ?? '',
                            port: watch.notifySmtp?.port ?? 587,
                            secure: watch.notifySmtp?.secure ?? false,
                            user: watch.notifySmtp?.user,
                            pass: watch.notifySmtp?.pass,
                            from: watch.notifySmtp?.from ?? '',
                            to: watch.notifySmtp?.to ?? '',
                          };
                          if (field.key === 'port') {
                            smtp.port = Number(event.target.value) || 587;
                          } else {
                            (smtp as Record<string, unknown>)[field.key] = event.target.value;
                          }
                          setWatch({ ...watch, notifySmtp: smtp });
                        }}
                        onBlur={() => void saveWatch({ notifySmtp: watch.notifySmtp })}
                      />
                    </div>
                  ))}
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={watch.notifySmtp?.secure ?? false}
                      disabled={watchSaving}
                      onChange={(event) => {
                        const secure = event.target.checked;
                        if (!watch.notifySmtp) return;
                        const next = { ...watch.notifySmtp, secure };
                        setWatch({ ...watch, notifySmtp: next });
                        void saveWatch({ notifySmtp: next });
                      }}
                    />
                    使用 SSL/TLS（465 端口通常需要）
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">邮件主题模板</span>
                    <Input
                      className="h-8 flex-1 text-xs"
                      placeholder="【Flow 店铺巡检】{{count}} 项待处理"
                      value={watch.notifySubjectTemplate}
                      disabled={watchSaving}
                      onChange={(event) => setWatch({ ...watch, notifySubjectTemplate: event.target.value })}
                      onBlur={() => void saveWatch({ notifySubjectTemplate: watch.notifySubjectTemplate })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadPreview('markdown')} disabled={previewLoading}>
                      预览 markdown
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadPreview('html')} disabled={previewLoading}>
                      预览 HTML
                    </Button>
                  </div>
                  {preview && (
                    <div className="mt-1 rounded border border-slate-200 bg-slate-900 p-2">
                      <div className="mb-1 text-[11px] text-slate-400">主题：{preview.subject}</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-100">
                        {preview.format === 'html' ? preview.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : preview.body}
                      </pre>
                    </div>
                  )}
                </div>
              )}
              <Button size="sm" variant="outline" className="w-full" onClick={() => void runWatch()} disabled={watchRunning}>
                {watchRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                立即执行一次巡检
              </Button>
            </div>
          )}
          {thresholdsDraft && (
            <div className="space-y-3">
              {[
                { key: 'lowStock' as const, label: '低库存阈值（件）', hint: '总库存低于该值告警' },
                { key: 'pendingRefundHours' as const, label: '退款超时（小时）', hint: '待审批退款超过该时长告警' },
                { key: 'unpaidOrderHours' as const, label: '未支付超时（小时）', hint: '订单创建后超过该时长未付告警' },
                { key: 'staleShippedDays' as const, label: '发货未签收（天）', hint: '发货超过该天数仍为已发货告警' },
              ].map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{field.label}</div>
                    <div className="text-xs text-slate-500">{field.hint}</div>
                  </div>
                  <Input
                    type="number"
                    className="w-24"
                    value={thresholdsDraft[field.key]}
                    onChange={(event) =>
                      setThresholdsDraft({
                        ...thresholdsDraft,
                        [field.key]: Number(event.target.value),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setThresholdsOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void saveThresholds()} disabled={thresholdsSaving}>
              {thresholdsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝该操作</DialogTitle>
            <DialogDescription>拒绝后不会执行任何变更，原因可选。</DialogDescription>
          </DialogHeader>
          <Input
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="拒绝原因（可选）"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void handleReject()} disabled={resolvingId === rejectTarget?.id}>
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CopilotPage;
