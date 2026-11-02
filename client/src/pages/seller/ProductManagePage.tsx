import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { SellerPageHeader } from '@/components/seller/SellerUI';
import { aiApi, productsApi } from '@/api';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';
import type { AICopywriterResponse, Product } from '@shared/api.interface';
import ProductTable from './product-manage/ProductTable';
import ProductFormDialog from './product-manage/ProductFormDialog';
import ImportDialog from './product-manage/ImportDialog';
import CopywriterDialog from './product-manage/CopywriterDialog';
import { useProductCatalog } from './product-manage/useProductCatalog';
import {
  EMPTY_COPYWRITER_FORM,
  EMPTY_PRODUCT_FORM,
  PAGE_SIZE,
  copywriterSchema,
  productSchema,
  toProductForm,
  type CopywriterFormValues,
  type ProductFormValues,
} from './product-manage/schema';

const ProductManagePage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh';
  const catalog = useProductCatalog();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copywriterOpen, setCopywriterOpen] = useState(false);
  const [copywriterResult, setCopywriterResult] = useState<AICopywriterResponse | null>(null);
  const [copywriterLoading, setCopywriterLoading] = useState(false);

  const productForm = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: EMPTY_PRODUCT_FORM,
  });

  const copywriterForm = useForm<CopywriterFormValues>({
    resolver: zodResolver(copywriterSchema),
    defaultValues: EMPTY_COPYWRITER_FORM,
  });

  const openCreate = (): void => {
    setEditingProduct(null);
    catalog.setReadiness(null);
    productForm.reset(EMPTY_PRODUCT_FORM);
    setDialogOpen(true);
  };

  const openEdit = (product: Product): void => {
    void catalog.loadReadiness(product.id);
    setEditingProduct(product);
    productForm.reset(toProductForm(product));
    setDialogOpen(true);
  };

  const submitProduct = async (values: ProductFormValues): Promise<void> => {
    try {
      if (editingProduct) await catalog.updateProduct(editingProduct.id, values);
      else await catalog.createProduct(values);
      setDialogOpen(false);
    } catch {
      // notifyError already surfaced the server message.
    }
  };

  const translateTitle = async (): Promise<void> => {
    const titleZh = productForm.getValues('titleZh');
    if (!titleZh) {
      toast('请先填写中文标题');
      return;
    }
    try {
      const result = await aiApi.translateText({ text: titleZh, sourceLang: 'zh', targetLang: 'en' });
      productForm.setValue('titleEn', result.translatedText);
    } catch (err) {
      notifyError(err, '翻译失败');
    }
  };

  const openCopywriter = (): void => {
    copywriterForm.setValue('productNameZh', productForm.getValues('titleZh'));
    copywriterForm.setValue(
      'category',
      catalog.categories.find((c) => c.id === productForm.getValues('categoryId'))?.nameZh ?? '',
    );
    setCopywriterResult(null);
    setCopywriterOpen(true);
  };

  const generateCopy = async (values: CopywriterFormValues): Promise<void> => {
    try {
      setCopywriterLoading(true);
      setCopywriterResult(await aiApi.generateCopywriter(values));
    } catch (err) {
      notifyError(err, 'AI 文案生成失败，请检查配置');
    } finally {
      setCopywriterLoading(false);
    }
  };

  const applyCopy = (): void => {
    if (!copywriterResult) return;
    productForm.setValue('titleEn', copywriterResult.titleEn);
    productForm.setValue('longDescEn', copywriterResult.longDescription);
    setCopywriterOpen(false);
    setCopywriterResult(null);
  };

  const closeImport = (): void => {
    setImportOpen(false);
    catalog.setImportResult(null);
    catalog.setImportLoading(false);
  };

  const totalPages = Math.ceil(catalog.total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={zh ? '商品' : 'Catalog'}
        title={zh ? '商品管理' : 'Products'}
        description={
          zh
            ? 'SPU + 多规格 SKU、批量上下架、CSV 导入导出；上架前自动跑 6 项完整性门禁。'
            : 'SPU with multi-SKU variants, bulk status, CSV import/export, and a 6-point publish gate.'
        }
        actions={<span className="flow-caption">{zh ? `共 ${catalog.total} 个商品` : `${catalog.total} products`}</span>}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] p-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索商品名称/SKU"
            value={catalog.keyword}
            onChange={(e) => catalog.setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && catalog.search()}
            className="pl-9"
          />
        </div>

        <Select
          value={catalog.categoryFilter}
          onValueChange={(value) => {
            catalog.setCategoryFilter(value);
            catalog.setPage(1);
            void catalog.fetchProducts({ page: 1, categoryId: value || undefined });
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部分类</SelectItem>
            {catalog.categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.nameZh}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={catalog.search} variant="secondary">
          搜索
        </Button>

        <div className="ml-auto flex gap-2">
          <Button onClick={() => void catalog.exportCsv()} variant="outline" size="sm">
            <Download className="mr-1 h-4 w-4" />
            导出 CSV
          </Button>
          <Button onClick={() => setImportOpen(true)} variant="outline" size="sm">
            <Upload className="mr-1 h-4 w-4" />
            批量导入
          </Button>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4" />
            新增商品
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]">
        {catalog.selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-blue-50/60 px-4 py-2 text-sm">
            <span className="text-slate-700">已选 {catalog.selectedIds.size} 个商品</span>
            <Button size="sm" variant="outline" disabled={catalog.bulkBusy} onClick={() => void catalog.bulkSetStatus('active')}>
              批量上架
            </Button>
            <Button size="sm" variant="outline" disabled={catalog.bulkBusy} onClick={() => void catalog.bulkSetStatus('inactive')}>
              批量下架
            </Button>
            <Button size="sm" variant="ghost" onClick={() => catalog.setSelectedIds(new Set())}>
              取消选择
            </Button>
          </div>
        )}

        <ProductTable
          products={catalog.products}
          loading={catalog.loading}
          selectedIds={catalog.selectedIds}
          onToggleSelect={catalog.toggleSelect}
          onToggleSelectAll={catalog.toggleSelectAll}
          onEdit={openEdit}
          onDelete={(id) => void catalog.deleteProduct(id)}
          onToggleStatus={(product, active) => void catalog.setProductStatus(product, active)}
        />

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <div className="text-sm text-muted-foreground">
              共 {catalog.total} 条，第 {catalog.page}/{totalPages} 页
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={catalog.page <= 1}
                onClick={() => catalog.setPage(Math.max(1, catalog.page - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={catalog.page >= totalPages}
                onClick={() => catalog.setPage(Math.min(totalPages, catalog.page + 1))}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </div>

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={productForm}
        categories={catalog.categories}
        editingProduct={editingProduct}
        readiness={catalog.readiness}
        onSubmit={submitProduct}
        onTranslateTitle={translateTitle}
        onOpenCopywriter={openCopywriter}
      />

      <ImportDialog
        open={importOpen}
        loading={catalog.importLoading}
        result={catalog.importResult}
        dragOver={dragOver}
        onDragOver={setDragOver}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void catalog.importCsv(file);
        }}
        onSelect={(e) => {
          const file = e.target.files?.[0];
          if (file) void catalog.importCsv(file);
          e.target.value = '';
        }}
        onDownloadTemplate={() => window.open(productsApi.downloadImportTemplate(), '_blank')}
        onClose={closeImport}
      />

      <CopywriterDialog
        open={copywriterOpen}
        onOpenChange={setCopywriterOpen}
        form={copywriterForm}
        result={copywriterResult}
        loading={copywriterLoading}
        onSubmit={generateCopy}
        onApply={applyCopy}
      />
    </div>
  );
};

export default ProductManagePage;
