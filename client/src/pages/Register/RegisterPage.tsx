import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import logoMain from '@/assets/branding/logo-main.png';
import { Image } from '@/components/ui/image';
import { extractErrorMessage } from '@/lib/error-feedback';

const RegisterPage: React.FC = () => {
  const { t } = useLanguage();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sellerCode, setSellerCode] = useState('');
  const [asSeller, setAsSeller] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error('请填写所有必填项');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('两次密码输入不一致');
      return;
    }
    if (password.length < 8) {
      toast.error('密码长度至少 8 位（需包含字母和数字）');
      return;
    }
    if (asSeller && !sellerCode.trim()) {
      toast.error('卖家注册需要邀请码');
      return;
    }

    setLoading(true);
    try {
      await register({
        name,
        email,
        password,
        ...(asSeller ? { role: 'seller' as const, sellerCode: sellerCode.trim() } : {}),
      });
      toast.success('注册成功');
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Register failed', err);
      toast.error(extractErrorMessage(err, '注册失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#07080B] via-[#12161F] to-[#07080B] py-12 px-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <Image
              src={logoMain}
              alt="Flow"
              className="h-16 w-16 object-contain rounded-xl"
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t.auth.createAccount}
          </h1>
          <p className="text-sm text-slate-500">Flow · 让跨境生意更简单</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t.auth.name}</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.auth.namePlaceholder}
              autoComplete="name"
            />
          </div>
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
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="asSeller"
              type="checkbox"
              checked={asSeller}
              onChange={(e) => setAsSeller(e.target.checked)}
              className="size-4 accent-[var(--flow-accent)]"
            />
            <Label htmlFor="asSeller" className="text-sm text-slate-600">
              我是卖家（需要邀请码）
            </Label>
          </div>
          {asSeller && (
            <div className="space-y-2">
              <Label htmlFor="sellerCode">卖家邀请码</Label>
              <Input
                id="sellerCode"
                type="text"
                value={sellerCode}
                onChange={(e) => setSellerCode(e.target.value)}
                placeholder="SELLER_REGISTRATION_CODE"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t.auth.confirmPassword}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t.auth.createAccount}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          {t.auth.haveAccount}{' '}
          <Link to="/login" className="text-[var(--flow-accent)] hover:underline font-medium">
            {t.auth.signIn}
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default RegisterPage;
