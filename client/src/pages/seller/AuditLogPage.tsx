import React, { useEffect, useState } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { getAuditLogs } from '@/api/audit';
import type { AuditLog } from '@shared/api.interface';
import { SellerPageHeader } from '@/components/seller/SellerUI';

const ACTION_OPTIONS = [
  { value: '', label: '全部操作' },
  { value: 'order.create', label: '创建订单' },
  { value: 'order.status_change', label: '订单状态变更' },
  { value: 'payment.pay', label: '支付成功' },
  { value: 'product.price_change', label: '商品改价' },
  { value: 'product.toggle_status', label: '商品上下架' },
  { value: 'csv.import', label: 'CSV 导入' },
  { value: 'coupon.create', label: '创建优惠券' },
  { value: 'coupon.redeem', label: '核销优惠券' },
];

const getActionLabel = (action: string): string => {
  const found = ACTION_OPTIONS.find((opt) => opt.value === action);
  return found?.label || action;
};

const getActionBadgeClass = (action: string): string => {
  if (action.startsWith('order.')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (action.startsWith('payment.')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (action.startsWith('product.')) return 'bg-violet-50 text-violet-700 border-violet-200';
  if (action.startsWith('csv.')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (action.startsWith('coupon.')) return 'bg-purple-50 text-purple-700 border-purple-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  const [actionFilter, setActionFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const loadLogs = async (): Promise<void> => {
    try {
      setLoading(true);
      const result = await getAuditLogs({
        page,
        pageSize,
        action: actionFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setLogs(result.items);
      setTotal(result.total);
    } catch (error: unknown) {
      console.error('[audit] load error', error);
      toast.error('加载审计日志失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleSearch = (): void => {
    setPage(1);
    void loadLogs();
  };

  const handleReset = (): void => {
    setActionFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    setTimeout(() => void loadLogs(), 0);
  };

  const toggleExpand = (id: string): void => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatJson = (value?: Record<string, unknown>): string => {
    if (!value) return '-';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div className="space-y-6">
      <SellerPageHeader
        eyebrow={'Audit logs'}
        title={'操作审计'}
        description={'所有写操作的前后值 diff、操作者与来源 IP；按卖家隔离，管理员可跨店查看。'}
      />

      {/* Filter Card */}
      <Card className="rounded-xl bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2 flex-1 min-w-48">
            <label className="text-sm font-medium text-slate-700">操作类型</label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="选择操作类型" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 flex-1 min-w-40">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <Calendar className="size-4" />
              开始日期
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setStartDate(e.target.value)
              }
            />
          </div>
          <div className="space-y-2 flex-1 min-w-40">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <Calendar className="size-4" />
              结束日期
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEndDate(e.target.value)
              }
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void handleSearch()}>
              <Search className="size-4 mr-2" />
              查询
            </Button>
            <Button variant="outline" onClick={handleReset}>
              重置
            </Button>
          </div>
        </div>
      </Card>

      {/* Log List */}
      <Card className="rounded-xl bg-white">
        {loading ? (
          <div className="p-8 text-center text-slate-500">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">暂无审计记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="w-10 py-3 px-4"></th>
                  <th className="text-left py-3 px-4 font-medium">时间</th>
                  <th className="text-left py-3 px-4 font-medium">操作人角色</th>
                  <th className="text-left py-3 px-4 font-medium">操作类型</th>
                  <th className="text-left py-3 px-4 font-medium">目标类型</th>
                  <th className="text-left py-3 px-4 font-medium">目标 ID</th>
                  <th className="text-left py-3 px-4 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: AuditLog) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => toggleExpand(log.id)}
                    >
                      <td className="py-3 px-4 text-slate-400">
                        {expandedRow === log.id ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {formatTime(log.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        {log.role ? (
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-600 border-slate-200"
                          >
                            {log.role}
                          </Badge>
                        ) : (
                          <span className="text-slate-400">未登录</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="secondary"
                          className={getActionBadgeClass(log.action)}
                        >
                          {getActionLabel(log.action)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {log.entity || '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs max-w-32 truncate">
                        {log.entityId || '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-xs">
                        {log.ip || '-'}
                      </td>
                    </tr>
                    {expandedRow === log.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="py-4 px-8">
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <div className="text-sm font-medium text-slate-700 mb-2">
                                变更前 (before_value)
                              </div>
                              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs overflow-x-auto font-mono whitespace-pre-wrap">
                                {formatJson(log.before)}
                              </pre>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-700 mb-2">
                                变更后 (after_value)
                              </div>
                              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs overflow-x-auto font-mono whitespace-pre-wrap">
                                {formatJson(log.after)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>
              共 {total} 条记录
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                上一页
              </Button>
              <span className="py-1 px-3 text-slate-600">
                第 {page} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p: number) => p + 1)}
                disabled={page * pageSize >= total}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AuditLogPage;
