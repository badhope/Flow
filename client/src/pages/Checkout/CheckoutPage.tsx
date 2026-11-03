import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  useForm,
  type SubmitHandler,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Package, Check, Zap, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Image } from '@/components/ui/image';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCart } from '@/api/cart';
import { getAddresses } from '@/api/addresses';
import { useAuth } from '@/contexts/AuthContext';
import { createOrder } from '@/api/orders';
import { payForOrder, getPaymentConfig } from '@/api/payments';
import { validateCoupon } from '@/api/coupons';
import { getShippingQuote } from '@/api/shipping';
import { toast } from 'sonner';
import { getProductTitle } from '@/utils/product-i18n';
import type {
  Address,
  CartResponse,
  CreateOrderRequest,
  PaymentProvider,
} from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';

const CheckoutPage: React.FC = () => {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [paying, setPaying] = useState<boolean>(false);
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('stripe');
  const [paymentConfig, setPaymentConfig] = useState<{
    stripeConfigured: boolean;
    paypalConfigured: boolean;
    demoMode: boolean;
    stripePublishableKey?: string;
  } | null>(null);
  const [, setOrderId] = useState<string | null>(null);
  const [couponCodeInput, setCouponCodeInput] = useState<string>('');
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [couponMessage, setCouponMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState<boolean>(false);
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [freeShippingApplied, setFreeShippingApplied] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const tRef = useRef(t);
  tRef.current = t;
  const navigate = useNavigate();


  const checkoutSchema = z.object({
    buyerName: z
      .string()
      .min(1, { message: 'required' })
      .max(100, { message: 'max 100 characters' }),
    buyerEmail: z
      .string()
      .email({ message: 'invalid email' })
      .max(255, { message: 'max 255 characters' })
      .optional()
      .or(z.literal('')),
    buyerPhone: z
      .string()
      .regex(/^[+]?[\d\s\-()]{6,50}$/, {
        message: 'invalid phone format',
      })
      .max(50, { message: 'max 50 characters' })
      .optional()
      .or(z.literal('')),
    shippingAddress: z
      .string()
      .min(1, { message: 'required' })
      .max(500, { message: 'max 500 characters' }),
    shippingCity: z
      .string()
      .min(1, { message: 'required' })
      .max(100, { message: 'max 100 characters' }),
    shippingZip: z
      .string()
      .regex(/^[\d\w\s\-]{3,20}$/, {
        message: 'invalid zip format',
      })
      .max(20, { message: 'max 20 characters' })
      .optional()
      .or(z.literal('')),
    shippingCountry: z
      .string()
      .min(1, { message: 'required' })
      .max(100, { message: 'max 100 characters' }),
    remark: z.string().max(500, { message: 'max 500 characters' }).optional(),
  });

  type CheckoutFormValues = z.infer<typeof checkoutSchema>;

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      buyerName: '',
      buyerEmail: '',
      buyerPhone: '',
      shippingAddress: '',
      shippingCity: '',
      shippingZip: '',
      shippingCountry: '',
      remark: '',
    },
  });

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        const [cartData, configData] = await Promise.all([
          getCart(),
          getPaymentConfig(),
        ]);
        setCart(cartData);
        setPaymentConfig(configData);
        if (cartData.items.length === 0) {
          toast.error(t.cart.empty);
          navigate('/cart');
        }
      } catch (error: unknown) {
        notifyError(error, tRef.current.common.error);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [navigate, t.cart.empty]);

  // 登录用户：载入地址簿并预填默认地址（下单更快）
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await getAddresses();
        if (cancelled) return;
        setSavedAddresses(list);
        const preferred = list.find((a) => a.isDefault) ?? list[0];
        if (preferred) {
          setSelectedAddressId(preferred.id);
          form.setValue('buyerName', preferred.receiverName);
          form.setValue('buyerPhone', preferred.phone ?? '');
          form.setValue('shippingAddress', preferred.addressLine1);
          form.setValue('shippingCity', preferred.city);
          form.setValue('shippingZip', preferred.zipCode ?? '');
          form.setValue('shippingCountry', preferred.country);
        }
      } catch {
        // 地址簿不可用不阻塞结算（用户可手填）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, form]);

  const applyAddress = (address: Address): void => {
    setSelectedAddressId(address.id);
    form.setValue('buyerName', address.receiverName);
    form.setValue('buyerPhone', address.phone ?? '');
    form.setValue('shippingAddress', address.addressLine1);
    form.setValue('shippingCity', address.city);
    form.setValue('shippingZip', address.zipCode ?? '');
    form.setValue('shippingCountry', address.country);
  };

  const subtotal: number = Number(cart?.total || 0);
  const qtyTotal: number = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const weightTotal: number = cart?.items.reduce((sum, item) => {
    const weight = Number((item.product as { weight?: string | number | null } | undefined)?.weight ?? 0);
    return sum + (Number.isFinite(weight) ? weight : 0) * item.quantity;
  }, 0) ?? 0;
  const watchedCountry = form.watch('shippingCountry');

  // 运费报价：展示用；下单时服务端会用同一口径重算，以订单中的金额为准
  useEffect(() => {
    if (!cart || cart.items.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const quote = await getShippingQuote({
          subtotal,
          qtyTotal,
          weightTotal,
          country: watchedCountry || undefined,
        });
        if (!cancelled) {
          setShippingFee(Number(quote.fee) || 0);
          setQuoteError(null);
        }
      } catch {
        // 报价失败不能静默当 0 运费：服务端会按真实运费重算，前后金额会不一致
        if (!cancelled) {
          setShippingFee(0);
          setQuoteError(
            language === 'zh'
              ? '运费报价失败，请检查网络或稍后重试（下单仍会按服务端运费计算）'
              : 'Failed to quote shipping. The server will still calculate the real fee at checkout.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cart, subtotal, qtyTotal, weightTotal, watchedCountry, language]);

  const handlePlaceOrder: SubmitHandler<CheckoutFormValues> = async (
    values: CheckoutFormValues,
  ): Promise<void> => {
    if (!cart || cart.items.length === 0) return;
    try {
      setSubmitting(true);
      const payload: CreateOrderRequest = {
        buyerName: values.buyerName,
        buyerEmail: values.buyerEmail || undefined,
        buyerPhone: values.buyerPhone || undefined,
        shippingAddress: values.shippingAddress,
        shippingCity: values.shippingCity,
        shippingZip: values.shippingZip || undefined,
        shippingCountry: values.shippingCountry,
        paymentMethod: paymentProvider,
        remark: values.remark || undefined,
        couponCode: appliedCouponCode || undefined,
        items: cart.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      };
      const order = await createOrder(payload);
      setOrderId(order.id);
      await handlePay(order.id);
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveShippingFee = freeShippingApplied ? 0 : shippingFee;
  const finalAmount: number = Math.max(0, subtotal + effectiveShippingFee - discountAmount);

  const handleApplyCoupon = async (): Promise<void> => {
    if (!couponCodeInput.trim()) return;
    try {
      setValidatingCoupon(true);
      setCouponMessage(null);
      const result = await validateCoupon({
        code: couponCodeInput.trim().toUpperCase(),
        orderAmount: subtotal,
      });
      if (result.valid && result.coupon) {
        setAppliedCouponCode(result.coupon.code);
        setDiscountAmount(result.discountAmount);
        setFreeShippingApplied(result.coupon.type === 'free_shipping');
        setCouponMessage({
          type: 'success',
          text: result.coupon.type === 'free_shipping'
            ? (language === 'zh' ? '免运费已应用' : 'Free shipping applied')
            : `${t.cart.couponApplied}: -$${result.discountAmount.toFixed(2)}`,
        });
        toast.success(t.cart.couponApplied);
      } else {
        setCouponMessage({
          type: 'error',
          text: result.message || t.cart.couponInvalid,
        });
      }
    } catch (error: unknown) {
      console.error('[checkout] apply coupon error', error);
      setCouponMessage({
        type: 'error',
        text: t.cart.couponInvalid,
      });
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = (): void => {
    setAppliedCouponCode(null);
    setDiscountAmount(0);
    setFreeShippingApplied(false);
    setCouponMessage(null);
    setCouponCodeInput('');
  };

  const handlePay = async (oId: string): Promise<void> => {
    try {
      setPaying(true);
      const result = await payForOrder({
        orderId: oId,
        provider: paymentProvider,
      });
      if (!result.success) {
        toast.error(result.message || t.common.error);
        navigate(`/orders?order=${oId}`);
        return;
      }
      // 真实渠道：订单已创建但尚未入账，必须完成渠道侧支付后才算成功
      if (result.paymentStatus === 'pending' && result.approveUrl) {
        toast.message(
          language === 'zh' ? '正在跳转 PayPal 完成支付…' : 'Redirecting to PayPal…',
        );
        window.location.href = result.approveUrl;
        return;
      }
      if (result.paymentStatus === 'pending' && result.clientSecret && paymentConfig?.stripePublishableKey) {
        navigate('/checkout/stripe', {
          state: {
            clientSecret: result.clientSecret,
            orderId: oId,
            publishableKey: paymentConfig.stripePublishableKey,
          },
        });
        return;
      }
      if (result.paymentStatus === 'pending') {
        toast.message(
          language === 'zh'
            ? '支付单已创建，但站点未配置 Stripe 公钥，请在渠道后台完成支付确认。'
            : 'Payment created, but no Stripe publishable key is configured. Please confirm it in your Stripe dashboard.',
        );
        navigate(`/orders?order=${oId}`);
        return;
      }
      if (result.paymentStatus === 'paid') {
        toast.success(language === 'zh' ? '支付成功！' : 'Payment successful!');
      } else {
        toast.message(
          language === 'zh'
            ? '订单已创建，支付状态以渠道回调为准。'
            : 'Order created. Payment status will be confirmed by the provider.',
        );
      }
      navigate(`/orders?order=${oId}`);
    } catch (error: unknown) {
      console.error('[checkout] pay error', error);
      toast.error(t.common.error);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flow-store min-h-screen flex items-center justify-center text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="flow-store min-h-screen">
      <div className="container mx-auto px-6 py-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate('/cart')}
        >
          <ArrowLeft className="size-4 mr-1" />
          {t.checkout.backToCart}
        </Button>

        <h1 className="text-2xl font-bold text-slate-900 mb-6">
          {t.checkout.title}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="rounded-xl bg-white">
              <div className="p-4 border-b">
                <h2 className="font-semibold text-slate-900 text-lg">
                  {t.checkout.shippingInfo}
                </h2>
              </div>
              <Form {...form}>
                <form
                  onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                    void form.handleSubmit(handlePlaceOrder)(e);
                  }}
                  className="p-4 space-y-4"
                >
                  {savedAddresses.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">
                          {t.address.title}
                        </span>
                        <Link to="/addresses" className="inline-flex items-center py-1 text-xs text-blue-600 hover:underline">
                          {t.address.edit}
                        </Link>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {savedAddresses.map((address) => (
                          <button
                            key={address.id}
                            type="button"
                            onClick={() => applyAddress(address)}
                            className={`max-w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                              selectedAddressId === address.id
                                ? 'border-blue-500 bg-white ring-1 ring-blue-500'
                                : 'border-slate-200 bg-white hover:border-blue-300'
                            }`}
                          >
                            <span className="font-medium text-slate-800">{address.receiverName}</span>
                            {address.isDefault && (
                              <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-700">
                                {t.address.default}
                              </span>
                            )}
                            <span className="block truncate text-slate-500">
                              {[address.city, address.country].filter(Boolean).join(', ')}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="buyerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.checkout.name} *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="buyerEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.checkout.email}</FormLabel>
                          <FormControl>
                            <Input type="email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="buyerPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.checkout.phone}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="shippingAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.checkout.address} *</FormLabel>
                        <FormControl>
                          <Textarea rows={2} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="shippingCity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.checkout.city} *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="shippingZip"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t.checkout.zip}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="shippingCountry"
                      render={({ field }) => (
                        <FormItem className="col-span-2 sm:col-span-1">
                          <FormLabel>{t.checkout.country} *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="remark"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.checkout.remark}</FormLabel>
                        <FormControl>
                          <Textarea rows={2} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Payment */}
                  <div className="pt-4 border-t">
                    <h3 className="font-semibold text-slate-900 mb-3">
                      {t.checkout.paymentMethod}
                    </h3>
                    {paymentConfig?.demoMode && (
                      <Alert variant="default" className="bg-amber-50 border-amber-200 mb-4">
                        <Zap className="size-4 text-amber-600" />
                        <AlertDescription className="text-amber-700 text-sm">
                          {language === 'zh'
                            ? '当前为演示支付，不产生真实扣款。'
                            : 'Demo payment mode - no real charge will be made.'}
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      {/* Stripe */}
                      <label
                        className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                          paymentProvider === 'stripe'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment"
                          value="stripe"
                          checked={paymentProvider === 'stripe'}
                          onChange={() => setPaymentProvider('stripe')}
                          className="mt-1 accent-blue-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">
                              Stripe
                            </span>
                            {!paymentConfig?.stripeConfigured && (
                              <Badge variant="secondary" className="text-xs">
                                {language === 'zh' ? '演示模式' : 'Demo'}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            {paymentConfig?.stripeConfigured
                              ? language === 'zh'
                                ? '使用 Stripe 安全支付'
                                : 'Secure payment via Stripe'
                              : language === 'zh'
                                ? '配置 STRIPE_SECRET_KEY 后启用真实收款'
                                : 'Configure STRIPE_SECRET_KEY to enable real payments'}
                          </p>
                        </div>
                      </label>

                      {/* PayPal */}
                      <label
                        className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                          paymentProvider === 'paypal'
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment"
                          value="paypal"
                          checked={paymentProvider === 'paypal'}
                          onChange={() => setPaymentProvider('paypal')}
                          className="mt-1 accent-blue-600"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">
                              PayPal
                            </span>
                            {!paymentConfig?.paypalConfigured && (
                              <Badge variant="secondary" className="text-xs">
                                {language === 'zh' ? '演示模式' : 'Demo'}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            {paymentConfig?.paypalConfigured
                              ? language === 'zh'
                                ? '使用 PayPal 账户支付'
                                : 'Pay with your PayPal account'
                              : language === 'zh'
                                ? '配置 PAYPAL_CLIENT_ID 后启用真实收款'
                                : 'Configure PAYPAL_CLIENT_ID to enable real payments'}
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Submit (mobile) */}
                  <div className="lg:hidden pt-4">
                    <Button
                      type="submit"
                      className="w-full"
                      size="lg"
                      disabled={submitting || paying}
                    >
                      <Check className="size-4" />
                      {submitting || paying
                        ? language === 'zh'
                          ? '处理中...'
                          : 'Processing...'
                        : t.checkout.placeOrder}
                    </Button>
                  </div>
                </form>
              </Form>
            </Card>
          </div>

          {/* Right: Order Summary */}
          <div className="lg:col-span-1">
            <Card className="rounded-xl bg-white sticky top-6">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-slate-900 text-lg flex items-center gap-2">
                  <Package className="size-5" />
                  {t.checkout.orderSummary}
                </h3>
              </div>
              <div className="p-4 space-y-4">
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {cart?.items.map((item) => {
                    const title: string = getProductTitle(item.product, language);
                    const variantPrice = item.variantId
                      ? item.product.variants.find((v) => v.id === item.variantId)?.price
                      : item.product.minPrice;
                    const unitPrice: number = Number(variantPrice ?? item.product.minPrice ?? '0');
                    return (
                      <div
                        key={item.id}
                        className="flex gap-3 text-sm"
                      >
                        <div className="size-14 rounded-lg overflow-hidden bg-slate-50 flex-shrink-0">
                          <Image
                            src={
                              item.variantImage ||
                              item.product.coverImage ||
                              item.product.images?.[0] ||
                              ''
                            }
                            alt={title}
                            className="w-full h-full object-cover"
                            width={56}
                            height={56}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-700 line-clamp-2">
                            {title}
                            {item.variantInfo && (
                              <span className="text-xs text-slate-400 ml-1">
                                ({item.variantInfo})
                              </span>
                            )}
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-slate-400">
                              × {item.quantity}
                            </span>
                            <span className="text-slate-900 font-medium">
                              ${(unitPrice * item.quantity).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Coupon Section */}
                <div className="border-t pt-3">
                  <div className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                    <Tag className="size-4" />
                    {t.cart.coupon}
                  </div>
                  {appliedCouponCode ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Check className="size-4 text-emerald-600" />
                          <span className="text-sm font-medium text-emerald-700">
                            {appliedCouponCode}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          className="text-emerald-600 hover:text-emerald-800 text-sm flex items-center gap-1"
                        >
                          <X className="size-3.5" />
                          {t.cart.removeCoupon}
                        </button>
                      </div>
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>{t.cart.discount}</span>
                        <span className="font-medium">-${discountAmount.toFixed(2)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={couponCodeInput}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setCouponCodeInput(e.target.value.toUpperCase());
                            setCouponMessage(null);
                          }}
                          placeholder={t.cart.couponCode}
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleApplyCoupon();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void handleApplyCoupon()}
                          disabled={validatingCoupon || !couponCodeInput.trim()}
                        >
                          {t.cart.applyCoupon}
                        </Button>
                      </div>
                      {couponMessage && (
                        <p
                          className={`text-xs ${couponMessage.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}
                        >
                          {couponMessage.text}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t pt-3 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>
                      {cart?.itemCount} {t.cart.itemsCount}
                    </span>
                    <span>${Number(cart?.subtotal || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>{t.cart.shipping}</span>
                    <span>
                      {freeShippingApplied ? (
                        <span className="text-emerald-600">
                          {language === 'zh' ? '免运费' : 'Free'}
                        </span>
                      ) : (
                        `$${shippingFee.toFixed(2)}`
                      )}
                    </span>
                  </div>
                  {quoteError && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      {quoteError}
                    </div>
                  )}
                  {appliedCouponCode && (
                    <div className="flex justify-between text-emerald-600">
                      <span>{t.cart.discount}</span>
                      <span>-${discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-slate-900 text-base pt-2 border-t">
                    <span>{appliedCouponCode ? t.cart.finalTotal : t.cart.total}</span>
                    <span className="text-lg text-orange-500">
                      ${finalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="hidden lg:block pt-2">
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => void form.handleSubmit(handlePlaceOrder)()}
                    disabled={submitting || paying}
                  >
                    <Check className="size-4" />
                    {submitting || paying
                      ? language === 'zh'
                        ? '处理中...'
                        : 'Processing...'
                      : t.checkout.placeOrder}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutPage;
