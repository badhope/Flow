import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import ProductCard from '@/components/ProductCard';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StorefrontSection } from '@shared/api.interface';

interface CollectionFloorsProps {
  sections: StorefrontSection[];
  favoriteIds: Set<string>;
  loading?: boolean;
}

/** 楼层右上角「查看全部」入口（按 slug 进入集合详情页） */
const FloorLink: React.FC<{ slug: string }> = ({ slug }) => {
  const { t } = useLanguage();
  return (
    <Link
      to={`/collections/${slug}`}
      className="group inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-[var(--store-line-strong)] bg-white px-3.5 py-1.5 text-xs font-medium text-[var(--store-muted)] transition-colors hover:border-[var(--store-ink)] hover:text-[var(--store-ink)]"
    >
      {t.home.viewAll}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
};

/**
 * 首页运营楼层：每个精选集合一行，横向滚动展示集合内商品。
 * 标题/描述按当前语言择一；楼层右上角进入集合详情。
 */
const CollectionFloors: React.FC<CollectionFloorsProps> = ({ sections, favoriteIds, loading = false }) => {
  const { language, t } = useLanguage();

  if (loading) {
    return (
      <section className="container mx-auto px-6 py-8">
        <div className="py-12 text-center text-slate-400">{t.common.loading}</div>
      </section>
    );
  }

  if (sections.length === 0) return null;

  return (
    <>
      {sections.map((section, sectionIndex) => {
        const title = language === 'zh' ? section.titleZh : section.titleEn;
        const description = language === 'zh'
          ? section.descriptionZh ?? section.descriptionEn
          : section.descriptionEn ?? section.descriptionZh;

        return (
          <section key={section.id} className="container mx-auto px-6 py-8">
            <div className="store-section">
              <div className="store-section-head">
                {/* 运营楼层接在首页内置分区（01–03）之后继续编号，避免两套序号并存 */}
                <span className="store-section-index">
                  {String(sectionIndex + 1).padStart(2, '0')}
                </span>
                <span className="store-section-rule" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="store-section-title truncate">{title}</h2>
                  {description && (
                    <p className="store-section-sub truncate">{description}</p>
                  )}
                </div>
              </div>
              <FloorLink slug={section.slug} />
            </div>

            <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
              {section.products.map((product) => (
                <div
                  key={product.id}
                  className="w-[46%] flex-shrink-0 snap-start sm:w-[31%] md:w-[23.5%] lg:w-[19%]"
                >
                  <ProductCard product={product} favorited={favoriteIds.has(product.id)} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
};

export default CollectionFloors;
