import React, { useId } from 'react';
import { Link } from 'react-router-dom';

interface StoreSectionProps {
  /** 目录序号，如 "01"；不传则不渲染序号 */
  index?: string;
  title: string;
  subtitle?: string;
  /** 右侧"查看全部"链接 */
  action?: { label: string; to: string };
  children: React.ReactNode;
  className?: string;
}

/**
 * 买家端分区标题。
 *
 * 为什么不用「图标 + 粗体标题」：电商模板全这么写，读者会自动忽略——
 * 图标成了装饰噪音。这里用「目录序号 + 细竖线 + 标题 + 一句说明」，
 * 让页面读起来像一本被编辑过的买手目录：每个分区是一个条目，
 * 有编号、有主张、有边界。
 *
 * 序号用等宽字体并压低对比度，保证它只做定位、不抢标题。
 */
const StoreSection: React.FC<StoreSectionProps> = ({
  index,
  title,
  subtitle,
  action,
  children,
  className = '',
}) => {
  const headingId = useId();

  return (
    <section className={className} aria-labelledby={headingId}>
      <div className="store-section">
        <div className="store-section-head">
          {index && <span className="store-section-index">{index}</span>}
          {index && <span className="store-section-rule" aria-hidden="true" />}
          <div className="min-w-0">
            <h2 id={headingId} className="store-section-title">
              {title}
            </h2>
            {subtitle && <p className="store-section-sub">{subtitle}</p>}
          </div>
        </div>

        {action && (
          <Link
            to={action.to}
            /* min-h 保证触控目标不小于 32px（无障碍审计会拦 <24px 的链接） */
            className="group inline-flex min-h-[32px] shrink-0 items-center gap-1 px-1 text-xs font-medium text-[var(--store-muted)] transition-colors hover:text-[var(--store-ink)]"
          >
            {action.label}
            <span
              aria-hidden="true"
              className="transition-transform duration-150 group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        )}
      </div>

      {children}
    </section>
  );
};

export default StoreSection;
