import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { CopilotService } from './copilot.service';

/**
 * 审批动作的看门狗。
 *
 * 与巡检（copilot-watch）分离：巡检是"业务告警"，看门狗是"数据正确性"。后者不依赖
 * 卖家配置，只要进程在跑就该运行，否则崩溃留下的 processing 动作永远无人认领。
 *
 * 用 Node 原生定时器（与 copilot-watch 一致），不引入调度依赖。
 */
@Injectable()
export class CopilotActionReaperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CopilotActionReaperService.name);
  private timer: NodeJS.Timeout | null = null;
  private static readonly INTERVAL_MS = 60_000;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly copilotService: CopilotService,
  ) {}

  onApplicationBootstrap(): void {
    // 启动 20 秒后先扫一次：上一次进程崩溃遗留的动作应尽早暴露
    setTimeout(() => void this.sweep(), 20_000);
    this.timer = setInterval(() => void this.sweep(), CopilotActionReaperService.INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 单次扫描：回收中断的 processing、作废过期的 pending */
  async sweep(): Promise<{ reclaimed: number; expired: number }> {
    try {
      return await this.copilotService.reclaimStaleActions();
    } catch (error) {
      this.logger.error(
        '审批看门狗执行失败',
        error instanceof Error ? error.stack : String(error),
      );
      return { reclaimed: 0, expired: 0 };
    }
  }
}
