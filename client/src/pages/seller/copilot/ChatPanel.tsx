import React from 'react';
import { Bot, ChevronRight, Loader2, Send, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

export const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: '店铺概况', prompt: '看一下店铺概况，今天表现怎么样？' },
  { label: '待发货订单', prompt: '帮我查一下待发货的订单' },
  { label: '库存预警', prompt: '哪些商品库存偏低？' },
  { label: '待审批退款', prompt: '现在有哪些待审批的退款？' },
];

interface ChatPanelProps {
  hasMessages: boolean;
  loadingDetail: boolean;
  sending: boolean;
  input: string;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: (text?: string) => void;
  onNew: () => void;
  children: React.ReactNode;
}

/** Right pane: transcript, empty state, composer. Message rendering is injected. */
const ChatPanel: React.FC<ChatPanelProps> = ({
  hasMessages,
  loadingDetail,
  sending,
  input,
  bottomRef,
  onInputChange,
  onSend,
  onNew,
  children,
}) => (
  <Card className="flow-panel flex min-w-0 flex-1 flex-col overflow-hidden border-[var(--flow-line-1)] bg-[var(--flow-surface-1)]">
    <div className="flex items-center justify-between border-b border-[var(--flow-line-1)] px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--flow-accent-soft)] text-[var(--flow-accent)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--flow-text-1)]">AI 运营副驾</div>
          <div className="text-xs text-[var(--flow-text-3)]">读取真实数据 · 写操作需要人工批准</div>
        </div>
      </div>
      <Button size="sm" variant="outline" className="md:hidden" onClick={onNew}>
        <Sparkles className="h-4 w-4" />
      </Button>
    </div>

    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-4">
        {!hasMessages && !loadingDetail && (
          <div className="mx-auto max-w-2xl py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--flow-accent-soft)] text-[var(--flow-accent)]">
              <Bot className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">今天想处理什么？</h2>
            <p className="mt-1 text-sm text-slate-500">
              副驾会先查真实数据再回答；发货、退款、发券等写操作一律要你点确认。
            </p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  onClick={() => onSend(item.prompt)}
                  disabled={sending}
                >
                  <span>{item.label}</span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingDetail && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载对话
          </div>
        )}

        {children}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 副驾正在查询与思考…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>

    <CardContent className="border-t p-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="例如：把订单 ORD... 标记为已发货；或：哪些商品库存偏低？"
          rows={2}
          className="resize-none"
          disabled={sending}
        />
        <Button onClick={() => onSend()} disabled={sending || input.trim().length === 0} className="h-10">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          发送
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldAlert className="h-3.5 w-3.5" />
        写操作会先生成待确认动作，未经你批准不会执行
      </div>
    </CardContent>
  </Card>
);

export default ChatPanel;
