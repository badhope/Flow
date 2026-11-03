import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Sparkles, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import ProductCard from '@/components/ProductCard';
import CollectionFloors from '@/components/CollectionFloors';
import { useLanguage } from '@/contexts/LanguageContext';
import { getFeaturedProducts, listProducts, getProductsByIds } from '@/api/products';
import { listCategories } from '@/api/categories';
import { getStorefront } from '@/api/collections';
import { checkFavoriteBatch } from '@/api/favorites';
import { useAuth } from '@/contexts/AuthContext';
import type { Product, Category, StorefrontSection } from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';
import { getRecentlyViewed } from '@/utils/recently-viewed';
import { applyCanonical, applyDocumentMeta, injectOrganizationJsonLd } from '@/lib/seo';

const HomePage: React.FC = () => {
  const { user } = useAuth();
  const [hotProducts, setHotProducts] = useState<Product[]>([]);
  const [newProducts, setNewProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [floors, setFloors] = useState<StorefrontSection[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const { language, t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const navigate = useNavigate();

  useEffect(() => {
    const loadData = async (): Promise<void> => {
      try {
        setLoading(true);
        const [cats, hot, newest, storefront] = await Promise.all([
          listCategories(),
          getFeaturedProducts(8),
          listProducts({ page: 1, pageSize: 8, sortBy: 'newest' }),
          getStorefront().catch(() => [] as StorefrontSection[]),
        ]);
        setCategories(cats);
         setHotProducts(hot);
         setNewProducts(newest.items);
         setFloors(storefront);
         if (user) {
           const floorProductIds = storefront.flatMap((section) => section.products.map((p) => p.id));
           const allIds = [...hot.map((p) => p.id), ...newest.items.map((p) => p.id), ...floorProductIds];
           const uniqueIds = Array.from(new Set(allIds));
           // Wishlist hearts are a progressive enhancement: if the batch check
           // fails the tiles simply render unfilled instead of logging an error.
           if (uniqueIds.length > 0) {
             try {
               setFavoriteIds(new Set(await checkFavoriteBatch(uniqueIds)));
             } catch {
               setFavoriteIds(new Set());
             }
           }
         }
      } catch (error: unknown) {
        notifyError(error, tRef.current.common.error);
      } finally {
        setLoading(false);
      }
    };
    void loadData();
   }, [user]);

  useEffect(() => {
    applyDocumentMeta(
      'Flow — 让跨境生意更简单 · Cross-Border Commerce, Simplified',
      'AI 原生跨境出口电商平台：买家商城 + 卖家 AI 工作台，5 个真实 AI Agent 与人工审批式运营副驾。',
    );
    applyCanonical('/');
    injectOrganizationJsonLd();
    const ids = getRecentlyViewed();
    if (ids.length > 0) {
      getProductsByIds(ids.slice(0, 4))
        .then((items) => setRecentProducts(items))
        .catch(() => setRecentProducts([]));
    }
  }, []);

  const displayCategories: Category[] = categories.slice(0, 5);

  const [intent, setIntent] = useState('');
  const [intentBusy, setIntentBusy] = useState(false);

  const suggestions = language === 'zh'
    ? ['送礼 50 美元以内', '配一套露营装备', '降噪耳机怎么选']
    : ['Gift under $50', 'Build me a camping kit', 'Which noise-cancelling headphones'];

  const submitIntent = async (text?: string): Promise<void> => {
    const value = (text ?? intent).trim();
    if (!value || intentBusy) return;
    setIntentBusy(true);
    try {
      window.dispatchEvent(new CustomEvent('flow:shopper-intent', { detail: { text: value } }));
    } finally {
      setIntentBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero · AI 原生入口 */}
      <section className="flow-dark relative overflow-hidden border-b border-[var(--flow-line-1)]">
        <div className="flow-grid-bg absolute inset-0 opacity-70" />
        <div className="flow-radial-glow absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--flow-accent)]/40 to-transparent" />

        <div className="container relative z-10 mx-auto px-6 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--flow-line-2)] bg-[var(--flow-surface-2)] px-3 py-1 text-[11px] font-medium text-[var(--flow-text-2)]">
                <span className="size-1.5 rounded-full bg-[var(--flow-accent)]" />
                {language === 'zh' ? 'AI 导购在线 · 基于真实在售库存' : 'AI shopping assistant · real in-stock only'}
              </span>

              <h1 className="flow-display mt-6 text-[var(--flow-text-1)]">
                {language === 'zh' ? (
                  <>
                    说一句话，
                    <br />
                    <span className="text-[var(--flow-accent)]">找到你要的东西</span>
                  </>
                ) : (
                  <>
                    Say what you need.
                    <br />
                    <span className="text-[var(--flow-accent)]">We find it.</span>
                  </>
                )}
              </h1>

              <p className="mt-5 max-w-xl text-sm leading-relaxed text-[var(--flow-text-2)]">
                {language === 'zh'
                  ? '不用翻 200 页商品列表。描述用途、预算或场景，AI 从在售商品里帮你挑，加购前一定会先问你。'
                  : 'Skip 200 pages of listings. Describe the use case, budget or occasion — AI picks from real stock, and always asks before adding to cart.'}
              </p>

              {/* 意图输入 */}
              <form
                className="mt-7"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitIntent();
                }}
              >
                <div className="flow-glass flow-glass-hover flex items-center gap-2 rounded-2xl p-1.5">
                  <Sparkles className="ml-3 size-4 shrink-0 text-[var(--flow-accent)]" />
                  <input
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    placeholder={
                      language === 'zh'
                        ? '例如：给爱喝咖啡的朋友挑个 100 元内的礼物'
                        : 'e.g. a gift under $100 for a coffee lover'
                    }
                    className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--flow-text-1)] outline-none placeholder:text-[var(--flow-text-3)]"
                    aria-label={language === 'zh' ? '描述你的需求' : 'Describe what you need'}
                  />
                  <button type="submit" className="flow-btn-accent h-10 shrink-0 px-4 text-xs">
                    {language === 'zh' ? '问 AI' : 'Ask AI'}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setIntent(s);
                        submitIntent(s);
                      }}
                      className="rounded-full border border-[var(--flow-line-2)] px-3 py-1 text-[11px] text-[var(--flow-text-2)] transition-colors hover:border-[var(--flow-accent)]/50 hover:text-[var(--flow-text-1)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </form>

              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-[var(--flow-text-3)]">
                <span>
                  {language === 'zh' ? '推荐仅来自在售且有库存商品' : 'Recommendations only from in-stock items'}
                </span>
                <span className="hidden sm:inline">·</span>
                <button
                  type="button"
                  onClick={() => navigate('/products')}
                  className="inline-flex items-center gap-1 py-1.5 text-[var(--flow-text-2)] transition-colors hover:text-[var(--flow-accent)]"
                >
                  <ShoppingBag className="size-3" />
                  {language === 'zh' ? '直接逛全部商品' : 'Browse all products'}
                </button>
              </div>
            </div>

            {/* 右侧：AI 搭配浮层示意。The parent keeps slack so the -2deg tilt
                cannot push the card past its container. */}
            <div className="relative hidden p-2 lg:block">
              <div className="flow-glass rotate-[-2deg] rounded-2xl p-5 transition-transform duration-500 hover:rotate-0">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--flow-accent-soft)]">
                    <Sparkles className="size-3.5 text-[var(--flow-accent)]" />
                  </span>
                  <span className="text-xs font-medium text-[var(--flow-text-1)]">
                    {language === 'zh' ? 'AI 搭配建议' : 'AI bundle'}
                  </span>
                  <span className="flow-mono ml-auto text-[10px] text-[var(--flow-text-3)]">2.1s</span>
                </div>
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-lg border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]/70 p-2.5">
                      <div className="flow-skeleton size-9 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <div className="h-2 w-3/4 rounded bg-[var(--flow-surface-3)]" />
                        <div className="mt-1.5 h-2 w-1/2 rounded bg-[var(--flow-surface-2)]" />
                      </div>
                      <span className="flow-mono text-[10px] text-[var(--flow-accent)]">
                        {i === 0 ? '98%' : i === 1 ? '91%' : '86%'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-[var(--flow-line-1)] pt-3">
                  <span className="flow-caption">{language === 'zh' ? '匹配度' : 'Match score'}</span>
                  <div className="ml-auto flex h-1 w-16 overflow-hidden rounded-full bg-[var(--flow-surface-3)]">
                    <span className="w-[91%] rounded-full bg-[var(--flow-accent)]" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories · 横向 chip 条 */}
      <section className="border-b border-slate-200/70 bg-white">
        <div className="container mx-auto flex items-center gap-3 overflow-x-auto px-6 py-4">
          <span className="shrink-0 text-xs font-medium text-slate-400">
            {language === 'zh' ? '分类' : 'Categories'}
          </span>
          {displayCategories.map((cat: Category) => {
            const name: string = language === 'zh' ? cat.nameZh : cat.nameEn;
            return (
              <Link
                key={cat.id}
                to={`/products?category=${cat.id}`}
                className="group flex shrink-0 items-center gap-2 rounded-full border border-slate-200 px-3.5 py-1.5 text-xs text-slate-600 transition-all hover:border-slate-900 hover:bg-slate-900 hover:text-white"
              >
                {cat.icon ? (
                  <Image src={cat.icon} alt={name} width={14} height={14} className="size-3.5" />
                ) : (
                  <ShoppingBag className="size-3.5" />
                )}
                {name}
              </Link>
            );
          })}
          <Link
            to="/products"
            className="ml-auto inline-flex shrink-0 items-center py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            {t.home.viewAll} →
          </Link>
        </div>
      </section>

      {/* Collection Floors（运营楼层） */}
      <CollectionFloors sections={floors} favoriteIds={favoriteIds} loading={loading} />

      {/* Hot Products */}
      <section className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5 text-orange-500" />
            <h2 className="text-xl font-semibold text-slate-900">
              {t.home.hotProducts}
            </h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/products?sortBy=sold_desc">{t.home.viewAll}</Link>
          </Button>
        </div>
        {loading ? (
          <div className="text-center py-12 text-slate-500">
            {t.common.loading}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
             {hotProducts.map((product: Product) => (
               <ProductCard
                 key={product.id}
                 product={product}
                 favorited={favoriteIds.has(product.id)}
               />
             ))}
          </div>
        )}
      </section>

      {recentProducts.length > 0 && (
        <section className="container mx-auto px-6 py-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-6">
            {language === 'zh' ? '最近浏览' : 'Recently viewed'}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {recentProducts.map((product: Product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* New Arrivals */}
      <section className="container mx-auto px-6 py-8 pb-16">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-sky-500" />
            <h2 className="text-xl font-semibold text-slate-900">
              {t.home.newArrivals}
            </h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to="/products?sortBy=newest">{t.home.viewAll}</Link>
          </Button>
        </div>
        {loading ? (
          <div className="text-center py-12 text-slate-500">
            {t.common.loading}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
             {newProducts.map((product: Product) => (
               <ProductCard
                 key={product.id}
                 product={product}
                 favorited={favoriteIds.has(product.id)}
               />
             ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default HomePage;
