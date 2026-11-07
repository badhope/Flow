import { Module } from '@nestjs/common';

import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { AuditModule } from '../audit/audit.module';
import { PaymentsModule } from '../payments/payments.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, PaymentsModule, InventoryModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
