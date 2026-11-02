import React, { useRef } from 'react';
import { CheckCircle, Download, FileText, Upload, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ImportFailure, ImportProductsResponse } from '@shared/api.interface';
import { validateCsvFile } from './schema';

export { validateCsvFile };

interface ImportDialogProps {
  open: boolean;
  loading: boolean;
  result: ImportProductsResponse | null;
  dragOver: boolean;
  onDragOver: (over: boolean) => void;
  onDrop: (event: React.DragEvent) => void;
  onSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
  onClose: () => void;
}

/** CSV bulk import: drag-and-drop, template download, per-row failure report. */
const ImportDialog: React.FC<ImportDialogProps> = ({
  open,
  loading,
  result,
  dragOver,
  onDragOver,
  onDrop,
  onSelect,
  onDownloadTemplate,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-600" />
            批量导入商品
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!result && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  onDragOver(true);
                }}
                onDragLeave={() => onDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                }`}
              >
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onSelect} />
                {loading ? (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <div className="size-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
                    </div>
                    <div className="text-sm text-slate-600">正在导入...</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FileText className="mx-auto size-12 text-slate-400" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">拖拽 CSV 文件到此处</div>
                      <div className="mt-1 text-xs text-slate-500">或点击选择文件</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={onDownloadTemplate}
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                >
                  <Download className="size-4" />
                  下载模板
                </button>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <CheckCircle className="mx-auto mb-1 size-6 text-emerald-600" />
                  <div className="text-2xl font-bold text-emerald-700">{result.successCount}</div>
                  <div className="text-xs text-emerald-600">成功</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
                  <XCircle className="mx-auto mb-1 size-6 text-red-600" />
                  <div className="text-2xl font-bold text-red-700">{result.failCount}</div>
                  <div className="text-xs text-red-600">失败</div>
                </div>
              </div>

              {result.failures.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-900">失败详情</div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border bg-slate-50">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr>
                          <th className="w-20 px-3 py-2 text-left text-xs font-medium text-slate-600">行号</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failures.map((f: ImportFailure) => (
                          <tr key={f.row} className="border-t border-slate-200">
                            <td className="px-3 py-2 font-mono text-slate-600">{f.row}</td>
                            <td className="px-3 py-2 text-slate-700">{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>完成</Button>
          ) : (
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportDialog;
