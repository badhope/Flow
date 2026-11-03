import React, { useCallback, useEffect, useState } from 'react';
import { Edit, Plus, Trash2, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import ShippingCalculator from '@/components/ShippingCalculator';
import { SellerPageHeader } from '@/components/seller/SellerUI';
import {
  createShippingTemplate,
  deleteShippingTemplate,
  getShippingTemplates,
  updateShippingTemplate,
} from '@/api/shipping';
import { toast } from 'sonner';
import type { ShippingTemplate } from '@shared/api.interface';

/**
 * Shipping templates mirror the server model exactly:
 * `baseFee` covers the first unit, `extraFeePerUnit` covers each additional
 * unit, and `specialZones` adds a surcharge for specific countries.
 *
 * The previous version of this page edited a `rules[]` array that the API never
 * read, so every saved template silently lost its rates. This form only
 * exposes fields the service actually persists.
 */
interface TemplateForm {
  name: string;
  baseFee: string;
  extraFeePerUnit: string;
  unitType: 'quantity' | 'weight';
  freeShippingThreshold: string;
  isDefault: boolean;
  /** Raw JSON text for specialZones: [{"countries":["US"],"extraFee":"3.00"}] */
  specialZones: string;
}

const emptyForm = (): TemplateForm => ({
  name: '',
  baseFee: '5',
  extraFeePerUnit: '2',
  unitType: 'quantity',
  freeShippingThreshold: '',
  isDefault: false,
  specialZones: '',
});

function toForm(template: ShippingTemplate): TemplateForm {
  return {
    name: template.name,
    baseFee: template.baseFee ?? '0',
    extraFeePerUnit: template.extraFeePerUnit ?? '0',
    unitType: (template.unitType as 'quantity' | 'weight') ?? 'quantity',
    freeShippingThreshold: template.freeShippingThreshold ?? '',
    isDefault: Boolean(template.isDefault),
    specialZones: template.specialZones ?? '',
  };
}

/** Validate the JSON editor before hitting the API so the error is local. */
function parseZones(raw: string): { ok: true; value?: string } | { ok: false; message: string } {
  if (!raw.trim()) return { ok: true, value: undefined };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, message: '特殊地区必须是 JSON 数组' };
    for (const zone of parsed) {
      if (!Array.isArray(zone?.countries) || zone.countries.length === 0) {
        return { ok: false, message: '每项都需要非空的 countries 数组' };
      }
      if (Number.isNaN(Number(zone?.extraFee))) {
        return { ok: false, message: 'extraFee 必须是数字' };
      }
    }
    return { ok: true, value: raw };
  } catch {
    return { ok: false, message: 'JSON 格式错误' };
  }
}

const ShippingTemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<ShippingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm());

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setTemplates(await getShippingTemplates());
    } catch {
      toast.error('获取运费模板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const openCreate = (): void => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (template: ShippingTemplate): void => {
    setEditingId(template.id);
    setForm(toForm(template));
    setDialogOpen(true);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm('确认删除该运费模板？')) return;
    try {
      await deleteShippingTemplate(id);
      toast.success('删除成功');
      void fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('请输入模板名称');
      return;
    }
    const zones = parseZones(form.specialZones);
    if (!zones.ok) {
      toast.error(zones.message);
      return;
    }
    const payload = {
      name: form.name.trim(),
      baseFee: form.baseFee || '0',
      extraFeePerUnit: form.extraFeePerUnit || '0',
      unitType: form.unitType,
      freeShippingThreshold: form.freeShippingThreshold || '0',
      isDefault: form.isDefault,
      specialZones: zones.value,
    };
    try {
      if (editingId) await updateShippingTemplate(editingId, payload);
      else await createShippingTemplate(payload);
      toast.success(editingId ? '模板更新成功' : '模板创建成功');
      setDialogOpen(false);
      void fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : editingId ? '更新失败' : '创建失败');
    }
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow="Shipping"
        title="运费模板"
        description="按件数或重量计费，可设免邮门槛与特殊地区加价；结算以服务端报价为准。"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            新建模板
          </Button>
        }
      />

      <ShippingCalculator />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模板名称</TableHead>
                <TableHead>计费方式</TableHead>
                <TableHead>首件/首重</TableHead>
                <TableHead>续件/续重</TableHead>
                <TableHead>免邮门槛</TableHead>
                <TableHead>特殊地区</TableHead>
                <TableHead>默认</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    加载中...
                  </TableCell>
                </TableRow>
              )}
              {!loading && templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Truck className="size-6" />
                        </EmptyMedia>
                        <EmptyTitle>暂无运费模板</EmptyTitle>
                        <EmptyDescription>创建运费模板来管理不同地区的运费定价</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                templates.map((template) => {
                  const zoneCount = (() => {
                    if (!template.specialZones) return 0;
                    try {
                      const parsed = JSON.parse(template.specialZones);
                      return Array.isArray(parsed) ? parsed.length : 0;
                    } catch {
                      return 0;
                    }
                  })();
                  return (
                    <TableRow key={template.id}>
                      <TableCell className="font-medium text-slate-900">{template.name}</TableCell>
                      <TableCell>{template.unitType === 'weight' ? '按重量' : '按件数'}</TableCell>
                      <TableCell>${Number(template.baseFee ?? 0).toFixed(2)}</TableCell>
                      <TableCell>${Number(template.extraFeePerUnit ?? 0).toFixed(2)}</TableCell>
                      <TableCell>
                        {template.freeShippingThreshold && Number(template.freeShippingThreshold) > 0
                          ? `$${Number(template.freeShippingThreshold).toFixed(2)}`
                          : '不包邮'}
                      </TableCell>
                      <TableCell>{zoneCount > 0 ? `${zoneCount} 个` : '-'}</TableCell>
                      <TableCell>
                        {template.isDefault ? <Badge>默认</Badge> : <Badge variant="secondary">普通</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(template)}>
                            <Edit className="mr-1 h-3 w-3" />
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => void handleDelete(template.id)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑运费模板' : '新建运费模板'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="ship-name">模板名称 *</Label>
              <Input
                id="ship-name"
                placeholder="如：标准国际快递"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ship-unit">计费方式</Label>
                <Select
                  value={form.unitType}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, unitType: v as 'quantity' | 'weight' }))}
                >
                  <SelectTrigger id="ship-unit" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quantity">按件数</SelectItem>
                    <SelectItem value="weight">按重量（kg）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ship-free">免邮门槛 (USD)</Label>
                <Input
                  id="ship-free"
                  type="number"
                  placeholder="留空或 0 表示不包邮"
                  value={form.freeShippingThreshold}
                  onChange={(e) => setForm((prev) => ({ ...prev, freeShippingThreshold: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ship-base">
                  {form.unitType === 'weight' ? '首重费用 (USD)' : '首件费用 (USD)'}
                </Label>
                <Input
                  id="ship-base"
                  type="number"
                  step="0.01"
                  value={form.baseFee}
                  onChange={(e) => setForm((prev) => ({ ...prev, baseFee: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="ship-extra">
                  {form.unitType === 'weight' ? '续重每 kg 加价 (USD)' : '续件每件加价 (USD)'}
                </Label>
                <Input
                  id="ship-extra"
                  type="number"
                  step="0.01"
                  value={form.extraFeePerUnit}
                  onChange={(e) => setForm((prev) => ({ ...prev, extraFeePerUnit: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="ship-zones">特殊地区加价（JSON，可选）</Label>
              <Input
                id="ship-zones"
                placeholder='[{"countries":["US","CA"],"extraFee":"3.00"}]'
                value={form.specialZones}
                onChange={(e) => setForm((prev) => ({ ...prev, specialZones: e.target.value }))}
                className="mt-1 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                命中任一国家时在基础运费上叠加 extraFee；留空表示无特殊地区。
              </p>
            </div>

            <label className="flex min-h-6 cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
                className="size-4 accent-[var(--flow-accent)]"
              />
              <span className="text-sm text-slate-600">设为默认模板（结算时优先使用）</span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleSubmit()}>{editingId ? '保存修改' : '创建模板'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShippingTemplatesPage;
