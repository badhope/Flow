import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CmsModule } from './modules/cms/cms.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { InquiryModule } from './modules/inquiry/inquiry.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { HealthModule } from './modules/health/health.module';
import { SeoModule } from './modules/seo/seo.module';
import { SeedModule } from './modules/seed/seed.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { ShopperModule } from './modules/shopper/shopper.module';
import { McpModule } from './modules/mcp/mcp.module';
import { FxModule } from './modules/fx/fx.module';
import { CustomsModule } from './modules/customs/customs.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { JwtAuthMiddleware } from './common/middleware/jwt-auth.middleware';
import { CsrfHeaderMiddleware } from './common/middleware/csrf-header.middleware';

const businessModules = [
  AnalyticsModule,
  AuthModule,
  AddressesModule,
  AiModule,
  AuditModule,
  CartModule,
  CategoriesModule,
  CmsModule,
  CollectionsModule,
  CopilotModule,
  CouponsModule,
  DashboardModule,
  FavoritesModule,
  HealthModule,
  SeoModule,
  InquiryModule,
  LogisticsModule,
  McpModule,
  FxModule,
  CustomsModule,
  InventoryModule,
  SettlementModule,
  OrdersModule,
  PaymentsModule,
  ProductsModule,
  RefundsModule,
  SeedModule,
  ShopperModule,
  ReviewsModule,
  ShippingModule,
];

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    DatabaseModule,
    ...businessModules,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(JwtAuthMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
    consumer
      .apply(CsrfHeaderMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
