import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { InquiryService } from './inquiry.service';
import type {
  InquirySession,
  InquiryMessage,
  SendMessageRequest,
} from '../../../shared/api.interface';

interface SessionListResponse {
  items: InquirySession[];
  total: number;
  page: number;
  pageSize: number;
}

interface CreateSessionRequest {
  sessionId: string;
  userId?: string;
}

@Controller('inquiry')
export class InquiryController {
  constructor(private readonly inquiryService: InquiryService) {}

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get('sessions')
  async getSessions(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ): Promise<SessionListResponse> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    if (pageNum < 1 || pageSizeNum < 1) {
      throw new BadRequestException('分页参数非法');
    }
    return this.inquiryService.getSessions(pageNum, pageSizeNum, status, {
      sellerId: req.user?.id,
      role: req.user?.role,
    });
  }

  @Get('sessions/:sessionId/messages')
  async getMessages(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
  ): Promise<InquiryMessage[]> {
    const isSeller = !!req.user && ['seller', 'admin'].includes(req.user.role);
    if (!isSeller) {
      const raw = req.headers['x-session-id'];
      const headerSessionId = Array.isArray(raw) ? raw[0] : raw;
      if (!headerSessionId || headerSessionId !== sessionId) {
        throw new ForbiddenException('无权访问该会话');
      }
    }
    return this.inquiryService.getMessages(
      sessionId,
      isSeller ? { sellerId: req.user?.id, role: req.user?.role } : undefined,
    );
  }

  @Post('messages')
  async sendMessage(
    @Req() req: Request,
    @Body() body: SendMessageRequest,
  ): Promise<InquiryMessage> {
    if (body.role === 'seller') {
      if (!req.user || !['seller', 'admin'].includes(req.user.role)) {
        throw new ForbiddenException('卖家身份需要登录且具备卖家权限');
      }
      return this.inquiryService.sendMessage(body, req.user.id);
    }
    // 买家侧仅允许发送 user 消息（assistant 回复由服务端 AI 客服落库，防止伪造）
    if (body.role !== 'user') {
      throw new ForbiddenException('买家侧仅可发送 user 角色消息');
    }
    const raw = req.headers['x-session-id'];
    const headerSessionId = Array.isArray(raw) ? raw[0] : raw;
    if (!headerSessionId || headerSessionId !== body.sessionId) {
      throw new ForbiddenException('无权向该会话发送消息');
    }
    return this.inquiryService.sendMessage(body);
  }

  @Post('sessions')
  async createSession(
    @Req() req: Request,
    @Body() body: CreateSessionRequest,
  ): Promise<InquirySession> {
    if (!body.sessionId) {
      throw new BadRequestException('sessionId 不能为空');
    }
    // 会话归属：必须由持有该 sessionId 的浏览器初始化；userId 由服务端从登录态解析，不信任请求体
    const raw = req.headers['x-session-id'];
    const headerSessionId = Array.isArray(raw) ? raw[0] : raw;
    if (!headerSessionId || headerSessionId !== body.sessionId) {
      throw new ForbiddenException('无权初始化该会话');
    }
    return this.inquiryService.createSession(body.sessionId, req.user?.id);
  }
}
