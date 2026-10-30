import React from 'react';
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CopilotAction } from '@shared/api.interface';

/** 工具 -> 风险等级与中文说明（写操作都要过人工门禁） */
const TOOL_META: Record<string, { risk: 'low' | 'medium' | 'high'; zh: string; en: string }> = {
  update_order_status: { risk: 'medium', zh: '修改订单状态', en: 'Change order status' },
  approve_refund: { risk: 'high', zh: '批准退款（真实打款）', en: 'Approve refund (real payout)' },
  reject_refund: { risk: 'medium', zh: '拒绝退款申请', en: 'Reject refund request' },
  update_product_status: { risk: 'low', zh: '商品上下架', en: 'Toggle product status' },
  create_coupon: { risk: 'medium', zh: '创建优惠券', en: 'Create coupon' },
  create_draft_product: { risk: 'low', zh: '创建商品草稿', en: 'Create product draft' },
  send_inquiry_reply: { risk: 'low', zh: '回复买家咨询', en: 'Reply to buyer inquiry' },
};

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
  const meta = TOOL_META[action.toolName] ?? { risk: 'medium' as const, zh: action.toolName, en: action.toolName };
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
