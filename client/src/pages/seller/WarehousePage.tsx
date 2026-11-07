import React, { useEffect, useState, useCallback } from 'react';
import { Warehouse as WarehouseIcon, Plus, RefreshCw, ArrowLeftRight, MapPin } from 'lucide-react';
import { SellerPageHeader, FlowPanel, FlowEmpty, FlowStatus } from '@/components/seller/SellerUI';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { listWarehouses, createWarehouse, listTransfers, completeTransfer, cancelTransfer } from '@/api/warehouse';
import type { Warehouse, StockTransfer } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

/**
 * 仓库管理。
 *
 * 多仓不是"多几个地址"：它决定从哪发货、是否跨境、以及同一 SKU 有货时的选仓顺序。
 * 这里是卖家配置仓与调拨的唯一入口。
 */
const WarehousePage: React.FC = () => {
  const [list, setList] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState({ name: '', code: '', country: 'CN', priority: '100' });

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
        description="配置发货仓与优先级。同一 SKU 多仓有货时，优先从目的国本地仓发货，其次按优先级。"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
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
                    <FlowStatus
                      tone={t.status === 'completed' ? 'ok' : t.status === 'cancelled' ? 'idle' : 'warn'}
                    >
                      {t.status === 'completed' ? '已入库' : t.status === 'cancelled' ? '已取消' : '在途'}
                    </FlowStatus>
                  </TableCell>
                  <TableCell className="text-xs text-[var(--flow-text-3)]">
                    {new Date(t.createdAt).toLocaleString('zh-CN')}
                  </TableCell>
                  <TableCell>
                    {t.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => void handleComplete(t.id)}>
                          入库
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleCancel(t.id)}>
                          取消
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FlowPanel>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建仓库</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>仓库名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 深圳仓"
              />
            </div>
            <div>
              <Label>仓库代码</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="如 SZX"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>所在国（两位代码）</Label>
                <Input
                  value={form.country}
                  maxLength={2}
                  onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <Label>优先级（小者优先）</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
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

export default WarehousePage;
