import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/contexts/LanguageContext';
import { getSessionId } from '@/utils/session';
import { supportChat, getAIStatus } from '@/api/ai';
import type { AIStatusResponse } from '@shared/api.interface';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [aiConfigured, setAiConfigured] = useState<boolean>(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { language, t } = useLanguage();
  const chatText = t.chat;
  // Buyer-only widget: the seller workbench has its own copilot and the floating
  // bubble overlaps the composer on dense seller screens.
  const { pathname } = useLocation();
  const isSellerArea = pathname.startsWith('/seller');

  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // ScrollArea 的真实滚动容器是其 viewport，直接设 scrollTop 无效 → 用 scrollIntoView
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isTyping, isOpen]);

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || isTyping) return;
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };
    setMessages((prev: ChatMessage[]) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);
    try {
      const response = await supportChat({
        sessionId: getSessionId(),
        message: userMessage.content,
        language,
      });
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.reply,
      };
      setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);
    } catch (error: unknown) {
      console.error('[chat] send error', error);
      setAiConfigured(false);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          language === 'zh'
            ? '智能客服正在配置中，请稍后再来，或发送邮件联系我们。'
            : 'AI support is being configured. Please check back later or email us.',
      };
      setMessages((prev: ChatMessage[]) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSend();
    }
  };

  const toggleChat = (): void => {
    setIsOpen((prev: boolean) => {
      if (!prev && messages.length === 0) {
        const welcomeMsg: ChatMessage = {
          id: 'welcome',
          role: 'assistant',
          content: chatText.welcome,
        };
        if (!aiConfigured) {
          const configMsg: ChatMessage = {
            id: 'config-note',
            role: 'assistant',
            content:
              language === 'zh'
                ? '智能客服正在配置中，请稍后再来，或发送邮件联系我们。'
                : 'AI support is being configured. Please check back later or email us.',
          };
          setMessages([welcomeMsg, configMsg]);
        } else {
          setMessages([welcomeMsg]);
        }
      }
      return !prev;
    });
  };

  useEffect(() => {
    const checkStatus = async (): Promise<void> => {
      try {
        const status: AIStatusResponse = await getAIStatus();
        setAiConfigured(status.configured);
      } catch (error: unknown) {
        console.warn('[chat] ai status check failed', error);
        setAiConfigured(false);
      }
    };
    void checkStatus();
  }, []);

  if (isSellerArea) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {isOpen && (
        <Card className="w-80 sm:w-96 h-[32rem] flex flex-col shadow-xl rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-5" />
              <span className="font-semibold">{chatText.title}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground size-8 p-0"
              onClick={toggleChat}
            >
              <X className="size-4" />
            </Button>
          </div>
          <ScrollArea ref={scrollRef} className="flex-1 p-4 space-y-3">
            {messages.map((msg: ChatMessage) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
            {isTyping && (
              <div className="flex justify-start">
                <div className="max-w-[80%] px-3 py-2 rounded-lg text-sm bg-slate-100 text-slate-500">
                  {chatText.typing}
                </div>
              </div>
            )}
          </ScrollArea>
          <div className="p-3 border-t flex gap-2">
            <Input
              value={input}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setInput(e.target.value)
              }
              onKeyDown={handleKeyDown}
              disabled={!aiConfigured}
              placeholder={aiConfigured ? chatText.placeholder : chatText.unavailable}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={isTyping || !input.trim() || !aiConfigured}
              aria-label={chatText.send}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </Card>
      )}
      <Button
        size="lg"
        aria-label={isOpen ? chatText.title : t.chat.title}
        aria-expanded={isOpen}
        className="rounded-full size-14 shadow-lg"
        onClick={toggleChat}
      >
        <MessageCircle className="size-6" />
      </Button>
    </div>
  );
};

export default ChatWidget;
