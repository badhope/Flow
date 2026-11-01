import { Inject, Injectable, Logger, BadRequestException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { aiSettings } from '../../database/schema';
import { CopilotInsightsService } from './copilot-insights.service';
import { CopilotNotifyService } from './copilot-notify.service';
import { enforcePublicOutbound, isSafePublicHttpUrl } from '../../common/http/url-guard';
import type { SmtpConfig } from './copilot-notify-transport';
import { diffNewInsights } from './copilot-insight-digest';
import { formatForChannel, renderDigest } from './copilot-digest-format';
import type { CopilotInsight } from '../../../shared/api.interface';

/** 巡检调度配置（存 ai_settings，键 copilot_watch_settings） */
export interface WatchSettings {
  enabled: boolean;
  /** 巡检间隔（分钟，5-1440） */
  intervalMinutes: number;
  /** 通知渠道（webhook 覆盖飞书/企微/钉钉/Slack；email 走 SMTP；none=只写日志） */
  notifyKind: 'webhook' | 'email' | 'none';
  notifyUrl?: string;
  /** SMTP 配置（notifyKind=email 时使用） */
  notifySmtp?: SmtpConfig;
  /** 只在有新增告警时通知（默认 true，避免无变化也刷屏） */
  notifyOnlyOnNew: boolean;
  /** 邮件主题模板（支持 {{count}} / {{critical}} / {{newCount}} 占位） */
  notifySubjectTemplate: string;
}

export const WATCH_SETTINGS_KEY = 'copilot_watch_settings';
/** 卖家作用域键：`{userId}:{key}`（admin 用全局键，与 ai-settings-scope 同规则） */
export function watchSettingsKeyFor(actor: { userId?: string; role?: string }): string {
  if (actor.role === 'admin' || !actor.userId) return WATCH_SETTINGS_KEY;
  return `${actor.userId}:${WATCH_SETTINGS_KEY}`;
}
export const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  enabled: false,
  intervalMinutes: 30,
  notifyKind: 'none',
  notifyOnlyOnNew: true,
  notifySubjectTemplate: '【Flow 店铺巡检】{{count}} 项待处理（严重 {{critical}} / 新增 {{newCount}}）',
};
/** 上次巡检快照（用于 diff 出新告警） */
const WATCH_SNAPSHOT_KEY = 'copilot_watch_last_snapshot';
/** 跨进程互斥锁（多副本部署时只有一个实例执行巡检） */
const WATCH_LOCK_KEY = 'copilot_watch_lock';

/** 巡检相关键统一按 actor 作用域：admin 用全局键，seller 用 `{userId}:` 前缀 */
function scopedWatchKey(actor: { userId?: string; role?: string }, baseKey: string): string {
  if (actor.role === 'admin' || !actor.userId) return baseKey;
  return `${actor.userId}:${baseKey}`;
}

/**
 * 定时巡检：Node 原生定时器（不引入 @nestjs/schedule，零新依赖）。
 * - 默认关闭，卖家在副驾「巡检设置」里开启
 * - 每个周期重新读配置，改完即时生效
 * - 用 ai_settings 行级锁做跨进程互斥，多副本安全
 * - 只对"新增告警"出摘要；可配置 webhook 外发（飞书/企微/钉钉/Slack）
 */
