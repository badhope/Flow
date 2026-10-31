import React, { useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  Languages,
  Upload,
  FileText,
  CheckCircle,
  XCircle,
  Download,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Image as ImageComponent } from '@/components/ui/image';
import { useLanguage } from '@/contexts/LanguageContext';
import { SellerPageHeader } from '@/components/seller/SellerUI';
import { productsApi, categoriesApi, aiApi } from '@/api';
import type {
  Product,
  Category,
  ProductListParams,
  AICopywriterResponse,
  ImportProductsResponse,
  ImportFailure,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

const productSchema = z.object({
  titleZh: z.string().min(1, '中文标题必填'),
  titleEn: z.string().min(1, '英文标题必填'),
  categoryId: z.string().optional(),
  price: z.string().refine((v) => !isNaN(Number(v)) && Number(v) >= 0, {
    message: '价格必须大于等于0',
  }),
  originalPrice: z.string().optional(),
  stock: z.string().refine((v) => !isNaN(Number(v)) && Number(v) >= 0, {
    message: '库存必须大于等于0',
  }),
  status: z.enum(['draft', 'active', 'inactive']),
  coverImage: z
    .string()
    .max(500, { message: '图片 URL 不能超过 500 字符' })
    .refine(
      (v) => {
        if (!v) return true;
        return v.startsWith('http://') || v.startsWith('https://');
      },
      { message: '图片 URL 必须以 http:// 或 https:// 开头' },
    )
    .optional(),
  descZh: z.string().optional(),
  descEn: z.string().optional(),
  longDescZh: z.string().optional(),
  longDescEn: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

const copywriterSchema = z.object({
  productNameZh: z.string().min(1, '商品名称必填'),
  specs: z.string().optional(),
  category: z.string().optional(),
  targetMarket: z.string().optional(),
});

type CopywriterFormValues = z.infer<typeof copywriterSchema>;

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  active: { label: '上架中', variant: 'default' },
  draft: { label: '草稿', variant: 'secondary' },
  inactive: { label: '已下架', variant: 'destructive' },
};

const PAGE_SIZE = 10;

const ProductManagePage: React.FC = () => {
  const { language } = useLanguage();
  const zh = language === 'zh';
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [keyword, setKeyword] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [copywriterOpen, setCopywriterOpen] = useState<boolean>(false);
  const [copywriterResult, setCopywriterResult] =
    useState<AICopywriterResponse | null>(null);
  const [copywriterLoading, setCopywriterLoading] = useState<boolean>(false);

  // 批量选择（上下架）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    setSelectedIds((prev) =>
      prev.size === products.length ? new Set() : new Set(products.map((p) => p.id)),
    );
  };

  const handleBulkStatus = async (status: 'active' | 'inactive'): Promise<void> => {
    if (selectedIds.size === 0) return;
    try {
      setBulkBusy(true);
      const result = await productsApi.bulkUpdateProductStatus([...selectedIds], status);
      if (result.failed.length > 0) {
        toast(`成功 ${result.updated} 个，失败 ${result.failed.length} 个：${result.failed[0].reason}`);
      } else {
        toast.success(`已${status === 'active' ? '上架' : '下架'} ${result.updated} 个商品`);
      }
      setSelectedIds(new Set());
      fetchProducts();
    } catch (err) {
      notifyError(err, '批量操作失败');
    } finally {
      setBulkBusy(false);
    }
  };

  // CSV 批量导入
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [importResult, setImportResult] =
    useState<ImportProductsResponse | null>(null);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const productForm = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      titleZh: '',
      titleEn: '',
      categoryId: '',
      price: '0',
      originalPrice: '',
      stock: '0',
      status: 'draft',
      coverImage: '',
      descZh: '',
      descEn: '',
      longDescZh: '',
      longDescEn: '',
    },
  });

  const copywriterForm = useForm<CopywriterFormValues>({
    resolver: zodResolver(copywriterSchema),
    defaultValues: {
      productNameZh: '',
      specs: '',
      category: '',
      targetMarket: 'US',
    },
  });

  const fetchProducts = useCallback(
    async (params: ProductListParams = {}) => {
      try {
        setLoading(true);
        const result = await productsApi.listProducts({
          page,
          pageSize: PAGE_SIZE,
          keyword: keyword || undefined,
          categoryId: categoryFilter || undefined,
          scope: 'mine',
          ...params,
        });
        setProducts(result.items);
        setTotal(result.total);
      } catch (err) {
        notifyError(err, '获取商品列表失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [page, keyword, categoryFilter]
  );

  const fetchCategories = useCallback(async () => {
    try {
      const result = await categoriesApi.listCategories();
      setCategories(result);
    } catch (err) {
      notifyError(err, '获取分类失败');
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSearch = () => {
    setPage(1);
    fetchProducts({ page: 1 });
  };

  const handleExport = async (): Promise<void> => {
    try {
      const blob = await productsApi.exportProductsCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('已导出商品 CSV');
    } catch (err) {
      notifyError(err, '导出失败，请重试');
    }
  };

  const handleAdd = () => {
    setEditingProduct(null);
    productForm.reset({
      titleZh: '',
      titleEn: '',
      categoryId: '',
      price: '0',
      originalPrice: '',
      stock: '0',
      status: 'draft',
      coverImage: '',
      descZh: '',
      descEn: '',
      longDescZh: '',
      longDescEn: '',
    });
    setDialogOpen(true);
  };

  const handleEdit = (product: Product) => {
    void loadReadiness(product.id);
    setEditingProduct(product);
    const firstVariant = product.variants[0];
    productForm.reset({
      titleZh: product.titleZh,
      titleEn: product.titleEn,
      categoryId: product.categoryId ?? '',
      price: firstVariant ? firstVariant.price : (product.minPrice ?? '0'),
      originalPrice: firstVariant?.originalPrice ?? '',
      stock: String(product.totalStock),
      status: product.status,
      coverImage: product.coverImage ?? '',
      descZh: product.descZh ?? '',
      descEn: product.descEn ?? '',
      longDescZh: product.longDescZh ?? '',
      longDescEn: product.longDescEn ?? '',
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定要删除该商品吗？')) return;
    try {
      await productsApi.deleteProduct(id);
      fetchProducts();
    } catch (err) {
      notifyError(err, '删除商品失败，请重试');
    }
  };

  const handleToggleStatus = async (
    product: Product,
    checked: boolean
  ) => {
    try {
      const newStatus = checked ? 'active' : 'inactive';
      await productsApi.updateProductStatus(product.id, newStatus);
      fetchProducts();
    } catch (err) {
      // 上架门禁失败时把后端给出的缺失项直接展示，避免"点了没反应"
      notifyError(err, '更新商品状态失败，请检查商品信息是否完整');
    }
  };

  /** 编辑态商品的上架就绪检查（仅展示，不阻断保存） */
  const [readiness, setReadiness] = useState<{
    ready: boolean;
    blockingCount: number;
    checks: Array<{ key: string; label: string; ok: boolean; hint?: string }>;
  } | null>(null);

  const loadReadiness = async (productId: string): Promise<void> => {
    try {
      const res = await fetch(`/api/products/${productId}/publish-readiness`, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return;
      setReadiness(await res.json());
    } catch {
      setReadiness(null);
    }
  };

  const handleSubmit = async (values: ProductFormValues) => {
    try {
      const payload: {
        titleZh: string;
        titleEn: string;
        categoryId?: string;
        price: number;
        originalPrice?: number;
        stock: number;
        status: 'draft' | 'active' | 'inactive';
        coverImage?: string;
        descZh?: string;
        descEn?: string;
        longDescZh?: string;
        longDescEn?: string;
      } = {
        titleZh: values.titleZh,
        titleEn: values.titleEn,
        categoryId: values.categoryId || undefined,
        price: Number(values.price),
        originalPrice: values.originalPrice
          ? Number(values.originalPrice)
          : undefined,
        stock: Number(values.stock),
        status: values.status,
        coverImage: values.coverImage || undefined,
        descZh: values.descZh,
        descEn: values.descEn,
        longDescZh: values.longDescZh,
        longDescEn: values.longDescEn,
      };

      if (editingProduct) {
        await productsApi.updateProduct(editingProduct.id, payload);
      } else {
        await productsApi.createProduct(payload);
      }
      setDialogOpen(false);
      fetchProducts();
    } catch (err) {
      console.error('保存商品失败', err);
      toast('保存失败');
    }
  };

  const handleCopywriter = async (values: CopywriterFormValues) => {
    try {
      setCopywriterLoading(true);
      const result = await aiApi.generateCopywriter(values);
      setCopywriterResult(result);
    } catch (err) {
      console.error('AI 文案生成失败', err);
      toast('AI 文案生成失败，请检查配置');
    } finally {
      setCopywriterLoading(false);
    }
  };

  const applyCopywriterResult = () => {
    if (!copywriterResult) return;
    productForm.setValue('titleEn', copywriterResult.titleEn);
    productForm.setValue('longDescEn', copywriterResult.longDescription);
    setCopywriterOpen(false);
    setCopywriterResult(null);
  };

  const handleTranslateTitle = async () => {
    const titleZh = productForm.getValues('titleZh');
    if (!titleZh) {
      toast('请先填写中文标题');
      return;
    }
    try {
      const result = await aiApi.translateText({
        text: titleZh,
        sourceLang: 'zh',
        targetLang: 'en',
      });
      productForm.setValue('titleEn', result.translatedText);
    } catch (err) {
      console.error('翻译失败', err);
      toast('翻译失败');
    }
  };

  const handleImportFile = async (file: File): Promise<void> => {
    const MAX_CSV_SIZE = 10 * 1024 * 1024;
    const ALLOWED_CSV_TYPES = new Set([
      'text/csv',
      'application/csv',
      'text/comma-separated-values',
      'application/vnd.ms-excel',
    ]);

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.csv')) {
      toast.error('请上传 CSV 格式文件');
      return;
    }
    if (!ALLOWED_CSV_TYPES.has(file.type) && !lowerName.endsWith('.csv')) {
      toast.error('文件类型不支持，请上传 CSV 文件');
      return;
    }
    if (file.size > MAX_CSV_SIZE) {
      toast.error('文件大小不能超过 10MB');
      return;
    }
    if (file.size === 0) {
      toast.error('文件不能为空');
      return;
    }
    try {
      setImportLoading(true);
      setImportResult(null);
      const result = await productsApi.importProducts(file);
      setImportResult(result);
      if (result.failCount === 0) {
        toast.success(`导入完成：成功 ${result.successCount} 条`);
      } else {
        toast(
          `导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`,
        );
      }
      fetchProducts();
    } catch (err) {
      console.error('CSV 导入失败', err);
      toast.error('导入失败，请检查文件格式');
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleImportFile(file);
  };

  const handleImportSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void handleImportFile(file);
    e.target.value = '';
  };

  const handleDownloadTemplate = (): void => {
    const url = productsApi.downloadImportTemplate();
    window.open(url, '_blank');
  };

  const closeImportDialog = (): void => {
    setImportOpen(false);
    setImportResult(null);
    setImportLoading(false);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

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
        actions={
          <span className="flow-caption">
            {zh ? `共 ${total} 个商品` : `${total} products`}
          </span>
        }
      />

      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] p-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索商品名称/SKU"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>

          <Select
            value={categoryFilter}
            onValueChange={(value) => {
              setCategoryFilter(value);
              setPage(1);
              fetchProducts({ page: 1, categoryId: value || undefined });
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部分类</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.nameZh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleSearch} variant="secondary">
            搜索
          </Button>

           <div className="ml-auto flex gap-2">
             <Button onClick={() => void handleExport()} variant="outline" size="sm">
               <Download className="h-4 w-4 mr-1" />
               导出 CSV
             </Button>
             <Button onClick={() => setImportOpen(true)} variant="outline" size="sm">
               <Upload className="h-4 w-4 mr-1" />
               批量导入
             </Button>
             <Button onClick={handleAdd} size="sm">
               <Plus className="h-4 w-4" />
               新增商品
             </Button>
           </div>
      </div>

      {/* 商品列表 */}
      <div className="overflow-hidden rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]">
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-blue-50/60 px-4 py-2 text-sm">
            <span className="text-slate-700">已选 {selectedIds.size} 个商品</span>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void handleBulkStatus('active')}>
              批量上架
            </Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void handleBulkStatus('inactive')}>
              批量下架
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              取消选择
            </Button>
          </div>
        )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="全选商品"
                    checked={products.length > 0 && selectedIds.size === products.length}
                    onChange={toggleSelectAll}
                    className="size-4 accent-blue-600"
                  />
                </TableHead>
                <TableHead>图片</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>分类</TableHead>
                <TableHead>价格</TableHead>
                <TableHead>库存</TableHead>
                <TableHead>销量</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    加载中...
                  </TableCell>
                </TableRow>
              )}
              {!loading && products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    暂无商品
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                products.map((product) => (
                  <TableRow key={product.id} data-state={selectedIds.has(product.id) ? 'selected' : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${product.titleZh}`}
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                        className="size-4 accent-blue-600"
                      />
                    </TableCell>
                    <TableCell>
                      {product.coverImage && (
                        <div className="h-10 w-10 overflow-hidden rounded-md">
                          <ImageComponent
                            src={product.coverImage}
                            alt={product.titleZh}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {product.variants[0]?.sku || '-'}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate font-medium">
                      {product.titleZh}
                    </TableCell>
                    <TableCell>{product.categoryNameZh || '-'}</TableCell>
                    <TableCell className="font-semibold">
                      ${Number(product.minPrice ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell>{product.totalStock}</TableCell>
                    <TableCell>{product.totalSold}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          STATUS_MAP[product.status]
                            ?.variant as 'default' | 'secondary' | 'destructive'
                        }
                      >
                        {STATUS_MAP[product.status]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Switch
                          checked={product.status === 'active'}
                          onCheckedChange={(checked) =>
                            handleToggleStatus(product, checked)
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(product.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <div className="text-sm text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
      </div>

      {/* 新增/编辑商品弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? '编辑商品' : '新增商品'}
            </DialogTitle>
          </DialogHeader>

          <Form {...productForm}>
            <form
              onSubmit={productForm.handleSubmit(handleSubmit)}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={productForm.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>分类</FormLabel>
                      <Select
                        value={field.value || ''}
                        onValueChange={field.onChange}
                      >
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
                  control={productForm.control}
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
                  control={productForm.control}
                  name="titleEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center justify-between">
                        <span>英文标题</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleTranslateTitle}
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

              {editingProduct && editingProduct.variants.length > 1 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  该商品有 {editingProduct.variants.length} 个规格：价格与库存请在规格中单独维护，此处的修改不会生效。
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField
                  control={productForm.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>售价 ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          disabled={Boolean(editingProduct && editingProduct.variants.length > 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={productForm.control}
                  name="originalPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>原价 ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          disabled={Boolean(editingProduct && editingProduct.variants.length > 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={productForm.control}
                  name="stock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>库存</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          disabled={Boolean(editingProduct && editingProduct.variants.length > 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={productForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>状态</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
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
                  control={productForm.control}
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
                control={productForm.control}
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
                control={productForm.control}
                name="descEn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>英文描述</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="English Short Description"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={productForm.control}
                name="longDescZh"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <span>长描述（中文）</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          copywriterForm.setValue(
                            'productNameZh',
                            productForm.getValues('titleZh')
                          );
                          copywriterForm.setValue(
                            'category',
                            categories.find(
                              (c: Category) =>
                                c.id === productForm.getValues('categoryId')
                            )?.nameZh || ''
                          );
                          setCopywriterOpen(true);
                        }}
                        className="h-auto p-0 text-violet-600"
                      >
                        <Sparkles className="mr-1 h-3 w-3" />
                        AI 文案生成
                      </Button>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="详细中文描述"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={productForm.control}
                name="longDescEn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>长描述（英文）</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Detailed English Description"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {readiness && editingProduct && (
                <div className={`rounded-lg border p-3 text-xs ${readiness.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  <div className="mb-1 font-medium">
                    {readiness.ready ? '上架检查：全部通过，可直接上架' : `上架检查：${readiness.blockingCount} 项待补齐`}
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 批量导入弹窗 */}
      <Dialog open={importOpen} onOpenChange={closeImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              批量导入商品
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 上传区域 */}
            {!importResult && (
              <>
                <div
                  onDragOver={(e: React.DragEvent) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleImportDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleImportSelect}
                  />
                  {importLoading ? (
                    <div className="space-y-3">
                      <div className="flex justify-center">
                        <div className="size-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                      <div className="text-sm text-slate-600">
                        正在导入...
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <FileText className="size-12 mx-auto text-slate-400" />
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          拖拽 CSV 文件到此处
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          或点击选择文件
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                  >
                    <Download className="size-4" />
                    下载模板
                  </button>
                </div>
              </>
            )}

            {/* 导入结果 */}
            {importResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <CheckCircle className="size-6 mx-auto text-emerald-600 mb-1" />
                    <div className="text-2xl font-bold text-emerald-700">
                      {importResult.successCount}
                    </div>
                    <div className="text-xs text-emerald-600">成功</div>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
                    <XCircle className="size-6 mx-auto text-red-600 mb-1" />
                    <div className="text-2xl font-bold text-red-700">
                      {importResult.failCount}
                    </div>
                    <div className="text-xs text-red-600">失败</div>
                  </div>
                </div>

                {importResult.failures.length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-slate-900 mb-2">
                      失败详情
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-lg border bg-slate-50">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-100">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 w-20">
                              行号
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                              原因
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {importResult.failures.map(
                            (f: ImportFailure, idx: number) => (
                              <tr key={idx} className="border-t border-slate-200">
                                <td className="px-3 py-2 text-slate-600 font-mono">
                                  {f.row}
                                </td>
                                <td className="px-3 py-2 text-slate-700">
                                  {f.reason}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            {importResult ? (
              <Button onClick={closeImportDialog}>完成</Button>
            ) : (
              <Button variant="outline" onClick={closeImportDialog}>
                取消
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 文案生成弹窗 */}
      <Dialog open={copywriterOpen} onOpenChange={setCopywriterOpen}>
         <DialogContent className="max-w-lg">
           <DialogHeader>
             <DialogTitle className="flex items-center gap-2">
               <Sparkles className="h-5 w-5 text-violet-500" />
               AI 文案生成
             </DialogTitle>
           </DialogHeader>

          <Form {...copywriterForm}>
            <form
              onSubmit={copywriterForm.handleSubmit(handleCopywriter)}
              className="space-y-4"
            >
              <FormField
                control={copywriterForm.control}
                name="productNameZh"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>商品名称（中文）</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={copywriterForm.control}
                name="specs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>规格特点</FormLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={copywriterForm.control}
                name="targetMarket"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>目标市场</FormLabel>
                    <Select
                      value={field.value || 'US'}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="US">美国</SelectItem>
                        <SelectItem value="EU">欧洲</SelectItem>
                        <SelectItem value="UK">英国</SelectItem>
                        <SelectItem value="JP">日本</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {copywriterResult && (
                <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4">
                  <div>
                    <div className="text-xs font-medium text-violet-700">
                      英文标题
                    </div>
                    <div className="mt-1 text-sm">
                      {copywriterResult.titleEn}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-violet-700">
                      产品卖点
                    </div>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {copywriterResult.bulletPoints.map((bp: string, i: number) => (
                        <li key={i}>{bp}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-violet-700">
                      长描述
                    </div>
                    <div className="mt-1 text-sm">
                      {copywriterResult.longDescription}
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCopywriterOpen(false)}
                >
                  关闭
                </Button>
                {copywriterResult ? (
                  <Button
                    type="button"
                    onClick={applyCopywriterResult}
                    className="bg-violet-600 hover:bg-violet-700"
                  >
                    应用到表单
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={copywriterLoading}
                    className="bg-violet-600 hover:bg-violet-700"
                  >
                    {copywriterLoading ? '生成中...' : '生成文案'}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductManagePage;
