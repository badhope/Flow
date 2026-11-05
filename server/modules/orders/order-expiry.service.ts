import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { OrdersService } from './orders.service';

/**
 * 未支付订单的自动释放。
 *
 * 为什么需要：下单即锁库存，但此前的订单**永不过期**。买家拍下不付款，
 * 库存就被永久占用，其他买家买不到——这是电商里最隐蔽的"超卖"，
 * 比并发超卖更常见，也更难被发现（因为没有任何报错）。
 *
 * 与 CopilotActionReaper 同理：这是数据正确性问题，不依赖任何卖家配置，
 * 只要进程在跑就应该执行，因此用固定间隔而非卖家可配的巡检周期。
 */
@Injectable()
export class OrderExpiryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrderExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  /** 每分钟扫一次；实际超时阈值由 ORDER_PAYMENT_TIMEOUT_MINUTES 决定 */
  private static readonly INTERVAL_MS = 60_000;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly ordersService: OrdersService,
  ) {}

  onApplicationBootstrap(): void {
    // 启动 45 秒后先扫一次：进程重启期间累积的过期订单应尽快释放
    setTimeout(() => void this.sweep(), 45_000);
    this.timer = setInterval(() => void this.sweep(), OrderExpiryService.INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 单次扫描；异常不得影响定时器继续运行 */
  async sweep(): Promise<{ released: string[]; scanned: number }> {
    try {
      return await this.ordersService.releaseExpiredOrders();
    } catch (error) {
      this.logger.error(
        '未支付订单释放失败',
        error instanceof Error ? error.stack : String(error),
      );
      return { released: [], scanned: 0 };
    }
  }
}
