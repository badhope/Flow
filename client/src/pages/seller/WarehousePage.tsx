import React, { useEffect, useState, useCallback } from 'react';
import {
  Warehouse as WarehouseIcon, Plus, RefreshCw, ArrowLeftRight, MapPin, Package, Search,
} from 'lucide-react';
import { SellerPageHeader, FlowPanel, FlowEmpty, FlowStatus } from '@/components/seller/SellerUI';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  listWarehouses, createWarehouse, listTransfers, createTransfer,
  completeTransfer, cancelTransfer, getVariantStock, setWarehouseStock,
} from '@/api/warehouse';
import { listProducts } from '@/api/products';
import type { Warehouse, StockTransfer, WarehouseStockRow, Product } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

/**
 * 仓库管理。
 *
 * 三个能力缺一不可，否则后端有了等于没做：
 *   1. 建仓 → 决定从哪发货
 *   2. 分仓分配库存 → 决定哪个仓有货可发
 *   3. 仓间调拨 → 把货挪到需要的市场
 */
const WarehousePage: React.FC = () => {
  const [list, setList] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // 建仓
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState({ name: '', code: '', country: 'CN', priority: '100' });

  // 分仓库存
  const [stockOpen, setStockOpen] = useState<boolean>(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockRows, setStockRows] = useState<WarehouseStockRow[]>([]);
  const [stockLoading, setStockLoading] = useState<boolean>(false);
  const [edits, setEdits] = useState<Record<string, { stock: string; safetyStock: string }>>({});

  // 调拨
  const [transferOpen, setTransferOpen] = useState<boolean>(false);
  const [transferForm, setTransferForm] = useState({
    productId: '', variantId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '1',
  });
  const [transferProducts, setTransferProducts] = useState<Product[]>([]);
  const [transferVariants, setTransferVariants] = useState<Array<{ id: string; sku: string; stock: number }>>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const [w, t] = await Promise.all([listWarehouses(), listTransfers(50)]);
      setList(w);
      setTransfers(t);
    } catch (error: unknown) {
      notifyError(error, '加载仓库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (): Promise<void> => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error('仓库名称与代码必填');
      return;
    }
    try {
      setSaving(true);
      await createWarehouse({
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        country: form.country.trim().toUpperCase(),
        priority: Number(form.priority) || 100,
      });
      toast.success('仓库已创建');
      setDialogOpen(false);
      setForm({ name: '', code: '', country: 'CN', priority: '100' });
      await load();
    } catch (error: unknown) {
      notifyError(error, '创建失败');
    } finally {
      setSaving(false);
    }
  };

  /** 打开某商品的分仓库存面板 */
  const openStock = async (product: Product): Promise<void> => {
    try {
      setStockProduct(product);
      setStockOpen(true);
      setStockLoading(true);
      const variants = product.variants ?? [];
      const first = variants[0];
      if (!first) {
        setStockRows([]);
        return;
      }
      const rows = await getVariantStock(first.id);
      setStockRows(rows);
      const next: Record<string, { stock: string; safetyStock: string }> = {};
      for (const r of rows) next[r.warehouseId] = { stock: String(r.stock), safetyStock: String(r.safetyStock) };
      // 没有记录的仓也要能录入
      for (const w of list) {
        if (!next[w.id]) next[w.id] = { stock: '0', safetyStock: '0' };
      }
      setEdits(next);
    } catch (error: unknown) {
      notifyError(error, '加载分仓库存失败');
    } finally {
      setStockLoading(false);
    }
  };

  const saveStock = async (): Promise<void> => {
    const variant = stockProduct?.variants?.[0];
    if (!variant) return;
    try {
      setSaving(true);
      for (const [warehouseId, val] of Object.entries(edits)) {
        await setWarehouseStock(
          warehouseId,
          variant.id,
          Math.max(0, Math.floor(Number(val.stock) || 0)),
          Math.max(0, Math.floor(Number(val.safetyStock) || 0)),
        );
      }
      toast.success('分仓库存已保存');
      setStockOpen(false);
      await load();
    } catch (error: unknown) {
      notifyError(error, '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const openTransfer = async (): Promise<void> => {
    try {
      setTransferOpen(true);
      const res = await listProducts({ page: 1, pageSize: 50 });
      setTransferProducts(res.items ?? []);
    } catch (error: unknown) {
      notifyError(error, '加载商品失败');
    }
  };

  const onPickTransferProduct = (productId: string): void => {
    const p = transferProducts.find((x) => x.id === productId);
    setTransferForm({ ...transferForm, productId, variantId: '', fromWarehouseId: '', toWarehouseId: '' });
    setTransferVariants((p?.variants ?? []).map((v) => ({ id: v.id, sku: v.sku, stock: v.stock })));
  };

  const submitTransfer = async (): Promise<void> => {
    const qty = Number(transferForm.quantity);
    if (!transferForm.variantId || !transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
      toast.error('请选择变体与调出/调入仓');
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error('调拨数量必须为正整数');
      return;
    }
    try {
      setSaving(true);
      await createTransfer({
        variantId: transferForm.variantId,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: qty,
      });
      toast.success('调拨单已创建，库存已从调出仓冻结');
      setTransferOpen(false);
      setTransferForm({ productId: '', variantId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '1' });
      await load();
    } catch (error: unknown) {
      notifyError(error, '创建调拨失败');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async (id: string): Promise<void> => {
    try {
      await completeTransfer(id);
      toast.success('调拨已入库');
      await load();
    } catch (error: unknown) {
      notifyError(error, '完成调拨失败');
    }
  };

  const handleCancel = async (id: string): Promise<void> => {
    try {
      await cancelTransfer(id);
      toast.success('调拨已取消，库存已退回');
      await load();
    } catch (error: unknown) {
      notifyError(error, '取消调拨失败');
    }
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        title="仓库管理"
        description="配置发货仓、分配分仓库存、在仓之间调拨。同一 SKU 多仓有货时，优先从目的国本地仓发货，其次按优先级。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openTransfer()}>
              <ArrowLeftRight className="mr-1.5 size-3.5" />
              新建调拨
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 size-3.5" />
              新建仓库
            </Button>
          </div>
        )}
      />

      <FlowPanel>
        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--flow-text-2)]">加载中…</div>
        ) : list.length === 0 ? (
          <FlowEmpty title="还没有仓库" description="创建第一个仓库后即可分配库存与发货。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>仓库</TableHead>
                <TableHead>代码</TableHead>
                <TableHead>所在国</TableHead>
                <TableHead className="text-right">优先级</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <WarehouseIcon className="size-3.5 text-[var(--flow-text-3)]" />
                      {w.name}
                      {w.isDefault && (
                        <span className="rounded bg-[var(--flow-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--flow-accent)]">
                          默认
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{w.code}</TableCell>
                  <TableCell className="text-xs">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3 text-[var(--flow-text-3)]" />
                      {w.country}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{w.priority}</TableCell>
                  <TableCell>
                    <FlowStatus tone={w.active ? 'ok' : 'idle'}>{w.active ? '启用' : '停用'}</FlowStatus>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FlowPanel>

      <StockAllocator onOpen={openStock} />

      <FlowPanel>
        <div className="mb-3 flex items-center gap-2">
          <ArrowLeftRight className="size-3.5 text-[var(--flow-text-3)]" />
          <span className="text-sm font-medium text-[var(--flow-text-1)]">调拨记录</span>
        </div>
        {transfers.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--flow-text-3)]">还没有调拨记录</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>调拨单号</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.transferNo}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                  <TableCell>
                    <FlowStatus tone={t.status === 'completed' ? 'ok' : t.status === 'cancelled' ? 'idle' : 'warn'}>
                      {t.status === 'completed' ? '已入库' : t.status === 'cancelled' ? '已取消' : '在途'}
                    </FlowStatus>
                  </TableCell>
                  <TableCell className="text-xs text-[var(--flow-text-3)]">
                    {new Date(t.createdAt).toLocaleString('zh-CN')}
                  </TableCell>
                  <TableCell>
                    {t.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => void handleComplete(t.id)}>入库</Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleCancel(t.id)}>取消</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FlowPanel>

      {/* 分仓库存分配 */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              分仓库存 · {stockProduct?.titleZh || stockProduct?.titleEn}
            </DialogTitle>
          </DialogHeader>
          {stockLoading ? (
            <div className="py-8 text-center text-sm text-[var(--flow-text-2)]">加载中…</div>
          ) : list.length === 0 ? (
            <div className="py-6 text-center text-sm text-[var(--flow-text-2)]">请先创建仓库</div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-[var(--flow-text-3)]">
                可售量 = 库存 − 安全库存。安全库存不参与销售，用于补货预警。
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>仓库</TableHead>
                    <TableHead className="text-right">库存</TableHead>
                    <TableHead className="text-right">安全库存</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((w) => {
                    const v = edits[w.id] ?? { stock: '0', safetyStock: '0' };
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="text-xs">
                          {w.name}
                          <span className="ml-1.5 text-[var(--flow-text-3)]">({w.country})</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="ml-auto h-8 w-24 text-right"
                            type="number"
                            min={0}
                            value={v.stock}
                            onChange={(e) => setEdits({ ...edits, [w.id]: { ...v, stock: e.target.value } })}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="ml-auto h-8 w-24 text-right"
                            type="number"
                            min={0}
                            value={v.safetyStock}
                            onChange={(e) => setEdits({ ...edits, [w.id]: { ...v, safetyStock: e.target.value } })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockOpen(false)}>取消</Button>
            <Button onClick={() => void saveStock()} disabled={saving || stockLoading}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建调拨 */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建调拨</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>商品</Label>
              <Select value={transferForm.productId} onValueChange={onPickTransferProduct}>
                <SelectTrigger><SelectValue placeholder="选择商品" /></SelectTrigger>
                <SelectContent>
                  {transferProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.titleZh || p.titleEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>变体（SKU）</Label>
              <Select
                value={transferForm.variantId}
                onValueChange={(v) => setTransferForm({ ...transferForm, variantId: v })}
              >
                <SelectTrigger><SelectValue placeholder="选择 SKU" /></SelectTrigger>
                <SelectContent>
                  {transferVariants.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.sku}（库存 {v.stock}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>调出仓</Label>
                <Select
                  value={transferForm.fromWarehouseId}
                  onValueChange={(v) => setTransferForm({ ...transferForm, fromWarehouseId: v })}
                >
                  <SelectTrigger><SelectValue placeholder="调出" /></SelectTrigger>
                  <SelectContent>
                    {list.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>调入仓</Label>
                <Select
                  value={transferForm.toWarehouseId}
                  onValueChange={(v) => setTransferForm({ ...transferForm, toWarehouseId: v })}
                >
                  <SelectTrigger><SelectValue placeholder="调入" /></SelectTrigger>
                  <SelectContent>
                    {list.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>数量</Label>
              <Input
                type="number"
                min={1}
                value={transferForm.quantity}
                onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>取消</Button>
            <Button onClick={() => void submitTransfer()} disabled={saving}>创建调拨</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 建仓 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建仓库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>仓库名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 深圳仓" />
            </div>
            <div>
              <Label>仓库代码</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="如 SZX" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>所在国（两位代码）</Label>
                <Input value={form.country} maxLength={2} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <Label>优先级（小者优先）</Label>
                <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** 商品列表 → 进入分仓库存面板的入口 */
const StockAllocator: React.FC<{ onOpen: (p: Product) => void }> = ({ onOpen }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const res = await listProducts({ page: 1, pageSize: 50, keyword: keyword || undefined });
      setProducts(res.items ?? []);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlowPanel>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Package className="size-3.5 text-[var(--flow-text-3)]" />
        <span className="text-sm font-medium text-[var(--flow-text-1)]">分仓库存</span>
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--flow-text-3)]" />
          <Input
            className="h-8 w-52 pl-7 text-xs"
            placeholder="搜索商品…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>
      {loading ? (
        <div className="py-6 text-center text-xs text-[var(--flow-text-3)]">加载中…</div>
      ) : products.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--flow-text-3)]">没有商品</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品</TableHead>
              <TableHead className="text-right">聚合库存</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="max-w-[320px] truncate text-xs">{p.titleZh || p.titleEn}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{p.totalStock}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => onOpen(p)}>分配库存</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </FlowPanel>
  );
};

export default WarehousePage;
