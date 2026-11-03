import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Image as ImageComponent } from '@/components/ui/image';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Product } from '@shared/api.interface';
import { STATUS_MAP } from './schema';

interface ProductTableProps {
  products: Product[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (product: Product, checked: boolean) => void;
}

/** Read-only product grid; every mutation is delegated upward. */
const ProductTable: React.FC<ProductTableProps> = ({
  products,
  loading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
  onDelete,
  onToggleStatus,
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="w-10">
          <label className="flex size-6 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              aria-label="全选商品"
              checked={products.length > 0 && selectedIds.size === products.length}
              onChange={onToggleSelectAll}
              className="size-4 cursor-pointer accent-blue-600"
            />
          </label>
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
              <label className="flex size-6 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  aria-label={`选择 ${product.titleZh}`}
                  checked={selectedIds.has(product.id)}
                  onChange={() => onToggleSelect(product.id)}
                  className="size-4 cursor-pointer accent-blue-600"
                />
              </label>
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
            <TableCell className="font-mono text-xs">{product.variants[0]?.sku || '-'}</TableCell>
            <TableCell className="max-w-[200px] truncate font-medium">{product.titleZh}</TableCell>
            <TableCell>{product.categoryNameZh || '-'}</TableCell>
            <TableCell className="font-semibold">${Number(product.minPrice ?? 0).toFixed(2)}</TableCell>
            <TableCell>{product.totalStock}</TableCell>
            <TableCell>{product.totalSold}</TableCell>
            <TableCell>
              <Badge variant={STATUS_MAP[product.status]?.variant ?? 'secondary'}>
                {STATUS_MAP[product.status]?.label ?? product.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="icon" onClick={() => onEdit(product)} aria-label="编辑商品">
                  <Pencil className="h-4 w-4" />
                </Button>
                <span className="flex h-6 items-center">
                  <Switch
                    checked={product.status === 'active'}
                    onCheckedChange={(checked) => onToggleStatus(product, checked)}
                    aria-label="切换上架状态"
                  />
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(product.id)}
                  className="text-destructive"
                  aria-label="删除商品"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
    </TableBody>
  </Table>
);

export default ProductTable;
