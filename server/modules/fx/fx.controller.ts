import { Controller, Get, Post, Body, Query, Req, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import { FxService } from './fx.service';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * 汇率接口。
 *
 * `GET /api/fx/rates` 公开（买家切换币种需要），其余为管理员操作。
 */
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  /** 公开：可选币种与汇率（供买家端币种切换） */
  @Get('rates')
  async rates() {
    const list = await this.fx.listRates();
    return {
      base: 'USD',
      rates: list.map((r) => ({
        code: r.code,
        symbol: r.symbol,
        nameZh: r.nameZh,
        nameEn: r.nameEn,
        rate: r.rate,
        decimalDigits: r.decimalDigits,
        updatedAt: r.updatedAt,
        // 让调用方能判断"这份汇率是不是最新的"
        source: r.source,
      })),
    };
  }

  /** 公开：换算（结账页预览用） */
  @Get('convert')
  async convert(
    @Query('amount') amount?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const value = Number(amount ?? '0');
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('amount 参数非法');
    }
    if (!from || !to) {
      throw new BadRequestException('缺少 from / to 参数');
    }
    try {
      return await this.fx.convert(value, from, to);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '换算失败');
    }
  }

  /** 管理员：手动刷新汇率 */
  @Post('refresh')
  @UseGuards(new RolesGuard(['admin']))
  async refresh(@Req() req: Request) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('仅管理员可刷新汇率');
    return this.fx.refreshRates();
  }

  /** 管理员：手工设置汇率（公开源不可用时的兜底） */
  @Post('rates')
  @UseGuards(new RolesGuard(['admin']))
  async setRate(@Req() req: Request, @Body() body: { code?: string; rate?: number }) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('仅管理员可设置汇率');
    if (!body?.code || typeof body.rate !== 'number') {
      throw new BadRequestException('需要 code 与 rate');
    }
    try {
      return await this.fx.setManualRate(body.code, body.rate);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '设置失败');
    }
  }
}
