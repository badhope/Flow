import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Minus, Plus, Trash2, ArrowRight, Copy, RefreshCw, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Image } from '@/components/ui/image';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCart, updateCartItem, removeCartItem, exportRecoveryCode, importRecoveryCode } from '@/api/cart';
import { toast } from 'sonner';
import type { CartResponse, CartItem } from '@shared/api.interface';
import { getProductTitle } from '@/utils/product-i18n';
import { notifyError } from '@/lib/error-feedback';

const CartPage: React.FC = () => {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('export');
  const [exportDialogOpen, setExportDialogOpen] = useState<boolean>(false);
  const [recoveryCode, setRecoveryCode] = useState<string>('');
  const [exporting, setExporting] = useState<boolean>(false);
  const [importCode, setImportCode] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);
  const { language, t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const navigate = useNavigate();

  const fetchCart = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const data = await getCart();
      setCart(data);
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCart();
  }, [fetchCart]);

  const handleUpdateQuantity = async (
    itemId: string,
    newQty: number,
  ): Promise<void> => {
    if (newQty < 1) return;
    try {
      setUpdating(itemId);
      const data = await updateCartItem(itemId, newQty);
      setCart(data);
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
      toast.error(t.common.error);
    } finally {
      setUpdating(null);
    }
  };

  const handleRemove = async (itemId: string): Promise<void> => {
    try {
      setUpdating(itemId);
      const data = await removeCartItem(itemId);
      setCart(data);
      toast.success(t.cart.remove);
    } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
      toast.error(t.common.error);
    } finally {
      setUpdating(null);
    }
  };

  const handleExportCode = async (): Promise<void> => {
    try {
      setExporting(true);
      const data = await exportRecoveryCode();
      setRecoveryCode(data.code);
      setExportDialogOpen(true);
    } catch (error: unknown) {
      console.error('[cart] export code error', error);
      toast.error(t.common.error);
    } finally {
      setExporting(false);
    }
  };

  const handleCopyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      toast.success(t.cart.codeCopied);
    } catch (error: unknown) {
      console.error('[cart] copy error', error);
    }
  };

  const handleImportCode = async (): Promise<void> => {
    const trimmed = importCode.trim();
    if (!trimmed) return;
    try {
      setImporting(true);
      const data = await importRecoveryCode(trimmed);
      setCart(data);
      setImportCode('');
      toast.success(t.cart.importSuccess);
    } catch (error: unknown) {
      console.error('[cart] import code error', error);
      toast.error(
        error instanceof Error ? error.message : t.common.error,
      );
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flow-store min-h-screen flex items-center justify-center text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  const isEmpty: boolean = !cart || cart.items.length === 0;

  return (
    <div className="flow-store min-h-screen">
      <div className="container mx-auto px-6 py-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">
          {t.cart.title}
          {!isEmpty && (
            <Badge variant="secondary" className="ml-3">
              {cart?.itemCount} {t.cart.itemsCount}
            </Badge>
          )}
        </h1>

        {isEmpty ? (
          <Card className="rounded-xl bg-white">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShoppingCart className="size-6" />
                </EmptyMedia>
                <EmptyTitle>{t.cart.empty}</EmptyTitle>
                <EmptyDescription>
                  {language === 'zh'
                    ? '快去挑选心仪的商品吧'
                    : 'Start shopping to add items'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => navigate('/products')}>
                  {t.cart.continueShopping}
                </Button>
              </EmptyContent>
            </Empty>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Cart Items */}
            <div className="lg:col-span-2 space-y-4">
              {cart?.items.map((item: CartItem) => {
                const title: string = getProductTitle(item.product, language);
                const variantPrice = item.variantId
                  ? item.product.variants.find((v) => v.id === item.variantId)?.price
                  : item.product.minPrice;
                const displayPrice: number = Number(variantPrice ?? item.product.minPrice ?? '0');
                const subtotal: number = displayPrice * item.quantity;
                const variantStock: number = item.variantId
                  ? item.product.variants.find((v) => v.id === item.variantId)?.stock ?? item.product.totalStock
                  : item.product.totalStock;
                return (
                  <Card
                    key={item.id}
                    className="rounded-xl bg-white overflow-hidden"
                  >
                    <div className="flex gap-4 p-4">
                      <Link
                        to={`/products/${item.productId}`}
                        className="flex-shrink-0"
                      >
                        <div className="size-24 sm:size-32 rounded-lg overflow-hidden bg-slate-50">
                          <Image
                            src={
                              item.variantImage ||
                              item.product.coverImage ||
                              item.product.images?.[0] ||
                              ''
                            }
                            alt={title}
                            className="w-full h-full object-cover"
                            width={128}
                            height={128}
                          />
                        </div>
                      </Link>
                      <div className="flex-1 flex flex-col justify-between min-w-0">
                        <div>
                          <Link
                            to={`/products/${item.productId}`}
                            className="font-medium text-slate-900 hover:text-blue-600 transition-colors line-clamp-2"
                          >
                            {title}
                          </Link>
                          {item.variantInfo && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {item.variantInfo}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center border border-slate-200 rounded-lg">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="减少数量"
                              className="size-8 rounded-none border-r border-slate-200"
                              onClick={() =>
                                void handleUpdateQuantity(
                                  item.id,
                                  item.quantity - 1,
                                )
                              }
                              disabled={
                                item.quantity <= 1 || updating === item.id
                              }
                            >
                              <Minus className="size-3" />
                            </Button>
                            <span className="w-10 text-center text-sm font-medium">
                              {item.quantity}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="增加数量"
                              className="size-8 rounded-none border-l border-slate-200"
                              onClick={() =>
                                void handleUpdateQuantity(
                                  item.id,
                                  item.quantity + 1,
                                )
                              }
                              disabled={
                                item.quantity >= variantStock ||
                                updating === item.id
                              }
                            >
                              <Plus className="size-3" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-orange-500">
                              ${subtotal.toFixed(2)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="移除商品"
                              className="size-8 text-slate-400 hover:text-red-500"
                              onClick={() => void handleRemove(item.id)}
                              disabled={updating === item.id}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Summary */}
            <div className="lg:col-span-1 space-y-4">
              <Card className="rounded-xl bg-white sticky top-6">
                <div className="p-4 space-y-4">
                  <h3 className="font-semibold text-slate-900 text-lg">
                    {t.cart.title}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>
                        {cart?.itemCount} {t.cart.itemsCount}
                      </span>
                      <span>${Number(cart?.subtotal || 0).toFixed(2)}</span>
                    </div>
                    <div className="border-t pt-3 flex justify-between font-semibold text-slate-900">
                      <span>{t.cart.total}</span>
                      <span className="text-lg text-orange-500">
                        ${Number(cart?.total || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => navigate('/checkout')}
                  >
                    {t.cart.checkout}
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => navigate('/products')}
                  >
                    {t.cart.continueShopping}
                  </Button>
                </div>
              </Card>

              {/* Cross-device sync */}
              <Card className="rounded-xl bg-white">
                <div className="p-4">
                  <h3 className="font-semibold text-slate-900 text-lg mb-1">
                    {t.cart.crossDevice}
                  </h3>
                  <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="w-full"
                  >
                    <TabsList className="w-full grid grid-cols-2 mb-4">
                      <TabsTrigger value="export" className="text-sm">
                        <Download className="size-4 mr-1" />
                        {t.cart.exportCode}
                      </TabsTrigger>
                      <TabsTrigger value="import" className="text-sm">
                        <Upload className="size-4 mr-1" />
                        {t.cart.importCode}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="export" className="space-y-3">
                      <p className="text-sm text-slate-500">
                        {t.cart.exportCodeDesc}
                      </p>
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => void handleExportCode()}
                        disabled={exporting}
                      >
                        {exporting ? (
                          <RefreshCw className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Download className="size-4 mr-2" />
                        )}
                        {t.cart.generateCode}
                      </Button>
                    </TabsContent>
                    <TabsContent value="import" className="space-y-3">
                      <p className="text-sm text-slate-500">
                        {t.cart.importCodeDesc}
                      </p>
                      <Input
                        placeholder={t.cart.codePlaceholder}
                        value={importCode}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setImportCode(e.target.value.toUpperCase())
                        }
                        maxLength={12}
                        className="font-mono tracking-widest text-center uppercase"
                      />
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => void handleImportCode()}
                        disabled={importing || !importCode.trim()}
                      >
                        {importing ? (
                          <RefreshCw className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="size-4 mr-2" />
                        )}
                        {t.cart.confirmImport}
                      </Button>
                    </TabsContent>
                  </Tabs>
                </div>
              </Card>
            </div>
          </div>
          )}
        </div>

      {/* Export Code Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.cart.recoveryCode}</DialogTitle>
            <DialogDescription>
              {t.cart.codeExpiryNote}
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 flex flex-col items-center gap-4">
            <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-6 text-center">
              <span className="text-3xl font-mono font-bold tracking-[0.3em] text-blue-600 uppercase">
                {recoveryCode}
              </span>
            </div>
            <p className="text-sm text-slate-500 text-center">
              {t.cart.codeExpiryNote}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleCopyCode()} className="w-full">
              <Copy className="size-4 mr-2" />
              {t.cart.codeCopied}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CartPage;
