import { Injectable, Inject, Logger, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { eq, desc, count, and, asc, or, isNull } from 'drizzle-orm';
import { inquirySessions, inquiryMessages } from '../../database/schema';
import type {
  InquirySession,
  InquiryMessage,
  SendMessageRequest,
} from '../../../shared/api.interface';

@Injectable()
export class InquiryService {
  private readonly logger = new Logger(InquiryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
  ) {}

  async getSessions(
    page: number,
    pageSize: number,
    status?: string,
    actor?: { sellerId?: string; role?: string },
  ): Promise<{
    items: InquirySession[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions = [];
    // 卖家看「已分配给自己」+「尚未分配」的会话；管理员看全量。
    // 未分配会话在卖家首次回复时绑定归属（assertSellerCanReply 会拒绝已归属他人的会话）。
    if (actor?.sellerId && actor.role !== 'admin') {
      conditions.push(
        or(eq(inquirySessions.sellerId, actor.sellerId), isNull(inquirySessions.sellerId)),
      );
    }
    if (status) {
      conditions.push(eq(inquirySessions.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inquirySessions)
        .where(whereClause),
      this.db
        .select()
        .from(inquirySessions)
        .where(whereClause)
        .orderBy(
          desc(inquirySessions.lastMessageAt),
          desc(inquirySessions.createdAt),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = totalResult[0]?.count ?? 0;
    const items: InquirySession[] = rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      userId: row.userId ?? undefined,
      status: (row.status as 'active' | 'closed') ?? 'active',
      lastMessage: row.lastMessageAt
        ? row.lastMessageAt.toISOString()
        : undefined,
      lastMessageAt: row.lastMessageAt
        ? row.lastMessageAt.toISOString()
        : undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async getMessages(sessionId: string, actor?: { sellerId?: string; role?: string }): Promise<InquiryMessage[]> {
    const sessionRows = await this.db
      .select({ sellerId: inquirySessions.sellerId })
      .from(inquirySessions)
      .where(eq(inquirySessions.sessionId, sessionId))
      .limit(1);
    if (sessionRows.length === 0) return [];
    if (actor?.role !== 'admin' && actor?.sellerId && sessionRows[0].sellerId && sessionRows[0].sellerId !== actor.sellerId) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(inquiryMessages)
      .where(eq(inquiryMessages.sessionId, sessionId))
      .orderBy(asc(inquiryMessages.createdAt));

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as 'user' | 'assistant' | 'seller',
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async sendMessage(
    body: SendMessageRequest,
    sellerUserId?: string,
  ): Promise<InquiryMessage> {
    await this.assertSellerCanReply(body.sessionId, sellerUserId);
    const [inserted] = await this.db
      .insert(inquiryMessages)
      .values({
        sessionId: body.sessionId,
        role: body.role,
        content: body.content,
      })
      .returning();

    if (!inserted) {
      throw new Error('消息创建失败');
    }

    // update session's last_message_at
    await this.db
      .update(inquirySessions)
      .set({
        lastMessageAt: new Date(),
      })
      .where(eq(inquirySessions.sessionId, body.sessionId));

    // if seller responded, mark status + 绑定会话归属（首个回复的卖家接管）
    if (sellerUserId && body.role === 'seller') {
      await this.db
        .update(inquirySessions)
        .set({ status: 'active', sellerId: sellerUserId })
        .where(eq(inquirySessions.sessionId, body.sessionId));
    }

    return {
      id: inserted.id,
      sessionId: inserted.sessionId,
      role: inserted.role as 'user' | 'assistant' | 'seller',
      content: inserted.content,
      createdAt: inserted.createdAt.toISOString(),
    };
  }

  /** 卖家回复前校验会话归属：已归属他人的会话拒绝；未归属则允许接管 */
  private async assertSellerCanReply(sessionId: string, sellerId?: string): Promise<void> {
    if (!sellerId) return;
    const rows = await this.db
      .select({ sellerId: inquirySessions.sellerId })
      .from(inquirySessions)
      .where(eq(inquirySessions.sessionId, sessionId))
      .limit(1);
    if (rows.length > 0 && rows[0].sellerId && rows[0].sellerId !== sellerId) {
      throw new ConflictException('该会话已由其他卖家接管');
    }
  }

  async createSession(
    sessionId: string,
    userId?: string,
    sellerId?: string,
  ): Promise<InquirySession> {
    try {
      const [inserted] = await this.db
        .insert(inquirySessions)
        .values({
          sessionId,
          userId: userId || null,
          sellerId: sellerId || null,
          status: 'active',
        })
        .returning();

      if (!inserted) {
        throw new Error('会话创建失败');
      }

      return {
        id: inserted.id,
        sessionId: inserted.sessionId,
        userId: inserted.userId ?? undefined,
        status: (inserted.status as 'active' | 'closed') ?? 'active',
        lastMessage: inserted.lastMessageAt
          ? inserted.lastMessageAt.toISOString()
          : undefined,
        lastMessageAt: inserted.lastMessageAt
          ? inserted.lastMessageAt.toISOString()
          : undefined,
        createdAt: inserted.createdAt.toISOString(),
      };
    } catch (error) {
      // unique violation: session already exists
      const code = this.extractErrorCode(error);
      if (code === '23505') {
        const existing = await this.db
          .select()
          .from(inquirySessions)
          .where(eq(inquirySessions.sessionId, sessionId))
          .limit(1);
        if (existing[0]) {
          const row = existing[0];
          return {
            id: row.id,
            sessionId: row.sessionId,
            userId: row.userId ?? undefined,
            status: (row.status as 'active' | 'closed') ?? 'active',
            lastMessage: row.lastMessageAt
              ? row.lastMessageAt.toISOString()
              : undefined,
            lastMessageAt: row.lastMessageAt
              ? row.lastMessageAt.toISOString()
              : undefined,
            createdAt: row.createdAt.toISOString(),
          };
        }
      }
      this.logger.error('创建会话失败', error);
      if (error instanceof ConflictException) throw error;
      throw error;
    }
  }

  private extractErrorCode(error: unknown): string | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
      const { code, cause } = current as { code?: unknown; cause?: unknown };
      if (typeof code === 'string') return code;
      current = cause;
    }
    return undefined;
  }
}
