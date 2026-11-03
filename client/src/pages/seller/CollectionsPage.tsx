import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, Layers, Star, StarOff, GripVertical, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  getCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addProductToCollection,
  removeProductFromCollection,
} from '@/api/collections';
import type {
  Collection,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { SellerPageHeader } from '@/components/seller/SellerUI';

const PAGE_SIZE = 10;

const CollectionsPage: React.FC = () => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateCollectionRequest>({ titleZh: '', titleEn: '' });

  const [productsDialogOpen, setProductsDialogOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [productIdInput, setProductIdInput] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      const items = await getCollections();
      setCollections(items);
      setTotal(items.length);
    } catch {
      toast.error('加载集合列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const handleCreate = () => {
    setEditingId(null);
    setForm({ titleZh: '', titleEn: '', slug: '', descriptionZh: '', sortOrder: collections.length, status: 'active', isFeatured: false });
    setDialogOpen(true);
  };

  const handleEdit = (collection: Collection) => {
    setEditingId(collection.id);
    setForm({
      titleZh: collection.titleZh,
      titleEn: collection.titleEn,
      slug: collection.slug,
      descriptionZh: collection.descriptionZh,
      sortOrder: collection.sortOrder,
      isFeatured: collection.isFeatured,
      status: collection.status,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该集合？集合内的商品不会被删除。')) return;
    try {
      await deleteCollection(id);
      toast.success('删除成功');
      fetchCollections();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    if (!form.titleZh.trim()) {
      toast.error('请输入集合中文名称');
      return;
    }
    if (!form.titleEn.trim()) {
      toast.error('请输入集合英文名称');
      return;
    }
    try {
      if (editingId) {
        const updatePayload: UpdateCollectionRequest = { ...form, productIds: undefined };
        delete updatePayload.productIds;
        await updateCollection(editingId, updatePayload);
        toast.success('更新成功');
      } else {
        await createCollection(form);
        toast.success('创建成功');
      }
      setDialogOpen(false);
      fetchCollections();
    } catch {
      toast.error(editingId ? '更新失败' : '创建失败');
    }
  };

  const handleManageProducts = (collection: Collection) => {
    setSelectedCollection(collection);
    setProductIdInput('');
    setProductsDialogOpen(true);
  };

  const handleAddProduct = async () => {
    if (!selectedCollection || !productIdInput.trim()) return;
    setProductsLoading(true);
    try {
      await addProductToCollection(selectedCollection.id, productIdInput.trim());
      toast.success('商品已添加到集合');
      setProductIdInput('');
      // Refresh
      const updated = await getCollections();
      setCollections(updated);
      const found = updated.find((c) => c.id === selectedCollection.id);
      if (found) setSelectedCollection(found);
    } catch {
      toast.error('添加失败');
    } finally {
      setProductsLoading(false);
    }
  };

  const handleRemoveProduct = async (productId: string) => {
    if (!selectedCollection) return;
    try {
      await removeProductFromCollection(selectedCollection.id, productId);
      toast.success('商品已从集合移除');
      const updated = await getCollections();
      setCollections(updated);
      const found = updated.find((c) => c.id === selectedCollection.id);
      if (found) setSelectedCollection(found);
    } catch {
      toast.error('移除失败');
    }
  };

  const handleToggleFeatured = async (collection: Collection) => {
    try {
      await updateCollection(collection.id, { isFeatured: !collection.isFeatured });
      toast.success(collection.isFeatured ? '已取消推荐' : '已设为推荐');
      fetchCollections();
    } catch {
      toast.error('操作失败');
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pagedCollections = collections.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={'Collections'}
        title={'运营集合'}
        description={'手动或智能集合，自动生成买家首页运营楼层。'}
        actions={
          <Button size="sm" onClick={handleCreate}>
            <Plus className="mr-1 h-4 w-4" />
            创建集合
          </Button>
        }
      />

      {/* Collections table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>集合名称</TableHead>
                <TableHead>标识</TableHead>
                <TableHead>商品数</TableHead>
                <TableHead>推荐</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              )}
              {!loading && collections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><Layers className="size-6" /></EmptyMedia>
                        <EmptyTitle>暂无集合</EmptyTitle>
                        <EmptyDescription>创建商品集合来组织您的商品展示</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                pagedCollections.map((collection) => (
                  <TableRow key={collection.id}>
                    <TableCell className="font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {collection.coverImage && (
                          <div className="h-8 w-8 rounded overflow-hidden bg-slate-100 flex-shrink-0">
                            <img src={collection.coverImage} alt="" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <span>{collection.titleZh}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{collection.slug}</TableCell>
                    <TableCell>{collection.productCount}</TableCell>
                    <TableCell>
                      {collection.isFeatured ? (
                        <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                      ) : (
                        <StarOff className="h-4 w-4 text-slate-300" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={collection.status === 'active' ? 'default' : 'secondary'}>
                        {collection.status === 'active' ? '启用' : '停用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleManageProducts(collection)} title="管理商品">
                          <GripVertical className="h-3 w-3" />
                          商品
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggleFeatured(collection)} title="推荐">
                          <Star className={`h-3 w-3 ${collection.isFeatured ? 'text-amber-500' : ''}`} />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleEdit(collection)}>
                          <Edit className="mr-1 h-3 w-3" />
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(collection.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <div className="text-sm text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑集合' : '创建集合'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>集合名称（中文）*</Label>
              <Input
                placeholder="如：春季新品推荐"
                value={form.titleZh}
                onChange={(e) => setForm((prev) => ({ ...prev, titleZh: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>集合名称（英文）*</Label>
              <Input
                placeholder="如：Spring New Arrivals"
                value={form.titleEn}
                onChange={(e) => setForm((prev) => ({ ...prev, titleEn: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>标识 (slug)</Label>
              <Input
                placeholder="如：spring-new-arrivals"
                value={form.slug}
                onChange={(e) => {
                  const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
                  setForm((prev) => ({ ...prev, slug }));
                }}
                className="mt-1 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">用作 URL 标识（留空则由英文名自动生成），仅支持小写字母、数字和连字符</p>
            </div>
            <div>
              <Label>描述</Label>
              <Textarea
                placeholder="集合描述（选填）"
                value={form.descriptionZh || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, descriptionZh: e.target.value }))}
                rows={3}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>排序权重</Label>
                <Input
                  type="number"
                  value={form.sortOrder || 0}
                  onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                  className="mt-1"
                />
              </div>
              <div>
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
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-featured"
                checked={form.isFeatured || false}
                onChange={(e) => setForm((prev) => ({ ...prev, isFeatured: e.target.checked }))}
                className="rounded border-slate-300"
              />
              <Label htmlFor="is-featured" className="mb-0 cursor-pointer">设为首页推荐集合</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingId ? '保存修改' : '创建集合'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 商品管理弹窗 */}
      <Dialog open={productsDialogOpen} onOpenChange={setProductsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              管理商品 - {selectedCollection?.titleZh}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 添加商品 */}
            <div className="flex gap-2">
              <Input
                placeholder="输入商品ID"
                value={productIdInput}
                onChange={(e) => setProductIdInput(e.target.value)}
              />
              <Button onClick={handleAddProduct} disabled={productsLoading}>
                {productsLoading ? '添加中...' : '添加'}
              </Button>
            </div>

            {/* 已有商品列表 */}
            {selectedCollection && selectedCollection.productIds && selectedCollection.productIds.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">
                  已添加商品 ({selectedCollection.productIds.length})
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {selectedCollection.productIds.map((pid, index) => (
                    <div key={pid} className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-6">{index + 1}.</span>
                        <span className="font-mono text-sm text-slate-700">{pid}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 h-6 p-1"
                        onClick={() => handleRemoveProduct(pid)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-slate-400">
                暂无商品，添加商品ID来关联商品到集合
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductsDialogOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CollectionsPage;
