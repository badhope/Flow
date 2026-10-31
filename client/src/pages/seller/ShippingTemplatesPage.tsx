import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, Truck } from 'lucide-react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getShippingTemplates,
  createShippingTemplate,
  updateShippingTemplate,
  deleteShippingTemplate,
} from '@/api/shipping';
import ShippingCalculator from '@/components/ShippingCalculator';
import type {
  ShippingTemplate,
  ShippingRule,
  CreateShippingTemplateRequest,
  UpdateShippingTemplateRequest,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { SellerPageHeader } from '@/components/seller/SellerUI';

const emptyRule = (): ShippingRule => ({
  countries: [],
  firstWeight: '0.5',
  firstWeightFee: '5',
  additionalWeight: '0.5',
  additionalWeightFee: '2',
});

const emptyForm = (): CreateShippingTemplateRequest => ({
  name: '',
  rules: [emptyRule()],
  defaultRule: undefined,
  freeShippingThreshold: undefined,
  status: 'active',
});

const ShippingTemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<ShippingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<CreateShippingTemplateRequest>(emptyForm());
  const [ruleInputs, setRuleInputs] = useState<string[]>(['US,UK,DE']);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getShippingTemplates();
      setTemplates(data);
    } catch {
      toast.error('加载运费模板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setRuleInputs(['US,UK,DE']);
    setDialogOpen(true);
  };

  const handleEdit = (template: ShippingTemplate) => {
    setEditingId(template.id);
    setForm({
      name: template.name,
      rules: template.rules && template.rules.length > 0 ? [...template.rules] : [emptyRule()],
      defaultRule: template.defaultRule,
      freeShippingThreshold: template.freeShippingThreshold ? Number(template.freeShippingThreshold) : undefined,
      status: template.status,
    });
    setRuleInputs(template.rules.map((r) => r.countries.join(',')));
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该运费模板？')) return;
    try {
      await deleteShippingTemplate(id);
      toast.success('删除成功');
      fetchTemplates();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleAddRule = () => {
    setForm((prev) => ({ ...prev, rules: [...prev.rules, emptyRule()] }));
    setRuleInputs((prev) => [...prev, '']);
  };

  const handleRemoveRule = (index: number) => {
    if (form.rules.length <= 1) return;
    setForm((prev) => ({ ...prev, rules: prev.rules.filter((_, i) => i !== index) }));
    setRuleInputs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRuleChange = (index: number, field: keyof ShippingRule, value: string) => {
    setForm((prev) => {
      const rules = [...prev.rules];
      rules[index] = { ...rules[index], [field]: value };
      return { ...prev, rules };
    });
  };

  const handleRuleCountriesChange = (index: number, value: string) => {
    setRuleInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    const countries = value.split(',').map((c) => c.trim()).filter(Boolean);
    handleRuleChange(index, 'countries', value);
    setForm((prev) => {
      const rules = [...prev.rules];
      rules[index] = { ...rules[index], countries };
      return { ...prev, rules };
    });
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('请输入模板名称');
      return;
    }
    try {
      if (editingId) {
        const updatePayload: UpdateShippingTemplateRequest = { ...form };
        await updateShippingTemplate(editingId, updatePayload);
        toast.success('模板更新成功');
      } else {
        await createShippingTemplate(form);
        toast.success('模板创建成功');
      }
      setDialogOpen(false);
      fetchTemplates();
    } catch {
      toast.error(editingId ? '更新失败' : '创建失败');
    }
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={'Shipping'}
        title={'运费模板'}
        description={'按地区与重量区间配置运费，结算时以服务端报价为准。'}
        actions={
          <Button size="sm" onClick={handleCreate}>
            <Plus className="mr-1 h-4 w-4" />
            新建模板
          </Button>
        }
      />

      {/* 计算器 */}
      <ShippingCalculator />

      {/* 模板列表 */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模板名称</TableHead>
                <TableHead>规则数</TableHead>
                <TableHead>免邮门槛</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              )}
              {!loading && templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><Truck className="size-6" /></EmptyMedia>
                        <EmptyTitle>暂无运费模板</EmptyTitle>
                        <EmptyDescription>创建运费模板来管理不同地区的运费定价</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium text-slate-900">{template.name}</TableCell>
                    <TableCell>{template.rules?.length || 0}</TableCell>
                    <TableCell>
                      {template.freeShippingThreshold ? `$${template.freeShippingThreshold}` : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={template.status === 'active' ? 'default' : 'secondary'}>
                        {template.status === 'active' ? '启用' : '停用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {template.createdAt ? new Date(template.createdAt).toLocaleDateString('zh-CN') : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(template)}>
                          <Edit className="mr-1 h-3 w-3" />
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(template.id)}>
                          <Trash2 className="mr-1 h-3 w-3" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 创建/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑运费模板' : '新建运费模板'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>模板名称 *</Label>
              <Input
                placeholder="如：标准国际快递"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1"
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>免邮门槛 (USD)</Label>
                <Input
                  type="number"
                  placeholder="留空则不启用免邮"
                  value={form.freeShippingThreshold || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({ ...prev, freeShippingThreshold: val ? Number(val) : undefined }));
                  }}
                  className="mt-1"
                />
              </div>
              <div className="flex-1">
                <Label>状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm((prev) => ({ ...prev, status: v as 'active' | 'inactive' }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="inactive">停用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 运费规则 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="mb-0">运费规则</Label>
                <Button type="button" size="sm" variant="outline" onClick={handleAddRule}>
                  <Plus className="mr-1 h-3 w-3" />
                  添加规则
                </Button>
              </div>
              <div className="space-y-3">
                {form.rules.map((rule, index) => (
                  <div key={index} className="rounded-lg border p-3 space-y-3 bg-slate-50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">规则 {index + 1}</span>
                      {form.rules.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-500 h-6 p-1"
                          onClick={() => handleRemoveRule(index)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">适用国家（逗号分隔）</Label>
                      <Input
                        placeholder="如: US,UK,CA,AU"
                        value={ruleInputs[index] || ''}
                        onChange={(e) => handleRuleCountriesChange(index, e.target.value)}
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">首重 (kg)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={rule.firstWeight}
                          onChange={(e) => handleRuleChange(index, 'firstWeight', e.target.value)}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">首重费用 (USD)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={rule.firstWeightFee}
                          onChange={(e) => handleRuleChange(index, 'firstWeightFee', e.target.value)}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">续重 (kg)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={rule.additionalWeight}
                          onChange={(e) => handleRuleChange(index, 'additionalWeight', e.target.value)}
                          className="mt-1 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">续重费用 (USD)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={rule.additionalWeightFee}
                          onChange={(e) => handleRuleChange(index, 'additionalWeightFee', e.target.value)}
                          className="mt-1 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingId ? '保存修改' : '创建模板'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShippingTemplatesPage;
