import React from 'react';

/** 卖家工作台页面骨架：统一标题区、描述、动作区与内容间距 */
export const SellerPageHeader: React.FC<{
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  status?: React.ReactNode;
}> = ({ title, description, eyebrow, actions, status }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      {eyebrow && <div className="flow-caption mb-1">{eyebrow}</div>}
      <h1 className="flow-h2 text-[var(--flow-text-1)]">{title}</h1>
      {description && (
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--flow-text-2)]">
          {description}
        </p>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {status}
      {actions}
    </div>
  </div>
);

/** 统一面板容器（替代 ad-hoc <Card className="shadow-sm">） */
export const FlowPanel: React.FC<{
  title?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}> = ({ title, description, icon: Icon, actions, children, className = '', bodyClassName = '', noPadding }) => (
  <section
    className={`overflow-hidden rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] ${className}`}
  >
    {(title || actions) && (
      <header className="flex items-center gap-2 border-b border-[var(--flow-line-1)] px-4 py-3">
        {Icon && <Icon className="size-4 shrink-0 text-[var(--flow-text-3)]" />}
        <div className="min-w-0 flex-1">
          {title && <h2 className="truncate text-sm font-medium text-[var(--flow-text-1)]">{title}</h2>}
          {description && <p className="mt-0.5 truncate text-[11px] text-[var(--flow-text-3)]">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={noPadding ? '' : `p-4 ${bodyClassName}`}>{children}</div>
  </section>
);

/** 指标块 */
export const FlowStat: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
}> = ({ label, value, hint, icon: Icon }) => (
  <div className="rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] p-4">
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--flow-text-3)]">
      {Icon && <Icon className="size-3" />}
      <span className="truncate">{label}</span>
    </div>
    <p className="flow-data-xl mt-2 text-[var(--flow-text-1)]">{value}</p>
    {hint && <p className="mt-1 text-[11px] text-[var(--flow-text-3)]">{hint}</p>}
  </div>
);

/** 空态 */
export const FlowEmpty: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}> = ({ title, description, action, icon: Icon }) => (
  <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
    {Icon && (
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[var(--flow-surface-2)]">
        <Icon className="size-5 text-[var(--flow-text-3)]" />
      </span>
    )}
    <p className="text-sm font-medium text-[var(--flow-text-1)]">{title}</p>
    {description && (
      <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--flow-text-2)]">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** 状态徽标：语义统一（不依赖 ad-hoc 颜色类） */
export const FlowStatus: React.FC<{
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'idle';
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const map = {
    ok: 'border-[var(--flow-ok)]/35 bg-[var(--flow-ok)]/10 text-[var(--flow-ok)]',
    warn: 'border-[var(--flow-warn)]/35 bg-[var(--flow-warn)]/10 text-[var(--flow-warn)]',
    danger: 'border-[var(--flow-danger)]/35 bg-[var(--flow-danger)]/10 text-[var(--flow-danger)]',
    info: 'border-[var(--flow-cyan)]/35 bg-[var(--flow-cyan)]/10 text-[var(--flow-cyan)]',
    idle: 'border-[var(--flow-line-2)] bg-[var(--flow-surface-2)] text-[var(--flow-text-3)]',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${map[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
};
