import React, { useEffect, useState } from 'react';
import {
  Plus,
  Edit,
  ToggleLeft,
  ToggleRight,
  Percent,
  DollarSign,
  Calendar,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  listCoupons,
  createCoupon,
  updateCoupon,
} from '@/api/coupons';
import { toast } from 'sonner';
import type {
  Coupon,
  CouponType,
  CreateCouponRequest,
  UpdateCouponRequest,
} from '@shared/api.interface';
import { SellerPageHeader } from '@/components/seller/SellerUI';

interface CouponFormData {
  code: string;
  type: CouponType;
  value: string;
  minOrderAmount: string;
  totalQuantity: string;
  expiresAt: string;
  active: boolean;
}

const initialFormData: CouponFormData = {
  code: '',
  type: 'percent',
  value: '',
  minOrderAmount: '0',
  totalQuantity: '100',
  expiresAt: '',
  active: true,
};

const CouponsPage: React.FC = () => {
  const { language, t } = useLanguage();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [editDialogOpen, setEditDialogOpen] = useState<boolean>(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [formData, setFormData] = useState<CouponFormData>(initialFormData);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadCoupons = async (): Promise<void> => {
    try {
      setLoading(true);
      const result = await listCoupons(page, pageSize);
      setCoupons(result.items);
      setTotal(result.total);
    } catch (error: unknown) {
      console.error('[seller coupons] load error', error);
      toast.error(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleCreate = (): void => {
    setFormData(initialFormData);
    setCreateDialogOpen(true);
  };

  const handleEdit = (coupon: Coupon): void => {
    setEditingCoupon(coupon);
    setFormData({
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      minOrderAmount: coupon.minOrderAmount,
      totalQuantity: String(coupon.totalQuantity),
      expiresAt: coupon.expiresAt
        ? new Date(coupon.expiresAt).toISOString().slice(0, 16)
        : '',
      active: coupon.active,
    });
    setEditDialogOpen(true);
  };

  const handleSubmitCreate = async (): Promise<void> => {
    if (!formData.code.trim() || !formData.value) {
      toast.error(
        language === 'zh' ? '请填写优惠码和面额' : 'Please fill in code and value',
      );
      return;
    }
    try {
      setSubmitting(true);
      const payload: CreateCouponRequest = {
        code: formData.code.trim().toUpperCase(),
        type: formData.type,
        value: Number(formData.value),
        minOrderAmount: formData.minOrderAmount
          ? Number(formData.minOrderAmount)
          : 0,
        totalQuantity: formData.totalQuantity ? Number(formData.totalQuantity) : undefined,
        expiresAt: formData.expiresAt
          ? new Date(formData.expiresAt).toISOString()
          : undefined,
        active: formData.active,
      };
      await createCoupon(payload);
      toast.success(
        language === 'zh' ? '优惠券创建成功' : 'Coupon created successfully',
      );
      setCreateDialogOpen(false);
      void loadCoupons();
    } catch (error: unknown) {
      console.error('[seller coupons] create error', error);
      toast.error(t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitEdit = async (): Promise<void> => {
    if (!editingCoupon || !formData.code.trim() || !formData.value) {
      toast.error(
        language === 'zh' ? '请填写优惠码和面额' : 'Please fill in code and value',
      );
      return;
    }
    try {
      setSubmitting(true);
      const payload: UpdateCouponRequest = {
        code: formData.code.trim().toUpperCase(),
        type: formData.type,
        value: Number(formData.value),
        minOrderAmount: formData.minOrderAmount
          ? Number(formData.minOrderAmount)
          : 0,
        totalQuantity: formData.totalQuantity ? Number(formData.totalQuantity) : undefined,
        expiresAt: formData.expiresAt
          ? new Date(formData.expiresAt).toISOString()
          : undefined,
        active: formData.active,
      };
      await updateCoupon(editingCoupon.id, payload);
      toast.success(
        language === 'zh' ? '优惠券更新成功' : 'Coupon updated successfully',
      );
      setEditDialogOpen(false);
      setEditingCoupon(null);
      void loadCoupons();
    } catch (error: unknown) {
      console.error('[seller coupons] update error', error);
      toast.error(t.common.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (coupon: Coupon): Promise<void> => {
    try {
      await updateCoupon(coupon.id, { active: !coupon.active });
      toast.success(
        language === 'zh'
          ? coupon.active
            ? '已停用'
            : '已启用'
          : coupon.active
            ? 'Disabled'
            : 'Enabled',
      );
      void loadCoupons();
    } catch (error: unknown) {
      console.error('[seller coupons] toggle status error', error);
      toast.error(t.common.error);
    }
  };

  const renderForm = (): React.ReactNode => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>{t.seller.couponCode}</Label>
        <Input
          value={formData.code}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormData({
              ...formData,
              code: e.target.value.toUpperCase(),
            })
          }
          placeholder={language === 'zh' ? '如：SAVE10' : 'e.g. SAVE10'}
        />
      </div>
      <div className="space-y-2">
        <Label>{t.seller.couponType}</Label>
        <Select
          value={formData.type}
          onValueChange={(value: string) =>
            setFormData({ ...formData, type: value as CouponType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">
              <div className="flex items-center gap-2">
                <Percent className="size-4" />
                {t.seller.percent}
              </div>
            </SelectItem>
            <SelectItem value="fixed">
              <div className="flex items-center gap-2">
                <DollarSign className="size-4" />
                {t.seller.fixed}
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t.seller.couponValue}</Label>
        <Input
          type="number"
          value={formData.value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, value: e.target.value })
          }
          placeholder={
            formData.type === 'percent'
              ? language === 'zh'
                ? '1-100'
                : '1-100'
              : language === 'zh'
                ? '立减金额'
                : 'Fixed amount'
          }
        />
        <p className="text-xs text-slate-500">
          {formData.type === 'percent'
            ? language === 'zh'
              ? '折扣百分比（1-100）'
              : 'Discount percentage (1-100)'
            : language === 'zh'
              ? '立减金额（美元）'
              : 'Fixed discount amount (USD)'}
        </p>
      </div>
      <div className="space-y-2">
        <Label>{t.seller.minOrderAmount}</Label>
        <Input
          type="number"
          value={formData.minOrderAmount}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, minOrderAmount: e.target.value })
          }
          placeholder="0"
        />
      </div>
      <div className="space-y-2">
        <Label>{t.seller.usageLimit}</Label>
        <Input
          type="number"
          value={formData.totalQuantity}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, totalQuantity: e.target.value })
          }
          placeholder="100"
        />
      </div>
      <div className="space-y-2">
        <Label>
          <Calendar className="size-4 inline mr-1" />
          {t.seller.expiresAt}
        </Label>
        <Input
          type="datetime-local"
          value={formData.expiresAt}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormData({ ...formData, expiresAt: e.target.value })
          }
        />
        <p className="text-xs text-slate-500">
          {language === 'zh' ? '可选，留空表示永不过期' : 'Optional, leave empty for no expiry'}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <Label>{t.seller.status}</Label>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.active}
            onCheckedChange={(checked: boolean) =>
              setFormData({ ...formData, active: checked })
            }
          />
          <span className="text-sm text-slate-600">
            {formData.active ? t.seller.active : t.seller.inactive}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow="Marketing"
        title={t.seller.couponManagement}
        description="百分比 / 固定金额 / 包邮三种类型，支持使用范围与限次；核销为原子操作。"
        actions={
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleCreate}>
              <Plus className="size-4 mr-2" />
              {t.seller.createCoupon}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t.seller.createCoupon}</DialogTitle>
            </DialogHeader>
            {renderForm()}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                {t.seller.cancel}
              </Button>
              <Button onClick={() => void handleSubmitCreate()} disabled={submitting}>
                {submitting ? t.common.loading : t.seller.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        }
      />

      {/* Coupon List */}
      <Card className="rounded-xl bg-white">
        {loading ? (
          <div className="p-8 text-center text-slate-500">{t.common.loading}</div>
        ) : coupons.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {language === 'zh' ? '暂无优惠券' : 'No coupons yet'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-left py-3 px-4 font-medium">{t.seller.couponCode}</th>
                  <th className="text-left py-3 px-4 font-medium">{t.seller.couponType}</th>
                  <th className="text-left py-3 px-4 font-medium">{t.seller.couponValue}</th>
                  <th className="text-left py-3 px-4 font-medium">{t.seller.minOrderAmount}</th>
                  <th className="text-left py-3 px-4 font-medium">{t.seller.usedCount}</th>
                  <th className="text-left py-3 px-4 font-medium">{t.seller.expiresAt}</th>
                  <th className="text-left py-3 px-4 font-medium">{t.seller.status}</th>
                  <th className="text-right py-3 px-4 font-medium">{t.seller.actions}</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon: Coupon) => (
                  <tr
                    key={coupon.id}
                    className="border-b border-slate-100 hover:bg-slate-50/50"
                  >
                    <td className="py-3 px-4">
                      <span className="font-mono font-medium text-slate-900">
                        {coupon.code}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant="secondary"
                        className={
                          coupon.type === 'percent'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }
                      >
                        {coupon.type === 'percent'
                          ? t.seller.percent
                          : t.seller.fixed}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {coupon.type === 'percent'
                        ? `${coupon.value}%`
                        : `$${Number(coupon.value).toFixed(2)}`}
                    </td>
                    <td className="py-3 px-4">${Number(coupon.minOrderAmount).toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{
                              width: `${coupon.totalQuantity > 0 ? Math.min(100, (coupon.usedCount / coupon.totalQuantity) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {coupon.usedCount}/{coupon.totalQuantity}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {coupon.expiresAt
                        ? new Date(coupon.expiresAt).toISOString().slice(0, 10)
                        : language === 'zh'
                          ? '永不过期'
                          : 'Never'}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        className={
                          coupon.active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }
                      >
                        {coupon.active ? t.seller.active : t.seller.inactive}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(coupon)}
                        >
                          <Edit className="size-4 mr-1" />
                          {t.seller.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleToggleStatus(coupon)}
                          className={coupon.active ? 'text-amber-600' : 'text-emerald-600'}
                        >
                          {coupon.active ? (
                            <ToggleRight className="size-4 mr-1" />
                          ) : (
                            <ToggleLeft className="size-4 mr-1" />
                          )}
                          {coupon.active ? t.seller.disable : t.seller.enable}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination hint */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>
              {language === 'zh' ? '共' : 'Total'} {total} {language === 'zh' ? '条' : ''}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                {language === 'zh' ? '上一页' : 'Prev'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p: number) => p + 1)}
                disabled={page * pageSize >= total}
              >
                {language === 'zh' ? '下一页' : 'Next'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.seller.editCoupon}</DialogTitle>
          </DialogHeader>
          {renderForm()}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialogOpen(false);
                setEditingCoupon(null);
              }}
            >
              {t.seller.cancel}
            </Button>
            <Button onClick={() => void handleSubmitEdit()} disabled={submitting}>
              {submitting ? t.common.loading : t.seller.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CouponsPage;
