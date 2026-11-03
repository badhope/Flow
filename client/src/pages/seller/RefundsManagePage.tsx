import React, { useEffect, useState, useCallback } from 'react';
import { Search, Eye, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { getSellerRefunds, approveRefund, rejectRefund } from '@/api/refunds';
import type { Refund, RefundListParams } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';
import { SellerPageHeader } from '@/components/seller/SellerUI';

type RefundStatus = Refund['status'];

const STATUS_MAP: Record<RefundStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; color: string }> = {
  requested: { label: '待处理', variant: 'secondary', color: 'text-amber-600' },
  approved: { label: '已批准', variant: 'default', color: 'text-blue-600' },
  rejected: { label: '已拒绝', variant: 'destructive', color: 'text-red-600' },
  completed: { label: '已完成', variant: 'outline', color: 'text-emerald-600' },
};

const REASON_MAP: Record<string, string> = {
  quality_issue: '商品质量问题',
  wrong_item: '发错商品',
  not_as_described: '商品与描述不符',
  damaged: '商品损坏/破损',
  missing_parts: '缺少配件/零件',
  changed_mind: '不想要了/改变主意',
  delivery_too_slow: '物流太慢',
  other: '其他原因',
};

const PAGE_SIZE = 10;

const RefundsManagePage: React.FC = () => {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRefund, setSelectedRefund] = useState<Refund | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReply, setRejectReply] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const [approveProcessing, setApproveProcessing] = useState<string | null>(null);

  const fetchRefunds = useCallback(
    async (params: RefundListParams = {}) => {
      try {
        setLoading(true);
        const result = await getSellerRefunds({
          page,
          pageSize: PAGE_SIZE,
          status: (statusFilter as RefundStatus) || undefined,
          keyword: keyword.trim() || undefined,
          ...params,
        });
        setRefunds(result.items);
        setTotal(result.total);
      } catch (err) {
        notifyError(err, '获取退款列表失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [page, statusFilter, keyword],
  );

  useEffect(() => {
    fetchRefunds();
  }, [fetchRefunds]);

  const handleSearch = () => {
    setPage(1);
    fetchRefunds({ page: 1, keyword: keyword.trim() || undefined });
  };

  const handleViewDetail = (refund: Refund) => {
    setSelectedRefund(refund);
    setDetailOpen(true);
  };

  const handleApprove = async (refund: Refund) => {
    setApproveProcessing(refund.id);
    try {
      await approveRefund(refund.id);
      toast.success('已批准退款');
      fetchRefunds();
      setDetailOpen(false);
    } catch {
      toast.error('批准失败');
    } finally {
      setApproveProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!selectedRefund) return;
    if (!rejectReply.trim()) {
      toast.error('请输入拒绝原因');
      return;
    }
    setRejecting(true);
    try {
      await rejectRefund(selectedRefund.id, { reply: rejectReply.trim() });
      toast.success('已拒绝退款');
      setRejectOpen(false);
      setRejectReply('');
      setDetailOpen(false);
      fetchRefunds();
    } catch {
      toast.error('拒绝失败');
    } finally {
      setRejecting(false);
    }
  };

  const formatTime = (time?: string) => {
    if (!time) return '-';
    return new Date(time).toLocaleString('zh-CN');
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={'Refunds'}
        title={'退款管理'}
        description={'审批原路退回、拒绝申请；并发审批有原子抢占，防止重复打款。'}
      />
      {/* 筛选 */}
      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索退款单号/订单号"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>

          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
              fetchRefunds({ page: 1, status: (value as RefundStatus) || undefined, keyword: keyword.trim() || undefined });
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部状态</SelectItem>
              {(Object.keys(STATUS_MAP) as RefundStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_MAP[status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleSearch} variant="secondary">搜索</Button>
        </CardContent>
      </Card>

      {/* 退款列表 */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>退款单号</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead>退款金额</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>申请时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              )}
              {!loading && refunds.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><RotateCcw className="size-6" /></EmptyMedia>
                        <EmptyTitle>暂无退款申请</EmptyTitle>
                        <EmptyDescription />
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                refunds.map((refund) => (
                  <TableRow key={refund.id}>
                    <TableCell className="font-mono text-xs">{refund.refundNo}</TableCell>
                    <TableCell className="font-mono text-xs">{refund.orderNo ?? refund.orderId}</TableCell>
                    <TableCell className="font-semibold">${refund.amount}</TableCell>
                    <TableCell className="text-sm">
                      {REASON_MAP[refund.reason] || refund.reason}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_MAP[refund.status].variant}>
                        {STATUS_MAP[refund.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatTime(refund.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetail(refund)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          详情
                        </Button>
                        {refund.status === 'requested' && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(refund)}
                              disabled={approveProcessing === refund.id}
                            >
                              <CheckCircle className="mr-1 h-3 w-3" />
                              {approveProcessing === refund.id ? '处理中' : '批准'}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                setSelectedRefund(refund);
                                setRejectReply('');
                                setRejectOpen(true);
                              }}
                            >
                              <XCircle className="mr-1 h-3 w-3" />
                              拒绝
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <div className="text-sm text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>退款详情</DialogTitle>
          </DialogHeader>
          {selectedRefund && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-slate-50 p-4 text-sm">
                <div><span className="text-muted-foreground">退款单号：</span><span className="font-mono">{selectedRefund.refundNo}</span></div>
                <div><span className="text-muted-foreground">订单号：</span><span className="font-mono">{selectedRefund.orderNo ?? selectedRefund.orderId}</span></div>
                <div><span className="text-muted-foreground">退款金额：</span><span className="font-semibold text-blue-800">${selectedRefund.amount}</span></div>
                <div><span className="text-muted-foreground">退款方式：</span>{selectedRefund.refundMethod === 'original' ? '原路返回' : '退至余额'}</div>
                <div><span className="text-muted-foreground">退款原因：</span>{REASON_MAP[selectedRefund.reason] || selectedRefund.reason}</div>
                <div><span className="text-muted-foreground">状态：</span>
                  <Badge variant={STATUS_MAP[selectedRefund.status].variant}>{STATUS_MAP[selectedRefund.status].label}</Badge>
                </div>
                <div className="col-span-2"><span className="text-muted-foreground">申请时间：</span>{formatTime(selectedRefund.createdAt)}</div>
                {selectedRefund.approvedAt && <div className="col-span-2"><span className="text-muted-foreground">批准时间：</span>{formatTime(selectedRefund.approvedAt)}</div>}
                {selectedRefund.completedAt && <div className="col-span-2"><span className="text-muted-foreground">完成时间：</span>{formatTime(selectedRefund.completedAt)}</div>}
                {selectedRefund.reasonDetail && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">补充说明：</span>
                    <p className="mt-1 text-slate-700">{selectedRefund.reasonDetail}</p>
                  </div>
                )}
                {selectedRefund.sellerReply && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">商家回复：</span>
                    <p className="mt-1 text-slate-700">{selectedRefund.sellerReply}</p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
                {selectedRefund.status === 'requested' && (
                  <>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setDetailOpen(false);
                        setRejectReply('');
                        setRejectOpen(true);
                      }}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      拒绝
                    </Button>
                    <Button onClick={() => handleApprove(selectedRefund)} disabled={approveProcessing === selectedRefund.id}>
                      <CheckCircle className="mr-1 h-4 w-4" />
                      批准退款
                    </Button>
                  </>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 拒绝弹窗 */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>拒绝退款</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              退款单号：<span className="font-mono text-slate-900">{selectedRefund?.refundNo}</span>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">拒绝原因 *</label>
              <Textarea
                placeholder="请输入拒绝退款的原因"
                value={rejectReply}
                onChange={(e) => setRejectReply(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejecting}>取消</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting ? '提交中...' : '确认拒绝'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RefundsManagePage;
