import {
  Controller, Get, Post, Put, Delete, Body, Param, Req, Query, UseGuards, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { WarehouseService } from './warehouse.service';
import { StockService } from './stock.service';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * 多仓管理。
 *
 * 卖家只能操作自己的仓；买家不涉及此接口（发货仓对买家不可见）。
 */
@Controller('warehouses')
@UseGuards(new RolesGuard(['seller', 'admin']))
export class WarehouseController {
  constructor(
    private readonly warehouses: WarehouseService,
    private readonly stockService: StockService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.list(req.user.id);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.create(req.user.id, body as unknown as Parameters<WarehouseService['create']>[1]);
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.update(req.user.id, id, body as unknown as Parameters<WarehouseService['update']>[2]);
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    await this.warehouses.remove(req.user.id, id);
    return { success: true };
  }

  /**
   * 库存漂移巡检：聚合库存与分仓总和不一致的变体。
   *
   * 这类问题不会抛错，只会表现为"商品显示有货但发不出"。
   * 必须能主动查，否则只能等买家投诉。
   */
  @Get('stock-drift')
  async stockDrift(@Req() req: Request, @Query('limit') limit?: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    const items = await this.stockService.findStockDrift(req.user.id, limit ? Number(limit) : 100);
    return {
      count: items.length,
      items,
      // 有漂移就是异常，明确告诉运维"要不要修"
      healthy: items.length === 0,
    };
  }

  /** 修复漂移：以分仓为准重算聚合（分仓是真相来源） */
  @Post('stock-drift/repair')
  async repairDrift(@Req() req: Request) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    const repaired = await this.stockService.repairStockDrift(req.user.id);
    return { repaired };
  }

  /** 某变体在各仓的库存 */
  @Get('stock/:variantId')
  async stock(@Req() req: Request, @Param('variantId') variantId: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.stockByVariant(req.user.id, variantId);
  }

  /** 设置某仓某变体库存 */
  @Put(':warehouseId/stock/:variantId')
  async setStock(
    @Req() req: Request,
    @Param('warehouseId') warehouseId: string,
    @Param('variantId') variantId: string,
    @Body() body: { stock?: number; safetyStock?: number },
  ) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    if (typeof body?.stock !== 'number') throw new BadRequestException('需要 stock');
    return this.warehouses.setStock(req.user.id, warehouseId, variantId, body.stock, body.safetyStock ?? 0);
  }

  // ---------- 调拨 ----------

  @Get('transfers')
  async transfers(@Req() req: Request, @Query('limit') limit?: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.listTransfers(req.user.id, limit ? Number(limit) : 50);
  }

  @Post('transfers')
  async createTransfer(@Req() req: Request, @Body() body: Record<string, unknown>) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.createTransfer(req.user.id, body as unknown as Parameters<WarehouseService['createTransfer']>[1]);
  }

  @Post('transfers/:id/complete')
  async completeTransfer(@Req() req: Request, @Param('id') id: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.completeTransfer(req.user.id, id);
  }

  @Post('transfers/:id/cancel')
  async cancelTransfer(@Req() req: Request, @Param('id') id: string) {
    if (!req.user?.id) throw new ForbiddenException('请先登录');
    return this.warehouses.cancelTransfer(req.user.id, id);
  }
}
