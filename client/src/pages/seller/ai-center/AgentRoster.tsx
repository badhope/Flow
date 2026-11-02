import React from 'react';
import { Bot, Plus } from 'lucide-react';
import { FlowPanel } from '@/components/seller/SellerUI';
import type { BuiltinAgentMeta, CustomAgent } from '@shared/api.interface';

interface AgentRosterProps {
  zh: boolean;
  builtin: BuiltinAgentMeta[];
  custom: CustomAgent[];
  runAgentId: string | null;
  runInput: string;
  runOutput: string | null;
  onRunInputChange: (value: string) => void;
  onCreate: () => void;
  onRun: (agent: CustomAgent) => void;
  onEdit: (agent: CustomAgent) => void;
  onRemove: (agent: CustomAgent) => void;
}

/** Agent roster: built-ins are read-only, custom agents can be run, edited and removed. */
const AgentRoster: React.FC<AgentRosterProps> = ({
  zh,
  builtin,
  custom,
  runAgentId,
  runInput,
  runOutput,
  onRunInputChange,
  onCreate,
  onRun,
  onEdit,
  onRemove,
}) => {
  const entries = [
    ...builtin.map((agent) => ({ kind: 'builtin' as const, agent })),
    ...custom.map((agent) => ({ kind: 'custom' as const, agent })),
  ];

  return (
    <FlowPanel
      title={zh ? 'Agent 名册' : 'Agent roster'}
      description={
        zh
          ? '内置 Agent 只读；自定义 Agent 可编辑提示词与输出格式'
          : 'Built-ins are read-only; custom agents are fully editable'
      }
      icon={Bot}
      actions={
        <button type="button" onClick={onCreate} className="flow-btn-accent h-8 text-xs">
          <Plus className="size-3.5" />
          {zh ? '新建 Agent' : 'New agent'}
        </button>
      }
      bodyClassName="space-y-4"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => {
          const key = entry.kind === 'builtin' ? entry.agent.key : entry.agent.id;
          const isRunning = entry.kind === 'custom' && runAgentId === entry.agent.id;
          return (
            <div
              key={key}
              className="rounded-lg border border-[var(--flow-line-1)] bg-[var(--flow-surface-2)] p-3"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--flow-accent-soft)]">
                  <Bot className="size-3.5 text-[var(--flow-accent)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-[var(--flow-text-1)]">
                      {entry.agent.name}
                    </span>
                    <span className="shrink-0 rounded border border-[var(--flow-line-2)] px-1 text-[9px] text-[var(--flow-text-3)]">
                      {entry.kind === 'builtin' ? (zh ? '内置' : 'builtin') : zh ? '自定义' : 'custom'}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--flow-text-2)]">
                    {entry.agent.description}
                  </p>
                  {entry.kind === 'custom' && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onRun(entry.agent)}
                        className="text-[11px] text-[var(--flow-accent)] transition-opacity hover:opacity-80"
                      >
                        {zh ? '试跑' : 'Run'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(entry.agent)}
                        className="text-[11px] text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-text-1)]"
                      >
                        {zh ? '编辑' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(entry.agent)}
                        className="text-[11px] text-[var(--flow-text-3)] transition-colors hover:text-[var(--flow-danger)]"
                      >
                        {zh ? '删除' : 'Delete'}
                      </button>
                    </div>
                  )}
                  {isRunning && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={runInput}
                        onChange={(e) => onRunInputChange(e.target.value)}
                        placeholder={zh ? '输入内容后试跑' : 'Input to test'}
                        className="h-8 w-full rounded-md border border-[var(--flow-line-2)] bg-[var(--flow-surface-1)] px-2 text-[11px] text-[var(--flow-text-1)] outline-none placeholder:text-[var(--flow-text-3)]"
                      />
                      {runOutput && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--flow-surface-1)] p-2 text-[10px] text-[var(--flow-text-2)]">
                          {runOutput}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </FlowPanel>
  );
};

export default AgentRoster;
