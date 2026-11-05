import { Controller, Get, Post, Param, Req, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import { CustomsService } from './customs.service';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * 清关单据接口。
 *
 * 卖家只能操作自己店铺的订单/单据；买家不下发此接口（报关是卖家侧职责）。
 */
@Controller('customs')
@UseGuards(new RolesGuard(['seller', 'admin']))
export class CustomsController {
  constructor(private readonly customs: CustomsService) {}

  /** 单据列表 */
  @Get()
  async list(@Req() req: Request, @Query('limit') limit?: string) {
    const actor = { userId: req.user?.id, role: req.user?.role };
    if (!actor.userId) throw new ForbiddenException('请先登录');
    return this.customs.list(actor, limit ? Number(limit) : 50);
  }

  /** 按订单查（订单详情页用；无单据返回 null） */
  @Get('order/:orderId')
  async byOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.customs.findByOrder(orderId);
  }

  /** 生成（幂等：已有则返回已有的） */
  @Post('order/:orderId')
  async generate(@Req() req: Request, @Param('orderId') orderId: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.customs.generateForOrder(orderId, {
      userId: req.user.id,
      role: req.user.role ?? 'seller',
    });
  }

  /** 标记已申报 */
  @Post(':id/file')
  async file(@Req() req: Request, @Param('id') id: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.customs.markFiled(id, {
      userId: req.user.id,
      role: req.user.role ?? 'seller',
    });
  }
}
