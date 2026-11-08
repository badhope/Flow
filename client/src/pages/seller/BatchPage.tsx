import React, { useEffect, useState, useCallback } from 'react';
import { Boxes, Plus, RefreshCw, AlertTriangle, CalendarClock, Package } from 'lucide-react';
import { SellerPageHeader, FlowPanel, FlowEmpty, FlowStatus, FlowStat } from '@/components/seller/SellerUI';
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
import { listBatches, listExpiringBatches, createBatch, getBatchDrift, repairBatchDrift } from '@/api/batch';
import { listWarehouses } from '@/api/warehouse';
import { listProducts } from '@/api/products';
import type { StockBatch, Warehouse, Product } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

/**
 * 批次与效期管理。
 *
 * 为什么需要这一页：下单走 FEFO（先到期先出），没有批次就扣不出货；
 * 而临期/过期批次不会自己冒出来提醒，必须有人能看到。
 */
const BatchPage: React.FC = () => {
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [expiring, setExpiring] = useState<StockBatch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<'all' | 'expiring'>('all');

  // 入库
  const [open, setOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Array<{ id: string; sku: string; stock: number }>>([]);
  const [form, setForm] = useState({
    warehouseId: '', productId: '', variantId: '', batchNo: '',
    quantity: '1', producedAt: '', expiresAt: '', note: '',
  });

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const [all, soon, wh] = await Promise.all([
        listBatches(200),
        listExpiringBatches(30),
        listWarehouses(),
      ]);
      setBatches(all);
      setExpiring(soon);
      setWarehouses(wh);
    } catch (error: unknown) {
      notifyError(error, '加载批次失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDialog = async (): Promise<void> => {
    setOpen(true);
    try {
      const res = await listProducts({ page: 1, pageSize: 50 });
      setProducts(res.items ?? []);
    } catch {
      setProducts([]);
    }
  };

  const onPickProduct = (productId: string): void => {
    const p = products.find((x) => x.id === productId);
    setForm({ ...form, productId, variantId: '' });
    setVariants((p?.variants ?? []).map((v) => ({ id: v.id, sku: v.sku, stock: v.stock })));
  };

  const submit = async (): Promise<void> => {
    if (!form.warehouseId || !form.variantId || !form.batchNo.trim()) {
      toast.error('仓库、SKU、批次号必填');
      return;
    }
    const qty = Number(form.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error('数量必须为正整数');
      return;
    }
    try {
      setSaving(true);
      await createBatch({
        warehouseId: form.warehouseId,
        variantId: form.variantId,
        batchNo: form.batchNo.trim(),
        quantity: qty,
        producedAt: form.producedAt || undefined,
        expiresAt: form.expiresAt || undefined,
        note: form.note || undefined,
      });
      toast.success('批次已入库');
      setOpen(false);
      setForm({ warehouseId: '', productId: '', variantId: '', batchNo: '', quantity: '1', producedAt: '', expiresAt: '', note: '' });
      await load();
    } catch (error: unknown) {
      notifyError(error, '入库失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRepair = async (): Promise<void> => {
    try {
      const r = await repairBatchDrift();
      toast.success(r.repaired > 0 ? `已修复 ${r.repaired} 条` : '没有需要修复的偏差');
      await load();
    } catch (error: unknown) {
      notifyError(error, '修复失败');
    }
  };

  const expireCount = expiring.filter((b) => b.status === 'expired').length;
  const soonCount = expiring.filter((b) => b.status === 'expiring').length;

  const list = tab === 'all' ? batches : expiring;

  const statusTone = (s: StockBatch['status']): 'ok' | 'warn' | 'danger' | 'idle' => {
    if (s === 'expired') return 'danger';
    if (s === 'expiring') return 'warn';
    if (s === 'no_expiry') return 'idle';
    return 'ok';
  };

  const statusLabel = (s: StockBatch['status']): string => {
    if (s === 'expired') return '已过期';
    if (s === 'expiring') return '临期';
    if (s === 'no_expiry') return '无保质期';
    return '正常';
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        title="批次与效期"
        description="下单按先到期先出（FEFO）扣减。过期批次不计入可售，但保留在库以便追溯。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={() => void openDialog()}>
              <Plus className="mr-1.5 size-3.5" />
              批次入库
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FlowStat label="批次总数" value={String(batches.length)} icon={Boxes} />
        <FlowStat label="临期（30天）" value={String(soonCount)} icon={CalendarClock} />
        <FlowStat label="已过期" value={String(expireCount)} icon={AlertTriangle} />
        <FlowStat label="有保质期" value={String(batches.filter((b) => b.expiresAt).length)} icon={Package} />
      </div>

      <FlowPanel>
        <div className="mb-3 flex items-center gap-2">
          <Button
            variant={tab === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab('all')}
          >
            全部批次
          </Button>
          <Button
            variant={tab === 'expiring' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab('expiring')}
          >
            临期 / 过期（{expiring.length}）
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void handleRepair()}>
            修复批次偏差
          </Button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--flow-text-2)]">加载中…</div>
        ) : list.length === 0 ? (
          <FlowEmpty
            title={tab === 'all' ? '还没有批次' : '没有临期批次'}
            description={tab === 'all' ? '批次入库后，下单才能按效期扣减。' : '30 天内没有到期的批次。'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>批次号</TableHead>
                <TableHead>仓库</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>生产日期</TableHead>
                <TableHead>到期日</TableHead>
                <TableHead className="text-right">剩余天数</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.batchNo}</TableCell>
                  <TableCell className="text-xs">{b.warehouseName}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.quantity}</TableCell>
                  <TableCell className="text-xs text-[var(--flow-text-3)]">
                    {b.producedAt ? new Date(b.producedAt).toLocaleDateString('zh-CN') : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {b.expiresAt ? new Date(b.expiresAt).toLocaleDateString('zh-CN') : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.daysToExpiry === null ? '—' : b.daysToExpiry}
                  </TableCell>
                  <TableCell>
                    <FlowStatus tone={statusTone(b.status)}>{statusLabel(b.status)}</FlowStatus>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FlowPanel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>批次入库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>仓库</Label>
              <Select value={form.warehouseId} onValueChange={(v) => setForm({ ...form, warehouseId: v })}>
                <SelectTrigger><SelectValue placeholder="选择仓库" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>商品</Label>
              <Select value={form.productId} onValueChange={onPickProduct}>
                <SelectTrigger><SelectValue placeholder="选择商品" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.titleZh || p.titleEn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>SKU</Label>
              <Select value={form.variantId} onValueChange={(v) => setForm({ ...form, variantId: v })}>
                <SelectTrigger><SelectValue placeholder="选择 SKU" /></SelectTrigger>
                <SelectContent>
                  {variants.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.sku}（库存 {v.stock}）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>批次号</Label>
                <Input
                  placeholder="如 LOT-2026-11"
                  value={form.batchNo}
                  onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
                />
              </div>
              <div>
                <Label>数量</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>生产日期（可选）</Label>
                <Input
                  type="date"
                  value={form.producedAt}
                  onChange={(e) => setForm({ ...form, producedAt: e.target.value })}
                />
              </div>
              <div>
                <Label>到期日（无保质期可留空）</Label>
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-[var(--flow-text-3)]">
              留空到期日视为标品，排在所有有保质期批次之后出库。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => void submit()} disabled={saving}>入库</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BatchPage;
