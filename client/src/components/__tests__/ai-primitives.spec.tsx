// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApprovalCard from '@/components/ApprovalCard';
import AgentTrace, { type TraceStep } from '@/components/AgentTrace';
import { FlowStatus, FlowStat, FlowEmpty } from '@/components/seller/SellerUI';
import { LanguageProvider } from '@/contexts/LanguageContext';

const wrap = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

const pendingAction = {
  id: 'a1',
  conversationId: 'c1',
  toolName: 'approve_refund',
  kind: 'write' as const,
  summary: '批准退款 RF-1001（$58.00）',
  args: { refundNo: 'RF-1001', amount: '58.00' },
  status: 'pending' as const,
  createdAt: new Date().toISOString(),
};

describe('ApprovalCard R1: 写操作必须人工批准', () => {
  it('R1: pending 动作展示批准与拒绝两个按钮', () => {
    wrap(<ApprovalCard action={pendingAction} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByRole('button', { name: /批准执行|Approve/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /拒绝|Reject/ })).toBeTruthy();
  });

  it('R1: 高风险工具的批准按钮带风险标识', () => {
    wrap(<ApprovalCard action={pendingAction} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/高风险|HIGH/)).toBeTruthy();
  });

  it('R1: 已执行动作不再提供批准按钮（防重复审批）', () => {
    wrap(
      <ApprovalCard
        action={{ ...pendingAction, status: 'executed', result: '已退款 $58.00' }}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /批准执行|Approve/ })).toBeNull();
    expect(screen.getByText('已退款 $58.00')).toBeTruthy();
  });

  it('R1: 点击批准只触发一次回调', () => {
    let called = 0;
    wrap(
      <ApprovalCard
        action={pendingAction}
        onApprove={() => {
          called += 1;
        }}
        onReject={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /批准执行|Approve/ }));
    expect(called).toBe(1);
  });
});

describe('AgentTrace R2: 工具轨迹状态可见', () => {
  const steps: TraceStep[] = [
    { id: 's1', label: '读取待审批退款', tool: 'list_pending_refunds', status: 'done', durationMs: 320 },
    { id: 's2', label: '生成退款批准动作', tool: 'approve_refund', status: 'pending' },
  ];

  it('R2: 多步骤展示计划标题与步骤数', () => {
    wrap(<AgentTrace steps={steps} />);
    expect(screen.getByText(/执行计划|Action plan/)).toBeTruthy();
    expect(screen.getByText(/读取待审批退款/)).toBeTruthy();
    expect(screen.getByText(/生成退款批准动作/)).toBeTruthy();
  });

  it('R2: 空步骤不渲染（避免空壳）', () => {
    const { container } = wrap(<AgentTrace steps={[]} />);
    expect(container.textContent).toBe('');
  });

  it('R2: 单步也可展示（工具足迹）', () => {
    wrap(<AgentTrace steps={[steps[0]]} />);
    expect(screen.getByText(/读取待审批退款/)).toBeTruthy();
  });

  it('R2: 折叠后步骤内容隐藏、摘要保留', () => {
    wrap(<AgentTrace steps={steps} defaultOpen={false} />);
    expect(screen.queryByText(/读取待审批退款/)).toBeNull();
    expect(screen.getByText(/步完成|steps done/)).toBeTruthy();
  });
});

describe('SellerUI R3: 统一页面原语', () => {
  it('R3: 指标块展示标签与数值', () => {
    wrap(<FlowStat label="GMV" value="$12,480.00" hint="近 30 天" />);
    expect(screen.getByText('GMV')).toBeTruthy();
    expect(screen.getByText('$12,480.00')).toBeTruthy();
  });

  it('R3: 空态展示标题与说明', () => {
    wrap(<FlowEmpty title="暂无商品" description="先在商品管理里创建第一个商品" />);
    expect(screen.getByText('暂无商品')).toBeTruthy();
    expect(screen.getByText('先在商品管理里创建第一个商品')).toBeTruthy();
  });

  it('R3: 状态徽标按语义着色（不依赖页面自定义 CSS）', () => {
    const { container } = wrap(<FlowStatus tone="danger">执行失败</FlowStatus>);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('flow-danger');
  });
});
