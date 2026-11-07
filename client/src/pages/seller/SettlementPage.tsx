import React, { useEffect, useState, useCallback } from 'react';
import { Wallet, TrendingUp, Percent, Package, RefreshCw, ChevronDown, CreditCard, ExternalLink } from 'lucide-react';
import { SellerPageHeader, FlowPanel, FlowStat, FlowEmpty, FlowStatus } from '@/components/seller/SellerUI';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { getSettlementSummary, getMyCommission, listSettlements, getPayoutAccount, executePayout, createPayoutAccount, refreshPayoutAccount } from '@/api/settlement';
import type { PayoutAccount } from '@shared/api.interface';
import type { Settlement, SettlementSummary, CommissionRule } from '@shared/api.interface';
import { notifyError } from '@/lib/error-feedback';
import { useAuth } from '@/contexts/AuthContext';

/**
 * 卖家结算中心。
 *
 * 过去卖家只能看到「订单流水」，看不到「平台抽多少、什么时候打款」——
 * 这是留不住卖家的地方。本页把结算单、佣金规则、明细摊开给卖家看。
 *
 * 金额全部以 USD 结算（跨境多币种下，USD 是统一口径）。
 */
const SettlementPage: React.FC = () => {
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [commission, setCommission] = useState<CommissionRule | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const [s, c, list, p] = await Promise.all([
        getSettlementSummary(),
        getMyCommission(),
        listSettlements(50),
        getPayoutAccount().catch(() => null),
      ]);
      setSummary(s);
      setCommission(c);
      setSettlements(list);
      setPayout(p);
    } catch (error: unknown) {
      notifyError(error, '加载结算数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePayout = async (id: string): Promise<void> => {
    try {
      setPaying(id);
      const updated = await executePayout(id);
      toast.success(`已打款（流水 ${updated.payoutId ?? '-'}）`);
      await load();
    } catch (error: unknown) {
      notifyError(error, '打款失败');
    } finally {
      setPaying(null);
    }
  };

  const handleOpenAccount = async (): Promise<void> => {
    try {
      const r = await createPayoutAccount({ email: user?.email ?? '' });
      // Stripe onboarding 必须在浏览器打开，不能只存链接
      window.open(r.onboardingUrl, '_blank', 'noopener');
      toast.success('已创建收款账户，请在新窗口完成资料填写');
      await load();
    } catch (error: unknown) {
      notifyError(error, '开通收款账户失败');
    }
  };

  const handleRefreshAccount = async (): Promise<void> => {
    try {
      await refreshPayoutAccount();
      toast.success('账户状态已刷新');
      await load();
    } catch (error: unknown) {
      notifyError(error, '刷新失败');
    }
  };

  const fmt = (v: string | undefined): string =>
    `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const period = (s: Settlement): string => {
    const start = new Date(s.periodStart).toLocaleDateString('zh-CN');
    const end = new Date(s.periodEnd).toLocaleDateString('zh-CN');
    return `${start} — ${end}`;
  };

  return (
    <div className="space-y-4">
      <SellerPageHeader
        title="结算中心"
        description="平台按周期结算已支付订单，扣除退款与佣金后的净额打款给你。"
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FlowStat label="待结算" value={fmt(summary?.pendingAmount)} icon={Wallet} />
        <FlowStat label="已结算" value={fmt(summary?.paidAmount)} icon={TrendingUp} />
        <FlowStat label="待结算单" value={String(summary?.pendingCount ?? 0)} icon={Package} />
        <FlowStat
          label="平台佣金"
          value={commission ? `${Number(commission.rate).toFixed(2)}%` : '—'}
          icon={Percent}
        />
      </div>

      {commission && (
        <FlowPanel>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[var(--flow-text-2)]">
            <span>
              佣金费率 <strong className="text-[var(--flow-text-1)]">{Number(commission.rate).toFixed(2)}%</strong>
              {commission.sellerId === null && <span className="ml-1 text-[var(--flow-text-3)]">（平台默认）</span>}
            </span>
            <span>
              每单固定手续费 <strong className="text-[var(--flow-text-1)]">{fmt(commission.fixedFee)}</strong>
            </span>
            {commission.note && <span className="text-[var(--flow-text-3)]">{commission.note}</span>}
          </div>
        </FlowPanel>
      )}

      <FlowPanel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-[var(--flow-text-2)]">收款账户</span>
          {!payout?.configured ? (
            <>
              <span className="text-[var(--flow-warn)]">
                未开通
                <span className="ml-1 text-[var(--flow-text-3)]">
                  （{payout?.stripeConfigured ? '开通后才能接收打款' : '平台未配置 Stripe Connect'}）
                </span>
              </span>
              {payout?.stripeConfigured && (
                <Button variant="outline" size="sm" onClick={() => void handleOpenAccount()}>
                  <CreditCard className="mr-1.5 size-3.5" />
                  开通收款账户
                </Button>
              )}
            </>
          ) : (
            <>
              <span className="font-mono text-[var(--flow-text-1)]">{payout.accountId}</span>
              <FlowStatus tone={payout.payoutsEnabled ? 'ok' : payout.detailsSubmitted ? 'warn' : 'idle'}>
                {payout.payoutsEnabled ? '可收款' : payout.detailsSubmitted ? '待验证' : '资料未完成'}
              </FlowStatus>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void handleRefreshAccount()}>刷新状态</Button>
                {!payout.payoutsEnabled && (
                  <Button variant="outline" size="sm" onClick={() => void handleOpenAccount()}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    继续填写
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </FlowPanel>

      <FlowPanel>
        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--flow-text-2)]">加载中…</div>
        ) : settlements.length === 0 ? (
          <FlowEmpty
            title="还没有结算单"
            description="结算单由平台按周期生成。订单完成支付后，下一个结算周期即可看到。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>结算单号</TableHead>
                <TableHead>周期</TableHead>
                <TableHead className="text-right">毛额</TableHead>
                <TableHead className="text-right">退款</TableHead>
                <TableHead className="text-right">佣金</TableHead>
                <TableHead className="text-right">净额</TableHead>
                <TableHead>状态</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlements.map((s) => (
                <React.Fragment key={s.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{s.settlementNo}</TableCell>
                    <TableCell className="text-xs text-[var(--flow-text-2)]">{period(s)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(s.grossAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-[var(--flow-warn)]">
                      {Number(s.refundAmount) > 0 ? `-${fmt(s.refundAmount)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[var(--flow-text-2)]">
                      -{fmt(s.commissionAmount)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmt(s.netAmount)}</TableCell>
                    <TableCell>
                      <FlowStatus tone={s.status === 'paid' ? 'ok' : 'warn'}>
                        {s.status === 'paid' ? '已打款' : '待打款'}
                      </FlowStatus>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {isAdmin && s.status === 'pending' && Number(s.netAmount) > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={paying === s.id}
                            onClick={() => void handlePayout(s.id)}
                          >
                            {paying === s.id ? '打款中…' : '打款'}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                        >
                          <ChevronDown className={`size-3.5 transition-transform ${expanded === s.id ? 'rotate-180' : ''}`} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === s.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-[var(--flow-surface-2)] p-0">
                        <div className="px-4 py-3">
                          <div className="mb-2 flex flex-wrap items-center gap-x-4 text-xs text-[var(--flow-text-2)]">
                            <span>{s.orderCount} 单，其中 {s.refundCount} 单发生退款</span>
                            <span>固定手续费合计 {fmt(s.fixedFeeTotal)}</span>
                            {s.payoutId && <span className="font-mono">流水 {s.payoutId}</span>}
                            {s.payoutError && <span className="text-[var(--flow-danger)]">打款失败：{s.payoutError}</span>}
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">订单号</TableHead>
                                <TableHead className="text-xs">支付时间</TableHead>
                                <TableHead className="text-right text-xs">毛额</TableHead>
                                <TableHead className="text-right text-xs">退款</TableHead>
                                <TableHead className="text-right text-xs">佣金</TableHead>
                                <TableHead className="text-right text-xs">净额</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {s.lineItems.map((line) => (
                                <TableRow key={line.orderNo}>
                                  <TableCell className="font-mono text-xs">{line.orderNo}</TableCell>
                                  <TableCell className="text-xs text-[var(--flow-text-3)]">
                                    {line.paidAt ? new Date(line.paidAt).toLocaleString('zh-CN') : '—'}
                                  </TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">{fmt(line.gross)}</TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">
                                    {Number(line.refund) > 0 ? `-${fmt(line.refund)}` : '—'}
                                  </TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">-{fmt(line.commission)}</TableCell>
                                  <TableCell className="text-right text-xs font-medium tabular-nums">{fmt(line.net)}</TableCell>
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
    </div>
  );
};

export default SettlementPage;
