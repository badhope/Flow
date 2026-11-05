import React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Languages, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { Category, Product } from '@shared/api.interface';
import type { ProductFormValues } from './schema';

export interface PublishReadiness {
  ready: boolean;
  blockingCount: number;
  checks: Array<{ key: string; label: string; ok: boolean; hint?: string }>;
}

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<ProductFormValues>;
  categories: Category[];
  editingProduct: Product | null;
  readiness: PublishReadiness | null;
  onSubmit: (values: ProductFormValues) => void | Promise<void>;
  onTranslateTitle: () => void | Promise<void>;
  onOpenCopywriter: () => void;
}

/** Create/edit dialog. Validation lives in `schema.ts`; this file is presentation only. */
const ProductFormDialog: React.FC<ProductFormDialogProps> = ({
  open,
  onOpenChange,
  form,
  categories,
  editingProduct,
  readiness,
  onSubmit,
  onTranslateTitle,
  onOpenCopywriter,
}) => {
  const multiVariant = Boolean(editingProduct && editingProduct.variants.length > 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingProduct ? '编辑商品' : '新增商品'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>分类</FormLabel>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择分类" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.nameZh}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="titleZh"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>中文标题</FormLabel>
                    <FormControl>
                      <Input placeholder="商品中文标题" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="titleEn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <span>英文标题</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void onTranslateTitle()}
                        className="h-auto p-0 text-indigo-600"
                      >
                        <Languages className="mr-1 h-3 w-3" />
                        翻译
                      </Button>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Product English Title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {multiVariant && editingProduct && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                该商品有 {editingProduct.variants.length} 个规格：价格与库存请在规格中单独维护，此处的修改不会生效。
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>售价 ($)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} disabled={multiVariant} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="originalPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>原价 ($)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} disabled={multiVariant} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>库存</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} disabled={multiVariant} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>状态</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择状态" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="draft">草稿</SelectItem>
                        <SelectItem value="active">上架</SelectItem>
                        <SelectItem value="inactive">下架</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="coverImage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>封面图URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="descZh"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>中文描述</FormLabel>
                  <FormControl>
                    <Textarea placeholder="中文短描述" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descEn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>英文描述</FormLabel>
                  <FormControl>
                    <Textarea placeholder="English Short Description" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="longDescZh"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center justify-between">
                    <span>长描述（中文）</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onOpenCopywriter}
                      className="h-auto p-0 text-violet-600"
                    >
                      <Sparkles className="mr-1 h-3 w-3" />
                      AI 文案生成
                    </Button>
                  </FormLabel>
                  <FormControl>
                    <Textarea placeholder="详细中文描述" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="longDescEn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>长描述（英文）</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Detailed English Description" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 跨境清关：报关单的数据来源。缺 HS 编码时生成的报关单无法申报 */}
            <div className="rounded-lg border border-dashed p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                跨境清关信息
                <span className="ml-1.5 font-normal opacity-70">
                  （生成报关单需要，缺失会导致无法申报）
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="hsCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>HS 编码</FormLabel>
                      <FormControl>
                        <Input placeholder="如 392410（6–10 位数字）" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="originCountry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>原产国</FormLabel>
                      <FormControl>
                        <Input placeholder="两位代码，如 CN" maxLength={2} {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customsNameEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>报关品名（英文）</FormLabel>
                      <FormControl>
                        <Input placeholder="Plastic food container" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customsMaterialEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>材质（英文）</FormLabel>
                      <FormControl>
                        <Input placeholder="PP plastic" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {readiness && editingProduct && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  readiness.ready
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="mb-1 font-medium">
                  {readiness.ready
                    ? '上架检查：全部通过，可直接上架'
                    : `上架检查：${readiness.blockingCount} 项待补齐`}
                </div>
                <ul className="space-y-0.5">
                  {readiness.checks.map((check) => (
                    <li key={check.key} className="flex items-start gap-1.5">
                      <span className="mt-[1px]">{check.ok ? '✓' : '✗'}</span>
                      <span className={check.ok ? 'opacity-70' : ''}>
                        {check.label}
                        {!check.ok && check.hint ? `（${check.hint}）` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default ProductFormDialog;
