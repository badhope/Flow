import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { CouponsModule } from '../coupons/coupons.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { InquiryModule } from '../inquiry/inquiry.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { RefundsModule } from '../refunds/refunds.module';
import { ShopperModule } from '../shopper/shopper.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { CopilotToolService } from './copilot-tool.service';
import { CopilotInsightsService } from './copilot-insights.service';
import { CopilotWatchService } from './copilot-watch.service';
import { CopilotNotifyService } from './copilot-notify.service';
import { NotifyTransport } from './copilot-notify-transport';
import { CopilotActionReaperService } from './copilot-action-reaper.service';

@Module({
  imports: [
    AiModule,
    AuditModule,
    CouponsModule,
    DashboardModule,
    InquiryModule,
    OrdersModule,
    ProductsModule,
    RefundsModule,
    ShopperModule,
  ],
  controllers: [CopilotController],
  providers: [
    CopilotService,
    CopilotToolService,
    CopilotInsightsService,
    CopilotWatchService,
    CopilotNotifyService,
    NotifyTransport,
    CopilotActionReaperService,
  ],
  // CopilotToolService 需要被 McpModule 复用（只读工具执行），必须导出
  exports: [CopilotService, CopilotToolService],
})
export class CopilotModule {}
