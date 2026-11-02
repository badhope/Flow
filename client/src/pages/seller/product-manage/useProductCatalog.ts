import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { categoriesApi, productsApi } from '@/api';
import { notifyError } from '@/lib/error-feedback';
import type { Category, Product, ProductListParams } from '@shared/api.interface';
import { PAGE_SIZE } from './schema';
import { validateCsvFile } from './schema';
import type { ProductFormValues } from './schema';
import type { PublishReadiness } from './ProductFormDialog';
import type { ImportProductsResponse } from '@shared/api.interface';

export interface ProductCatalogState {
  products: Product[];
  categories: Category[];
  total: number;
  page: number;
  loading: boolean;
  keyword: string;
  categoryFilter: string;
  selectedIds: Set<string>;
  bulkBusy: boolean;
  readiness: PublishReadiness | null;
  importResult: ImportProductsResponse | null;
  importLoading: boolean;
  setPage: (page: number) => void;
  setKeyword: (keyword: string) => void;
  setCategoryFilter: (id: string) => void;
  setSelectedIds: (ids: Set<string>) => void;
  setImportResult: (result: ImportProductsResponse | null) => void;
  setImportLoading: (loading: boolean) => void;
  setReadiness: (readiness: PublishReadiness | null) => void;
  fetchProducts: (params?: ProductListParams) => Promise<void>;
  search: () => void;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  bulkSetStatus: (status: 'active' | 'inactive') => Promise<void>;
  createProduct: (values: ProductFormValues) => Promise<void>;
  updateProduct: (id: string, values: ProductFormValues) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  setProductStatus: (product: Product, active: boolean) => Promise<void>;
  loadReadiness: (productId: string) => Promise<void>;
  exportCsv: () => Promise<void>;
  importCsv: (file: File) => Promise<void>;
}

/**
 * Owns every server interaction for the product catalog page. The page itself
 * stays presentational, so listing logic can be tested and reused independently.
 */
export function useProductCatalog(): ProductCatalogState {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [keyword, setKeyword] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null);
  const [importResult, setImportResult] = useState<ImportProductsResponse | null>(null);
  const [importLoading, setImportLoading] = useState<boolean>(false);

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
    [page, keyword, categoryFilter],
  );

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    categoriesApi
      .listCategories()
      .then(setCategories)
      .catch((err: unknown) => notifyError(err, '获取分类失败'));
  }, []);

  const search = useCallback(() => {
    setPage(1);
    void fetchProducts({ page: 1 });
  }, [fetchProducts]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === products.length ? new Set() : new Set(products.map((p) => p.id))));
  }, [products]);

  const bulkSetStatus = useCallback(
    async (status: 'active' | 'inactive') => {
      if (selectedIds.size === 0) return;
      try {
        setBulkBusy(true);
        const result = await productsApi.bulkUpdateProductStatus(Array.from(selectedIds), status);
        if (result.failed.length > 0) {
          toast(`成功 ${result.updated} 个，失败 ${result.failed.length} 个：${result.failed[0].reason}`);
        } else {
          toast.success(`已${status === 'active' ? '上架' : '下架'} ${result.updated} 个商品`);
        }
        setSelectedIds(new Set());
        void fetchProducts();
      } catch (err) {
        notifyError(err, '批量操作失败');
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, fetchProducts],
  );

  const createProduct = useCallback(
    async (values: ProductFormValues) => {
      try {
        await productsApi.createProduct(toPayload(values));
        void fetchProducts();
      } catch (err) {
        notifyError(err, '创建商品失败');
        throw err;
      }
    },
    [fetchProducts],
  );

  const updateProduct = useCallback(
    async (id: string, values: ProductFormValues) => {
      try {
        await productsApi.updateProduct(id, toPayload(values));
        void fetchProducts();
      } catch (err) {
        notifyError(err, '保存商品失败');
        throw err;
      }
    },
    [fetchProducts],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      if (!window.confirm('确定要删除该商品吗？')) return;
      try {
        await productsApi.deleteProduct(id);
        void fetchProducts();
      } catch (err) {
        notifyError(err, '删除商品失败，请重试');
      }
    },
    [fetchProducts],
  );

  const setProductStatus = useCallback(
    async (product: Product, active: boolean) => {
      try {
        await productsApi.updateProductStatus(product.id, active ? 'active' : 'inactive');
        void fetchProducts();
      } catch (err) {
        // Publish gate rejections carry the missing-field list; surface it instead of a silent no-op.
        notifyError(err, '更新商品状态失败，请检查商品信息是否完整');
      }
    },
    [fetchProducts],
  );

  const loadReadiness = useCallback(async (productId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/publish-readiness`, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return;
      setReadiness((await res.json()) as PublishReadiness);
    } catch {
      setReadiness(null);
    }
  }, []);

  const exportCsv = useCallback(async () => {
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
  }, []);

  const importCsv = useCallback(
    async (file: File) => {
      const problem = validateCsvFile(file);
      if (problem) {
        toast.error(problem);
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
          toast(`导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
        }
        void fetchProducts();
      } catch (err) {
        notifyError(err, '导入失败，请检查文件格式');
      } finally {
        setImportLoading(false);
      }
    },
    [fetchProducts],
  );

  return {
    products,
    categories,
    total,
    page,
    loading,
    keyword,
    categoryFilter,
    selectedIds,
    bulkBusy,
    readiness,
    importResult,
    importLoading,
    setPage,
    setKeyword,
    setCategoryFilter,
    setSelectedIds,
    setImportResult,
    setImportLoading,
    setReadiness,
    fetchProducts,
    search,
    toggleSelect,
    toggleSelectAll,
    bulkSetStatus,
    createProduct,
    updateProduct,
    deleteProduct,
    setProductStatus,
    loadReadiness,
    exportCsv,
    importCsv,
  };
}

function toPayload(values: ProductFormValues) {
  return {
    titleZh: values.titleZh,
    titleEn: values.titleEn,
    categoryId: values.categoryId || undefined,
    price: Number(values.price),
    originalPrice: values.originalPrice ? Number(values.originalPrice) : undefined,
    stock: Number(values.stock),
    status: values.status,
    coverImage: values.coverImage || undefined,
    descZh: values.descZh,
    descEn: values.descEn,
    longDescZh: values.longDescZh,
    longDescEn: values.longDescEn,
  };
}
