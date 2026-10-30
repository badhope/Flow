import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, Loader2, Send, ShoppingBag, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/contexts/LanguageContext';
import { shopperApi } from '@/api';
import type { CopilotAction, CopilotMessage } from '@shared/api.interface';
import { toast } from 'sonner';
import { extractErrorMessage } from '@/lib/error-feedback';

const COPY: Record<string, {
  title: string;
  placeholder: string;
  welcome: string;
  hint: string;
  confirm: string;
  reject: string;
  quick: string[];
}> = {
  zh: {
    title: 'AI 导购',
    placeholder: '想找什么商品？',
    welcome: '你好，我是 AI 导购。告诉我你的需求（品类、预算、用途），我帮你从在售商品里挑。',
    hint: '推荐均来自店铺真实在售商品',
    confirm: '加入购物车',
    reject: '不用了',
    quick: ['帮我推荐耳机', '你们卖什么？', '看看我的购物车'],
  },
  en: {
    title: 'AI Shopping Assistant',
    placeholder: 'What are you looking for?',
    welcome: 'Hi! Tell me what you need (category, budget, use case) and I will pick from items actually in stock.',
    hint: 'Recommendations come from real in-stock items',
    confirm: 'Add to cart',
    reject: 'No thanks',
    quick: ['Recommend headphones', 'What do you sell?', 'Show my cart'],
  },
  es: {
    title: 'Asistente de compras IA',
    placeholder: '¿Qué buscas?',
    welcome: 'Hola, dime qué necesitas y te recomiendo productos reales en stock.',
    hint: 'Recomendaciones de productos reales',
    confirm: 'Añadir al carrito',
    reject: 'No, gracias',
    quick: ['Recomiéndame auriculares', '¿Qué venden?', 'Ver mi carrito'],
  },
  pt: {
    title: 'Assistente de compras IA',
    placeholder: 'O que você procura?',
    welcome: 'Olá! Diga o que precisa e eu recomendo produtos reais em estoque.',
    hint: 'Recomendações de produtos reais',
    confirm: 'Adicionar ao carrinho',
    reject: 'Não, obrigado',
    quick: ['Recomende fones', 'O que vocês vendem?', 'Ver meu carrinho'],
  },
};

const ShopperWidget: React.FC = () => {
  const { language } = useLanguage();
  const copy = COPY[language] ?? COPY.zh;

  const [open, setOpen] = useState<boolean>(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [actions, setActions] = useState<CopilotAction[]>([]);
  const [input, setInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onIntent = (event: Event): void => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;
      setOpen(true);
      void handleSend(text);
    };
    window.addEventListener('flow:shopper-intent', onIntent);
    return () => window.removeEventListener('flow:shopper-intent', onIntent);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, sending, open]);

  // 再次打开时恢复上一次会话（同一 sessionId 的用户体验连续）
  useEffect(() => {
    if (!open || conversationId) return;
    void (async () => {
      try {
        const rows = await shopperApi.listShopperConversations();
        if (rows.length === 0) return;
        const detail = await shopperApi.getShopperConversation(rows[0].id);
        setConversationId(detail.conversation.id);
        setMessages(detail.messages);
        setActions(detail.actions);
      } catch {
        // 历史会话加载失败不影响新对话
      }
    })();
  }, [open, conversationId]);

  const ensureConversation = async (): Promise<string> => {
    if (conversationId) return conversationId;
    const created = await shopperApi.createShopperConversation();
    setConversationId(created.id);
    return created.id;
  };

  const handleSend = async (text?: string): Promise<void> => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setSending(true);
    setInput('');
    const optimistic: CopilotMessage = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? '',
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const id = await ensureConversation();
      const result = await shopperApi.sendShopperMessage(id, content);
      setMessages((prev) => [
        ...prev.filter((message) => !message.id.startsWith('local-')),
        ...result.messages,
      ]);
      setActions((prev) => {
        const map = new Map(prev.map((action) => [action.id, action]));
        for (const action of result.actions) map.set(action.id, action);
        return Array.from(map.values());
      });
    } catch (err) {
      toast.error(extractErrorMessage(err, 'AI 导购暂时不可用'));
      setMessages((prev) => prev.filter((message) => !message.id.startsWith('local-')));
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async (action: CopilotAction, approve: boolean): Promise<void> => {
    setResolvingId(action.id);
    try {
      const result = await shopperApi.resolveShopperAction(action.id, approve);
      setActions((prev) => prev.map((item) => (item.id === action.id ? result.action : item)));
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          conversationId: conversationId ?? '',
          role: 'assistant',
          content: result.message,
          createdAt: new Date().toISOString(),
        },
      ]);
      toast.success(result.message);
    } catch (err) {
      toast.error(extractErrorMessage(err, '操作失败'));
    } finally {
      setResolvingId(null);
    }
  };

  const renderAction = (action: CopilotAction): React.ReactNode => (
    <div key={action.id} className="mt-2 rounded-lg border border-[#00C2B8]/40 bg-teal-50 p-2.5 text-sm">
      <div className="flex items-center gap-1.5 text-xs text-teal-700">
        <ShoppingBag className="h-3.5 w-3.5" />
        {action.status === 'pending' ? '待确认' : action.status === 'executed' ? '已加入购物车' : '未执行'}
      </div>
      <div className="mt-1 font-medium text-slate-800">{action.summary}</div>
      {action.result && <div className="mt-1 text-xs text-slate-600">{action.result}</div>}
      {action.status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => void handleResolve(action, true)} disabled={resolvingId === action.id}>
            {resolvingId === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {copy.confirm}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleResolve(action, false)} disabled={resolvingId === action.id}>
            <X className="h-3.5 w-3.5" />
            {copy.reject}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed bottom-24 right-6 z-40 flex flex-col items-end gap-3">
      {open && (
        <Card className="flex h-[30rem] w-80 flex-col overflow-hidden rounded-xl shadow-xl sm:w-96">
          <div className="flex items-center justify-between bg-[#0B1F3A] p-3.5 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#00C2B8]" />
              <span className="text-sm font-semibold">{copy.title}</span>
              <Badge className="bg-[#00C2B8]/20 text-[10px] text-[#00C2B8]">AI</Badge>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white hover:bg-white/10" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1 p-3">
            <div className="space-y-3">
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
                  {copy.welcome}
                </div>
              </div>

              {messages.length === 0 && (
                <div className="space-y-1.5 pt-1">
                  {copy.quick.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                      onClick={() => void handleSend(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((message) => {
                if (message.role === 'tool') return null;
                const isUser = message.role === 'user';
                const action = message.actionId
                  ? actions.find((item) => item.id === message.actionId)
                  : undefined;
                return (
                  <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] ${isUser ? 'text-right' : ''}`}>
                      <div
                        className={`inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                          isUser ? 'bg-[#0B1F3A] text-white' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {message.content}
                      </div>
                      {action && renderAction(action)}
                    </div>
                  </div>
                );
              })}

              {sending && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> …
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="border-t p-2.5">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={copy.placeholder}
                disabled={sending}
              />
              <Button size="icon" onClick={() => void handleSend()} disabled={sending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-1.5 text-[10px] text-slate-400">{copy.hint}</div>
          </div>
        </Card>
      )}

      <Button
        size="lg"
        className="size-12 rounded-full bg-[#00C2B8] shadow-lg hover:bg-[#00a89f]"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={copy.title}
      >
        <Bot className="size-5" />
      </Button>
    </div>
  );
};

export default ShopperWidget;
