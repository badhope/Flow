import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  MessageSquareText,
  TrendingUp,
  Lightbulb,
  AlertTriangle,
  ChevronRight,
  Loader2,
  BarChart3,
  Clock,
  Zap,
  CheckCircle2,
  Settings2,
  Bot,
  Play,
  Pencil,
  Trash2,
  Plus,
  Save,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Markdown } from '@/components/ui/markdown';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  FlowEmpty,
  FlowPanel,
  FlowStat,
  FlowStatus,
  SellerPageHeader,
} from '@/components/seller/SellerUI';
import { aiApi } from '@/api';
import type {
  AIStatusResponse,
  AITrendReport,
  AISelectResponse,
  AIUsageStats,
  AIReportSummary,
  AIReportDetail,
  AiSettingsView,
  CustomAgent,
  BuiltinAgentMeta,
  UpdateAiSettingsRequest,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

const PROVIDER_PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  { label: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
];

const AICenterPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const zh = language === 'zh';
  const [status, setStatus] = useState<AIStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);

  const [trendReport, setTrendReport] = useState<AITrendReport | null>(null);
  const [trendLoading, setTrendLoading] = useState<boolean>(false);

  const [selectResult, setSelectResult] = useState<AISelectResponse | null>(null);
  const [selectLoading, setSelectLoading] = useState<boolean>(false);

  const [usageStats, setUsageStats] = useState<AIUsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState<boolean>(true);

  const [reports, setReports] = useState<AIReportSummary[]>([]);
  const [activeReport, setActiveReport] = useState<AIReportDetail | null>(null);

  // —— 模型设置 ——
  const [aiSettings, setAiSettings] = useState<AiSettingsView | null>(null);
  const [settingsForm, setSettingsForm] = useState<{ baseUrl: string; apiKey: string; model: string }>({
    baseUrl: '',
    apiKey: '',
    model: '',
  });
  const [settingsSaving, setSettingsSaving] = useState<boolean>(false);
  const [settingsTesting, setSettingsTesting] = useState<boolean>(false);
  const [settingsTestResult, setSettingsTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // —— 自定义 Agent ——
  const [agents, setAgents] = useState<{ builtin: BuiltinAgentMeta[]; custom: CustomAgent[] }>({
    builtin: [],
    custom: [],
  });
  const [agentDialogOpen, setAgentDialogOpen] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null);
  const [agentForm, setAgentForm] = useState<{
    name: string;
    slug: string;
    description: string;
    systemPrompt: string;
    userPromptTemplate: string;
    responseFormat: 'text' | 'json';
    temperature: string;
    maxTokens: string;
    enabled: boolean;
  }>({
    name: '',
    slug: '',
    description: '',
    systemPrompt: '',
    userPromptTemplate: '{{input}}',
    responseFormat: 'text',
    temperature: '0.7',
    maxTokens: '2000',
    enabled: true,
  });
  const [agentSaving, setAgentSaving] = useState<boolean>(false);
  const [runAgentId, setRunAgentId] = useState<string | null>(null);
  const [runInput, setRunInput] = useState<string>('');
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState<boolean>(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        setLoadingStatus(true);
        const result = await aiApi.getAIStatus();
        setStatus(result);
      } catch (err) {
        notifyError(err, '获取 AI 状态失败');
        setStatus({ configured: false });
      } finally {
        setLoadingStatus(false);
      }
    };
    fetchStatus();
    fetchUsageStats();
    void fetchReports();
    void fetchAiSettings();
    void fetchAgents();
  }, []);

  const fetchReports = async () => {
    try {
      const result = await aiApi.getAIReports('trend');
      setReports(result);
    } catch (err) {
      notifyError(err, '获取历史报告失败');
    }
  };

  const handleViewReport = async (id: string) => {
    try {
      const detail = await aiApi.getAIReport(id);
      setActiveReport(detail);
    } catch (err) {
      notifyError(err, '读取报告失败');
    }
  };

  const fetchAiSettings = async () => {
    try {
      const result = await aiApi.getAiSettings();
      setAiSettings(result);
      setSettingsForm((prev) => ({
        baseUrl: prev.baseUrl || result.baseUrl || '',
        apiKey: prev.apiKey,
        model: prev.model || result.model || '',
      }));
    } catch (err) {
      notifyError(err, '获取模型设置失败');
    }
  };

  const fetchAgents = async () => {
    try {
      setAgents(await aiApi.listAiAgents());
    } catch (err) {
      notifyError(err, '获取 Agent 列表失败');
    }
  };

  const handleSaveAiSettings = async () => {
    try {
      setSettingsSaving(true);
      const payload: UpdateAiSettingsRequest = {};
      if (settingsForm.baseUrl.trim() !== (aiSettings?.baseUrl ?? '')) payload.baseUrl = settingsForm.baseUrl.trim();
      if (settingsForm.model.trim() !== (aiSettings?.model ?? '')) payload.model = settingsForm.model.trim();
      if (settingsForm.apiKey.trim()) payload.apiKey = settingsForm.apiKey.trim();

      const updated = await aiApi.updateAiSettings(payload);
      setAiSettings(updated);
      setSettingsForm({ baseUrl: updated.baseUrl, model: updated.model, apiKey: '' });
      setStatus((prev) => (prev ? { ...prev, configured: updated.configured, model: updated.model } : prev));
      toast('模型设置已保存（立即生效）');
    } catch (err) {
      console.error('保存模型设置失败', err);
      toast('保存失败，请检查填写内容');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!window.confirm('清除界面中保存的 API Key？将回退到环境变量或未配置状态。')) return;
    try {
      const updated = await aiApi.updateAiSettings({ apiKey: '' });
      setAiSettings(updated);
      setStatus((prev) => (prev ? { ...prev, configured: updated.configured, model: updated.model } : prev));
      toast('已清除界面中的 API Key');
    } catch (err) {
      console.error('清除 Key 失败', err);
      toast('清除失败');
    }
  };

  const handleTestAiSettings = async () => {
    try {
      setSettingsTesting(true);
      setSettingsTestResult(null);
      const result = await aiApi.testAiSettings();
      setSettingsTestResult(result);
    } catch (err) {
      console.error('测试连通失败', err);
      setSettingsTestResult({ ok: false, message: '测试请求失败，请稍后再试' });
    } finally {
      setSettingsTesting(false);
    }
  };

  const openCreateAgent = () => {
    setEditingAgent(null);
    setAgentForm({
      name: '',
      slug: '',
      description: '',
      systemPrompt: '',
      userPromptTemplate: '{{input}}',
      responseFormat: 'text',
      temperature: '0.7',
      maxTokens: '2000',
      enabled: true,
    });
    setAgentDialogOpen(true);
  };

  const openEditAgent = (agent: CustomAgent) => {
    setEditingAgent(agent);
    setAgentForm({
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      userPromptTemplate: agent.userPromptTemplate,
      responseFormat: agent.responseFormat,
      temperature: String(agent.temperature),
      maxTokens: String(agent.maxTokens),
      enabled: agent.enabled,
    });
    setAgentDialogOpen(true);
  };

  const handleSaveAgent = async () => {
    try {
      setAgentSaving(true);
      const payload = {
        name: agentForm.name.trim(),
        description: agentForm.description.trim(),
        systemPrompt: agentForm.systemPrompt,
        userPromptTemplate: agentForm.userPromptTemplate,
        responseFormat: agentForm.responseFormat,
        temperature: Number(agentForm.temperature) || 0.7,
        maxTokens: Number(agentForm.maxTokens) || 2000,
        enabled: agentForm.enabled,
      };

      if (editingAgent) {
        await aiApi.updateAiAgent(editingAgent.id, payload);
      } else {
        await aiApi.createAiAgent({ ...payload, slug: agentForm.slug.trim() || undefined });
      }

      setAgentDialogOpen(false);
      await fetchAgents();
      toast(editingAgent ? 'Agent 已更新' : 'Agent 已创建');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(message ? String(message) : '保存失败');
    } finally {
      setAgentSaving(false);
    }
  };

  const handleRemoveAgent = async (agent: CustomAgent) => {
    if (!window.confirm(`删除 Agent「${agent.name}」？此操作不可恢复。`)) return;
    try {
      await aiApi.deleteAiAgent(agent.id);
      await fetchAgents();
      toast('Agent 已删除');
    } catch (err) {
      console.error('删除 Agent 失败', err);
      toast('删除失败');
    }
  };

  const handleRunAgent = async (agent: CustomAgent) => {
    try {
      setRunLoading(true);
      setRunOutput(null);
      const result = await aiApi.runAiAgent(agent.id, runInput);
      setRunOutput(result.parsed !== undefined ? JSON.stringify(result.parsed, null, 2) : result.content);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(message ? String(message) : '运行失败');
    } finally {
      setRunLoading(false);
    }
  };

  const fetchUsageStats = async () => {
    try {
      setUsageLoading(true);
      const result = await aiApi.getUsageStats();
      setUsageStats(result);
    } catch (err) {
      notifyError(err, '获取 AI 用量统计失败');
    } finally {
      setUsageLoading(false);
    }
  };

  const handleGenerateTrend = async () => {
    try {
      setTrendLoading(true);
      const result = await aiApi.generateTrendReport();
      setTrendReport(result);
      void fetchReports();
    } catch (err) {
      console.error('生成趋势报告失败', err);
      toast('生成失败，请检查 AI 配置');
    } finally {
      setTrendLoading(false);
    }
  };

  const handleGenerateSelect = async () => {
    try {
      setSelectLoading(true);
      const result = await aiApi.generateSelectSuggestion();
      setSelectResult(result);
    } catch (err) {
      console.error('生成选品建议失败', err);
      toast('生成失败，请检查 AI 配置');
    } finally {
      setSelectLoading(false);
    }
  };

  const featureCards = [
    {
      title: 'AI 文案生成',
      description: '一键生成多语言商品标题、卖点和描述',
      icon: Sparkles,
      actionLabel: '前往使用',
      onClick: () => navigate('/seller/products'),
    },
    {
      title: '智能客服',
      description: '基于店铺 FAQ 与真实订单状态自动应答',
      icon: MessageSquareText,
      actionLabel: '前往咨询管理',
      onClick: () => navigate('/seller/inquiries'),
    },
    {
      title: '市场趋势',
      description: '聚合近 30 天销量后由模型解读',
      icon: TrendingUp,
      actionLabel: trendReport ? '重新生成' : '生成趋势简报',
      onClick: handleGenerateTrend,
      loading: trendLoading,
    },
    {
      title: '选品建议',
      description: '结合类目、热销与 90 天需求缺口推荐',
      icon: Lightbulb,
      actionLabel: selectResult ? '重新推荐' : '帮我选品',
      onClick: handleGenerateSelect,
      loading: selectLoading,
    },
  ];

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={zh ? 'AI 控制台' : 'AI console'}
        title={zh ? 'AI 分析中心' : 'AI Center'}
        description={
          zh
            ? '5 个内置 Agent + 自定义 Agent，全部走真实模型调用；未配置模型时诚实报错，不返回假数据。'
            : 'Five built-in agents plus custom ones, all backed by real model calls. Honestly errors when unconfigured.'
        }
        status={
          !loadingStatus ? (
            <FlowStatus tone={status?.configured ? 'ok' : 'warn'}>
              {status?.configured ? (status.model || (zh ? '已配置' : 'Configured')) : zh ? '未配置模型' : 'No model'}
            </FlowStatus>
          ) : null
        }
      />

      {/* 概览：3 指标 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FlowStat
          label={zh ? '累计调用' : 'Total calls'}
          value={usageStats ? usageStats.totalCalls.toLocaleString() : '--'}
          icon={Zap}
        />
        <FlowStat
          label={zh ? '成功率' : 'Success rate'}
          value={usageStats ? `${(usageStats.successRate * 100).toFixed(1)}%` : '--'}
          icon={CheckCircle2}
        />
        <FlowStat
          label={zh ? '总耗时' : 'Total time'}
          value={usageStats ? `${(usageStats.totalDurationMs / 1000).toFixed(1)}s` : '--'}
          icon={Clock}
        />
        <FlowStat
          label={zh ? '历史报告' : 'Reports'}
          value={reports.length}
          icon={BarChart3}
        />
      </div>

      {/* Agent 名册：内置 + 自定义 */}
      <FlowPanel
        title={zh ? 'Agent 名册' : 'Agent roster'}
        description={
          zh ? '内置 Agent 只读；自定义 Agent 可编辑提示词与输出格式' : 'Built-ins are read-only; custom agents are fully editable'
        }
        icon={Bot}
        actions={
          <button type="button" onClick={openCreateAgent} className="flow-btn-accent h-8 text-xs">
            <Plus className="size-3.5" />
            {zh ? '新建 Agent' : 'New agent'}
          </button>
        }
        bodyClassName="space-y-4"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {[...agents.builtin.map((a) => ({ kind: 'builtin' as const, agent: a })), ...agents.custom.map((a) => ({ kind: 'custom' as const, agent: a }))].map((entry) => (
            <div
              key={entry.kind === 'builtin' ? entry.agent.key : entry.agent.id}
              className="rounded-lg border border-[var(--flow-line-1)] bg-[var(--flow-surface-2)] p-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--flow-accent-soft)]">
                  <Bot className="size-3.5 text-[var(--flow-accent)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-[var(--flow-text-1)]">
                      {entry.agent.name}
                    </span>
                    <span className="shrink-0 rounded border border-[var(--flow-line-2)] px-1 text-[9px] text-[var(--flow-text-3)]">
                      {entry.kind === 'builtin' ? (zh ? '内置' : 'builtin') : (zh ? '自定义' : 'custom')}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--flow-text-2)]">
                    {entry.agent.description}
                  </p>
                  {entry.kind === 'custom' && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRunAgentId(entry.agent.id);
                          void handleRunAgent(entry.agent);
                        }}
                        className="text-[11px] text-[var(--flow-accent)] transition-opacity hover:opacity-80"
                      >
                        {zh ? '试跑' : 'Run'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditAgent(entry.agent)}
                        className="text-[11px] text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-text-1)]"
                      >
                        {zh ? '编辑' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveAgent(entry.agent)}
                        className="text-[11px] text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-danger)]"
                      >
                        {zh ? '删除' : 'Delete'}
                      </button>
                    </div>
                  )}
                  {entry.kind === 'custom' && runAgentId === entry.agent.id && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={runInput}
                        onChange={(e) => setRunInput(e.target.value)}
                        placeholder={zh ? '输入内容后试跑' : 'Input to test'}
                        className="h-8 w-full rounded-md border border-[var(--flow-line-2)] bg-[var(--flow-surface-1)] px-2 text-[11px] text-[var(--flow-text-1)] outline-none placeholder:text-[var(--flow-text-3)]"
                      />
                      {runOutput && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--flow-surface-1)] p-2 text-[10px] text-[var(--flow-text-2)]">
                          {runOutput}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </FlowPanel>

      {/* 能力入口 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {featureCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.title}
              type="button"
              onClick={() => void card.onClick()}
              disabled={card.loading}
              className="group rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] p-4 text-left transition-colors hover:border-[var(--flow-line-3)] hover:bg-[var(--flow-surface-2)] disabled:opacity-60"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--flow-accent-soft)]">
                {card.loading ? (
                  <Loader2 className="size-4 animate-spin text-[var(--flow-accent)]" />
                ) : (
                  <Icon className="size-4 text-[var(--flow-accent)]" />
                )}
              </span>
              <p className="mt-3 text-[13px] font-medium text-[var(--flow-text-1)]">{card.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--flow-text-2)]">{card.description}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--flow-text-3)] transition-colors group-hover:text-[var(--flow-accent)]">
                {card.loading ? (zh ? '生成中…' : 'Generating…') : card.actionLabel}
                <ChevronRight className="size-3" />
              </span>
            </button>
          );
        })}
      </div>

      {!loadingStatus && !status?.configured && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--flow-warn)]/30 bg-[var(--flow-warn)]/10 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--flow-warn)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--flow-text-1)]">
              {zh ? 'AI 功能尚未启用' : 'AI is not enabled yet'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--flow-text-2)]">
              {zh
                ? '在页面底部「模型设置」填写 OpenAI 兼容端点即可启用；未配置期间 AI 端点诚实返回提示，绝不返回假数据。'
                : 'Fill the OpenAI-compatible endpoint under Model settings at the bottom. Until then AI endpoints honestly refuse instead of returning fake data.'}
            </p>
          </div>
        </div>
      )}

      {/* 模型设置 */}
      <FlowPanel
        title={zh ? '模型设置' : 'Model settings'}
        description={zh ? '任意 OpenAI 兼容端点；保存即生效，未配置时 AI 端点诚实拒绝' : 'Any OpenAI-compatible endpoint; applies on save'}
        icon={Settings2}
        bodyClassName="space-y-4"
      >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {aiSettings?.configured ? (
              <Badge className="bg-emerald-100 text-emerald-700">已配置</Badge>
            ) : (
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                未配置
              </Badge>
            )}
            {aiSettings?.source === 'db' && <span className="text-muted-foreground">来源：界面设置</span>}
            {aiSettings?.source === 'env' && (
              <span className="text-muted-foreground">来源：环境变量（引导默认值）</span>
            )}
            {aiSettings?.apiKeyMasked && (
              <span className="text-muted-foreground">当前 Key：{aiSettings.apiKeyMasked}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">一键预填：</span>
            {PROVIDER_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setSettingsForm((prev) => ({ ...prev, baseUrl: preset.baseUrl, model: preset.model }))
                }
              >
                {preset.label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">
              （Key 请使用您自己的账号；也可直接手填任意 OpenAI 兼容端点）
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                value={settingsForm.baseUrl}
                placeholder="https://api.deepseek.com"
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={settingsForm.apiKey}
                placeholder="留空不修改；输入新值覆盖"
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>模型名</Label>
              <Input
                value={settingsForm.model}
                placeholder="deepseek-chat"
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, model: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleSaveAiSettings()} disabled={settingsSaving}>
              {settingsSaving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              保存设置
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleTestAiSettings()}
              disabled={settingsTesting}
            >
              {settingsTesting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              测试连通（使用已保存配置）
            </Button>
            {aiSettings?.apiKeyMasked && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={() => void handleClearApiKey()}
              >
                清除界面 Key
              </Button>
            )}
          </div>

          {settingsTestResult && (
            <p className={`text-sm ${settingsTestResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
              {settingsTestResult.message}
            </p>
          )}
        </FlowPanel>

      {/* 用量统计 */}
      <FlowPanel
        title={zh ? 'AI 用量统计' : 'AI usage'}
        description={zh ? '累计调用量与资源消耗' : 'Cumulative calls and resource use'}
        icon={BarChart3}
      >
          {usageLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : usageStats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-ai-section-type="card-stat">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Zap className="h-3.5 w-3.5" />
                    总调用次数
                  </div>
                  <div className="mt-1 text-xl font-bold text-slate-900">
                    {usageStats.totalCalls.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Clock className="h-3.5 w-3.5" />
                    总耗时(秒)
                  </div>
                  <div className="mt-1 text-xl font-bold text-slate-900">
                    {(usageStats.totalDurationMs / 1000).toFixed(1)}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Sparkles className="h-3.5 w-3.5" />
                    Token 总量
                  </div>
                  <div className="mt-1 text-xl font-bold text-slate-900">
                    {(usageStats.totalInputTokens + usageStats.totalOutputTokens).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    成功率
                  </div>
                  <div className="mt-1 text-xl font-bold text-slate-900">
                    {(usageStats.successRate * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              {usageStats.byAgent.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    按 Agent 分布
                  </div>
                  <div className="space-y-2">
                    {usageStats.byAgent.map((stat) => (
                      <div
                        key={stat.agent}
                        className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"
                      >
                        <span className="text-sm font-medium text-slate-700 capitalize">
                          {stat.agent}
                        </span>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{stat.calls} 次</span>
                          <span>{stat.inputTokens + stat.outputTokens} tokens</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
      </FlowPanel>

      {/* 趋势报告结果 */}
      {trendReport && (
        <FlowPanel
          title={trendReport.title || (zh ? '市场趋势简报' : 'Trend brief')}
          description={(zh ? '生成时间：' : 'Generated ') + new Date(trendReport.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}
          icon={TrendingUp}
        >
          <div className="prose prose-sm max-w-none text-[var(--flow-text-2)]">
            <Markdown>{trendReport.content}</Markdown>
          </div>
        </FlowPanel>
      )}

      {/* 历史报告（落库回看） */}
      <FlowPanel
        title={zh ? '历史报告' : 'Report history'}
        description={zh ? '已生成的趋势报告落库保存，可随时回看' : 'Saved trend reports, reviewable anytime'}
        icon={Clock}
      >
          {reports.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无历史报告</p>
          ) : (
            <div className="space-y-2">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {report.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(report.createdAt).toLocaleString('zh-CN')}
                      {report.model ? ` · ${report.model}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleViewReport(report.id)}
                  >
                    查看
                  </Button>
                </div>
              ))}
            </div>
          )}
          {activeReport && (
            <div className="mt-4 rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">
                  {activeReport.title}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setActiveReport(null)}>
                  收起
                </Button>
              </div>
              <div className="prose prose-sm max-w-none">
                <Markdown>{activeReport.content}</Markdown>
              </div>
            </div>
          )}
      </FlowPanel>

      {/* 选品建议结果 */}
      {selectResult && selectResult.items.length > 0 && (
        <FlowPanel
          title={zh ? 'AI 选品推荐' : 'AI product picks'}
          description={zh ? `基于市场数据的 ${selectResult.items.length} 个方向` : `${selectResult.items.length} directions from market data`}
          icon={Lightbulb}
          bodyClassName="space-y-3"
        >
            {selectResult.items.map((item, index) => (
              <div
                key={index}
                className="rounded-lg border p-4 transition-colors hover:border-amber-200 hover:bg-amber-50/30"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-slate-900">
                      {index + 1}. {item.keyword}
                    </h4>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      <span className="text-muted-foreground">
                        预估需求：
                        <span className="font-medium text-slate-700">
                          {item.estimatedDemand}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        建议价格：
                        <span className="font-medium text-slate-700">
                          {item.suggestedPriceRange}
                        </span>
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      item.confidence >= 0.8
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.confidence >= 0.6
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-700'
                    }
                  >
                    置信度 {Math.round(item.confidence * 100)}%
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {item.reason}
                </p>
              </div>
            ))}
        </FlowPanel>
      )}
      {/* Agent 新建/编辑对话框 */}
      <Dialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAgent ? '编辑 Agent' : '新建 Agent'}</DialogTitle>
            <DialogDescription>
              系统提示词定义角色与规则；用户模板中的 {'{{input}}'} 会被运行时输入替换（缺占位符时输入追加在末尾）
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>名称 *</Label>
                <Input
                  value={agentForm.name}
                  placeholder="如：差评回复助手"
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>标识 slug（可选）</Label>
                <Input
                  value={agentForm.slug}
                  placeholder="review-helper（小写字母/数字/连字符）"
                  disabled={!!editingAgent}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, slug: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>描述</Label>
              <Input
                value={agentForm.description}
                placeholder="这个 Agent 做什么（展示用）"
                onChange={(e) => setAgentForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>系统提示词 *</Label>
              <Textarea
                rows={5}
                value={agentForm.systemPrompt}
                placeholder="你是……，请遵守以下规则：……"
                onChange={(e) => setAgentForm((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>用户提示词模板</Label>
              <Textarea
                rows={3}
                value={agentForm.userPromptTemplate}
                placeholder="{{input}}"
                onChange={(e) => setAgentForm((prev) => ({ ...prev, userPromptTemplate: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>输出格式</Label>
                <div className="flex gap-1 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={agentForm.responseFormat === 'text' ? 'default' : 'outline'}
                    onClick={() => setAgentForm((prev) => ({ ...prev, responseFormat: 'text' }))}
                  >
                    文本
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={agentForm.responseFormat === 'json' ? 'default' : 'outline'}
                    onClick={() => setAgentForm((prev) => ({ ...prev, responseFormat: 'json' }))}
                  >
                    JSON
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>temperature</Label>
                <Input
                  value={agentForm.temperature}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, temperature: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>maxTokens</Label>
                <Input
                  value={agentForm.maxTokens}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, maxTokens: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={agentForm.enabled}
                onCheckedChange={(value) => setAgentForm((prev) => ({ ...prev, enabled: value }))}
              />
              <span className="text-sm text-slate-700">启用</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAgentDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => void handleSaveAgent()}
              disabled={agentSaving || !agentForm.name.trim() || !agentForm.systemPrompt.trim()}
            >
              {agentSaving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default AICenterPage;
