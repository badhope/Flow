import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { getCollectionBySlug } from '@/api/collections';
import { getProductsByIds } from '@/api/products';
import { checkFavoriteBatch } from '@/api/favorites';
import type { Collection, Product } from '@shared/api.interface';

/**
 * 买家端集合详情页：展示集合信息与集合内全部（上架）商品。
 * 商品数据来自批量接口，一次请求拿全，避免逐个查询。
 */
const CollectionDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        const detail = await getCollectionBySlug(slug);
        if (cancelled) return;

        const productIds = (detail.products ?? []).map((item) => item.productId);
        const items = await getProductsByIds(productIds);
        if (cancelled) return;

        setCollection(detail);
        setProducts(items);

        if (user && items.length > 0) {
          try {
            const faves = await checkFavoriteBatch(items.map((item) => item.id));
            if (!cancelled) setFavoriteIds(new Set(faves));
          } catch {
            // 收藏状态失败不影响展示
          }
        }
      } catch {
        if (!cancelled) {
          setCollection(null);
          setProducts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, user]);

  if (loading) {
    return (
      <div className="flow-store min-h-screen">
        <div className="container mx-auto px-6 py-24 text-center text-slate-400">
          {t.common.loading}
        </div>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flow-store min-h-screen">
        <div className="container mx-auto px-6 py-24 text-center">
          <LayoutGrid className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <p className="mb-6 text-slate-500">
            {language === 'zh' ? '该集合不存在或未公开' : 'This collection is unavailable'}
          </p>
          <Button variant="outline" asChild>
            <Link to="/products">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t.home.viewAll}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const title = language === 'zh' ? collection.titleZh : collection.titleEn;
  const description = language === 'zh'
    ? collection.descriptionZh ?? collection.descriptionEn
    : collection.descriptionEn ?? collection.descriptionZh;

  return (
    <div className="flow-store min-h-screen">
      {/* Header band */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-500 to-sky-400">
        {collection.coverImage && (
          <Image
            src={collection.coverImage}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        <div className="relative z-10 container mx-auto px-6 py-14">
          <Link
            to="/"
            className="mb-5 inline-flex items-center gap-1 text-sm text-blue-50/90 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {language === 'zh' ? '返回首页' : 'Back to home'}
          </Link>
          <div className="mb-2 flex items-center gap-2 text-blue-50/90">
            <LayoutGrid className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              {t.home.featuredCollection}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">{title}</h1>
          {description && (
            <p className="mt-3 max-w-2xl text-blue-50/90">{description}</p>
          )}
          <p className="mt-4 text-sm text-blue-100/80">
            {products.length} {language === 'zh' ? '件商品' : 'items'}
          </p>
        </div>
      </section>

      {/* Products */}
      <section className="container mx-auto px-6 py-10 pb-20">
        {products.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            {language === 'zh' ? '该集合暂无上架商品' : 'No products in this collection yet'}
          </div>
        ) : (
          <div className="grid grid-cols-2 content-start gap-4 sm:grid-cols-3 md:grid-cols-4">
            {products.map((product) => (
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

export default CollectionDetailPage;
