import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

const SELLER_ROLES = new Set(['seller', 'admin']);

const SellerRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading || (user === null && typeof window === 'undefined')) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--flow-ink)]">
        <div className="flex flex-col items-center gap-4">
          <div className="size-14 rounded-xl bg-[var(--flow-accent)]/20 flex items-center justify-center text-2xl font-bold text-[var(--flow-accent)]">
            G
          </div>
          <div className="size-8 border-4 border-[var(--flow-accent)] border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-slate-300">{t.common.loading}...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!SELLER_ROLES.has(user.role)) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            {t.auth.sellerAccessDenied}
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            {t.auth.sellerAccessDeniedDesc}
          </p>
          <Button variant="default">
            <Link to="/" className="text-white no-underline">{t.auth.backToHome}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SellerRouteGuard;
