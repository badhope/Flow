import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import ProductCard from '@/components/ProductCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { listProducts } from '@/api/products';
import { listCategories } from '@/api/categories';
import { checkFavoriteBatch } from '@/api/favorites';
import type {
  Product,
  Category,
  ProductListParams,
} from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';
import { applyCanonical, applyDocumentMeta } from '@/lib/seo';

type SortBy = 'newest' | 'price_asc' | 'price_desc' | 'sold_desc';

const ProductListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const { user } = useAuth();

  const [keyword, setKeyword] = useState<string>(
    searchParams.get('keyword') || '',
  );
  const [searchInput, setSearchInput] = useState<string>(
    searchParams.get('keyword') || '',
  );
  const [categoryId, setCategoryId] = useState<string>(
    searchParams.get('category') || '',
  );
  const [sortBy, setSortBy] = useState<SortBy>(
    (searchParams.get('sortBy') as SortBy) || 'newest',
  );
  const [page, setPage] = useState<number>(
    parseInt(searchParams.get('page') || '1', 10),
  );
  const [minPrice, setMinPrice] = useState<string>(
    searchParams.get('minPrice') || '',
  );
  const [maxPrice, setMaxPrice] = useState<string>(
    searchParams.get('maxPrice') || '',
  );
  const pageSize: number = 12;

  // URL 是列表状态的唯一事实源：顶部导航搜索、浏览器前进/后退、
  // 商品详情返回等都会只改 URL 不重挂组件，必须在这里同步回本地状态。
  useEffect(() => {
    const nextKeyword = searchParams.get('keyword') || '';
    const nextCategory = searchParams.get('category') || '';
    const nextSort = (searchParams.get('sortBy') as SortBy) || 'newest';
    const nextPage = parseInt(searchParams.get('page') || '1', 10);
    setKeyword(nextKeyword);
    setSearchInput(nextKeyword);
    setCategoryId(nextCategory);
    setSortBy(nextSort);
    setPage(Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 1);
    setMinPrice(searchParams.get('minPrice') || '');
    setMaxPrice(searchParams.get('maxPrice') || '');
  }, [searchParams]);

  useEffect(() => {
    applyDocumentMeta(
      keyword
        ? `${keyword} · 搜索 · Flow`
        : '全部商品 · Flow',
      '浏览 Flow 跨境出口商城的全部在售商品：按分类、价格、销量筛选，支持多语言与多规格。',
    );
    applyCanonical('/products');
  }, [keyword]);

  const fetchProducts = useCallback(async (): Promise<void> => {
    const params: ProductListParams = {
      page,
      pageSize,
      sortBy: sortBy as ProductListParams['sortBy'],
    };
    if (categoryId) params.categoryId = categoryId;
    if (keyword) params.keyword = keyword;
    if (minPrice) params.minPrice = Number(minPrice);
    if (maxPrice) params.maxPrice = Number(maxPrice);

     try {
       setLoading(true);
       const data = await listProducts(params);
       setProducts(data.items);
       setTotal(data.total);
       if (user && data.items.length > 0) {
         try {
           const ids = data.items.map((p) => p.id);
           const faves = await checkFavoriteBatch(ids);
           setFavoriteIds(new Set(faves));
         } catch (favErr) {
           console.error('[productList] favorites error', favErr);
         }
       }
     } catch (error: unknown) {
      notifyError(error, tRef.current.common.error);
    } finally {
      setLoading(false);
    }
   }, [page, pageSize, sortBy, categoryId, keyword, minPrice, maxPrice, user]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const cats = await listCategories();
        setCategories(cats);
      } catch (error: unknown) {
        notifyError(error, tRef.current.common.error);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const updateUrl = (updates: Record<string, string>): void => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]: [string, string]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    navigate(`/products?${params.toString()}`);
  };

  const handleSearch = (): void => {
    setKeyword(searchInput);
    setPage(1);
    updateUrl({ keyword: searchInput, page: '1' });
  };

  const handleCategoryChange = (id: string): void => {
    setCategoryId(id);
    setPage(1);
    updateUrl({ category: id, page: '1' });
  };

  const handleSortChange = (value: string): void => {
    setSortBy(value as SortBy);
    updateUrl({ sortBy: value });
  };

  const handlePageChange = (newPage: number): void => {
    setPage(newPage);
    updateUrl({ page: String(newPage) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePriceApply = (): void => {
    setPage(1);
    updateUrl({ minPrice, maxPrice, page: '1' });
  };

  const totalPages: number = Math.ceil(total / pageSize);

  return (
    <div className="flow-store min-h-screen">
      <div className="container mx-auto px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar Filter */}
          <aside className="w-full lg:w-64 flex-shrink-0">
            <div className="store-card p-4 space-y-6">
              <div>
                <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <SlidersHorizontal className="size-4" />
                  {t.common.allCategories}
                </h3>
                <div className="space-y-1">
                  <button
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      !categoryId
                        ? 'store-filter-active'
                        : 'text-[var(--store-muted)] hover:bg-[var(--store-surface-2)]'
                    }`}
                    onClick={() => handleCategoryChange('')}
                  >
                    {t.common.allCategories}
                  </button>
                  {categories.map((cat: Category) => {
                    const name: string =
                      language === 'zh' ? cat.nameZh : cat.nameEn;
                    return (
                      <button
                        key={cat.id}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          categoryId === cat.id
                            ? 'bg-blue-50 text-blue-600 font-medium'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                        onClick={() => handleCategoryChange(cat.id)}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold text-slate-900 mb-3">
                  {t.common.priceRange}
                </h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder={t.common.minPrice}
                      value={minPrice}
                      onChange={(
                        e: React.ChangeEvent<HTMLInputElement>,
                      ) => setMinPrice(e.target.value)}
                      className="text-sm"
                    />
                    <Input
                      type="number"
                      placeholder={t.common.maxPrice}
                      value={maxPrice}
                      onChange={(
                        e: React.ChangeEvent<HTMLInputElement>,
                      ) => setMaxPrice(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={handlePriceApply}
                  >
                    {t.common.apply}
                  </Button>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            {/* Search & Sort */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <Input
                  className="pl-10"
                  placeholder={t.nav.searchPlaceholder}
                  value={searchInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearchInput(e.target.value)
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSearch} variant="secondary">
                  {t.common.search}
                </Button>
                <Select value={sortBy} onValueChange={handleSortChange}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder={t.common.sortBy} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t.common.newest}</SelectItem>
                    <SelectItem value="price_asc">
                      {t.common.priceAsc}
                    </SelectItem>
                    <SelectItem value="price_desc">
                      {t.common.priceDesc}
                    </SelectItem>
                    <SelectItem value="sold_desc">
                      {t.common.bestSelling}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Results count */}
            <div className="text-sm text-slate-500 mb-4">
              {total} {t.common.results}
            </div>

            {/* Product Grid */}
            {loading ? (
              <div className="flex flex-col gap-3">
                <div className="h-6 w-32 rounded-md bg-[var(--store-surface-2)]" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="store-card overflow-hidden">
                      <div className="aspect-square animate-pulse bg-[var(--store-surface-2)]" />
                      <div className="space-y-2 p-3">
                        <div className="h-3 w-3/4 rounded bg-[var(--store-surface-2)]" />
                        <div className="h-3 w-1/3 rounded bg-[var(--store-surface-2)]" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : products.length === 0 ? (
              <div className="store-empty">
                <p className="text-sm font-medium text-[var(--store-ink)]">{t.common.noResults}</p>
                <p className="mt-1 text-xs text-[var(--store-muted)]">
                  换个关键词，或回到首页让 AI 帮你描述需求。
                </p>
                <a href="/" className="store-btn-primary mt-4">回首页用 AI 找</a>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                 {products.map((product: Product) => (
                   <ProductCard
                     key={product.id}
                     product={product}
                     favorited={favoriteIds.has(product.id)}
                   />
                 ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() =>
                          page > 1 && handlePageChange(page - 1)
                        }
                        className={
                          page <= 1
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                    {Array.from({ length: totalPages }, (_, i: number) => i + 1)
                      .slice(
                        Math.max(0, page - 3),
                        Math.min(totalPages, page + 2),
                      )
                      .map((p: number) => (
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={p === page}
                            onClick={() => handlePageChange(p)}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() =>
                          page < totalPages && handlePageChange(page + 1)
                        }
                        className={
                          page >= totalPages
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default ProductListPage;
