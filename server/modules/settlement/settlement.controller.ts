import {
  Controller, Get, Post, Body, Param, Req, Query, UseGuards, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { SettlementService } from './settlement.service';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * 结算与佣金接口。
 *
 * 卖家：看自己的结算单与汇总；管理员：生成、打款、配置佣金。
 */
@Controller('settlements')
@UseGuards(new RolesGuard(['seller', 'admin']))
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  /** 结算单列表（卖家只看自己的） */
  @Get()
  async list(@Req() req: Request, @Query('limit') limit?: string) {
    const actor = { userId: req.user?.id, role: req.user?.role };
    if (!actor.userId) throw new ForbiddenException('请先登录');
    return this.settlements.list(actor, limit ? Number(limit) : 50);
  }

  /** 我的结算汇总（卖家看板用） */
  @Get('summary')
  async summary(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.settlements.getSummary(req.user.id);
  }

  /** 我的佣金规则（卖家可查看自己将被抽多少） */
  @Get('commission')
  async myCommission(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.settlements.resolveCommissionRule(req.user.id);
  }

  @Get(':id')
  async getOne(@Req() req: Request, @Param('id') id: string) {
    const actor = { userId: req.user?.id, role: req.user?.role };
    if (!actor.userId) throw new ForbiddenException('请先登录');
    return this.settlements.getOne(id, actor);
  }

  /**
   * 管理员：为某卖家生成结算单。
   *
   * 周期缺省为「上一个自然月」，这是最常见的结算节奏。
   */
  @Post('generate')
  @UseGuards(new RolesGuard(['admin']))
  async generate(
    @Req() req: Request,
    @Body() body: { sellerId?: string; periodStart?: string; periodEnd?: string },
  ) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('仅管理员可生成结算单');
    if (!body?.sellerId) throw new BadRequestException('需要 sellerId');

    const now = new Date();
    const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const start = body.periodStart ? new Date(body.periodStart) : defaultStart;
    const end = body.periodEnd ? new Date(body.periodEnd) : defaultEnd;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('结算周期时间格式非法');
    }
    return this.settlements.generate(body.sellerId, start, end);
  }

  /** 管理员：标记已打款 */
  @Post(':id/pay')
  @UseGuards(new RolesGuard(['admin']))
  async pay(@Req() req: Request, @Param('id') id: string) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('仅管理员可标记打款');
    return this.settlements.markPaid(id);
  }

  /** 管理员：设置佣金规则（不传 sellerId 则改全局默认） */
  @Post('commission')
  @UseGuards(new RolesGuard(['admin']))
  async setCommission(
    @Req() req: Request,
    @Body() body: { sellerId?: string | null; rate?: number; fixedFee?: number; note?: string },
  ) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('仅管理员可配置佣金');
    if (typeof body?.rate !== 'number') throw new BadRequestException('需要 rate');
    return this.settlements.setCommissionRule(body.sellerId ?? null, {
      rate: body.rate,
      fixedFee: body.fixedFee,
      note: body.note,
    });
  }
}
