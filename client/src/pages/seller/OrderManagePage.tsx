import React, { useEffect, useState, useCallback } from 'react';
import { Search, Eye, Truck, CheckCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { Image as ImageComponent } from '@/components/ui/image';
import { ordersApi } from '@/api';
import { createLogistics } from '@/api/logistics';
import type { Order, OrderStatus, OrderListParams } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';
import { SellerPageHeader } from '@/components/seller/SellerUI';

const STATUS_MAP: Record<OrderStatus, { label: string; variant: string; color: string }> = {
  pending_payment: { label: '待付款', variant: 'secondary', color: 'text-amber-600' },
  paid: { label: '已付款', variant: 'default', color: 'text-blue-600' },
  shipped: { label: '已发货', variant: 'default', color: 'text-indigo-600' },
  delivered: { label: '已完成', variant: 'default', color: 'text-emerald-600' },
  cancelled: { label: '已取消', variant: 'destructive', color: '' },
  refunded: { label: '已退款', variant: 'secondary', color: 'text-slate-500' },
  partially_refunded: { label: '部分退款', variant: 'secondary', color: 'text-orange-600' },
};

const PAGE_SIZE = 10;

const OrderManagePage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [shipOpen, setShipOpen] = useState<boolean>(false);
  const [trackingNumber, setTrackingNo] = useState<string>('');
  const [carrier, setCarrier] = useState<string>('');
  const [shippingOrder, setShippingOrder] = useState<Order | null>(null);

  const fetchOrders = useCallback(
    async (params: OrderListParams = {}) => {
      try {
        setLoading(true);
        const result = await ordersApi.getSellerOrders({
          page,
          pageSize: PAGE_SIZE,
          keyword: keyword || undefined,
          status: (statusFilter as OrderStatus) || undefined,
          ...params,
        });
        setOrders(result.items);
        setTotal(result.total);
      } catch (err) {
        notifyError(err, '获取订单列表失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [page, keyword, statusFilter]
  );

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleSearch = () => {
    setPage(1);
    fetchOrders({ page: 1 });
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    // 筛选变化必须回到第 1 页，否则停在第 N 页会得到空表
    setPage(1);
    fetchOrders({ page: 1, status: (value as OrderStatus) || undefined });
  };

  const handleViewDetail = async (order: Order) => {
    try {
      const detail = await ordersApi.getSellerOrderDetail(order.id);
      setSelectedOrder(detail);
      setDetailOpen(true);
    } catch (err) {
      notifyError(err, '获取订单详情失败');
      setSelectedOrder(order);
      setDetailOpen(true);
    }
  };

  const handleShip = (order: Order) => {
    setShippingOrder(order);
    setTrackingNo('');
    setCarrier('');
    setShipOpen(true);
  };

  const handleConfirmShip = async () => {
    if (!shippingOrder) return;
    if (!carrier) {
      toast('请选择承运商');
      return;
    }
    if (!trackingNumber.trim()) {
      toast('请输入运单号');
      return;
    }
    try {
      await ordersApi.updateOrderStatus(shippingOrder.id, {
        status: 'shipped',
        trackingNumber: trackingNumber || undefined,
      });
      // 登记物流信息
      await createLogistics({
        orderId: shippingOrder.id,
        carrier,
        trackingNumber: trackingNumber,
      });
      setShipOpen(false);
      setShippingOrder(null);
      fetchOrders();
      if (selectedOrder?.id === shippingOrder.id) {
        handleViewDetail(shippingOrder);
      }
    } catch (err) {
      notifyError(err, '发货失败，请重试');
    }
  };

  const handleComplete = async (order: Order) => {
    if (!window.confirm('确认标记订单为已完成？')) return;
    try {
      await ordersApi.updateOrderStatus(order.id, {
        status: 'delivered',
      });
      fetchOrders();
      if (selectedOrder?.id === order.id) {
        handleViewDetail(order);
      }
    } catch (err) {
      notifyError(err, '标记完成失败，请重试');
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatTime = (time?: string) => {
    if (!time) return '-';
    return new Date(time).toLocaleString('zh-CN');
  };

  const getTimelineSteps = (order: Order) => {
    const steps: { label: string; time?: string; done: boolean }[] = [
      { label: '订单创建', time: order.createdAt, done: true },
      { label: '已付款', time: order.paidAt, done: order.status !== 'pending_payment' },
      { label: '已发货', time: order.shippedAt, done: order.status === 'shipped' || order.status === 'delivered' },
      { label: '已完成', time: order.deliveredAt, done: order.status === 'delivered' },
    ];
    return steps;
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={'Orders'}
        title={'订单管理'}
        description={'按状态筛选、查看详情、批量发货与物流登记；卖家仅见本店订单。'}
      />
      {/* 顶部筛选 */}
      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索订单号/买家名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>

          <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部状态</SelectItem>
              {(Object.keys(STATUS_MAP) as OrderStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_MAP[status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleSearch} variant="secondary">
            搜索
          </Button>
        </CardContent>
      </Card>

      {/* 订单列表 */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>订单号</TableHead>
                <TableHead>买家</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>下单时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    加载中...
                  </TableCell>
                </TableRow>
              )}
              {!loading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    暂无订单
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">
                      {order.orderNo}
                    </TableCell>
                    <TableCell>{order.buyerName}</TableCell>
                    <TableCell className="font-semibold">
                      ${order.totalAmount}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_MAP[order.status].variant as 'default' | 'secondary' | 'destructive'}
                      >
                        {STATUS_MAP[order.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatTime(order.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetail(order)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          详情
                        </Button>
                        {order.status === 'paid' && (
                          <Button
                            size="sm"
                            onClick={() => handleShip(order)}
                          >
                            <Truck className="mr-1 h-3 w-3" />
                            发货
                          </Button>
                        )}
                        {order.status === 'shipped' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleComplete(order)}
                          >
                            <CheckCircle className="mr-1 h-3 w-3" />
                            完成
                          </Button>
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 订单详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-6">
              {/* 基本信息 */}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  订单信息
                </div>
                <div className="rounded-lg border bg-slate-50 p-4 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground">订单号：</span>
                      <span className="font-mono">
                        {selectedOrder.orderNo}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">状态：</span>
                      <Badge
                        variant={STATUS_MAP[selectedOrder.status].variant as 'default' | 'secondary' | 'destructive'}
                      >
                        {STATUS_MAP[selectedOrder.status].label}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">支付方式：</span>
                      {selectedOrder.paymentMethod}
                    </div>
                    <div>
                      <span className="text-muted-foreground">订单金额：</span>
                      <span className="font-semibold text-blue-800">
                        ${selectedOrder.totalAmount}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 收货信息 */}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  收货信息
                </div>
                <div className="rounded-lg border bg-slate-50 p-4 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-muted-foreground">收货人：</span>
                      {selectedOrder.buyerName}
                    </div>
                    <div>
                      <span className="text-muted-foreground">电话：</span>
                      {selectedOrder.buyerPhone || '-'}
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">地址：</span>
                      {selectedOrder.shippingAddress},{' '}
                      {selectedOrder.shippingCity},{' '}
                      {selectedOrder.shippingCountry}{' '}
                      {selectedOrder.shippingZip || ''}
                    </div>
                    {selectedOrder.trackingNumber && (
                      <div>
                        <span className="text-muted-foreground">物流单号：</span>
                        <span className="font-mono">
                          {selectedOrder.trackingNumber}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 商品明细 */}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  商品明细
                </div>
                <div className="rounded-lg border">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 border-b p-3 last:border-b-0"
                    >
                      {item.productImage && (
                        <div className="h-12 w-12 overflow-hidden rounded-md">
                          <ImageComponent
                            src={item.productImage}
                            alt={item.productTitle}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {item.productTitle}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          x{item.quantity}
                        </div>
                      </div>
                      <div className="font-semibold">
                        ${item.subtotal}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 状态时间线 */}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  订单进度
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <div className="space-y-3">
                    {getTimelineSteps(selectedOrder).map((step, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 h-3 w-3 rounded-full ring-2 ring-white ${
                            step.done
                              ? 'bg-blue-600'
                              : 'bg-slate-300'
                          }`}
                        />
                        <div className="flex-1">
                          <div
                            className={`text-sm font-medium ${
                              step.done
                                ? 'text-slate-900'
                                : 'text-slate-400'
                            }`}
                          >
                            {step.label}
                          </div>
                          {step.time && (
                            <div className="text-xs text-muted-foreground">
                              {formatTime(step.time)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDetailOpen(false)}
                >
                  关闭
                </Button>
                {selectedOrder.status === 'paid' && (
                  <Button onClick={() => handleShip(selectedOrder)}>
                    <Truck className="mr-1 h-4 w-4" />
                    标记发货
                  </Button>
                )}
                {selectedOrder.status === 'shipped' && (
                  <Button
                    variant="secondary"
                    onClick={() => handleComplete(selectedOrder)}
                  >
                    <CheckCircle className="mr-1 h-4 w-4" />
                    标记完成
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 发货弹窗 */}
      <Dialog open={shipOpen} onOpenChange={setShipOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>标记发货</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {shippingOrder && (
              <div className="text-sm text-muted-foreground">
                订单号：
                <span className="font-mono text-slate-900">
                  {shippingOrder.orderNo}
                </span>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">
                承运商
              </label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择承运商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DHL">DHL</SelectItem>
                  <SelectItem value="FedEx">FedEx</SelectItem>
                  <SelectItem value="UPS">UPS</SelectItem>
                  <SelectItem value="USPS">USPS</SelectItem>
                  <SelectItem value="EMS">EMS</SelectItem>
                  <SelectItem value="China Post">China Post</SelectItem>
                  <SelectItem value="Other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                运单号
              </label>
              <Input
                placeholder="请输入运单号"
                value={trackingNumber}
                onChange={(e) => setTrackingNo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipOpen(false)}>
              取消
            </Button>
            <Button onClick={handleConfirmShip}>确认发货</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrderManagePage;
