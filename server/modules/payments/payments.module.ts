import { Module } from '@nestjs/common';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { PayPalService } from './paypal.service';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeService, PayPalService],
  exports: [PaymentsService, StripeService, PayPalService],
})
export class PaymentsModule {}
