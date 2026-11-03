import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface TraceStep {
  id: string;
  label: string;
  /** 工具名（mono 展示） */
  tool?: string;
  /** 状态：待执行 / 运行中 / 完成 / 失败 */
  status: 'pending' | 'running' | 'done' | 'failed';
  /** 耗时（ms），完成后展示 */
  durationMs?: number;
  /** 参数摘要 */
  detail?: string;
}

interface AgentTraceProps {
  steps: TraceStep[];
  title?: string;
  defaultOpen?: boolean;
  /** 折叠态下总计耗时 */
  totalMs?: number;
}

/**
 * Agent 运行轨迹（Shape of AI: Action plan / Footprints）。
 * - 逐步骤状态点：空心=待执行、脉冲=运行中、填充=完成、红色=失败
 * - 完成后可折叠为一行摘要
 * - 只在有 >= 2 步时出现（单步查询不需要轨迹）
 */
const AgentTrace: React.FC<AgentTraceProps> = ({
  steps,
  title,
  defaultOpen = true,
  totalMs,
}) => {
  const { language } = useLanguage();
  const zh = language === 'zh';
  const [open, setOpen] = useState(defaultOpen);

  if (steps.length === 0) return null;

  const done = steps.filter((s) => s.status === 'done').length;
  const failed = steps.some((s) => s.status === 'failed');
  const running = steps.some((s) => s.status === 'running');
  const summary = failed
    ? zh
      ? `${done}/${steps.length} 步完成，有失败`
      : `${done}/${steps.length} steps, one failed`
    : running
      ? zh
        ? `执行中 ${done}/${steps.length}`
        : `Running ${done}/${steps.length}`
      : zh
        ? `${steps.length} 步完成`
        : `${steps.length} steps done`;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--flow-surface-2)]"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-[var(--flow-text-3)]" />
        ) : (
          <ChevronRight className="size-3.5 text-[var(--flow-text-3)]" />
        )}
        <span className="text-xs font-medium text-[var(--flow-text-2)]">
          {title ?? (zh ? '执行计划' : 'Action plan')}
        </span>
        <span className="flow-mono ml-auto text-[11px] text-[var(--flow-text-3)]">
          {summary}
          {totalMs !== undefined && ` · ${(totalMs / 1000).toFixed(1)}s`}
        </span>
      </button>

      {open && (
        <ol className="border-t border-[var(--flow-line-1)] px-3 py-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2.5 py-1.5">
              <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                {step.status === 'done' && (
                  <Check className="size-3.5 text-[var(--flow-ok)]" />
                )}
                {step.status === 'running' && (
                  <Loader2 className="size-3.5 animate-spin text-[var(--flow-accent)]" />
                )}
                {step.status === 'failed' && <X className="size-3.5 text-[var(--flow-danger)]" />}
                {step.status === 'pending' && (
                  <span className="size-2 rounded-full border border-[var(--flow-line-3)]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs leading-5 text-[var(--flow-text-1)]">
                  {step.label}
                </span>
                {(step.tool || step.detail) && (
                  <span className="flow-mono block truncate text-[11px] text-[var(--flow-text-3)]">
                    {step.tool}
                    {step.tool && step.detail ? ' · ' : ''}
                    {step.detail}
                  </span>
                )}
              </span>
              {step.durationMs !== undefined && (
                <span className="flow-mono shrink-0 text-[11px] text-[var(--flow-text-3)]">
                  {(step.durationMs / 1000).toFixed(2)}s
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default AgentTrace;
