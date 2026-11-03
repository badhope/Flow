import React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { FlowPanel } from '@/components/seller/SellerUI';
import type { AIReportDetail, AIReportSummary } from '@shared/api.interface';

interface ReportHistoryPanelProps {
  zh: boolean;
  reports: AIReportSummary[];
  activeReport: AIReportDetail | null;
  onView: (id: string) => void;
  onClose: () => void;
}

/** Persisted trend reports with inline drill-down. */
const ReportHistoryPanel: React.FC<ReportHistoryPanelProps> = ({ zh, reports, activeReport, onView, onClose }) => (
  <FlowPanel
    title={zh ? '历史报告' : 'Report history'}
    description={zh ? '已生成的趋势报告落库保存，可随时回看' : 'Saved trend reports, reviewable anytime'}
    icon={Clock}
  >
    {reports.length === 0 ? (
      <p className="py-4 text-center text-sm text-muted-foreground">暂无历史报告</p>
    ) : (
      <div className="space-y-2">
        {reports.map((report) => (
          <div key={report.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{report.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(report.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}
                {report.model ? ` · ${report.model}` : ''}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onView(report.id)}>
              查看
            </Button>
          </div>
        ))}
      </div>
    )}
    {activeReport && (
      <div className="mt-4 rounded-lg border p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">{activeReport.title}</div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            收起
          </Button>
        </div>
        <div className="prose prose-sm max-w-none">
          <Markdown>{activeReport.content}</Markdown>
        </div>
      </div>
    )}
  </FlowPanel>
);

export default ReportHistoryPanel;
