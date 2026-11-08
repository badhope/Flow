import {
  Controller, Get, Post, Body, Param, Req, Query, UseGuards, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { BatchService } from './batch.service';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * 批次与效期。
 *
 * 卖家只能操作自己的批次；买家不涉及（效期对买家只体现在"是否可售"）。
 */
@Controller('batches')
@UseGuards(new RolesGuard(['seller', 'admin']))
export class BatchController {
  constructor(private readonly batches: BatchService) {}

  /** 批次入库 */
  @Post()
  async create(
    @Req() req: Request,
    @Body() body: {
      warehouseId?: string; variantId?: string; batchNo?: string; quantity?: number;
      producedAt?: string; expiresAt?: string; note?: string;
    },
  ) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    if (!body?.warehouseId || !body?.variantId || !body?.batchNo) {
      throw new BadRequestException('需要 warehouseId、variantId、batchNo');
    }
    if (typeof body.quantity !== 'number') throw new BadRequestException('需要 quantity');
    return this.batches.addBatch({
      sellerId: req.user.id,
      warehouseId: body.warehouseId,
      variantId: body.variantId,
      batchNo: body.batchNo,
      quantity: body.quantity,
      producedAt: body.producedAt,
      expiresAt: body.expiresAt,
      note: body.note,
    });
  }

  /** 全部批次（按到期日排序） */
  @Get()
  async list(@Req() req: Request, @Query('limit') limit?: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.batches.listAll(req.user.id, limit ? Number(limit) : 200);
  }

  /** 临期/过期看板 */
  @Get('expiring')
  async expiring(@Req() req: Request, @Query('days') days?: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.batches.listExpiring(req.user.id, days ? Number(days) : 30);
  }

  /** 某变体的批次明细 */
  @Get('variant/:variantId')
  async byVariant(@Req() req: Request, @Param('variantId') variantId: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.batches.listByVariant(req.user.id, variantId);
  }

  /** 批次与分仓库存漂移检查 */
  @Get('drift')
  async drift(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    const items = await this.batches.findBatchDrift(req.user.id);
    return { count: items.length, items, healthy: items.length === 0 };
  }

  /** 为缺批次的分仓库存自动补 LEGACY 批次 */
  @Post('backfill')
  async backfill(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return { backfilled: await this.batches.backfillMissingBatches(req.user.id) };
  }

  /** 修复批次漂移（以分仓库存为准） */
  @Post('drift/repair')
  async repair(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return { repaired: await this.batches.repairBatchDrift(req.user.id) };
  }

  /** 清理空批次 */
  @Post('purge-empty')
  async purge(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return { purged: await this.batches.purgeEmptyBatches(req.user.id) };
  }
}
