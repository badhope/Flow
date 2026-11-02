import React from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CopilotInsightThresholds } from '@shared/api.interface';

export interface WatchSettings {
  enabled: boolean;
  intervalMinutes: number;
  notifyKind: 'webhook' | 'email' | 'none';
  notifyUrl?: string;
  notifySmtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
    to: string;
  };
  notifyOnlyOnNew: boolean;
  notifySubjectTemplate: string;
}

interface WatchSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  watch: WatchSettings | null;
  watchSaving: boolean;
  watchRunning: boolean;
  thresholdsDraft: CopilotInsightThresholds | null;
  thresholdsSaving: boolean;
  preview: { subject: string; body: string; format: string } | null;
  previewLoading: boolean;
  onWatchChange: (next: WatchSettings) => void;
  onSaveWatch: (patch: Partial<WatchSettings>) => void;
  onRunWatch: () => void;
  onLoadPreview: (format: 'markdown' | 'html') => void;
  onThresholdsChange: (next: CopilotInsightThresholds) => void;
  onSaveThresholds: () => void;
}

/** Store-watch configuration: schedule, notification channel and alert thresholds. */
const WatchSettingsDialog: React.FC<WatchSettingsDialogProps> = ({
  open,
  onOpenChange,
  watch,
  watchSaving,
  watchRunning,
  thresholdsDraft,
  thresholdsSaving,
  preview,
  previewLoading,
  onWatchChange,
  onSaveWatch,
  onRunWatch,
  onLoadPreview,
  onThresholdsChange,
  onSaveThresholds,
}) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>巡检设置</DialogTitle>
            <DialogDescription>调整告警阈值，保存后立即生效（留空或超范围会被拒绝）。</DialogDescription>
          </DialogHeader>
          {watch && (
            <div className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-700">定时巡检</div>
                  <div className="text-xs text-slate-500">后台按间隔自动巡检，只记录新增告警（默认关闭）</div>
                </div>
                <Switch
                  checked={watch.enabled}
                  disabled={watchSaving}
                  onCheckedChange={(checked) => onSaveWatch({ enabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">间隔（分钟，5-1440）</span>
                <Input
                  type="number"
                  className="w-24"
                  value={watch.intervalMinutes}
                  disabled={watchSaving}
                  onChange={(event) => onWatchChange({ ...watch, intervalMinutes: Number(event.target.value) })}
                  onBlur={() => onSaveWatch({ intervalMinutes: watch.intervalMinutes })}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">通知渠道</span>
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                  value={watch.notifyKind}
                  disabled={watchSaving}
                  onChange={(event) => {
                    const kind = event.target.value as 'webhook' | 'email' | 'none';
                    onWatchChange({ ...watch, notifyKind: kind });
                    onSaveWatch({ notifyKind: kind });
                  }}
                >
                  <option value="none">只写日志</option>
                  <option value="webhook">Webhook（飞书/企微/钉钉/Slack）</option>
                  <option value="email">邮件（SMTP）</option>
                </select>
              </div>
              {watch.notifyKind === 'webhook' && (
                <>
                  <Input
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    value={watch.notifyUrl ?? ''}
                    disabled={watchSaving}
                    onChange={(event) => onWatchChange({ ...watch, notifyUrl: event.target.value })}
                    onBlur={() => onSaveWatch({ notifyUrl: watch.notifyUrl ?? '' })}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={watch.notifyOnlyOnNew}
                      disabled={watchSaving}
                      onChange={(event) => {
                        const onlyNew = event.target.checked;
                        onWatchChange({ ...watch, notifyOnlyOnNew: onlyNew });
                        onSaveWatch({ notifyOnlyOnNew: onlyNew });
                      }}
                    />
                    仅在出现新增告警时通知
                  </label>
                </>
              )}
              {watch.notifyKind === 'email' && (
                <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">
                  {[
                    { key: 'host' as const, label: 'SMTP 主机', placeholder: 'smtp.example.com' },
                    { key: 'port' as const, label: '端口', placeholder: '587' },
                    { key: 'from' as const, label: '发件人', placeholder: 'bot@example.com' },
                    { key: 'to' as const, label: '收件人', placeholder: 'owner@example.com' },
                    { key: 'user' as const, label: '用户名（可选）', placeholder: 'bot@example.com' },
                    { key: 'pass' as const, label: '密码（可选）', placeholder: '••••••' },
                  ].map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-2">
                      <span className="shrink-0 text-xs text-slate-600">{field.label}</span>
                      <Input
                        className="h-8 flex-1 text-xs"
                        placeholder={field.placeholder}
                        value={
                          field.key === 'port'
                            ? String(watch.notifySmtp?.port ?? 587)
                            : String(watch.notifySmtp?.[field.key] ?? '')
                        }
                        disabled={watchSaving}
                        onChange={(event) => {
                          const smtp = {
                            host: watch.notifySmtp?.host ?? '',
                            port: watch.notifySmtp?.port ?? 587,
                            secure: watch.notifySmtp?.secure ?? false,
                            user: watch.notifySmtp?.user,
                            pass: watch.notifySmtp?.pass,
                            from: watch.notifySmtp?.from ?? '',
                            to: watch.notifySmtp?.to ?? '',
                          };
                          if (field.key === 'port') {
                            smtp.port = Number(event.target.value) || 587;
                          } else {
                            (smtp as Record<string, unknown>)[field.key] = event.target.value;
                          }
                          onWatchChange({ ...watch, notifySmtp: smtp });
                        }}
                        onBlur={() => onSaveWatch({ notifySmtp: watch.notifySmtp })}
                      />
                    </div>
                  ))}
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={watch.notifySmtp?.secure ?? false}
                      disabled={watchSaving}
                      onChange={(event) => {
                        const secure = event.target.checked;
                        if (!watch.notifySmtp) return;
                        const next = { ...watch.notifySmtp, secure };
                        onWatchChange({ ...watch, notifySmtp: next });
                        onSaveWatch({ notifySmtp: next });
                      }}
                    />
                    使用 SSL/TLS（465 端口通常需要）
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">邮件主题模板</span>
                    <Input
                      className="h-8 flex-1 text-xs"
                      placeholder="【Flow 店铺巡检】{{count}} 项待处理"
                      value={watch.notifySubjectTemplate}
                      disabled={watchSaving}
                      onChange={(event) => onWatchChange({ ...watch, notifySubjectTemplate: event.target.value })}
                      onBlur={() => onSaveWatch({ notifySubjectTemplate: watch.notifySubjectTemplate })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onLoadPreview('markdown')} disabled={previewLoading}>
                      预览 markdown
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onLoadPreview('html')} disabled={previewLoading}>
                      预览 HTML
                    </Button>
                  </div>
                  {preview && (
                    <div className="mt-1 rounded border border-slate-200 bg-slate-900 p-2">
                      <div className="mb-1 text-[11px] text-slate-400">主题：{preview.subject}</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-100">
                        {preview.format === 'html' ? preview.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : preview.body}
                      </pre>
                    </div>
                  )}
                </div>
              )}
              <Button size="sm" variant="outline" className="w-full" onClick={() => onRunWatch()} disabled={watchRunning}>
                {watchRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                立即执行一次巡检
              </Button>
            </div>
          )}
          {thresholdsDraft && (
            <div className="space-y-3">
              {[
                { key: 'lowStock' as const, label: '低库存阈值（件）', hint: '总库存低于该值告警' },
                { key: 'pendingRefundHours' as const, label: '退款超时（小时）', hint: '待审批退款超过该时长告警' },
                { key: 'unpaidOrderHours' as const, label: '未支付超时（小时）', hint: '订单创建后超过该时长未付告警' },
                { key: 'staleShippedDays' as const, label: '发货未签收（天）', hint: '发货超过该天数仍为已发货告警' },
              ].map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{field.label}</div>
                    <div className="text-xs text-slate-500">{field.hint}</div>
                  </div>
                  <Input
                    type="number"
                    className="w-24"
                    value={thresholdsDraft[field.key]}
                    onChange={(event) =>
                      onThresholdsChange({ ...thresholdsDraft, [field.key]: Number(event.target.value) })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={() => onSaveThresholds()} disabled={thresholdsSaving}>
              {thresholdsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
);

export default WatchSettingsDialog;
