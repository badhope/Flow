import React, { useEffect, useState, useCallback } from 'react';
import { FileText, AlertTriangle, RefreshCw, CheckCircle2, ChevronDown, Settings2, Send } from 'lucide-react';
import { SellerPageHeader, FlowPanel, FlowEmpty, FlowStatus } from '@/components/seller/SellerUI';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { listCustomsDeclarations, fileCustoms, getBrokerConfig, saveBrokerConfig, submitToBroker } from '@/api/customs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import type { CustomsDeclaration, CustomsBrokerConfig } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

/**
 * 清关单据管理。
 *
 * 跨境订单在目的国清关时需要申报清单（HS 编码 / 英文品名 / 数量 / 单价 / 原产国）。
 * 此前系统没有这个概念，卖家只能手工在 Excel 里拼。
 *
 * 缺 HS 编码的单据会显式标红并禁止申报——海关不认"忘了填"，
 * 与其等退单不如在这里拦住。
 */
const CustomsPage: React.FC = () => {
  const [list, setList] = useState<CustomsDeclaration[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);
  const [broker, setBroker] = useState<CustomsBrokerConfig | null>(null);
  const [brokerOpen, setBrokerOpen] = useState<boolean>(false);
  const [brokerForm, setBrokerForm] = useState({ endpoint: '', apiKey: '', signingSecret: '', enabled: true });
  const [brokerSaving, setBrokerSaving] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const [items, cfg] = await Promise.all([
        listCustomsDeclarations(100),
        getBrokerConfig().catch(() => null),
      ]);
      setList(items);
      setBroker(cfg);
    } catch (error: unknown) {
      notifyError(error, '加载清关单据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFile = async (id: string): Promise<void> => {
    try {
      setFiling(id);
      await fileCustoms(id);
      toast.success('已标记为已申报');
      await load();
    } catch (error: unknown) {
      notifyError(error, '标记申报失败');
    } finally {
      setFiling(null);
    }
  };

  const handleSubmit = async (id: string): Promise<void> => {
    try {
      setFiling(id);
      const d = await submitToBroker(id);
      if (d.brokerStatus === 'accepted') toast.success(`报关行已受理（回执 ${d.brokerRef}）`);
      else toast.error(`报关行返回：${d.brokerStatus} ${d.lastError ?? ''}`);
      await load();
    } catch (error: unknown) {
      notifyError(error, '报关行提交失败');
    } finally {
      setFiling(null);
    }
  };

  const saveBroker = async (): Promise<void> => {
    if (!brokerForm.endpoint.trim()) { toast.error('报关行端点必填'); return; }
    try {
      setBrokerSaving(true);
      await saveBrokerConfig({
        endpoint: brokerForm.endpoint.trim(),
        provider: 'generic_http',
        credentials: brokerForm.apiKey ? { apiKey: brokerForm.apiKey } : {},
        signingSecret: brokerForm.signingSecret || undefined,
        enabled: brokerForm.enabled,
      });
      toast.success('报关行配置已保存');
      setBrokerOpen(false);
      await load();
    } catch (error: unknown) {
      notifyError(error, '保存失败');
    } finally {
      setBrokerSaving(false);
    }
  };

  const statusTone = (s: string): 'idle' | 'info' | 'ok' => {
    if (s === 'filed') return 'info';
    if (s === 'cleared') return 'ok';
    return 'idle';
  };

  const statusLabel = (s: string): string => {
    if (s === 'filed') return '已申报';
    if (s === 'cleared') return '已放行';
    return '草稿';
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        title="清关单据"
        description="按订单生成的报关清单，含 HS 编码、英文品名与申报价值。缺 HS 编码的单据无法申报。"
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        )}
      />

      <FlowPanel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Settings2 className="size-3.5 text-[var(--flow-text-3)]" />
          <span className="text-[var(--flow-text-2)]">报关行对接</span>
          {broker ? (
            <>
              <span className="font-mono text-[var(--flow-text-1)]">{broker.endpoint}</span>
              <FlowStatus tone={broker.enabled ? 'ok' : 'idle'}>{broker.enabled ? '已启用' : '未启用'}</FlowStatus>
              <span className="text-[var(--flow-text-3)]">签名 {broker.hasSigningSecret ? '已配置' : '未配置'}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => {
                setBrokerForm({ endpoint: broker.endpoint, apiKey: '', signingSecret: '', enabled: broker.enabled });
                setBrokerOpen(true);
              }}>修改</Button>
            </>
          ) : (
            <>
              <span className="text-[var(--flow-warn)]">未配置</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setBrokerOpen(true)}>配置</Button>
            </>
          )}
        </div>
      </FlowPanel>

      <FlowPanel>
        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--flow-text-2)]">加载中…</div>
        ) : list.length === 0 ? (
          <FlowEmpty
            title="还没有清关单据"
            description="在订单详情页点击「生成报关单」，或先为商品填写 HS 编码。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>单据号</TableHead>
                <TableHead>目的国</TableHead>
                <TableHead className="text-right">申报价值</TableHead>
                <TableHead className="text-right">约合 USD</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>告警</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((d) => (
                <React.Fragment key={d.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{d.declarationNo}</TableCell>
                    <TableCell className="text-xs">{d.destinationCountry || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.declaredCurrency} {Number(d.declaredValue).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[var(--flow-text-2)]">
                      ${Number(d.declaredValueUsd).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <FlowStatus tone={statusTone(d.status)}>{statusLabel(d.status)}</FlowStatus>
                    </TableCell>
                    <TableCell>
                      {d.warnings.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--flow-warn)]">
                          <AlertTriangle className="size-3" />
                          {d.warnings.length} 项
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--flow-ok)]">
                          <CheckCircle2 className="size-3" />
                          完整
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {d.status === 'draft' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={d.warnings.length > 0 || filing === d.id || !broker?.enabled}
                              onClick={() => void handleSubmit(d.id)}
                              title={d.warnings.length > 0 ? '请先补齐缺失字段' : (!broker?.enabled ? '请先配置并启用报关行' : '向报关行提交申报')}
                            >
                              <Send className="mr-1 size-3" />
                              提交报关
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={d.warnings.length > 0 || filing === d.id}
                              onClick={() => void handleFile(d.id)}
                              title="线下已申报，仅标记状态"
                            >
                              标记
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                        >
                          <ChevronDown className={`size-3.5 transition-transform ${expanded === d.id ? 'rotate-180' : ''}`} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === d.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-[var(--flow-surface-2)] p-0">
                        <div className="px-4 py-3">
                          {d.warnings.length > 0 && (
                            <div className="mb-2 rounded border border-[var(--flow-warn)]/30 bg-[var(--flow-warn)]/10 px-2 py-1 text-[11px] text-[var(--flow-warn)]">
                              {d.warnings.join(' · ')}
                            </div>
                          )}
                          {d.lastError && (
                            <div className="mb-2 rounded border border-[var(--flow-danger)]/30 bg-[var(--flow-danger)]/10 px-2 py-1 text-[11px] text-[var(--flow-danger)]">
                              报关行：{d.lastError}（已尝试 {d.attemptCount} 次）
                            </div>
                          )}
                          {d.brokerRef && (
                            <div className="mb-2 text-[11px] text-[var(--flow-text-3)]">
                              回执：{d.brokerRef} · {d.brokerStatus}
                            </div>
                          )}
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">SKU</TableHead>
                                <TableHead className="text-xs">HS 编码</TableHead>
                                <TableHead className="text-xs">报关品名</TableHead>
                                <TableHead className="text-right text-xs">数量</TableHead>
                                <TableHead className="text-right text-xs">单价</TableHead>
                                <TableHead className="text-xs">原产国</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {d.lineItems.map((item) => (
                                <TableRow key={item.sku}>
                                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                                  <TableCell className={`font-mono text-xs ${item.hsCode ? '' : 'text-[var(--flow-danger)]'}`}>
                                    {item.hsCode ?? '缺失'}
                                  </TableCell>
                                  <TableCell className="max-w-[280px] truncate text-xs">{item.description}</TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">{item.quantity}</TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">{item.unitValue}</TableCell>
                                  <TableCell className="text-xs">{item.originCountry ?? '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </FlowPanel>
      <Dialog open={brokerOpen} onOpenChange={setBrokerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>报关行对接配置</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-[var(--flow-text-3)]">
              系统以 POST JSON 向该端点提交申报，并用签名密钥对请求体做 HMAC-SHA256 签名
              （请求头 X-Flow-Signature）。端点必须为 https。
            </p>
            <div>
              <Label>端点 URL</Label>
              <Input
                placeholder="https://broker.example.com/declare"
                value={brokerForm.endpoint}
                onChange={(e) => setBrokerForm({ ...brokerForm, endpoint: e.target.value })}
              />
            </div>
            <div>
              <Label>API Key（无签名密钥时作为 Bearer）</Label>
              <Input
                type="password"
                placeholder="留空则不修改"
                value={brokerForm.apiKey}
                onChange={(e) => setBrokerForm({ ...brokerForm, apiKey: e.target.value })}
              />
            </div>
            <div>
              <Label>签名密钥（HMAC-SHA256）</Label>
              <Input
                type="password"
                placeholder="留空则不修改"
                value={brokerForm.signingSecret}
                onChange={(e) => setBrokerForm({ ...brokerForm, signingSecret: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={brokerForm.enabled}
                onChange={(e) => setBrokerForm({ ...brokerForm, enabled: e.target.checked })}
              />
              启用对接
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBrokerOpen(false)}>取消</Button>
            <Button onClick={() => void saveBroker()} disabled={brokerSaving}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomsPage;
