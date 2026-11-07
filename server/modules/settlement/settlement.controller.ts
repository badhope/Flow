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

  /** 卖家的收款账户状态 */
  @Get('payout-account')
  async payoutAccount(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.settlements.getPayoutAccount(req.user.id);
  }

  /**
   * 注意路由顺序：静态路径必须声明在 `:id` 之前。
   * NestJS 按声明顺序匹配，`@Get(':id')` 会把 "payout-account" 当成 id，
   * 直接查库并 500。同理 `summary`/`commission` 也必须在前。
   */
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

  /** 卖家：开通收款账户（返回 Stripe onboarding 链接） */
  @Post('payout-account')
  async createPayoutAccount(
    @Req() req: Request,
    @Body() body: { email?: string; country?: string; returnUrl?: string; refreshUrl?: string },
  ) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    if (!body?.email?.trim()) throw new BadRequestException('需要 email');
    const base = process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
    return this.settlements.createPayoutAccount(req.user.id, {
      email: body.email.trim(),
      country: body.country,
      returnUrl: body.returnUrl ?? `${base}/seller/settlements?payout=done`,
      refreshUrl: body.refreshUrl ?? `${base}/seller/settlements?payout=refresh`,
    });
  }

  /** 卖家：刷新收款账户状态（onboarding 回来后） */
  @Post('payout-account/refresh')
  async refreshPayoutAccount(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.settlements.refreshPayoutAccount(req.user.id);
  }

  /**
   * 管理员：真实打款（Stripe Connect）。
   *
   * 与下面的 `/:id/pay` 区别：`pay` 是手工标记（线下已转账），这里是系统真实发起转账。
   */
  @Post(':id/payout')
  @UseGuards(new RolesGuard(['admin']))
  async payout(@Req() req: Request, @Param('id') id: string) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('仅管理员可执行打款');
    return this.settlements.executePayout(id, { role: req.user.role });
  }

  /** 管理员：标记已打款（线下转账） */
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
