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
import ConversationSidebar from './copilot/ConversationSidebar';
import ChatPanel from './copilot/ChatPanel';
import FunnelDialog from './copilot/FunnelDialog';
import WatchSettingsDialog from './copilot/WatchSettingsDialog';
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
      {/* 会话列表与巡检 */}
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        loadingList={loadingList}
        insights={insights}
        insightsLoading={insightsLoading}
        sending={sending}
        onNew={() => void handleNewConversation()}
        onSelect={(id) => void loadConversation(id)}
        onDelete={(id) => void handleDeleteConversation(id)}
        onRefreshInsights={() => void fetchInsights()}
        onOpenFunnel={() => void openFunnel()}
        onOpenThresholds={() => void openThresholds()}
        onInsightClick={(prompt) => void handleSend(prompt)}
      />

      {/* 对话区 */}
      <ChatPanel
        hasMessages={Boolean(detail && detail.messages.length > 0)}
        loadingDetail={loadingDetail}
        sending={sending}
        input={input}
        bottomRef={bottomRef}
        onInputChange={setInput}
        onSend={(text) => void handleSend(text)}
        onNew={() => void handleNewConversation()}
      >
        {detail?.messages.map(renderMessage)}

        {pendingBatchIds.length > 0 && (
          <div className="space-y-2 border-t border-slate-200 pt-3">
            {pendingBatchIds.map((batchId) => renderBatchCard(batchId))}
          </div>
        )}
      </ChatPanel>


      <FunnelDialog
        open={funnelOpen}
        onOpenChange={setFunnelOpen}
        funnel={funnel}
        funnelLoading={funnelLoading}
        demandGaps={demandGaps}
        productFunnel={productFunnel}
        draftingKeyword={draftingKeyword}
        auditResult={auditResult}
        auditing={auditing}
        backfilling={backfilling}
        copyAudit={copyAudit}
        copyAuditing={copyAuditing}
        onAnalyze={() => {
          setFunnelOpen(false);
          void handleSend(
            `买家在导购里搜了这些词但店里没有：${demandGaps.map((gap) => gap.keyword).join('、')}。请基于真实需求给出补货/上架建议`,
          );
        }}
        onCreateDraft={(keyword) => void createDraft(keyword)}
        onAudit={() => void auditActive()}
        onBackfill={() => void backfillAll()}
        onCopyAudit={() => void runCopyAudit()}
        onMarkReviewed={(productId) => void markReviewed(productId)}
      />


      <WatchSettingsDialog
        open={thresholdsOpen}
        onOpenChange={setThresholdsOpen}
        watch={watch}
        watchSaving={watchSaving}
        watchRunning={watchRunning}
        thresholdsDraft={thresholdsDraft}
        thresholdsSaving={thresholdsSaving}
        preview={preview}
        previewLoading={previewLoading}
        onWatchChange={setWatch}
        onSaveWatch={(patch) => void saveWatch(patch)}
        onRunWatch={() => void runWatch()}
        onLoadPreview={(format) => void loadPreview(format)}
        onThresholdsChange={setThresholdsDraft}
        onSaveThresholds={() => void saveThresholds()}
      />

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
