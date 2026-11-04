import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Minus,
  Plus,
  ShoppingCart,
  Zap,
  Check,
  Package,
  Tag,
  Info,
  Star,
  Heart,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Image } from '@/components/ui/image';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { getProduct } from '@/api/products';
import { addToCart } from '@/api/cart';
import {
  getProductReviews,
  getMyReview,
  createReview,
} from '@/api/reviews';
import { toggleFavorite, checkFavorite } from '@/api/favorites';
import { toast } from 'sonner';
import {
  Product,
  ProductVariant,
  ProductReview,
  ProductReviewsResponse,
} from '@shared/api.interface';
import VariantSelector from '@/components/VariantSelector';
import {
  getProductTitle,
  getProductDesc,
  getProductLongDesc,
  getProductBulletPoints,
} from '@/utils/product-i18n';
import { applyCanonical, applyDocumentMeta, injectProductJsonLd, productMeta } from '@/lib/seo';
import { listProducts } from '@/api/products';
import ProductCard from '@/components/ProductCard';
import { getRecentlyViewed, pushRecentlyViewed } from '@/utils/recently-viewed';

const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [quantity, setQuantity] = useState<number>(1);
  const [activeImage, setActiveImage] = useState<number>(0);
  const [addingToCart, setAddingToCart] = useState<boolean>(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  // Favorite state
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [favoriteLoading, setFavoriteLoading] = useState<boolean>(false);

  // Reviews state
  const [reviewsData, setReviewsData] = useState<ProductReviewsResponse | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState<boolean>(true);
  const [myReview, setMyReview] = useState<ProductReview | null>(null);
  const [hasPurchased, setHasPurchased] = useState<boolean>(false);
  const [reviewRating, setReviewRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);
  const [related, setRelated] = useState<Product[]>([]);

  // Derived: selected variant
  const selectedVariant: ProductVariant | undefined = selectedVariantId
    ? product?.variants.find((v: ProductVariant) => v.id === selectedVariantId)
    : product?.variants[0];

  // Derived: display price (string) — from selected variant or product min/max
  const displayPrice: string = selectedVariant?.price ?? product?.minPrice ?? '0';
  const displayOriginalPrice: string =
    selectedVariant?.originalPrice ??
    product?.variants[0]?.originalPrice ??
    product?.minPrice ??
    '0';
  const isOnSale: boolean = Number(displayOriginalPrice) > Number(displayPrice);

  // Derived: stock
  const stockForSelected: number = selectedVariant?.stock ?? product?.totalStock ?? 0;

  useEffect(() => {
    const load = async (): Promise<void> => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await getProduct(id);
        setProduct(data);
        // Auto-select first variant if available
        if (data.variants.length > 0) {
          setSelectedVariantId(data.variants[0].id);
        }
        const meta = productMeta(data);
        applyDocumentMeta(meta.title, meta.description);
        applyCanonical(`/products/${data.id}`);
        injectProductJsonLd({ product: data, url: `${window.location.origin}/products/${data.id}` });
        pushRecentlyViewed(data.id);
        // 相关推荐：同分类最热商品（失败不影响主流程）
        if (data.categoryId) {
          listProducts({ categoryId: data.categoryId, pageSize: 5, sortBy: 'sold_desc' })
            .then((res) => setRelated(res.items.filter((item: Product) => item.id !== data.id).slice(0, 4)))
            .catch(() => setRelated([]));
        }
      } catch (error: unknown) {
        console.error('[productDetail] load error', error);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id]);

  // Load reviews
  const loadReviews = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      setReviewsLoading(true);
      const data = await getProductReviews(id);
      setReviewsData(data);
    } catch (error: unknown) {
      console.error('[productDetail] load reviews error', error);
    } finally {
      setReviewsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  // Load my review and favorite status
  useEffect(() => {
    const loadUserSpecific = async (): Promise<void> => {
      if (!id || !user) return;
      try {
        const [reviewData, favData] = await Promise.all([
          getMyReview(id),
          checkFavorite(id),
        ]);
        setMyReview(reviewData.review);
        setHasPurchased(reviewData.hasPurchased);
        setIsFavorited(favData.favorited);
      } catch (error: unknown) {
        console.error('[productDetail] load user data error', error);
      }
    };
    void loadUserSpecific();
  }, [id, user]);

  const handleVariantSelect = (variant: ProductVariant): void => {
    setSelectedVariantId(variant.id);
    // Reset quantity if it exceeds new variant stock
    setQuantity((prev: number) => Math.min(prev, variant.stock || 1));
  };

  if (loading) {
    return (
      <div className="flow-store flex min-h-[50vh] items-center justify-center text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flow-store flex min-h-[50vh] items-center justify-center text-slate-500">
        {t.common.error}
      </div>
    );
  }

  const title: string = getProductTitle(product, language);
  const desc: string = getProductDesc(product, language);
  const longDesc: string = getProductLongDesc(product, language);
  const bulletPoints: string[] = getProductBulletPoints(product, language);
  const images: string[] = product.images?.length
    ? product.images
    : product.coverImage
      ? [product.coverImage]
      : [];

  const handleQuantityChange = (delta: number): void => {
    setQuantity((prev: number) => {
      const next: number = prev + delta;
      return Math.max(1, Math.min(stockForSelected, next));
    });
  };

  const handleAddToCart = async (): Promise<void> => {
    if (!id) return;
    try {
      setAddingToCart(true);
      await addToCart(id, quantity, selectedVariantId ?? undefined);
      toast.success(t.product.addToCart);
    } catch (error: unknown) {
      console.error('[productDetail] add to cart error', error);
      toast.error(t.common.error);
    } finally {
      setAddingToCart(false);
    }
  };

  const handleBuyNow = async (): Promise<void> => {
    if (!id) return;
    try {
      setAddingToCart(true);
      await addToCart(id, quantity, selectedVariantId ?? undefined);
      navigate('/checkout');
    } catch (error: unknown) {
      console.error('[productDetail] buy now error', error);
      toast.error(t.common.error);
    } finally {
      setAddingToCart(false);
    }
  };

  const handleToggleFavorite = async (): Promise<void> => {
    if (!id) return;
    if (!user) {
      toast.error(t.auth.loginToContinue);
      return;
    }
    try {
      setFavoriteLoading(true);
      const result = await toggleFavorite(id);
      setIsFavorited(result.favorited);
      toast.success(
        result.favorited
          ? t.product.addToFavorites
          : t.product.removeFromFavorites,
      );
    } catch (error: unknown) {
      console.error('[productDetail] toggle favorite error', error);
      toast.error(t.common.error);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleSubmitReview = async (): Promise<void> => {
    if (!id) return;
    if (reviewRating === 0) {
      toast.error(
        language === 'zh' ? '请选择评分' : 'Please select a rating',
      );
      return;
    }
    try {
      setSubmittingReview(true);
      await createReview(id, {
        rating: reviewRating,
        comment: reviewComment || undefined,
      });
      toast.success(t.product.reviewSubmitted);
      setReviewComment('');
      setReviewRating(0);
      await loadReviews();
      if (user) {
        const reviewData = await getMyReview(id);
        setMyReview(reviewData.review);
      }
    } catch (error: unknown) {
      console.error('[productDetail] submit review error', error);
      toast.error(t.common.error);
    } finally {
      setSubmittingReview(false);
    }
  };

  const renderStars = (rating: number, size: string = 'size-4'): React.ReactNode => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((starNum: number) => (
          <Star
            key={starNum}
            className={`${size} ${starNum <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'}`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flow-store">
      <div className="container mx-auto px-6 py-6" id="reviews">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate(-1)}
        >
          ← {t.common.back}
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Images */}
          <div className="space-y-4">
            <Card className="rounded-xl overflow-hidden bg-white">
              <div className="aspect-square relative bg-slate-50">
                <Image
                  src={images[activeImage] || ''}
                  alt={title}
                  className="w-full h-full object-contain"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                {isOnSale && (
                  <Badge className="absolute left-3 top-3 rounded-[4px] border border-[var(--store-line-strong)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--store-ink)] hover:bg-white">
                    -
                    {Math.round(
                      ((Number(displayOriginalPrice) - Number(displayPrice)) /
                        Number(displayOriginalPrice)) *
                        100,
                    )}
                    %
                  </Badge>
                )}
                <button
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    void handleToggleFavorite();
                  }}
                  disabled={favoriteLoading}
                  className="absolute top-4 right-4 size-10 rounded-full bg-white shadow-sm flex items-center justify-center hover:bg-slate-50 transition-colors"
                  title={isFavorited ? t.product.removeFromFavorites : t.product.addToFavorites}
                >
                  <Heart
                    className={`size-5 transition-colors ${isFavorited ? 'fill-red-500 text-red-500' : 'text-slate-400'}`}
                  />
                </button>
              </div>
            </Card>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {images.map((img: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImage(idx)}
                    className={`flex-shrink-0 size-20 rounded-lg overflow-hidden border-2 transition-colors ${
                      activeImage === idx
                        ? 'border-blue-500'
                        : 'border-transparent hover:border-slate-200'
                    }`}
                  >
                    <Image
                      src={img}
                      alt={`${title}-${idx}`}
                      className="w-full h-full object-cover"
                      width={80}
                      height={80}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div>
              <h1 className="mb-2 text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--store-ink)] sm:text-2xl">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-[var(--store-muted)]">{desc}</p>
            </div>

            {/* Price：墨色 + 等宽，价格是事实而不是促销信号 */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-[var(--store-line)] py-3.5">
              <span className="store-price text-3xl leading-none">
                ${Number(displayPrice).toFixed(2)}
              </span>
              {isOnSale && (
                <span className="store-price-was text-base">
                  ${Number(displayOriginalPrice).toFixed(2)}
                </span>
              )}
              {isOnSale && (
                <span className="store-tag">
                  −{Math.round(((Number(displayOriginalPrice) - Number(displayPrice)) / Number(displayOriginalPrice)) * 100)}%
                </span>
              )}
            </div>

            {/* Variant Selector */}
            {product.variants.length > 0 && (
              <VariantSelector
                product={product}
                selectedId={selectedVariantId}
                onSelect={handleVariantSelect}
              />
            )}

            {/* Stock & Sold */}
            <div className="flex gap-6 text-sm text-slate-500">
              <div className="flex items-center gap-1">
                <Package className="size-4" />
                {t.product.stock}:{' '}
                <span
                  className={
                    stockForSelected > 0 ? 'text-emerald-500 font-medium' : 'text-red-500'
                  }
                >
                  {stockForSelected > 0
                    ? `${stockForSelected} ${t.product.inStock}`
                    : t.product.outOfStock}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Tag className="size-4" />
                {t.product.sold}: {product.totalSold}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">
                {t.product.quantity}
              </div>
              <div className="inline-flex items-center border border-slate-200 rounded-lg">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-none border-r border-slate-200"
                  onClick={() => handleQuantityChange(-1)}
                  disabled={quantity <= 1}
                >
                  <Minus className="size-4" />
                </Button>
                <span className="w-12 text-center font-medium">
                  {quantity}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-none border-l border-slate-200"
                  onClick={() => handleQuantityChange(1)}
                  disabled={quantity >= stockForSelected}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => void handleAddToCart()}
                disabled={stockForSelected === 0 || addingToCart}
              >
                <ShoppingCart className="size-5" />
                {t.product.addToCart}
              </Button>
              <Button
                size="lg"
                className="flex-1 border border-[var(--store-ink)] bg-[var(--store-ink)] text-white hover:bg-[var(--store-ink)]/90"
                onClick={() => void handleBuyNow()}
                disabled={stockForSelected === 0 || addingToCart}
              >
                <Zap className="size-5" />
                {t.product.buyNow}
              </Button>
            </div>

            {/* Bullet Points */}
            {bulletPoints && bulletPoints.length > 0 && (
              <div className="border-t pt-6">
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <Info className="size-4 text-blue-500" />
                  {t.product.bulletPoints}
                </h3>
                <ul className="space-y-2">
                  {bulletPoints.map((point: string, idx: number) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-sm text-slate-600"
                    >
                      <Check className="size-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Card className="rounded-xl bg-white">
          <Tabs defaultValue="description" className="p-4">
            <TabsList className="mb-4">
              <TabsTrigger value="description">
                {t.product.description}
              </TabsTrigger>
              <TabsTrigger value="specs">{t.product.specs}</TabsTrigger>
            </TabsList>
            <TabsContent value="description" className="text-slate-600 leading-relaxed">
              <div className="whitespace-pre-wrap">{longDesc}</div>
            </TabsContent>
            <TabsContent value="specs">
              {product.optionNames.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {product.optionNames.map((name: string, idx: number) => (
                    <div
                      key={idx}
                      className="grid grid-cols-3 py-3 text-sm"
                    >
                      <div className="text-slate-500 col-span-1">{name}</div>
                      <div className="text-slate-800 col-span-2">
                        {product.variants
                          .map((v: ProductVariant) => v.optionValues[idx])
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400 text-sm">—</div>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        {/* Reviews Section */}
        <Card className="rounded-xl bg-white mt-6">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <MessageSquare className="size-5 text-blue-600" />
              {t.product.reviewTitle}
            </h2>
          </div>

          {reviewsLoading ? (
            <div className="p-6 text-center text-slate-500">{t.common.loading}</div>
          ) : (
            <>
              {/* Review Summary */}
              <div className="p-6 border-b bg-slate-50/50">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-slate-900">
                      {reviewsData?.averageRating.toFixed(1) || '0.0'}
                    </div>
                    <div className="mt-1">
                      {renderStars(Math.round(reviewsData?.averageRating || 0), 'size-5')}
                    </div>
                    <div className="text-sm text-slate-500 mt-1">
                      {reviewsData?.totalCount || 0} {t.product.reviewCount}
                    </div>
                  </div>
                </div>
              </div>

              {/* Review Form */}
              {!user ? (
                <div className="p-6 border-b text-center">
                  <Link
                    to="/login"
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {t.product.loginToReview}
                  </Link>
                </div>
              ) : myReview ? (
                <div className="p-6 border-b bg-emerald-50/50">
                  <div className="text-emerald-700 font-medium flex items-center gap-2">
                    <Check className="size-5" />
                    {t.product.alreadyReviewed}
                  </div>
                </div>
              ) : hasPurchased ? (
                <div className="p-6 border-b space-y-4">
                  <h3 className="font-semibold text-slate-900">{t.product.writeReview}</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-600">{t.product.averageRating}:</span>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((starNum: number) => (
                          <button
                            key={starNum}
                            type="button"
                            onMouseEnter={() => setHoverRating(starNum)}
                            onMouseLeave={() => setHoverRating(0)}
                            onClick={() => setReviewRating(starNum)}
                            className="p-0.5"
                          >
                            <Star
                              className={`size-6 ${starNum <= (hoverRating || reviewRating) ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'}`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                    <Textarea
                      placeholder={t.product.reviewPlaceholder}
                      value={reviewComment}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReviewComment(e.target.value)}
                      rows={3}
                    />
                    <Button
                      onClick={() => void handleSubmitReview()}
                      disabled={submittingReview || reviewRating === 0}
                    >
                      {submittingReview ? t.common.loading : t.product.submitReview}
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Review List */}
              <div className="p-6">
                {reviewsData && reviewsData.items.length > 0 ? (
                  <div className="space-y-4">
                    {reviewsData.items.map((review: ProductReview) => (
                      <div
                        key={review.id}
                        className="flex gap-4 pb-4 border-b last:border-b-0 last:pb-0"
                      >
                        <div className="size-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-700 font-medium text-sm">
                            {review.userName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-slate-900">
                              {review.userName}
                            </span>
                            {renderStars(review.rating)}
                            <span className="text-xs text-slate-400">
                              {new Date(review.createdAt).toISOString().slice(0, 10)}
                            </span>
                          </div>
                          {review.comment && (
                            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                              {review.comment}
                            </p>
                          )}
                          {review.images && review.images.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {review.images.map((src, i) => (
                                <Image
                                  key={`${review.id}-${i}`}
                                  src={src}
                                  alt={`${review.userName} review image ${i + 1}`}
                                  width={64}
                                  height={64}
                                  className="size-16 rounded-lg object-cover border border-slate-200"
                                />
                              ))}
                            </div>
                          )}
                          {review.verifiedPurchase && (
                            <span className="mt-1 inline-block text-xs text-emerald-600">
                              {language === 'zh' ? '已验证购买' : 'Verified purchase'}
                            </span>
                          )}
                          {review.sellerReply && (
                            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <span className="font-medium text-slate-700">
                                {language === 'zh' ? '商家回复：' : 'Seller reply: '}
                              </span>
                              {review.sellerReply}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    {t.product.noReviews}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">
              {language === 'zh' ? '你可能还喜欢' : 'You may also like'}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default ProductDetailPage;
