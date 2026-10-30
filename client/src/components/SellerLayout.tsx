import React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  MessageSquare,
  Sparkles,
  Store,
  Globe,
  LogOut,
  Tag,
  FileText,
  RotateCcw,
  Truck,
  Layers,
  Menu,
  Bot,
  Command,
} from 'lucide-react';
import logoWhite from '@/assets/branding/logo-white.png';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language } from '@shared/api.interface';
import { Image } from '@/components/ui/image';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import SellerCommandPalette from '@/components/SellerCommandPalette';

const SellerLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();

  const languageLabels: Record<Language, string> = {
    zh: '简体中文',
    en: 'English',
    es: 'Español',
    pt: 'Português',
  };

  const handleLogout = (): void => {
    logout();
    navigate('/login');
  };

  const zh = language === 'zh';
  const navItems = [
    {
      to: '/seller/copilot',
      label: zh ? 'AI 运营副驾' : 'AI Copilot',
      icon: Bot,
      accent: true,
    },
    {
      to: '/seller/dashboard',
      label: zh ? '数据看板' : 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      to: '/seller/products',
      label: zh ? '商品管理' : 'Products',
      icon: Package,
    },
    {
      to: '/seller/orders',
      label: zh ? '订单管理' : 'Orders',
      icon: ShoppingCart,
    },
    {
      to: '/seller/inquiries',
      label: zh ? '咨询管理' : 'Inquiries',
      icon: MessageSquare,
    },
    {
      to: '/seller/refunds',
      label: zh ? '退款管理' : 'Refunds',
      icon: RotateCcw,
    },
    {
      to: '/seller/coupons',
      label: zh ? '优惠券' : 'Coupons',
      icon: Tag,
    },
    {
      to: '/seller/collections',
      label: zh ? '运营集合' : 'Collections',
      icon: Layers,
    },
    {
      to: '/seller/shipping-templates',
      label: zh ? '运费模板' : 'Shipping',
      icon: Truck,
    },
    {
      to: '/seller/cms-pages',
      label: zh ? 'CMS 页面' : 'CMS',
      icon: FileText,
    },
    {
      to: '/seller/audit-logs',
      label: zh ? '审计日志' : 'Audit logs',
      icon: FileText,
    },
    {
      to: '/seller/ai-center',
      label: zh ? 'AI 分析中心' : 'AI Center',
      icon: Sparkles,
    },
  ];

  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const getPageTitle = (): string => {
    const item = navItems.find((nav) => location.pathname.startsWith(nav.to));
    return item?.label ?? (zh ? '卖家中心' : 'Seller Center');
  };

  const navLinkClass = (isActive: boolean, accent?: boolean): string => {
    if (isActive) {
      return 'flex items-center gap-2.5 rounded-lg border-l-2 border-[var(--flow-accent)] bg-[var(--flow-accent-soft)] px-3 py-2 text-[13px] font-medium text-[var(--flow-text-1)]';
    }
    return `flex items-center gap-2.5 rounded-lg border-l-2 border-transparent px-3 py-2 text-[13px] transition-colors hover:bg-[var(--flow-surface-2)] hover:text-[var(--flow-text-1)] ${
      accent ? 'text-[var(--flow-accent)]' : 'text-[var(--flow-text-2)]'
    }`;
  };

  const navBody = (onClick?: () => void) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onClick}
            className={({ isActive }) => navLinkClass(isActive, item.accent)}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-screen w-full bg-slate-100">
      <aside className="flow-dark hidden w-60 shrink-0 flex-col border-r border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] lg:flex">
        <div className="flex items-center gap-2.5 border-b border-[var(--flow-line-1)] px-4 py-4">
          <Image src={logoWhite} alt="Flow" className="size-8 object-contain" />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-[var(--flow-text-1)]">Flow</div>
            <div className="flow-caption truncate">{zh ? '卖家工作台' : 'Seller Workbench'}</div>
          </div>
          <span className="ml-auto rounded border border-[var(--flow-line-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--flow-text-3)]">
            AI
          </span>
        </div>

        {navBody()}

        <div className="space-y-1 border-t border-[var(--flow-line-1)] p-2">
          <NavLink
            to="/"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[var(--flow-text-2)] transition-colors hover:bg-[var(--flow-surface-2)] hover:text-[var(--flow-text-1)]"
          >
            <Store className="size-4" />
            {zh ? '前往商城' : 'View storefront'}
          </NavLink>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-[var(--flow-text-3)]">
            <Command className="size-3" />
            {zh ? '⌘K 唤起 AI 命令' : '⌘K for AI commands'}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]/80 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="text-[var(--flow-text-2)] lg:hidden">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flow-dark w-64 border-0 bg-[var(--flow-surface-1)] p-0">
                <SheetTitle className="flex items-center gap-2.5 border-b border-[var(--flow-line-1)] px-4 py-4 text-left">
                  <Image src={logoWhite} alt="Flow" className="size-7 object-contain" />
                  <span className="text-sm font-semibold text-[var(--flow-text-1)]">Flow</span>
                </SheetTitle>
                {navBody(() => setMobileNavOpen(false))}
              </SheetContent>
            </Sheet>
            <h1 className="truncate text-sm font-medium text-[var(--flow-text-1)]">
              {getPageTitle()}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <SellerCommandPalette />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-[var(--flow-text-2)] hover:text-[var(--flow-text-1)]">
                  <Globe className="size-4" />
                  <span className="hidden max-w-[80px] truncate text-xs sm:inline">
                    {languageLabels[language]}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="flow-dark w-40 border-[var(--flow-line-2)] bg-[var(--flow-surface-2)]">
                {(['zh', 'en', 'es', 'pt'] as Language[]).map((lang) => (
                  <DropdownMenuItem
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={`text-[13px] ${language === lang ? 'font-medium text-[var(--flow-accent)]' : 'text-[var(--flow-text-2)]'}`}
                  >
                    {languageLabels[lang]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="hidden items-center gap-2 border-l border-[var(--flow-line-1)] pl-2 sm:flex">
              <span className="size-6 rounded-full bg-[var(--flow-surface-3)] text-center text-[11px] leading-6 text-[var(--flow-text-2)]">
                {(user?.name ?? 'U').slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[120px] truncate text-xs text-[var(--flow-text-2)]">
                {user?.name || ''}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-danger)]"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">{zh ? '退出' : 'Sign out'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-100 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default SellerLayout;
