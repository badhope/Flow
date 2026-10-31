import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, ShoppingBag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Image } from '@/components/ui/image';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { getMyFavorites, toggleFavorite } from '@/api/favorites';
import { toast } from 'sonner';
import type { FavoriteProduct } from '@shared/api.interface';
import { getProductTitle } from '@/utils/product-i18n';

const FavoritesPage: React.FC = () => {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        const data = await getMyFavorites();
        setFavorites(data);
      } catch (error: unknown) {
        console.error('[favorites] load error', error);
        toast.error(t.common.error);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user, t.common.error]);

  const handleRemove = async (productId: string): Promise<void> => {
    try {
      setRemovingId(productId);
      await toggleFavorite(productId);
      setFavorites((prev: FavoriteProduct[]) =>
        prev.filter((f: FavoriteProduct) => f.productId !== productId),
      );
      toast.success(
        language === 'zh' ? '已取消收藏' : 'Removed from wishlist',
      );
    } catch (error: unknown) {
      console.error('[favorites] remove error', error);
      toast.error(t.common.error);
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flow-store min-h-screen flex items-center justify-center text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flow-store min-h-screen flex flex-col items-center justify-center gap-4">
        <Heart className="size-16 text-slate-300" />
        <p className="text-slate-500">{t.auth.loginToContinue}</p>
        <Link to="/login">
          <Button>{t.auth.signIn}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flow-store min-h-screen">
      <div className="container mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Heart className="size-6 text-red-500 fill-red-500" />
            {t.favorites.title}
            <Badge variant="secondary" className="ml-2">
              {favorites.length}
            </Badge>
          </h1>
        </div>

        {favorites.length === 0 ? (
          <Card className="rounded-xl bg-white p-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center">
                <Heart className="size-8 text-slate-400" />
              </div>
              <p className="text-slate-500">{t.favorites.empty}</p>
              <Button onClick={() => navigate('/products')}>
                <ShoppingBag className="size-4 mr-2" />
                {t.favorites.browseProducts}
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {favorites.map((fav: FavoriteProduct) => {
              const product = fav.product;
              const title: string = getProductTitle(product, language);
              const minPrice: string = product.minPrice ?? '0';
              const displayOriginalPrice: string =
                product.variants[0]?.originalPrice ?? minPrice;
              const isOnSale: boolean =
                !!displayOriginalPrice && Number(displayOriginalPrice) > Number(minPrice);
              return (
                <Card
                  key={fav.id}
                  className="overflow-hidden rounded-xl bg-white shadow-sm transition-all duration-300 hover:shadow-md h-full"
                >
                  <Link to={`/products/${product.id}`}>
                    <div className="relative aspect-square overflow-hidden bg-slate-50">
                      <Image
                        src={product.coverImage || product.images?.[0] || ''}
                        alt={title}
                        className="w-full h-full object-cover"
                        sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
                      />
                      {isOnSale && (
                        <Badge className="absolute top-2 left-2 bg-orange-500 hover:bg-orange-500">
                          -
                          {Math.round(
                            ((Number(displayOriginalPrice) - Number(minPrice)) /
                              Number(displayOriginalPrice)) *
                              100,
                          )}
                          %
                        </Badge>
                      )}
                    </div>
                  </Link>
                  <div className="p-4 space-y-2">
                    <Link to={`/products/${product.id}`}>
                      <h3 className="text-sm font-medium text-slate-900 line-clamp-2 leading-snug min-h-[2.5rem]">
                        {title}
                      </h3>
                    </Link>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-orange-500">
                        ${Number(minPrice).toFixed(2)}
                      </span>
                      {isOnSale && displayOriginalPrice && (
                        <span className="text-xs text-slate-400 line-through">
                          ${Number(displayOriginalPrice).toFixed(2)}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                      onClick={() => void handleRemove(fav.productId)}
                      disabled={removingId === fav.productId}
                    >
                      <Trash2 className="size-3.5 mr-1" />
                      {t.favorites.remove}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FavoritesPage;
