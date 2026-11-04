import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package,
  CheckCircle2,
  Clock,
  Truck,
  MapPin,
  CreditCard,
  Eye,
  Info,
  RotateCcw,
} from 'lucide-react';
import RefundRequestModal from '@/components/RefundRequestModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Image } from '@/components/ui/image';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { useLanguage } from '@/contexts/LanguageContext';
import { getBuyerOrders, getOrderDetail } from '@/api/orders';
import { payForOrder } from '@/api/payments';
import { useNavigate } from 'react-router-dom';
import { getLogistics } from '@/api/logistics';
import type { Order, OrderStatus, LogisticsTracking } from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';
import { toast } from 'sonner';

const STATUS_STEPS: OrderStatus[] = [
  'pending_payment',
  'paid',
  'shipped',
  'delivered',
];

const statusVariantMap: Record<OrderStatus, string> = {
  pending_payment: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  paid: 'bg-blue-100 text-blue-700 border-blue-200',
  shipped: 'bg-purple-100 text-purple-700 border-purple-200',
  delivered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  refunded: 'bg-slate-100 text-slate-600 border-slate-200',
  partially_refunded: 'bg-orange-100 text-orange-700 border-orange-200',
};

const OrdersPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [logisticsData, setLogisticsData] = useState<LogisticsTracking | null>(null);
  const [logisticsLoading, setLogisticsLoading] = useState<boolean>(false);
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [paying, setPaying] = useState<boolean>(false);
  const tRef = useRef(t);
  tRef.current = t;
  const [refundModalOpen, setRefundModalOpen] = useState(false);

  const initialOrderId: string = searchParams.get('order') || '';

  const fetchOrders = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const data = await getBuyerOrders({ page: 1, pageSize: 20 });
      setOrders(data.items);
      if (initialOrderId && data.items.length > 0) {
        const found: Order | undefined = data.items.find(
          (o: Order) => o.id === initialOrderId,
        );
        if (found) {
          setSelectedOrder(found);
        } else {
          setSelectedOrder(data.items[0]);
        }
      } else if (data.items.length > 0) {
        setSelectedOrder(data.items[0]);
      }
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
    } finally {
      setLoading(false);
    }
  }, [initialOrderId]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const handlePayNow = async (order: Order): Promise<void> => {
    try {
      setPaying(true);
      const provider = ['stripe', 'paypal', 'demo'].includes(order.paymentMethod)
        ? (order.paymentMethod as 'stripe' | 'paypal' | 'demo')
        : 'demo';
      const result = await payForOrder({ orderId: order.id, provider });
      if (result.approveUrl) {
        window.location.href = result.approveUrl;
        return;
      }
      if (result.paymentStatus === 'paid') {
        toast.success(t.orders.paymentSuccess ?? '支付成功');
      } else {
        toast.message(t.orders.paymentPending ?? '支付已创建，等待渠道确认');
      }
      void fetchOrders();
      void handleViewDetail(order.id);
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
    } finally {
      setPaying(false);
    }
  };

  const handleViewDetail = async (orderId: string): Promise<void> => {
    try {
      setDetailLoading(true);
      setLogisticsLoading(true);
      const detail = await getOrderDetail(orderId);
      setSelectedOrder(detail);
      // 并行加载物流轨迹
      getLogistics(orderId)
        .then((data) => {
          setLogisticsData(data);
        })
        .catch((err: unknown) => {
          console.error('[orders] logistics error', err);
          setLogisticsData(null);
        })
        .finally(() => {
          setLogisticsLoading(false);
        });
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
    } finally {
      setDetailLoading(false);
    }
  };

  const renderTimeline = (order: Order): React.ReactNode => {
    const currentIndex: number = STATUS_STEPS.indexOf(order.status);
    const stepIcons = [Clock, CreditCard, Truck, Package];
    return (
      <div className="relative">
        {STATUS_STEPS.map((step: OrderStatus, idx: number) => {
          const StepIcon = stepIcons[idx];
          const isCompleted: boolean =
            order.status !== 'cancelled' && idx < currentIndex;
          const isCurrent: boolean =
            order.status !== 'cancelled' && idx === currentIndex;
          const isCancelled: boolean = order.status === 'cancelled';
          const stepKey: OrderStatus = step as OrderStatus;
          return (
            <div key={step} className="flex gap-4 pb-6 last:pb-0 relative">
              {idx < STATUS_STEPS.length - 1 && (
                <div
                  className={`absolute left-[18px] top-10 w-0.5 h-[calc(100%-24px)] ${
                    isCompleted ? 'bg-emerald-300' : 'bg-slate-200'
                  }`}
                />
              )}
              <div
                className={`size-9 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                  isCompleted
                    ? 'bg-emerald-100 text-emerald-600'
                    : isCurrent
                      ? 'bg-blue-100 text-blue-600'
                      : isCancelled
                        ? 'bg-slate-100 text-slate-400'
                        : 'bg-slate-100 text-slate-400'
                }`}
              >
                <StepIcon className="size-4" />
              </div>
              <div className="pt-1">
                <div
                  className={`text-sm font-medium ${
                    isCompleted || isCurrent
                      ? 'text-slate-900'
                      : 'text-slate-400'
                  }`}
                >
                  {t.status[stepKey]}
                </div>
                {isCompleted && (
                  <div className="text-xs text-slate-400 mt-0.5">
                    {idx === 0 && order.paidAt
                      ? new Date(order.paidAt).toLocaleString()
                      : idx === 1 && order.paidAt
                        ? new Date(order.paidAt).toLocaleString()
                        : idx === 2 && order.shippedAt
                          ? new Date(order.shippedAt).toLocaleString()
                          : idx === 3 && order.deliveredAt
                            ? new Date(order.deliveredAt).toLocaleString()
                            : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {(order.status === 'cancelled' || order.status === 'refunded' || order.status === 'partially_refunded') && (
          <div className="flex gap-4">
            <div className="size-9 rounded-full bg-red-100 text-red-500 flex items-center justify-center flex-shrink-0">
              <Clock className="size-4" />
            </div>
            <div className="pt-1">
              <div className="text-sm font-medium text-slate-900">
                {t.status[order.status]}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flow-store flex min-h-[50vh] items-center justify-center text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flow-store">
        <div className="container mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-6">
            {t.orders.title}
          </h1>
          <Card className="rounded-xl bg-white">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Package className="size-6" />
                </EmptyMedia>
                <EmptyTitle>{t.orders.empty}</EmptyTitle>
                <EmptyDescription />
              </EmptyHeader>
            </Empty>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flow-store">
      <div className="container mx-auto px-6 py-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">
          {t.orders.title}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Order List */}
          <div className="lg:col-span-1 space-y-3">
            {orders.map((order: Order) => {
              const statusKey: OrderStatus = order.status as OrderStatus;
              const isSelected: boolean = selectedOrder?.id === order.id;
              return (
                <Card
                  key={order.id}
                  className={`rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'ring-2 ring-blue-500 shadow-md'
                      : 'hover:shadow-md'
                  }`}
                  onClick={() => void handleViewDetail(order.id)}
                >
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900">
                        {t.orders.orderNo}: {order.orderNo}
                      </span>
                      <Badge
                        className={`${statusVariantMap[statusKey]} border`}
                        variant="outline"
                      >
                        {t.status[statusKey]}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">
                        {t.orders.amount}
                      </span>
                      <span className="store-price font-semibold">
                        ${Number(order.totalAmount).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-6 p-0"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          void handleViewDetail(order.id);
                        }}
                      >
                        <Eye className="size-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Order Detail */}
          <div className="lg:col-span-2 space-y-6">
            {detailLoading ? (
              <Card className="rounded-xl bg-white p-12 text-center text-slate-500">
                {t.common.loading}
              </Card>
            ) : selectedOrder ? (
              <>
                {/* Status & Timeline */}
                 <Card className="rounded-xl bg-white">
                   <div className="p-4 border-b flex items-center justify-between">
                     <div>
                       <div className="font-semibold text-slate-900">
                         {t.orders.statusTimeline}
                       </div>
                       <div className="text-sm text-slate-500 mt-0.5">
                         {t.orders.orderNo}: {selectedOrder.orderNo}
                       </div>
                     </div>
                     <Badge
                       className={`${
                         statusVariantMap[selectedOrder.status as OrderStatus]
                       } border`}
                       variant="outline"
                     >
                       {t.status[selectedOrder.status as OrderStatus]}
                     </Badge>
                   </div>
                   <div className="p-6">
                     {renderTimeline(selectedOrder)}
                   </div>
                 </Card>

                {/* Logistics Tracking */}
                 <Card className="rounded-xl bg-white">
                   <div className="p-4 border-b flex items-center justify-between">
                     <div className="flex items-center gap-2">
                       <Truck className="size-4 text-blue-500" />
                       <h3 className="font-semibold text-slate-900">
                         {t.orders.logisticsTracking}
                       </h3>
                     </div>
                     {logisticsData?.carrier && (
                       <Badge variant="outline" className="text-xs">
                         {logisticsData.carrier}
                         {logisticsData.trackingNumber
                           ? ` · ${logisticsData.trackingNumber}`
                           : ''}
                       </Badge>
                     )}
                   </div>
                   <div className="p-4">
                     {logisticsData?.isDemo && (
                       <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                         <Info className="size-3 flex-shrink-0" />
                         {t.orders.demoLogisticsNote}
                       </div>
                     )}
                     {logisticsLoading ? (
                       <div className="py-6 text-center text-sm text-slate-400">
                         {t.common.loading}
                       </div>
                     ) : logisticsData && logisticsData.events.length > 0 ? (
                       <div className="relative">
                         {logisticsData.events.map((event, idx) => {
                           const isLatest: boolean = idx === 0;
                           return (
                             <div
                               key={idx}
                               className="flex gap-4 pb-5 last:pb-0 relative"
                             >
                               {idx < logisticsData.events.length - 1 && (
                                 <div
                                   className={`absolute left-[18px] top-9 w-0.5 h-[calc(100%-24px)] ${
                                     isLatest
                                       ? 'bg-blue-300'
                                       : 'bg-slate-200'
                                   }`}
                                 />
                               )}
                               <div
                                 className={`size-9 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                                   isLatest
                                     ? 'bg-blue-100 text-blue-600'
                                     : 'bg-slate-100 text-slate-400'
                                 }`}
                               >
                                 {isLatest ? (
                                   <Package className="size-4" />
                                 ) : (
                                   <CheckCircle2 className="size-4" />
                                 )}
                               </div>
                               <div className="pt-1 flex-1">
                                 <div
                                   className={`text-sm font-medium ${
                                     isLatest
                                       ? 'text-slate-900'
                                       : 'text-slate-600'
                                   }`}
                                 >
                                   {event.description}
                                 </div>
                                 {event.location && (
                                   <div className="text-xs text-slate-400 mt-0.5">
                                     {event.location}
                                   </div>
                                 )}
                                 <div className="text-xs text-slate-400 mt-0.5">
                                   {new Date(event.time).toLocaleString()}
                                 </div>
                               </div>
                             </div>
                           );
                         })}
                       </div>
                     ) : (
                       <div className="py-6 text-center text-sm text-slate-400">
                         {t.orders.tracking}
                       </div>
                     )}
                   </div>
                 </Card>

                {/* Shipping Info */}
                <Card className="rounded-xl bg-white">
                  <div className="p-4 border-b flex items-center gap-2">
                    <MapPin className="size-4 text-blue-500" />
                    <h3 className="font-semibold text-slate-900">
                      {t.orders.shippingInfo}
                    </h3>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-slate-400 text-xs">
                        {t.checkout.name}
                      </div>
                      <div className="text-slate-700 font-medium">
                        {selectedOrder.buyerName}
                      </div>
                    </div>
                    {selectedOrder.buyerPhone && (
                      <div>
                        <div className="text-slate-400 text-xs">
                          {t.checkout.phone}
                        </div>
                        <div className="text-slate-700 font-medium">
                          {selectedOrder.buyerPhone}
                        </div>
                      </div>
                    )}
                    <div className="col-span-2">
                      <div className="text-slate-400 text-xs">
                        {t.checkout.address}
                      </div>
                      <div className="text-slate-700">
                        {selectedOrder.shippingAddress}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs">
                        {t.checkout.city}
                      </div>
                      <div className="text-slate-700">
                        {selectedOrder.shippingCity}
                      </div>
                    </div>
                    {selectedOrder.shippingZip && (
                      <div>
                        <div className="text-slate-400 text-xs">
                          {t.checkout.zip}
                        </div>
                        <div className="text-slate-700">
                          {selectedOrder.shippingZip}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-slate-400 text-xs">
                        {t.checkout.country}
                      </div>
                      <div className="text-slate-700">
                        {selectedOrder.shippingCountry}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs flex items-center gap-1">
                        <CreditCard className="size-3" />
                        {t.orders.paymentMethod}
                      </div>
                      <div className="text-slate-700 capitalize">
                        {selectedOrder.paymentMethod}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Items */}
                <Card className="rounded-xl bg-white">
                  <div className="p-4 border-b flex items-center gap-2">
                    <Package className="size-4 text-blue-500" />
                    <h3 className="font-semibold text-slate-900">
                      {t.orders.items}
                    </h3>
                  </div>
                  <div className="p-4 space-y-3">
                    {selectedOrder.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex gap-3 items-center"
                      >
                        <div className="size-14 rounded-lg overflow-hidden bg-slate-50 flex-shrink-0">
                          <Image
                            src={item.productImage || ''}
                            alt={item.productTitle}
                            className="w-full h-full object-cover"
                            width={56}
                            height={56}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-700 line-clamp-1">
                            {item.productTitle}
                          </div>
                          <div className="text-xs text-slate-400">
                            × {item.quantity}
                          </div>
                        </div>
                        <div className="text-sm font-medium text-slate-900">
                          ${Number(item.subtotal).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t flex justify-between items-center">
                    <span className="text-slate-500 text-sm">
                      {t.cart.total}
                    </span>
                    <span className="store-price text-xl font-bold">
                      ${Number(selectedOrder.totalAmount).toFixed(2)}
                    </span>
                  </div>
                </Card>

                {/* 操作区：待付款补付 / 退款 / 评价 */}
                <div className="flex flex-wrap justify-end gap-2">
                  {selectedOrder.status === 'pending_payment' && (
                    <Button
                      size="sm"
                      disabled={paying}
                      onClick={() => void handlePayNow(selectedOrder)}
                    >
                      <CreditCard className="mr-1 h-3 w-3" />
                      {t.orders.payNow ?? '去支付'}
                    </Button>
                  )}
                  {['paid', 'shipped', 'delivered', 'partially_refunded'].includes(selectedOrder.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRefundModalOpen(true)}
                      className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      {t.orders.requestRefund}
                    </Button>
                  )}
                  {selectedOrder.status === 'delivered' && selectedOrder.items[0]?.productId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/products/${selectedOrder.items[0].productId}#reviews`)}
                    >
                      {t.orders.writeReview ?? '去评价'}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <Card className="rounded-xl bg-white p-12 text-center text-slate-500">
                {t.orders.empty}
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Refund Request Modal */}
      {selectedOrder && (
        <RefundRequestModal
          order={selectedOrder}
          open={refundModalOpen}
          onClose={() => setRefundModalOpen(false)}
          onSuccess={() => {
            toast.success(t.orders.refundSubmitted);
            void fetchOrders();
          }}
        />
      )}
    </div>
  );
};

export default OrdersPage;
