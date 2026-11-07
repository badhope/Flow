import { Module } from '@nestjs/common';

import { StockReservationService } from './stock-reservation.service';
import { WarehouseService } from './warehouse.service';
import { StockService } from './stock.service';
import { WarehouseController } from './warehouse.controller';

/**
 * 库存模块。
 *
 * 只导出 StockReservationService：它是无状态的服务，不反向依赖 Orders 或 Payments，
 * 因此不会产生循环依赖（Orders/Payments 都 import 本模块）。
 */
@Module({
  controllers: [WarehouseController],
  providers: [StockReservationService, WarehouseService, StockService],
  exports: [StockReservationService, WarehouseService, StockService],
})
export class InventoryModule {}
