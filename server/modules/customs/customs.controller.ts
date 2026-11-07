import { Controller, Get, Post, Body, Param, Req, Query, UseGuards, ForbiddenException } from '@nestjs/common';
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

  /** 报关行配置：读取（凭据脱敏） */
  @Get('broker/config')
  async getBroker(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    const cfg = await this.customs.getBrokerConfig(req.user.id);
    if (!cfg) return null;
    return {
      provider: cfg.provider,
      endpoint: cfg.endpoint,
      enabled: cfg.enabled,
      hasCredentials: Object.keys((cfg.credentials ?? {}) as Record<string, unknown>).length > 0,
      hasSigningSecret: !!cfg.signingSecret,
      updatedAt: cfg.updatedAt.toISOString(),
    };
  }

  /** 报关行配置：保存 */
  @Post('broker/config')
  async saveBroker(
    @Req() req: Request,
    @Body() body: { provider?: string; endpoint?: string; credentials?: Record<string, string>; signingSecret?: string; enabled?: boolean },
  ) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.customs.saveBrokerConfig(req.user.id, {
      provider: body?.provider,
      endpoint: body?.endpoint ?? '',
      credentials: body?.credentials,
      signingSecret: body?.signingSecret,
      enabled: body?.enabled,
    });
  }

  /** 向报关行真实提交 */
  @Post(':id/submit')
  async submit(@Req() req: Request, @Param('id') id: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.customs.submitToBroker(id, {
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
