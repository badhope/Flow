import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Bot, User, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { inquiryApi } from '@/api';
import type { InquirySession, InquiryMessage } from '@shared/api.interface';
import { toast } from 'sonner';
import { notifyError } from '@/lib/error-feedback';

const InquiryManagePage: React.FC = () => {
  const [sessions, setSessions] = useState<InquirySession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InquiryMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      setLoadingSessions(true);
      const result = await inquiryApi.getSellerSessionList();
      const items: InquirySession[] = Array.isArray(result)
        ? result
        : (result as { items?: InquirySession[] }).items ?? [];
      setSessions(items);
      if (items.length > 0 && !selectedSessionId) {
        setSelectedSessionId(items[0].sessionId);
      }
    } catch (err) {
      notifyError(err, '获取会话列表失败');
    } finally {
      setLoadingSessions(false);
    }
  }, [selectedSessionId]);

  const fetchMessages = useCallback(async (sessionId: string) => {
    try {
      setLoadingMessages(true);
      const result = await inquiryApi.getSellerMessageList(sessionId);
      setMessages(result);
    } catch (err) {
      notifyError(err, '获取消息列表失败');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (selectedSessionId) {
      fetchMessages(selectedSessionId);
    }
  }, [selectedSessionId, fetchMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
  };

  const handleSendMessage = async () => {
    if (!selectedSessionId || !inputValue.trim()) return;

    const trimmed = inputValue.trim();
    setInputValue('');

    // 乐观更新：先添加一条本地消息
    const tempMessage: InquiryMessage = {
      id: `temp_${Date.now()}`,
      sessionId: selectedSessionId,
      role: 'seller',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMessage]);

    try {
      setSending(true);
      const result = await inquiryApi.sendSellerMessage(
        selectedSessionId,
        trimmed
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id.startsWith('temp_') ? result : m
        )
      );
    } catch (err) {
      notifyError(err, '发送消息失败，请重试');
      toast('发送失败');
      setMessages((prev) =>
        prev.filter((m) => !m.id.startsWith('temp_'))
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (time: string) => {
    const d = new Date(time);
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (time?: string) => {
    if (!time) return '';
    const d = new Date(time);
    return d.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
    });
  };

  const selectedSession = sessions.find(
    (s) => s.sessionId === selectedSessionId
  );

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100vh-180px)] md:flex-row">
      {/* 左侧会话列表 */}
      <Card className="w-full flex-shrink-0 shadow-sm md:w-72">
        <CardContent className="flex h-full flex-col p-0">
          <div className="border-b p-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-blue-800" />
              <span className="font-semibold">咨询会话</span>
              <Badge variant="secondary" className="ml-auto">
                {sessions.length}
              </Badge>
            </div>
          </div>

          <ScrollArea className="min-h-0 min-w-0 flex-1">
            {loadingSessions && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            )}
            {!loadingSessions && sessions.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                暂无会话
              </div>
            )}
            {!loadingSessions &&
              sessions.map((session) => (
                <div
                  key={session.sessionId}
                  onClick={() => handleSelectSession(session.sessionId)}
                  className={`cursor-pointer border-b p-3 transition-colors hover:bg-slate-50 ${
                    selectedSessionId === session.sessionId
                      ? 'bg-blue-50 border-l-2 border-l-blue-600'
                      : ''
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {session.userName ?? '访客'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(session.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {session.lastMessage || '暂无消息'}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      variant={
                        session.status === 'active'
                          ? 'default'
                          : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {session.status === 'active' ? '进行中' : '已关闭'}
                    </Badge>
                  </div>
                </div>
              ))}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 右侧聊天窗口 */}
      <Card className="flex flex-1 flex-col shadow-sm">
        <CardContent className="flex flex-1 flex-col p-0">
          {/* 聊天头部 */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-semibold">
                <span className="truncate">{selectedSession?.userName ?? '访客'}</span>
                {selectedSession?.sessionId && (
                  <span className="shrink-0 font-mono text-[11px] font-normal text-slate-400">
                    #{selectedSession.sessionId.slice(0, 8)}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedSession?.status === 'active'
                  ? '咨询中'
                  : '会话已结束'}
              </div>
            </div>
          </div>

          {/* 消息列表 */}
          <ScrollArea className="min-h-0 min-w-0 flex-1 bg-slate-50">
            {loadingMessages && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            )}
            {!loadingMessages && messages.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {selectedSessionId ? '暂无消息' : '请选择会话'}
              </div>
            )}
            <div className="w-full min-w-0 space-y-3 p-4">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isSeller = msg.role === 'seller';
                const isAi = msg.role === 'assistant';

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`flex min-w-0 max-w-[75%] gap-2 ${
                        isUser ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      {/* 头像 */}
                      <div
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                          isUser
                            ? 'bg-blue-100 text-blue-700'
                            : isAi
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {isUser ? (
                          <User className="h-4 w-4" />
                        ) : isAi ? (
                          <Bot className="h-4 w-4" />
                        ) : (
                          <MessageCircle className="h-4 w-4" />
                        )}
                      </div>

                      {/* 消息气泡 */}
                      <div className="min-w-0">
                        <div
                          className={`break-words rounded-lg px-3 py-2 text-sm ${
                            isUser
                              ? 'bg-blue-800 text-white'
                              : 'bg-white text-slate-800 border border-slate-200'
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div
                          className={`mt-1 flex items-center gap-2 text-xs text-muted-foreground ${
                            isUser ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          {!isUser && !isAi && isSeller && (
                            <span className="text-slate-500">客服</span>
                          )}
                          {isAi && (
                            <span className="text-violet-500">
                              AI 回复
                            </span>
                          )}
                          <span>{formatTime(msg.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* 输入区域 */}
          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Input
                placeholder={
                  selectedSessionId ? '输入消息，按 Enter 发送' : '请先选择会话'
                }
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!selectedSessionId || sending}
                className="min-h-[40px]"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!selectedSessionId || !inputValue.trim() || sending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InquiryManagePage;
