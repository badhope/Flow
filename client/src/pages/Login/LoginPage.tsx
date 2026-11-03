import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { extractErrorMessage } from '@/lib/error-feedback';
import logoMain from '@/assets/branding/logo-main.png';
import { Image } from '@/components/ui/image';

const LoginPage: React.FC = () => {
  const { t } = useLanguage();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from || '/';

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('请输入邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      await login({ email, password });
      toast.success('登录成功');
      navigate(from, { replace: true });
    } catch (err) {
      console.error('Login failed', err);
      toast.error(extractErrorMessage(err, '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#07080B] via-[#12161F] to-[#07080B] py-12 px-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Image
              src={logoMain}
              alt="Flow"
              className="h-16 w-16 object-contain rounded-xl"
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t.auth.welcomeBack}
          </h1>
          <p className="text-sm text-slate-500">Flow · 让跨境生意更简单</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t.auth.email}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t.auth.password}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t.auth.signIn}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          {t.auth.noAccount}{' '}
          <Link to="/register" className="inline-flex items-center py-1 text-[var(--flow-accent)] hover:underline font-medium">
            {t.auth.signUp}
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default LoginPage;
