import React from 'react';
import { listProducts } from '@/api/products';
import type { Product } from '@shared/api.interface';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import ShopperWidget from './ShopperWidget';
import { ShoppingCart, Store, Globe, Search, User, LogOut, Heart, ChevronDown, Menu, MapPin } from 'lucide-react';
import logoHorizontal from '@/assets/branding/logo-horizontal.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import type { Language } from '@shared/api.interface';
import { Image } from '@/components/ui/image';

const BuyerLayout: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<Product[]>([]);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const suggestTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLanguageSelect = (lang: Language): void => {
    setLanguage(lang);
  };

  const languageLabels: Record<Language, string> = {
    zh: '简体中文',
    en: 'English',
    es: 'Español',
    pt: 'Português',
  };

  const handleSearch = (e: React.FormEvent): void => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?keyword=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleSearchInput = (value: string): void => {
    setSearchQuery(value);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    suggestTimer.current = setTimeout(() => {
      listProducts({ keyword: value.trim(), pageSize: 5 })
        .then((res) => {
          setSuggestions(res.items);
          setSuggestOpen(true);
        })
        .catch(() => setSuggestions([]));
    }, 250);
  };

  const selectSuggestion = (product: Product): void => {
    setSuggestOpen(false);
    setSearchQuery('');
    navigate(`/products/${product.id}`);
  };

  const handleLogout = (): void => {
    logout();
    navigate('/');
  };

  return (
    <div className="flow-store min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-[var(--store-line)] bg-white/85 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <div className="flex items-center gap-3 md:gap-8">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="md:hidden" title={t.nav.home}>
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0">
                  <SheetHeader className="border-b px-4 py-3">
                    <SheetTitle className="text-left">
                      <Image src={logoHorizontal} alt="Flow" className="h-7 w-auto max-w-[160px] object-contain" />
                    </SheetTitle>
                  </SheetHeader>
                  <div className="flex flex-col gap-1 p-3">
                    <form onSubmit={(e) => { handleSearch(e); setMobileNavOpen(false); }} className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--store-faint)]" />
                      <Input
                        type="text"
                        placeholder={t.nav.searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full border-[var(--store-line)] bg-[var(--store-surface-2)] pl-9 pr-4 focus-visible:border-[var(--store-ink)] focus-visible:ring-1 focus-visible:ring-[var(--store-ink)]/20"
                      />
                    </form>
                    <NavLink
                      to="/"
                      end
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        `rounded-md px-3 py-2 text-sm font-medium ${
                          isActive ? 'bg-slate-100 text-[var(--flow-ink)]' : 'text-slate-600'
                        }`
                      }
                    >
                      {t.nav.home}
                    </NavLink>
                    <NavLink
                      to="/products"
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        `rounded-md px-3 py-2 text-sm font-medium ${
                          isActive ? 'bg-slate-100 text-[var(--flow-ink)]' : 'text-slate-600'
                        }`
                      }
                    >
                      {t.nav.products}
                    </NavLink>
                    <NavLink
                      to="/favorites"
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        `rounded-md px-3 py-2 text-sm font-medium ${
                          isActive ? 'bg-slate-100 text-[var(--flow-ink)]' : 'text-slate-600'
                        }`
                      }
                    >
                      {t.nav.favorites}
                    </NavLink>
                    <NavLink
                      to="/orders"
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        `rounded-md px-3 py-2 text-sm font-medium ${
                          isActive ? 'bg-slate-100 text-[var(--flow-ink)]' : 'text-slate-600'
                        }`
                      }
                    >
                      {t.nav.orders}
                    </NavLink>
                    {user && (
                      <NavLink
                        to="/addresses"
                        onClick={() => setMobileNavOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                            isActive ? 'bg-slate-100 text-[var(--flow-ink)]' : 'text-slate-600'
                          }`
                        }
                      >
                        <MapPin className="w-4 h-4" />
                        {t.address?.title ?? 'Addresses'}
                      </NavLink>
                    )}
                    <Link
                      to="/seller/dashboard"
                      onClick={() => setMobileNavOpen(false)}
                      className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600"
                    >
                      <Store className="w-4 h-4" />
                      {t.nav.sellerCenter}
                    </Link>
                  </div>
                </SheetContent>
              </Sheet>
              <Link to="/" className="flex shrink-0 items-center gap-2">
                <Image
                  src={logoHorizontal}
                  alt="Flow"
                  className="h-8 w-auto max-w-[130px] object-contain sm:h-9 sm:max-w-none"
                />
              </Link>
              <nav className="hidden items-center gap-1 py-2 md:flex">
                {[
                  { to: '/', label: t.nav.home, end: true },
                  { to: '/products', label: t.nav.products, end: false },
                ].map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `relative inline-flex items-center px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'font-medium text-[var(--store-ink)]'
                          : 'text-[var(--store-muted)] hover:text-[var(--store-ink)]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {item.label}
                        {/* 当前页用 2px 下划线标记，比单纯变色更明确 */}
                        <span
                          aria-hidden="true"
                          className={`absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-[var(--store-ink)] transition-opacity ${
                            isActive ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>

            <div className="flex-1 max-w-md hidden sm:block relative">
              <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--store-faint)]" />
                <Input
                  type="text"
                  placeholder={t.nav.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                  className="w-full border-[var(--store-line)] bg-[var(--store-surface-2)] pl-9 pr-4 focus-visible:border-[var(--store-ink)] focus-visible:ring-1 focus-visible:ring-[var(--store-ink)]/20"
                  autoComplete="off"
                />
              </form>
              {suggestOpen && suggestions.length > 0 && (
                <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-[var(--store-line-strong)] bg-white shadow-[0_16px_40px_-24px_rgba(11,31,58,0.45)]">
                  {suggestions.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onMouseDown={() => selectSuggestion(product)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--store-surface-2)]"
                    >
                      <span className="flex size-9 items-center justify-center overflow-hidden rounded border border-[var(--store-line)] bg-[var(--store-surface-2)]">
                        {product.coverImage ? (
                          <img src={product.coverImage} alt="" className="size-full object-cover" loading="lazy" />
                        ) : (
                          <Search className="size-4 text-slate-400" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--store-text)]">
                          {language === 'zh' ? product.titleZh : product.titleEn}
                        </span>
                        <span className="store-num block text-xs text-[var(--store-faint)]">${product.minPrice ?? '0.00'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

              <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <Globe className="size-4 shrink-0" aria-hidden="true" />
                      {/* 移动端只留图标：语言名 + 箭头约占 90px，是头部横向溢出的主要来源 */}
                      <span className="hidden max-w-[80px] truncate sm:inline">
                        {languageLabels[language]}
                      </span>
                      <ChevronDown className="hidden size-3 sm:block" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {(['zh', 'en', 'es', 'pt'] as Language[]).map((lang) => (
                       <DropdownMenuItem
                        key={lang}
                        onClick={() => handleLanguageSelect(lang)}
                        className={language === lang ? 'text-[var(--flow-accent)] font-medium' : ''}
                      >
                        {languageLabels[lang]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Link to="/favorites" className="hidden sm:block">
                  <Button variant="ghost" size="sm" className="relative" title={t.nav.favorites}>
                    <Heart className="w-5 h-5" />
                  </Button>
                </Link>
                <Link to="/cart">
                  <Button variant="ghost" size="sm" className="relative">
                    <ShoppingCart className="w-5 h-5" />
                  </Button>
                </Link>
                {user ? (
                  <div className="flex items-center gap-2">
                    <Link to="/addresses" className="hidden sm:block">
                      <Button variant="ghost" size="sm" title={t.address?.title ?? 'Addresses'}>
                        <MapPin className="w-5 h-5" />
                      </Button>
                    </Link>
                    <Link to="/orders">
                      <Button variant="ghost" size="sm" className="flex items-center gap-1">
                        <User className="w-4 h-4" />
                        <span className="hidden sm:inline text-sm font-medium max-w-[100px] truncate">
                          {user.name}
                        </span>
                        {typeof user.points === 'number' && user.points > 0 && (
                          <span
                            className="hidden md:inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                            title={t.nav.points}
                          >
                            {user.points} {t.nav.points}
                          </span>
                        )}
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleLogout}
                      className="text-slate-500 hover:text-red-600"
                      title={t.auth.logout}
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <Link to="/login">
                    <Button variant="ghost" size="sm" className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      <span className="hidden sm:inline text-sm font-medium">
                        {t.auth.signIn}
                      </span>
                    </Button>
                  </Link>
                )}
                <Link to="/seller/dashboard">
                  <Button variant="outline" size="sm" className="hidden sm:flex">
                    <Store className="w-4 h-4 mr-1" />
                    {t.nav.sellerCenter}
                  </Button>
                </Link>
              </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <ShopperWidget />

      <footer className="bg-[var(--flow-ink)] text-slate-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="mb-4 flex items-center gap-2.5">
                {/*
                  页脚只保留文字字标，不再贴位图 logo。
                  原因：现有的 logo PNG 全是「深色底 + 白字」的不透明位图（colortype 2，无 alpha），
                  放在同色深蓝页脚上，图片边界就是一个灰块——发布截图里已经出现过。
                  在 96×32 这个尺寸下，位图既看不清细节又会随底色失效；
                  纯文字字标在任何背景上都稳定，也更符合"克制"的品牌基调。
                */}
                <span className="text-[0.9375rem] font-semibold tracking-tight text-white">
                  Flow AI
                </span>
              </div>
               <p className="text-sm">
                 {language === 'zh'
                   ? 'AI 让跨境生意更简单'
                   : language === 'es'
                     ? 'IA simplifica los negocios transfronterizos'
                     : language === 'pt'
                       ? 'IA torna o comércio transfronteiriço mais simples'
                       : 'AI makes cross-border business simpler'}
                </p>
            </div>
             <div>
               <h4 className="text-white font-semibold mb-4">
                  {language === 'zh' ? '购物指南' : language === 'es' ? 'Guía de Compra' : language === 'pt' ? 'Guia de Compras' : 'Shopping Guide'}
               </h4>
               <ul className="space-y-2 text-sm">
                 <li><Link to="/page/how-to-order" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '如何下单' : language === 'es' ? 'Cómo Pedir' : language === 'pt' ? 'Como Pedir' : 'How to Order'}</Link></li>
                 <li><Link to="/page/payment-methods" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '支付方式' : language === 'es' ? 'Métodos de Pago' : language === 'pt' ? 'Formas de Pagamento' : 'Payment Methods'}</Link></li>
                 <li><Link to="/page/shipping-info" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '配送说明' : language === 'es' ? 'Información de Envío' : language === 'pt' ? 'Informações de Entrega' : 'Shipping Info'}</Link></li>
                 <li><Link to="/page/returns" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '退换货政策' : language === 'es' ? 'Política de Devoluciones' : language === 'pt' ? 'Política de Devolução' : 'Return Policy'}</Link></li>
               </ul>
             </div>
             <div>
               <h4 className="text-white font-semibold mb-4">
                  {language === 'zh' ? '客户服务' : language === 'es' ? 'Atención al Cliente' : language === 'pt' ? 'Atendimento ao Cliente' : 'Customer Service'}
               </h4>
               <ul className="space-y-2 text-sm">
                 <li><Link to="/page/help" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '帮助中心' : language === 'es' ? 'Centro de Ayuda' : language === 'pt' ? 'Central de Ajuda' : 'Help Center'}</Link></li>
                 <li><Link to="/page/contact" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '联系我们' : language === 'es' ? 'Contáctanos' : language === 'pt' ? 'Fale Conosco' : 'Contact Us'}</Link></li>
                 <li><Link to="/page/faq" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '常见问题' : language === 'es' ? 'Preguntas Frecuentes' : language === 'pt' ? 'Perguntas Frequentes' : 'FAQ'}</Link></li>
               </ul>
             </div>
             <div>
               <h4 className="text-white font-semibold mb-4">
                  {language === 'zh' ? '关于我们' : language === 'es' ? 'Sobre Nosotros' : language === 'pt' ? 'Sobre Nós' : 'About Us'}
               </h4>
               <ul className="space-y-2 text-sm">
                 <li><Link to="/page/about" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '公司介绍' : language === 'es' ? 'About Flow' : language === 'pt' ? 'Sobre a Flow' : 'About Flow'}</Link></li>
                 <li><Link to="/register?role=seller" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '卖家入驻' : language === 'es' ? 'Sell on Flow' : language === 'pt' ? 'Sell on Flow' : 'Sell on Flow'}</Link></li>
                 <li><Link to="/page/privacy" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '隐私政策' : language === 'es' ? 'Política de Privacidad' : language === 'pt' ? 'Política de Privacidade' : 'Privacy Policy'}</Link></li>
                 <li><Link to="/page/terms" className="inline-block py-1 hover:text-white transition-colors">{language === 'zh' ? '服务条款' : language === 'es' ? 'Términos de Servicio' : language === 'pt' ? 'Termos de Serviço' : 'Terms of Service'}</Link></li>
               </ul>
             </div>
          </div>
           <div className="border-t border-[#1a3a5c] mt-8 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
              <span>© {new Date().getFullYear()} Flow. {language === 'zh' ? '保留所有权利。' : language === 'es' ? 'Todos los derechos reservados.' : language === 'pt' ? 'Todos os direitos reservados.' : 'All rights reserved.'}</span>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                <span>Stripe</span><span>PayPal</span><span>{language === 'zh' ? '30 天退换' : '30-day returns'}</span><span>{language === 'zh' ? '全球配送' : 'Worldwide shipping'}</span>
              </span>
            </div>
        </div>
      </footer>
    </div>
  );
};

export default BuyerLayout;
