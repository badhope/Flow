import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { Image } from '@/components/ui/image';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { toggleFavorite } from '@/api/favorites';
import { toast } from 'sonner';
import type { Product } from '@shared/api.interface';
import { getProductTitle } from '@/utils/product-i18n';

interface ProductCardProps {
  product: Product;
  favorited?: boolean;
}

/**
 * 商品卡（买家端）。
 *
 * 设计说明：这里是买家停留最久的元素，所以它必须同时回答三件事——
 * 「这是什么」「多少钱」「值不值得点进去」。模板化的做法（橙价 + 大圆角 +
 * 重阴影）会让每张卡都长得一样，视觉上互相抵消。
 *
 * 这里改成：纸感描边卡、价格用品牌墨色等宽数字、折扣是安静标签、
 * 收藏按钮默认隐形（hover/触屏常显），把注意力让给商品本身。
 */
const ProductCard: React.FC<ProductCardProps> = ({ product, favorited = false }) => {
  const { language, t } = useLanguage();
  const productText = t.product;

  const { user } = useAuth();
  const [isFavorited, setIsFavorited] = useState<boolean>(favorited);
  const [favLoading, setFavLoading] = useState<boolean>(false);

  const title: string = getProductTitle(product, language);

  const minPrice: string = product.minPrice ?? '0';
  const displayOriginalPrice: string = product.variants[0]?.originalPrice ?? minPrice;
  const isOnSale: boolean =
    !!displayOriginalPrice && Number(displayOriginalPrice) > Number(minPrice);

  const discountPct = isOnSale
    ? Math.round(
      ((Number(displayOriginalPrice) - Number(minPrice)) / Number(displayOriginalPrice)) * 100,
    )
    : 0;

  const isSoldOut = product.totalStock === 0;

  const handleToggleFavorite = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error(t.auth.loginToContinue);
      return;
    }
    try {
      setFavLoading(true);
      const result = await toggleFavorite(product.id);
      setIsFavorited(result.favorited);
    } catch (error: unknown) {
      console.error('[productCard] toggle favorite error', error);
      toast.error(t.common.error);
    } finally {
      setFavLoading(false);
    }
  };

  return (
    <Link
      to={`/products/${product.id}`}
      className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--store-ink)] focus-visible:ring-offset-2 rounded-[10px]"
      aria-label={title}
    >
      <article className="store-tile group">
        <div className="store-tile-media">
          {/*
            object-contain 而不是 cover：商品图多为白底产品照，
            cover 会把主体裁掉边缘；contain 保留完整轮廓，靠底色衬托。
          */}
          <Image
            src={product.coverImage || product.images?.[0] || ''}
            alt={title}
            className="h-full w-full object-contain p-2"
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
          />

          {/* 折扣：安静的角标，不用爆炸贴 */}
          {isOnSale && discountPct > 0 && (
            <span className="store-tag absolute left-2.5 top-2.5">
              −{discountPct}%
            </span>
          )}

          {/* 售罄：盖一层中性遮罩 + 文字，而不是只写一行灰字 */}
          {isSoldOut && (
            <span className="store-tag store-tag-solid absolute bottom-2.5 left-2.5">
              {productText.outOfStock}
            </span>
          )}

          <button
            type="button"
            onClick={handleToggleFavorite}
            disabled={favLoading}
            className="store-fav absolute right-2.5 top-2.5"
            aria-label={isFavorited ? t.product.removeFromFavorites : t.product.addToFavorites}
            aria-pressed={isFavorited}
            title={isFavorited ? t.product.removeFromFavorites : t.product.addToFavorites}
          >
            <Heart className={`size-3.5 ${isFavorited ? 'fill-current' : ''}`} />
          </button>
        </div>

        <div className="space-y-1.5 px-3 pb-3 pt-2.5">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[0.8125rem] font-medium leading-snug text-[var(--store-text)]">
            {title}
          </h3>

          <div className="flex items-baseline gap-1.5">
            <span className="store-price text-[0.9375rem]">
              ${Number(minPrice).toFixed(2)}
            </span>
            {isOnSale && (
              <span className="store-price-was text-[0.6875rem]">
                ${Number(displayOriginalPrice).toFixed(2)}
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-1 text-[0.6875rem] text-[var(--store-faint)]">
            <span className="store-num">{product.totalSold}</span>
            <span>{productText.sold}</span>
          </div>
        </div>
      </article>
    </Link>
  );
};

export default ProductCard;
