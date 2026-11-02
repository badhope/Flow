import { z } from 'zod';

/** Shared form contract for creating and editing a product. */
export const productSchema = z.object({
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

export type ProductFormValues = z.infer<typeof productSchema>;

export const copywriterSchema = z.object({
  productNameZh: z.string().min(1, '商品名称必填'),
  specs: z.string().optional(),
  category: z.string().optional(),
  targetMarket: z.string().optional(),
});

export type CopywriterFormValues = z.infer<typeof copywriterSchema>;

export const STATUS_MAP: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  active: { label: '上架中', variant: 'default' },
  draft: { label: '草稿', variant: 'secondary' },
  inactive: { label: '已下架', variant: 'destructive' },
};

export const PAGE_SIZE = 10;

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
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
};

export const EMPTY_COPYWRITER_FORM: CopywriterFormValues = {
  productNameZh: '',
  specs: '',
  category: '',
  targetMarket: 'US',
};

export const MAX_CSV_SIZE = 10 * 1024 * 1024;

/** `file.type` is unreliable across OSes, so extension is the authoritative check. */
export function validateCsvFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.csv')) return '请上传 CSV 格式文件';
  if (file.size === 0) return '文件不能为空';
  if (file.size > MAX_CSV_SIZE) return '文件大小不能超过 10MB';
  return null;
}


/** Map a product entity onto the editable form shape. */
export function toProductForm(product: {
  titleZh: string;
  titleEn: string;
  categoryId?: string | null;
  minPrice?: string | null;
  totalStock: number;
  status: string;
  coverImage?: string | null;
  descZh?: string | null;
  descEn?: string | null;
  longDescZh?: string | null;
  longDescEn?: string | null;
  variants: Array<{ price: string; originalPrice?: string | null }>;
}): ProductFormValues {
  const firstVariant = product.variants[0];
  return {
    titleZh: product.titleZh,
    titleEn: product.titleEn,
    categoryId: product.categoryId ?? '',
    price: firstVariant ? firstVariant.price : (product.minPrice ?? '0'),
    originalPrice: firstVariant?.originalPrice ?? '',
    stock: String(product.totalStock),
    status: product.status as ProductFormValues['status'],
    coverImage: product.coverImage ?? '',
    descZh: product.descZh ?? '',
    descEn: product.descEn ?? '',
    longDescZh: product.longDescZh ?? '',
    longDescEn: product.longDescEn ?? '',
  };
}

/** Convert validated form values into the API payload. */
export function toProductPayload(values: ProductFormValues) {
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
