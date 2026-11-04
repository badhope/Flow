import React from 'react';
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToolContract } from '@/contexts/ToolContractContext';
import type { CopilotAction } from '@shared/api.interface';

/**
 * 风险元数据从服务端工具契约读取（见 ToolContractContext），前端不再维护第二份映射表。
 * 契约尚未加载时回退到 medium（保守，不误标为 low）。
 */

const RISK_STYLE = {
  low: {
    label: { zh: '低风险', en: 'LOW' },
    cls: 'border-[var(--flow-ok)]/40 text-[var(--flow-ok)] bg-[var(--flow-ok)]/10',
    icon: Check,
  },
  medium: {
    label: { zh: '需确认', en: 'MED' },
    cls: 'border-[var(--flow-warn)]/40 text-[var(--flow-warn)] bg-[var(--flow-warn)]/10',
    icon: AlertTriangle,
  },
  high: {
    label: { zh: '高风险', en: 'HIGH' },
    cls: 'border-[var(--flow-danger)]/40 text-[var(--flow-danger)] bg-[var(--flow-danger)]/10',
    icon: ShieldAlert,
  },
} as const;

interface ApprovalCardProps {
  action: CopilotAction;
  onApprove: (id: string) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
  busy?: boolean;
}

/**
 * 审批门禁卡（Shape of AI: Verification / Governors）。
 * 写操作在模型循环内永不执行，必须在此卡片上人工批准。
 * 视觉：左侧 2px 风险色条 + 风险徽标 + 参数摘要 + 批准/拒绝。
 */
const ApprovalCard: React.FC<ApprovalCardProps> = ({ action, onApprove, onReject, busy }) => {
  const { language } = useLanguage();
  const zh = language === 'zh';
  const contract = useToolContract(action.toolName);
  const meta = {
    risk: (contract?.risk ?? 'medium') as 'low' | 'medium' | 'high',
    zh: contract?.labelZh || action.toolName,
    en: contract?.labelEn || action.toolName,
  };
  const style = RISK_STYLE[meta.risk];
  const RiskIcon = style.icon;

  const args = Object.entries(action.args ?? {}).filter(([, v]) => v !== undefined && v !== null);

  return (
    <div className="flow-fade-in my-3 overflow-hidden rounded-xl border border-[var(--flow-line-2)] bg-[var(--flow-surface-2)]">
      <div className={`h-0.5 w-full ${meta.risk === 'high' ? 'bg-[var(--flow-danger)]' : meta.risk === 'medium' ? 'bg-[var(--flow-warn)]' : 'bg-[var(--flow-ok)]'}`} />

      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${style.cls}`}>
            <RiskIcon className="size-3" />
            {style.label[zh ? 'zh' : 'en']}
          </span>
          <span className="text-sm font-medium text-[var(--flow-text-1)]">
            {zh ? meta.zh : meta.en}
          </span>
          {contract?.irreversible && (
            <span className="rounded bg-[var(--flow-danger)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--flow-danger)]">
              {zh ? '不可逆' : 'IRREVERSIBLE'}
            </span>
          )}
          <span className="flow-mono ml-auto text-[11px] text-[var(--flow-text-3)]">
            {action.toolName}
          </span>
        </div>

        <p className="mb-2.5 text-xs leading-relaxed text-[var(--flow-text-2)]">
          {action.summary}
        </p>

        {args.length > 0 && (
          <div className="mb-3 rounded-lg border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] px-2.5 py-2">
            <div className="flow-caption mb-1">{zh ? '将执行' : 'Will execute'}</div>
            <dl className="space-y-0.5">
              {args.map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-2">
                  <dt className="flow-mono shrink-0 text-[11px] text-[var(--flow-text-3)]">{key}</dt>
                  <dd className="flow-mono min-w-0 flex-1 truncate text-[11px] text-[var(--flow-text-1)]">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="flex items-center gap-2">
          {action.status === 'pending' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onApprove(action.id)}
                className="flow-btn-accent h-8 flex-1 text-xs disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {zh ? '批准执行' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onReject(action.id)}
                className="flow-btn-ghost h-8 px-3 text-xs disabled:opacity-50"
              >
                <X className="size-3.5" />
                {zh ? '拒绝' : 'Reject'}
              </button>
            </>
          ) : (
            <div className="flex w-full items-center gap-2 rounded-lg border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)] px-3 py-2 text-xs text-[var(--flow-text-2)]">
              {action.status === 'executed' ? <Check className="size-3.5 text-[var(--flow-ok)]" /> : <X className="size-3.5 text-[var(--flow-text-3)]" />}
              <span>{action.result || (zh ? `动作已${action.status === 'rejected' ? '拒绝' : '处理'}` : `Action ${action.status}`)}</span>
            </div>
          )}
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-[var(--flow-text-3)]">
          {zh
            ? '批准后按业务规则执行（状态机 / 库存 / 积分 / 审计）。模型无法自行执行写操作。'
            : 'Runs through real business rules (state machine / stock / points / audit). The model cannot self-execute writes.'}
        </p>
      </div>
    </div>
  );
};

export default ApprovalCard;
