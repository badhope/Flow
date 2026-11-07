import React, { useEffect, lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import { ToolContractProvider } from './contexts/ToolContractContext';
import BuyerLayout from './components/BuyerLayout';
import SellerLayout from './components/SellerLayout';
import SellerRouteGuard from './components/SellerRouteGuard';
import HomePage from './pages/Home/HomePage';
import { reportVisitOnce } from './lib/visit-beacon';

const ProductListPage = lazy(() => import('./pages/ProductList/ProductListPage'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetail/ProductDetailPage'));
const CartPage = lazy(() => import('./pages/Cart/CartPage'));
const CheckoutPage = lazy(() => import('./pages/Checkout/CheckoutPage'));
const StripePaymentPage = lazy(() => import('./pages/Checkout/StripePaymentPage'));
const OrdersPage = lazy(() => import('./pages/Orders/OrdersPage'));
const FavoritesPage = lazy(() => import('./pages/Favorites/FavoritesPage'));
const AddressesPage = lazy(() => import('./pages/AddressesPage'));
const LoginPage = lazy(() => import('./pages/Login/LoginPage'));
const RegisterPage = lazy(() => import('./pages/Register/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/seller/DashboardPage'));
const ProductManagePage = lazy(() => import('./pages/seller/ProductManagePage'));
const OrderManagePage = lazy(() => import('./pages/seller/OrderManagePage'));
const InquiryManagePage = lazy(() => import('./pages/seller/InquiryManagePage'));
const AICenterPage = lazy(() => import('./pages/seller/AICenterPage'));
const CopilotPage = lazy(() => import('./pages/seller/CopilotPage'));
const CouponsPage = lazy(() => import('./pages/seller/CouponsPage/CouponsPage'));
const RefundsManagePage = lazy(() => import('./pages/seller/RefundsManagePage'));
const SettlementPage = lazy(() => import('./pages/seller/SettlementPage'));
const CustomsPage = lazy(() => import('./pages/seller/CustomsPage'));
const WarehousePage = lazy(() => import('./pages/seller/WarehousePage'));
const ShippingTemplatesPage = lazy(() => import('./pages/seller/ShippingTemplatesPage'));
const CollectionsPage = lazy(() => import('./pages/seller/CollectionsPage'));
const CmsPagesPage = lazy(() => import('./pages/seller/CmsPagesPage'));
const AuditLogPage = lazy(() => import('./pages/seller/AuditLogPage'));
const CmsPageView = lazy(() => import('./pages/CmsPageView'));
const CollectionDetailPage = lazy(() => import('./pages/CollectionDetail/CollectionDetailPage'));
const NotFound = lazy(() => import('./pages/NotFound/NotFound'));

const RouteFallback: React.FC = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
    加载中…
  </div>
);

const RoutesComponent = () => {
  // 工具契约只在卖家工作台需要；在买家页拉取会被 403 拒绝并污染控制台
  const { pathname } = useLocation();
  const needsToolContracts = pathname.startsWith('/seller');
  // 会话内每日一次访问上报（卖家看板访客数）
  useEffect(() => {
    reportVisitOnce();
  }, []);

  return (
    <LanguageProvider>
      <AuthProvider>
        <ToolContractProvider enabled={needsToolContracts}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* Public CMS pages */}
            <Route path="/page/:slug" element={<CmsPageView />} />
            {/* Public collection detail */}
            <Route path="/collections/:slug" element={<CollectionDetailPage />} />
            <Route element={<BuyerLayout />}>
              <Route index element={<HomePage />} />
              <Route path="products" element={<ProductListPage />} />
              <Route path="products/:id" element={<ProductDetailPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="checkout/stripe" element={<StripePaymentPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="addresses" element={<AddressesPage />} />
            </Route>
            <Route
              path="seller"
              element={
                <SellerRouteGuard>
                  <SellerLayout />
                </SellerRouteGuard>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="products" element={<ProductManagePage />} />
              <Route path="orders" element={<OrderManagePage />} />
              <Route path="inquiries" element={<InquiryManagePage />} />
              <Route path="copilot" element={<CopilotPage />} />
              <Route path="ai-center" element={<AICenterPage />} />
              <Route path="coupons" element={<CouponsPage />} />
              <Route path="refunds" element={<RefundsManagePage />} />
              <Route path="settlements" element={<SettlementPage />} />
              <Route path="customs" element={<CustomsPage />} />
              <Route path="warehouses" element={<WarehousePage />} />
              <Route path="shipping-templates" element={<ShippingTemplatesPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="cms-pages" element={<CmsPagesPage />} />
              <Route path="audit-logs" element={<AuditLogPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <Toaster position="top-right" />
        </ToolContractProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default RoutesComponent;