@Injectable()
export class CopilotWatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CopilotWatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private currentIntervalMinutes: number | null = null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly insightsService: CopilotInsightsService,
    private readonly notifyService: CopilotNotifyService,
  ) {}

  onApplicationBootstrap(): void {
    // 启动后 30 秒做一次调度自检（不立即跑巡检，避免冷启动打满）
    setTimeout(() => void this.reschedule(), 30_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getSettings(actor: { userId?: string; role?: string } = {}): Promise<WatchSettings> {
    const settingsKey = watchSettingsKeyFor(actor);
    const rows = await this.db
      .select({ value: aiSettings.value })
      .from(aiSettings)
      .where(eq(aiSettings.key, settingsKey))
      .limit(1);
    if (!rows[0]?.value) return { ...DEFAULT_WATCH_SETTINGS };
    try {
      const parsed = JSON.parse(rows[0].value) as Partial<WatchSettings>;
      return {
        enabled: parsed.enabled === true,
        intervalMinutes: clampInterval(parsed.intervalMinutes),
        notifyKind: normalizeNotifyKind(parsed.notifyKind),
        notifyUrl: typeof parsed.notifyUrl === 'string' ? parsed.notifyUrl.slice(0, 500) : undefined,
        notifySmtp: normalizeSmtp(parsed.notifySmtp),
        notifyOnlyOnNew: parsed.notifyOnlyOnNew !== false,
        notifySubjectTemplate: typeof parsed.notifySubjectTemplate === 'string' && parsed.notifySubjectTemplate.trim()
          ? parsed.notifySubjectTemplate.slice(0, 200)
          : DEFAULT_WATCH_SETTINGS.notifySubjectTemplate,
      };
    } catch {
      return { ...DEFAULT_WATCH_SETTINGS };
    }
  }

  async updateSettings(
    input: Partial<WatchSettings>,
    actor: { userId?: string; role?: string },
  ): Promise<WatchSettings> {
    const actorId = actor.userId ?? '';
    const settingsKey = watchSettingsKeyFor(actor);
    const current = await this.getSettings(actor);
    if (
      enforcePublicOutbound()
      && input.notifyUrl !== undefined
      && input.notifyUrl.trim()
      && !isSafePublicHttpUrl(input.notifyUrl.trim())
    ) {
      throw new BadRequestException('通知地址不可用：禁止指向内网/保留地址（SSRF 防护）');
    }
    const next: WatchSettings = {
      enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
      intervalMinutes: input.intervalMinutes === undefined
        ? current.intervalMinutes
        : clampInterval(input.intervalMinutes),
      notifyKind: input.notifyKind === undefined ? current.notifyKind : normalizeNotifyKind(input.notifyKind),
      notifyUrl: input.notifyUrl === undefined ? current.notifyUrl : (input.notifyUrl.trim() || undefined),
      notifySmtp: input.notifySmtp === undefined ? current.notifySmtp : normalizeSmtp(input.notifySmtp),
      notifyOnlyOnNew: input.notifyOnlyOnNew === undefined ? current.notifyOnlyOnNew : input.notifyOnlyOnNew === true,
      notifySubjectTemplate: input.notifySubjectTemplate === undefined
        ? current.notifySubjectTemplate
        : (input.notifySubjectTemplate.trim().slice(0, 200) || DEFAULT_WATCH_SETTINGS.notifySubjectTemplate),
    };
    await this.db
      .insert(aiSettings)
      .values({ key: settingsKey, value: JSON.stringify(next), updatedBy: actorId })
      .onConflictDoUpdate({
        target: aiSettings.key,
        set: { value: JSON.stringify(next), updatedBy: actorId, updatedAt: new Date() },
      });
    await this.reschedule();
    return next;
  }

  /** 按当前配置重建定时器（配置变化后调用）。admin 全局设置驱动调度；seller 设置仅存取 */
  async reschedule(): Promise<void> {
    const settings = await this.getSettings({ role: 'admin' });
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentIntervalMinutes = settings.intervalMinutes;

    if (!settings.enabled) {
      this.logger.log('定时巡检未开启');
      return;
    }

    const intervalMs = settings.intervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(`定时巡检已开启：每 ${settings.intervalMinutes} 分钟`);
  }

  /**
   * 执行一次巡检（含跨进程互斥与新增告警 diff）。
   * 作用域语义（v1.22 修正）：手动触发按调用者 actor 执行；后台定时器按 admin 全局配置执行。
   */
  async runOnce(force = false, actor: { userId?: string; role?: string } = { role: 'admin' }): Promise<{ ran: boolean; message: string }> {
    if (this.running) return { ran: false, message: '上一次巡检仍在执行' };
    this.running = true;
    try {
      if (!force && !(await this.getSettings(actor)).enabled) {
        return { ran: false, message: '定时巡检未开启' };
      }

      const locked = await this.acquireLock(actor);
      if (!locked) return { ran: false, message: '其他实例正在巡检' };

      try {
        const { insights } = await this.insightsService.getInsights(actor);
        const previous = await this.readSnapshot(actor);
        const newInsights = diffNewInsights(previous, insights);
        const plainDigest = renderDigest({ insights, newInsights }, 'plain');

        await this.writeSnapshot(insights, actor);
        this.logger.log(plainDigest.replace(/\n/g, ' | '));

        const settings = await this.getSettings(actor);
        const channelReady = settings.notifyKind === 'email'
          ? !!settings.notifySmtp?.host
          : settings.notifyKind === 'webhook' ? !!settings.notifyUrl : false;
        const shouldNotify = channelReady && (!settings.notifyOnlyOnNew || newInsights.length > 0);
        let notifyNote = '';
        if (shouldNotify) {
          const subject = renderSubject(settings.notifySubjectTemplate, insights, newInsights);
          const channelKind = settings.notifyKind === 'email' ? 'email' : 'webhook';
          const format = formatForChannel(channelKind);
          const body = format === 'plain' ? plainDigest : renderDigest({ insights, newInsights }, format);
          const sent = await this.notifyService.send(
            settings.notifyKind === 'email'
              ? { kind: 'email', smtp: settings.notifySmtp }
              : { kind: 'webhook', url: settings.notifyUrl },
            format === 'markdown' ? body : plainDigest,
            subject,
            format === 'html' ? body : undefined,
          );
          notifyNote = sent.ok
            ? `（已推送${sent.channel === 'email' ? '邮件' : '通知'}）`
            : `（通知未发送：${sent.message}）`;
        }

        return { ran: true, message: plainDigest + notifyNote };
      } finally {
        await this.releaseLock(actor);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`定时巡检失败：${message}`);
      return { ran: false, message: `巡检失败：${message}` };
    } finally {
      this.running = false;
    }
  }

  // ==================== 内部 ====================

  /**
   * 跨进程互斥：用 ai_settings 一行的 updated_at 做租约。
   * 单条 UPDATE ... WHERE updated_at < now() - lease 是原子的，命中即获得锁。
   */
  private async acquireLock(actor: { userId?: string; role?: string }): Promise<boolean> {
    const leaseSeconds = 300;
    const rows = await this.db.execute<{ key: string }>(sql`
      INSERT INTO ${aiSettings} (key, value, updated_at)
      VALUES (${scopedWatchKey(actor, WATCH_LOCK_KEY)}, '1', now())
      ON CONFLICT (key) DO UPDATE
        SET updated_at = now()
        WHERE ai_settings.updated_at < now() - (${leaseSeconds} || ' seconds')::interval
      RETURNING key
    `);
    return Array.isArray(rows) && rows.length > 0;
  }

  private async releaseLock(actor: { userId?: string; role?: string }): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${aiSettings} SET updated_at = now() - interval '1 hour'
      WHERE key = ${scopedWatchKey(actor, WATCH_LOCK_KEY)}
    `);
  }

  private async readSnapshot(actor: { userId?: string; role?: string }): Promise<CopilotInsight[]> {
    const rows = await this.db
      .select({ value: aiSettings.value })
      .from(aiSettings)
      .where(eq(aiSettings.key, scopedWatchKey(actor, WATCH_SNAPSHOT_KEY)))
      .limit(1);
    if (!rows[0]?.value) return [];
    try {
      const parsed = JSON.parse(rows[0].value) as unknown;
      return Array.isArray(parsed) ? (parsed as CopilotInsight[]) : [];
    } catch {
      return [];
    }
  }

  private async writeSnapshot(insights: CopilotInsight[], actor: { userId?: string; role?: string }): Promise<void> {
    const value = JSON.stringify(insights);
    await this.db
      .insert(aiSettings)
      .values({ key: scopedWatchKey(actor, WATCH_SNAPSHOT_KEY), value })
      .onConflictDoUpdate({
        target: aiSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

function normalizeNotifyKind(value: unknown): WatchSettings['notifyKind'] {
  if (value === 'webhook') return 'webhook';
  if (value === 'email') return 'email';
  return 'none';
}

function normalizeSmtp(value: unknown): SmtpConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const host = typeof raw.host === 'string' ? raw.host.trim().slice(0, 200) : '';
  const from = typeof raw.from === 'string' ? raw.from.trim().slice(0, 200) : '';
  const to = typeof raw.to === 'string' ? raw.to.trim().slice(0, 500) : '';
  if (!host || !from || !to) return undefined;
  // 非 dev/test 环境 SMTP 目标必须来自运维 allowlist，避免 seller 用 host/port 探测内网或云元数据。
  if (enforcePublicOutbound()) {
    const allowed = (process.env.SMTP_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(host.toLowerCase())) return undefined;
  }
  const port = typeof raw.port === 'number' && Number.isFinite(raw.port) ? Math.round(raw.port) : 587;
  return {
    host,
    port: Math.max(1, Math.min(65535, port)),
    secure: raw.secure === true,
    user: typeof raw.user === 'string' ? raw.user.slice(0, 200) : undefined,
    pass: typeof raw.pass === 'string' ? raw.pass.slice(0, 500) : undefined,
    from,
    to,
  };
}

/** 邮件主题模板渲染：{{count}} / {{critical}} / {{newCount}} */
export function renderSubject(
  template: string,
  insights: ReadonlyArray<{ severity: string }>,
  newInsights: ReadonlyArray<unknown>,
): string {
  const critical = insights.filter((insight) => insight.severity === 'critical').length;
  return template
    .replace(/\{\{count\}\}/g, String(insights.length))
    .replace(/\{\{critical\}\}/g, String(critical))
    .replace(/\{\{newCount\}\}/g, String(newInsights.length))
    .slice(0, 200);
}

function clampInterval(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_WATCH_SETTINGS.intervalMinutes;
  return Math.max(5, Math.min(1440, numeric));
}
