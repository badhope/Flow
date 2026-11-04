import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, MapPin, Star, Home, Building } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '@/api/addresses';
import type {
  Address,
  CreateAddressRequest,
  UpdateAddressRequest,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { notifyError } from '@/lib/error-feedback';

const AddressesPage: React.FC = () => {
  const { t } = useLanguage();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const emptyForm: CreateAddressRequest = {
    label: '',
    receiverName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
    isDefault: false,
  };

  const [form, setForm] = useState<CreateAddressRequest>(emptyForm);

  const fetchAddresses = useCallback(async () => {
    try {
      setLoading(true);
      setLoadFailed(false);
      const items = await getAddresses();
      setAddresses(items);
    } catch (err) {
      setLoadFailed(true);
      notifyError(err, t.address.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.address.loadFailed]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const handleEdit = (address: Address) => {
    setEditingId(address.id);
    setForm({
      label: address.label,
      receiverName: address.receiverName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
      country: address.country,
      isDefault: address.isDefault,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.address.deleteConfirm)) return;
    try {
      await deleteAddress(id);
      toast.success(t.address.deleted);
      fetchAddresses();
    } catch {
      toast.error(t.address.deleteFailed);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultAddress(id);
      toast.success(t.address.defaultSet);
      fetchAddresses();
    } catch {
      toast.error(t.address.setDefaultFailed);
    }
  };

  const handleSubmit = async () => {
    if (!form.receiverName.trim()) {
      toast.error(t.address.needReceiver);
      return;
    }
    if (!form.phone.trim()) {
      toast.error(t.address.needPhone);
      return;
    }
    if (!form.addressLine1.trim()) {
      toast.error(t.address.needDetail);
      return;
    }
    if (!form.city.trim()) {
      toast.error(t.address.needCity);
      return;
    }
    if (!form.country.trim()) {
      toast.error(t.address.needCountry);
      return;
    }

    try {
      if (editingId) {
        const updatePayload: UpdateAddressRequest = { ...form };
        delete updatePayload.isDefault;
        await updateAddress(editingId, updatePayload);
        toast.success(t.address.updated);
      } else {
        await createAddress(form);
        toast.success(t.address.created);
      }
      setDialogOpen(false);
      fetchAddresses();
    } catch {
      toast.error(editingId ? t.address.updateFailed : t.address.createFailed);
    }
  };

  const getLabelIcon = (label?: string) => {
    const l = label?.toLowerCase() || '';
    const homeWords = ['home', 'casa', '家', '住宅'];
    const officeWords = ['office', 'oficina', 'escritório', '公司', '办公'];
    if (homeWords.some((w) => l.includes(w))) return <Home className="h-4 w-4" />;
    if (officeWords.some((w) => l.includes(w))) return <Building className="h-4 w-4" />;
    return <MapPin className="h-4 w-4" />;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Card className="rounded-xl bg-white p-8 text-center">
          <p className="mb-4 text-slate-600">{t.address.loadFailed}</p>
          <Button onClick={() => void fetchAddresses()}>{t.common.submit}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flow-store">
      <div className="container mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <MapPin className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">{t.address.title}</h1>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="mr-1 h-4 w-4" />
            {t.address.add}
          </Button>
        </div>

        {addresses.length === 0 ? (
          <Card className="rounded-xl bg-white">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><MapPin className="size-6" /></EmptyMedia>
                <EmptyTitle>{t.address.empty}</EmptyTitle>
                <EmptyDescription>{t.address.emptyHint}</EmptyDescription>
              </EmptyHeader>
              <div className="mt-4">
                <Button onClick={handleCreate}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t.address.add}
                </Button>
              </div>
            </Empty>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {addresses.map((address) => (
              <Card
                key={address.id}
                className={`rounded-xl bg-white transition-all hover:shadow-md ${
                  address.isDefault ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {getLabelIcon(address.label)}
                      <span className="text-sm font-medium text-slate-700">
                        {address.label || t.address.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {address.isDefault && (
                        <Badge variant="default" className="text-xs">{t.address.default}</Badge>
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{address.receiverName}</span>
                      <span className="text-slate-400">{address.phone}</span>
                    </div>
                    <div className="text-slate-600">
                      {address.addressLine1}
                      {address.addressLine2 && <span>，{address.addressLine2}</span>}
                    </div>
                    <div className="text-slate-500 text-xs">
                      {[address.city, address.state, address.zipCode, address.country]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-blue-600 hover:text-blue-800"
                        onClick={() => handleEdit(address)}
                      >
                        <Edit className="mr-1 h-3 w-3" />
                        {t.address.edit}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(address.id)}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        {t.address.delete}
                      </Button>
                    </div>
                    {!address.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(address.id)}
                      >
                        <Star className="mr-1 h-3 w-3" />
                        {t.address.setDefault}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Add new card */}
            <Card className="rounded-xl bg-white border-2 border-dashed border-slate-200 hover:border-blue-300 transition-colors cursor-pointer flex items-center justify-center min-h-[180px]"
              onClick={handleCreate}
            >
              <CardContent className="text-center py-6">
                <Plus className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <div className="text-sm text-slate-400">{t.address.addNew}</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t.address.edit : t.address.add}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t.address.label}</Label>
              <div className="flex gap-2 mt-1">
                {[t.address.labelHome, t.address.labelOffice, t.address.labelOther].map((label) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={form.label === label ? 'default' : 'outline'}
                    onClick={() => setForm((prev) => ({ ...prev, label }))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t.address.receiver}</Label>
                <Input
                  placeholder={t.address.receiverPlaceholder}
                  value={form.receiverName}
                  onChange={(e) => setForm((prev) => ({ ...prev, receiverName: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>{t.address.phone}</Label>
                <Input
                  placeholder={t.address.phonePlaceholder}
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>{t.address.detail}</Label>
              <Input
                placeholder={t.address.detailPlaceholder}
                value={form.addressLine1}
                onChange={(e) => setForm((prev) => ({ ...prev, addressLine1: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div>
              <Label>{t.address.detail2}</Label>
              <Input
                placeholder={t.address.detail2Placeholder}
                value={form.addressLine2 || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, addressLine2: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t.address.city}</Label>
                <Input
                  placeholder={t.address.cityPlaceholder}
                  value={form.city}
                  onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>{t.address.state}</Label>
                <Input
                  placeholder={t.address.statePlaceholder}
                  value={form.state || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t.address.zip}</Label>
                <Input
                  placeholder={t.address.zipPlaceholder}
                  value={form.zipCode || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, zipCode: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>{t.address.country}</Label>
                <Input
                  placeholder={t.address.countryPlaceholder}
                  value={form.country}
                  onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            {!editingId && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="set-default"
                  checked={form.isDefault || false}
                  onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <Label htmlFor="set-default" className="mb-0 cursor-pointer">{t.address.setAsDefault}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleSubmit}>{editingId ? t.common.save : t.address.create}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AddressesPage;
