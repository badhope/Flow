import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '../../lib/echarts';
import {
  ArrowUpRight,
  Bot,
  CircleAlert,
  Clock,
  Package,
  PlugZap,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';
import { dashboardApi, copilotApi } from '@/api';
import type { CopilotInsightsView, DashboardData } from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';
import { useLanguage } from '@/contexts/LanguageContext';

/** 暗色图表统一基线 */
const AXIS_LINE = 'rgba(255,255,255,0.08)';
const SPLIT_LINE = 'rgba(255,255,255,0.05)';
const TEXT_2 = '#9CA3B0';
const ACCENT = '#C6FF4A';
const CYAN = '#22D3C5';
const SERIES = [ACCENT, CYAN, '#FFB020', '#FF5A5F', '#8FA3BF'];

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [insights, setInsights] = useState<CopilotInsightsView | null>(null);
  const [insightsError, setInsightsError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const { language } = useLanguage();
  const zh = language === 'zh';
  const navigate = useNavigate();

  const fetchData = React.useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const [result, insightResult] = await Promise.all([
        dashboardApi.getDashboardStats(),
        copilotApi.getCopilotInsights().catch(() => null),
      ]);
      setData(result);
      setInsights(insightResult);
      setInsightsError(insightResult === null);
      try {
        const status = await import('@/api/ai').then((m) => m.getAIStatus());
        setAiConfigured(status.configured);
      } catch {
        setAiConfigured(null);
      }
    } catch (err) {
      notifyError(err, zh ? '获取看板数据失败，请重试' : 'Failed to load dashboard');
      setError(zh ? '数据加载失败' : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const topFindings = useMemo(() => {
    if (!insights) return [];
    return [...insights.insights]
      .sort((a, b) => {
        const rank = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
        return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
      })
      .slice(0, 3);
  }, [insights]);

  const trendOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#10131A',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        textStyle: { color: '#F2F4F8', fontSize: 12 },
        axisPointer: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
      },
      legend: {
        top: 0,
        right: 0,
        data: [zh ? '销售额' : 'Revenue', zh ? '订单数' : 'Orders'],
        textStyle: { color: TEXT_2, fontSize: 11 },
        itemWidth: 8,
        itemHeight: 8,
        icon: 'circle',
      },
      grid: { left: 8, right: 8, bottom: 8, top: 40, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data?.salesTrend.map((item) => item.date.slice(5)) ?? [],
        axisLine: { lineStyle: { color: AXIS_LINE } },
        axisTick: { show: false },
        axisLabel: { color: TEXT_2, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: SPLIT_LINE, type: 'dashed' } },
          axisLabel: { color: TEXT_2, fontSize: 10 },
        },
        {
          type: 'value',
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: TEXT_2, fontSize: 10 },
        },
      ],
      series: [
        {
          name: zh ? '销售额' : 'Revenue',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { color: ACCENT, width: 1.5 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(198,255,74,0.18)' },
                { offset: 1, color: 'rgba(198,255,74,0)' },
              ],
            },
          },
          data: data?.salesTrend.map((item) => item.amount) ?? [],
        },
        {
          name: zh ? '订单数' : 'Orders',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: CYAN, width: 1.5 },
          data: data?.salesTrend.map((item) => item.orders) ?? [],
        },
      ],
    }),
    [data, zh],
  );

  const pieOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#10131A',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        textStyle: { color: '#F2F4F8', fontSize: 12 },
        formatter: '{b}: ${c} ({d}%)',
      },
      legend: {
        bottom: 0,
        left: 'center',
        textStyle: { color: TEXT_2, fontSize: 11 },
        itemWidth: 8,
        itemHeight: 8,
        icon: 'circle',
      },
      color: SERIES,
      series: [
        {
          name: zh ? '分类销售' : 'Category sales',
          type: 'pie',
          radius: ['52%', '74%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 3,
            borderColor: '#07080B',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: false },
            itemStyle: { shadowBlur: 12, shadowColor: 'rgba(198,255,74,0.25)' },
          },
          labelLine: { show: false },
          data:
            data?.categorySales.map((item) => ({
              name: item.name,
              value: item.amount,
            })) ?? [],
        },
      ],
    }),
    [data, zh],
  );

  const severityStyle: Record<string, { dot: string; text: string }> = {
    critical: { dot: 'bg-[var(--flow-danger)]', text: 'text-[var(--flow-danger)]' },
    warning: { dot: 'bg-[var(--flow-warn)]', text: 'text-[var(--flow-warn)]' },
    info: { dot: 'bg-[var(--flow-cyan)]', text: 'text-[var(--flow-cyan)]' },
  };

  const kpis = [
    { label: zh ? 'GMV 总成交额' : 'GMV', value: data ? `$${data.stats.gmv}` : '--', icon: TrendingUp },
    { label: zh ? '订单数' : 'Orders', value: data?.stats.orderCount ?? '--', icon: ShoppingCart },
    { label: zh ? '访客数' : 'Visitors', value: data?.stats.visitorCount ?? '--', icon: Users },
    { label: zh ? '在架商品' : 'Products', value: data?.stats.productCount ?? '--', icon: Package },
  ];

  const queue = [
    { label: zh ? '待发货订单' : 'Awaiting shipment', value: data?.stats.pendingOrders ?? 0, icon: Truck, to: '/seller/orders' },
    { label: zh ? '今日订单' : 'Orders today', value: data?.stats.todayOrders ?? 0, icon: Clock, to: '/seller/orders' },
    { label: zh ? '今日 GMV' : 'GMV today', value: data ? `$${data.stats.todayGmv}` : '--', icon: TrendingUp, to: '/seller/orders' },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-12 gap-4">
        <div className="flow-skeleton col-span-12 h-[220px] rounded-2xl lg:col-span-8" />
        <div className="flow-skeleton col-span-12 h-[220px] rounded-2xl lg:col-span-4" />
        <div className="flow-skeleton col-span-12 h-[320px] rounded-2xl lg:col-span-8" />
        <div className="flow-skeleton col-span-12 h-[320px] rounded-2xl lg:col-span-4" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <CircleAlert className="size-6 text-[var(--flow-danger)]" />
        <p className="text-sm text-[var(--flow-text-2)]">{error}</p>
        <button type="button" onClick={() => void fetchData()} className="flow-btn-ghost h-9 text-xs">
          <RefreshCw className="size-3.5" />
          {zh ? '重试' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* AI 简报：占 8 列 */}
      <section className="col-span-12 overflow-hidden rounded-2xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] lg:col-span-8">
        <div className="flex items-center gap-2 border-b border-[var(--flow-line-1)] px-5 py-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-[var(--flow-accent-soft)]">
            <Sparkles className="size-3.5 text-[var(--flow-accent)]" />
          </span>
          <h2 className="text-sm font-medium text-[var(--flow-text-1)]">
            {zh ? '今日 AI 简报' : "Today's AI briefing"}
          </h2>
          {insights && (
            <span className="flow-mono ml-auto text-[10px] text-[var(--flow-text-3)]">
              {new Date(insights.generatedAt).toLocaleTimeString(zh ? 'zh-CN' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchData()}
            className="text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-text-1)]"
            aria-label={zh ? '刷新' : 'Refresh'}
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        <div className="p-5">
          {insightsError ? (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--flow-danger)]/30 bg-[var(--flow-danger)]/10 p-4">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--flow-danger)]" />
              <div>
                <p className="text-sm font-medium text-[var(--flow-text-1)]">
                  {zh ? 'AI 巡检加载失败' : 'AI inspection failed'}
                </p>
                <p className="mt-1 text-xs text-[var(--flow-text-2)]">
                  {zh ? '暂时无法确认店铺是否有异常，请重试；不会把失败误报为“暂无异常”。' : 'We could not confirm store health. Retry instead of treating the failure as a clean result.'}
                </p>
                <button type="button" onClick={() => void fetchData()} className="flow-btn-ghost mt-3 h-8 text-xs">
                  <RefreshCw className="size-3.5" />
                  {zh ? '重试巡检' : 'Retry inspection'}
                </button>
              </div>
            </div>
          ) : aiConfigured === false ? (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--flow-line-2)] bg-[var(--flow-surface-2)] p-4">
              <PlugZap className="mt-0.5 size-4 shrink-0 text-[var(--flow-warn)]" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--flow-text-1)]">
                  {zh ? 'AI 尚未接入模型' : 'AI model not configured'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--flow-text-2)]">
                  {zh
                    ? '配置任意 OpenAI 兼容端点后，副驾与 5 个 Agent 即刻可用；未配置时所有非 AI 功能正常运行。'
                    : 'Add any OpenAI-compatible endpoint to enable Copilot and the 5 agents. Everything else works without it.'}
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/seller/ai-center')}
                  className="flow-btn-accent mt-3 h-8 text-xs"
                >
                  {zh ? '去配置模型' : 'Configure model'}
                </button>
              </div>
            </div>
          ) : topFindings.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--flow-text-2)]">
                {zh ? '店铺当前没有需要处理的异常' : 'Nothing needs attention right now'}
              </p>
              <button
                type="button"
                onClick={() => navigate('/seller/copilot')}
                className="flow-btn-ghost mt-3 h-8 text-xs"
              >
                <Bot className="size-3.5" />
                {zh ? '让副驾做一次巡检' : 'Run a Copilot check'}
              </button>
            </div>
          ) : (
            <>
              <ul className="space-y-2.5">
                {topFindings.map((item) => {
                  const style = severityStyle[item.severity] ?? severityStyle.info;
                  return (
                    <li key={item.id} className="flex items-start gap-2.5">
                      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${style.dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-medium ${style.text}`}>{item.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-[var(--flow-text-2)]">
                          {item.detail}
                        </p>
                      </div>
                      {item.prompt && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/seller/copilot?q=${encodeURIComponent(item.prompt)}`)
                          }
                          className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-accent)]"
                        >
                          {zh ? '交给副驾' : 'Hand to Copilot'}
                          <ArrowUpRight className="size-3" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => navigate('/seller/copilot')}
                className="flow-btn-accent mt-4 h-8 text-xs"
              >
                <Bot className="size-3.5" />
                {zh ? '打开运营副驾' : 'Open Copilot'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* KPI 2x2：占 4 列 */}
      <section className="col-span-12 grid grid-cols-2 gap-3 lg:col-span-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] p-4 transition-colors hover:border-[var(--flow-line-2)]"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--flow-text-3)]">
                <Icon className="size-3" />
                <span className="truncate">{kpi.label}</span>
              </div>
              <p className="flow-data-xl mt-2 text-[var(--flow-text-1)]">{kpi.value}</p>
            </div>
          );
        })}
      </section>

      {/* 主图：8 列 */}
      <section className="col-span-12 rounded-2xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] lg:col-span-8">
        <div className="flex items-center justify-between border-b border-[var(--flow-line-1)] px-5 py-3">
          <h2 className="text-sm font-medium text-[var(--flow-text-1)]">
            {zh ? '近 30 天销售趋势' : 'Sales · last 30 days'}
          </h2>
          <span className="flow-caption">{zh ? '按天聚合' : 'Daily'}</span>
        </div>
        <div className="p-3">
          <ReactEChartsCore
            echarts={echarts}
            option={trendOption}
            style={{ height: 300 }}
            notMerge={true}
            lazyUpdate={true}
          />
        </div>
      </section>

      {/* 分类占比：4 列 */}
      <section className="col-span-12 rounded-2xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] lg:col-span-4">
        <div className="border-b border-[var(--flow-line-1)] px-5 py-3">
          <h2 className="text-sm font-medium text-[var(--flow-text-1)]">
            {zh ? '分类销售占比' : 'Category mix'}
          </h2>
        </div>
        <div className="p-3">
          <ReactEChartsCore
            echarts={echarts}
            option={pieOption}
            style={{ height: 300 }}
            notMerge={true}
            lazyUpdate={true}
          />
        </div>
      </section>

      {/* 待处理队列：12 列 */}
      <section className="col-span-12 rounded-2xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]">
        <div className="flex items-center justify-between border-b border-[var(--flow-line-1)] px-5 py-3">
          <h2 className="text-sm font-medium text-[var(--flow-text-1)]">
            {zh ? '待处理' : 'Needs attention'}
          </h2>
          <span className="flow-caption">{zh ? '点击进入对应模块' : 'Click to open'}</span>
        </div>
        <div className="divide-y divide-[var(--flow-line-1)]">
          {queue.map((row) => {
            const Icon = row.icon;
            return (
              <button
                key={row.label}
                type="button"
                onClick={() => navigate(row.to)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--flow-surface-2)]"
              >
                <Icon className="size-4 shrink-0 text-[var(--flow-text-3)]" />
                <span className="flex-1 text-[13px] text-[var(--flow-text-2)]">{row.label}</span>
                <span className="flow-mono text-sm text-[var(--flow-text-1)]">{row.value}</span>
                <ArrowUpRight className="size-3.5 shrink-0 text-[var(--flow-text-3)]" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default DashboardPage;
