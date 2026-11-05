import { Module } from '@nestjs/common';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderExpiryService } from './order-expiry.service';
import { CouponsModule } from '../coupons/coupons.module';
import { AuditModule } from '../audit/audit.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [CouponsModule, AuditModule, ShippingModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderExpiryService],
  exports: [OrdersService],
})
export class OrdersModule {}
