import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Bot,
  Command,
  CornerDownLeft,
  LayoutDashboard,
  Package,
  Search,
  ShoppingCart,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react';
import { copilotApi } from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 全局命令面板（⌘K / Ctrl+K）。
 * Wayfinders + Prompt actions：同一个输入框既是导航，也是 AI 意图入口。
 * - 输入为空：展示导航与上下文动作
 * - 输入有词：命中导航则排在前面，同时提供「问 AI」兜底动作
 */
interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'navigate' | 'ask';
  run: () => void | Promise<void>;
}

const SellerCommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh';

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery('');
      navigate(path);
    },
    [navigate],
  );

  const askAi = useCallback(
    async (question: string) => {
      if (!question.trim() || busy) return;
      setBusy(true);
      try {
        const conversation = await copilotApi.createCopilotConversation();
        await copilotApi.sendCopilotMessage(conversation.id, question.trim());
        setOpen(false);
        setQuery('');
        navigate(`/seller/copilot?c=${conversation.id}`);
      } catch {
        navigate('/seller/copilot');
        setOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [navigate, busy],
  );

  const navItems: PaletteItem[] = useMemo(
    () => [
      { id: 'n-copilot', label: zh ? 'AI 运营副驾' : 'AI Copilot', hint: zh ? '对话 · 工具调用 · 审批' : 'Chat · tools · approvals', icon: Bot, group: 'navigate', run: () => go('/seller/copilot') },
      { id: 'n-dash', label: zh ? '数据看板' : 'Dashboard', hint: zh ? 'GMV · 趋势 · 分类' : 'GMV · trend · categories', icon: LayoutDashboard, group: 'navigate', run: () => go('/seller/dashboard') },
      { id: 'n-products', label: zh ? '商品管理' : 'Products', hint: zh ? 'SPU/SKU · 批量 · AI 文案' : 'SPU/SKU · bulk · AI copy', icon: Package, group: 'navigate', run: () => go('/seller/products') },
      { id: 'n-orders', label: zh ? '订单管理' : 'Orders', hint: zh ? '状态流转 · 发货' : 'Status · shipping', icon: ShoppingCart, group: 'navigate', run: () => go('/seller/orders') },
      { id: 'n-inquiries', label: zh ? '咨询管理' : 'Inquiries', hint: zh ? '客服会话' : 'Support threads', icon: Users, group: 'navigate', run: () => go('/seller/inquiries') },
      { id: 'n-ai', label: zh ? 'AI 分析中心' : 'AI Center', hint: zh ? 'Agent · 用量 · 模型' : 'Agents · usage · models', icon: Sparkles, group: 'navigate', run: () => go('/seller/ai-center') },
    ],
    [zh, go],
  );

  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? navItems.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            (item.hint ?? '').toLowerCase().includes(q),
        )
      : navItems;

    const askItem: PaletteItem | null = q
      ? {
          id: 'ask-ai',
          label: zh ? `问 AI：${query.trim()}` : `Ask AI: ${query.trim()}`,
          hint: zh ? '交给运营副驾，可调用工具并生成待审批动作' : 'Hand off to Copilot with tool access',
          icon: Wand2,
          group: 'ask',
          run: () => askAi(query),
        }
      : null;

    return askItem ? [askItem, ...matched] : matched;
  }, [query, navItems, askAi, zh]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isPaletteKey = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isPaletteKey) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[active];
        if (item && !busy) void item.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, active]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  if (!user || user.role === 'buyer') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-[var(--flow-line-2)] bg-[var(--flow-surface-2)] px-3 py-1.5 text-xs text-[var(--flow-text-2)] transition-colors hover:border-[var(--flow-line-3)] hover:text-[var(--flow-text-1)] md:flex"
        aria-label={zh ? '打开命令面板' : 'Open command palette'}
      >
        <Search className="size-3.5" />
        <span>{zh ? '搜索或问 AI' : 'Search or ask AI'}</span>
        <kbd className="flow-mono ml-2 rounded border border-[var(--flow-line-2)] px-1.5 py-0.5 text-[10px] text-[var(--flow-text-3)]">
          ⌘K
        </kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="flow-glass fixed left-1/2 top-[15vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl p-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              {zh ? '命令面板' : 'Command palette'}
            </DialogPrimitive.Title>

            <div className="flex items-center gap-3 border-b border-[var(--flow-line-1)] px-4 py-3.5">
              <Search className="size-4 shrink-0 text-[var(--flow-text-3)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={zh ? '跳转页面，或直接描述你想让 AI 做的事…' : 'Jump to a page, or describe what you want AI to do…'}
                className="w-full bg-transparent text-sm text-[var(--flow-text-1)] outline-none placeholder:text-[var(--flow-text-3)]"
              />
              {busy && <span className="flow-caption animate-pulse">{zh ? '连接副驾…' : 'Connecting…'}</span>}
            </div>

            <div ref={listRef} className="max-h-[min(420px,55vh)] overflow-y-auto p-2">
              {items.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-[var(--flow-text-3)]">
                  {zh ? '没有匹配项' : 'No matches'}
                </div>
              )}
              {items.map((item, index) => {
                const Icon = item.icon;
                const isActive = index === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void item.run()}
                    disabled={busy}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? 'bg-[var(--flow-accent-soft)] text-[var(--flow-text-1)]'
                        : 'text-[var(--flow-text-2)] hover:bg-[var(--flow-surface-2)]'
                    }`}
                  >
                    <Icon className={`size-4 shrink-0 ${item.group === 'ask' ? 'text-[var(--flow-accent)]' : ''}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.label}</span>
                      {item.hint && (
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--flow-text-3)]">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-[var(--flow-text-3)]" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--flow-line-1)] px-4 py-2.5 text-[11px] text-[var(--flow-text-3)]">
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="flow-mono rounded border border-[var(--flow-line-2)] px-1">↑↓</kbd>
                  {zh ? '选择' : 'Navigate'}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="flow-mono rounded border border-[var(--flow-line-2)] px-1">↵</kbd>
                  {zh ? '执行' : 'Run'}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="flow-mono rounded border border-[var(--flow-line-2)] px-1">esc</kbd>
                  {zh ? '关闭' : 'Close'}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <Command className="size-3" />
                {zh ? 'AI 原生导航' : 'AI-native navigation'}
                <ArrowRight className="size-3" />
              </span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
};

export default SellerCommandPalette;
