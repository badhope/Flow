import React, { useEffect, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from '../../lib/echarts';
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  TrendingUp,
  Clock,
  Truck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboardApi } from '@/api';
import type { DashboardData } from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const result = await dashboardApi.getDashboardStats();
        setData(result);
      } catch (err) {
        notifyError(err, '获取看板数据失败，请重试');
        setError('数据加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const statsCards = [
    {
      title: 'GMV (总成交额)',
      value: data ? `$${data.stats.gmv}` : '--',
      icon: DollarSign,
      color: 'text-blue-800',
      bgColor: 'bg-blue-50',
    },
    {
      title: '订单数',
      value: data?.stats.orderCount ?? '--',
      icon: ShoppingCart,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
    },
    {
      title: '访客数',
      value: data?.stats.visitorCount ?? '--',
      icon: Users,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      title: '商品数',
      value: data?.stats.productCount ?? '--',
      icon: Package,
      color: 'text-violet-600',
      bgColor: 'bg-violet-50',
    },
  ];

  const todayCards = [
    {
      title: '今日 GMV',
      value: data ? `$${data.stats.todayGmv}` : '--',
      icon: TrendingUp,
      color: 'text-blue-800',
    },
    {
      title: '今日订单',
      value: data?.stats.todayOrders ?? '--',
      icon: Clock,
      color: 'text-indigo-600',
    },
    {
      title: '待发货订单',
      value: data?.stats.pendingOrders ?? '--',
      icon: Truck,
      color: 'text-orange-500',
    },
  ];

  const trendOption = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e2e8f0',
      borderWidth: 1,
      textStyle: { color: '#1e293b' },
    },
    legend: {
      bottom: '5%',
      data: ['销售额', '订单数'],
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '20%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data?.salesTrend.map((item) => item.date) ?? [],
      axisLine: { lineStyle: { color: '#e2e8f0' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: [
      {
        type: 'value',
        name: '销售额($)',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#64748b', fontSize: 11 },
      },
      {
        type: 'value',
        name: '订单数',
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { color: '#64748b', fontSize: 11 },
      },
    ],
    series: [
      {
        name: '销售额',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#1e40af', width: 2 },
        itemStyle: { color: '#1e40af' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(30, 64, 175, 0.15)' },
              { offset: 1, color: 'rgba(30, 64, 175, 0.02)' },
            ],
          },
        },
        data: data?.salesTrend.map((item) => item.amount) ?? [],
      },
      {
        name: '订单数',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#6366f1', width: 2 },
        itemStyle: { color: '#6366f1' },
        data: data?.salesTrend.map((item) => item.orders) ?? [],
      },
    ],
  };

  const pieOption = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: ${c} ({d}%)',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e2e8f0',
      borderWidth: 1,
      textStyle: { color: '#1e293b' },
    },
    legend: {
      bottom: '5%',
      left: 'center',
      textStyle: { color: '#64748b', fontSize: 12 },
    },
    color: ['#1e40af', '#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f97316'],
    series: [
      {
        name: '分类销售',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '40%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: false,
        },
        emphasis: {
          label: {
            show: false,
          },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.2)',
          },
        },
        labelLine: {
          show: false,
        },
        data:
          data?.categorySales.map((item) => ({
            name: item.name,
            value: item.amount,
          })) ?? [],
      },
    ],
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 核心指标卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {card.title}
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {card.value}
                    </p>
                  </div>
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.bgColor}`}
                  >
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 今日数据卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {todayCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50`}
                  >
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {card.title}
                    </p>
                    <p className="text-xl font-bold text-slate-900">
                      {card.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">近30天销售趋势</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ReactEChartsCore
              echarts={echarts}
              option={trendOption}
              style={{ height: 320 }}
              notMerge={true}
              lazyUpdate={true}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">分类销售占比</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ReactEChartsCore
              echarts={echarts}
              option={pieOption}
              style={{ height: 320 }}
              notMerge={true}
              lazyUpdate={true}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DashboardPage;
