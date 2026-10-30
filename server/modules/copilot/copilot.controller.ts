import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';

import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { CopilotService } from './copilot.service';
import { CopilotToolService } from './copilot-tool.service';
import { ProductsService } from '../products/products.service';
import { CopywriterService } from '../ai/copywriter.service';
import { CopilotInsightsService } from './copilot-insights.service';
import { CopilotWatchService, renderSubject, type WatchSettings } from './copilot-watch.service';
import { renderDigest } from './copilot-digest-format';
import { ShopperAnalyticsService } from '../shopper/shopper-analytics.service';
import { sanitizeInsightThresholds } from './copilot-insight-thresholds';
import type {
  CopilotAction,
  CopilotActionResolveResult,
  CopilotBatchResolveResult,
  CopilotConversation,
  CopilotConversationDetail,
  CopilotInsightThresholds,
  CopilotInsightsView,
  CopilotSendResult,
  CopilotToolsView,
  ShopperDemandGap,
  ShopperFunnelResponse,
  ShopperProductFunnelResponse,
} from '../../../shared/api.interface';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class SendCopilotMessageDto {
  @IsString()
  @Length(1, 4000, { message: '消息长度需为 1-4000 字符' })
  content!: string;
}

export class UpdateInsightThresholdsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  lowStock?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  pendingRefundHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  unpaidOrderHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  staleShippedDays?: number;
}

export class UpdateWatchSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  intervalMinutes?: number;

  @IsOptional()
  @IsIn(['webhook', 'email', 'none'])
  notifyKind?: 'webhook' | 'email' | 'none';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(https?:\/\/|$)/i, { message: '通知地址需以 http(s):// 开头' })
  notifyUrl?: string;

  @IsOptional()
  @IsBoolean()
  notifyOnlyOnNew?: boolean;

  @IsOptional()
  @IsObject()
  notifySmtp?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notifySubjectTemplate?: string;
}

export class BackfillCopyDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

export class CreateDraftFromGapDto {
  @IsString()
  @Length(1, 100)
  keyword!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  categoryId?: string;
}

export class ResolveActionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * AI 运营副驾（卖家专用）。
 * 所有端点都由 RolesGuard 收口为 seller/admin；动作执行额外校验会话所有者。
 */
@Controller('copilot')
@UseGuards(new RolesGuard(['seller', 'admin']))
export class CopilotController {
  constructor(
    private readonly copilotService: CopilotService,
    private readonly insightsService: CopilotInsightsService,
    private readonly shopperAnalytics: ShopperAnalyticsService,
    private readonly watchService: CopilotWatchService,
    private readonly toolService: CopilotToolService,
    private readonly productsService: ProductsService,
    private readonly copywriterService: CopywriterService,
    private readonly auditService: AuditService,
  ) {}

  private getActor(req: Request): { userId: string; role: string } {
    return { userId: (req.user as { id: string }).id, role: req.user?.role ?? 'seller' };
  }

  @Get('tools')
  getTools(): CopilotToolsView {
    return this.copilotService.getTools();
  }

  @Get('insights')
  async getInsights(@Req() req: Request): Promise<CopilotInsightsView> {
    return this.insightsService.getInsights(this.getActor(req));
  }

  @Get('shopper-funnel')
  async getShopperFunnel(
    @Req() req: Request,
    @Query('days') days?: string,
  ): Promise<ShopperFunnelResponse> {
    const parsed = days ? parseInt(days, 10) : 30;
    const safeDays = Number.isFinite(parsed) ? Math.min(365, Math.max(1, parsed)) : 30;
    const actor = this.getActor(req);
    return this.shopperAnalytics.getFunnel(safeDays, actor.role === 'admin' ? undefined : actor.userId);
  }

  @Get('shopper-demand-gaps')
  async getShopperDemandGaps(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ): Promise<ShopperDemandGap[]> {
    const parsedDays = days ? parseInt(days, 10) : 90;
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    return this.shopperAnalytics.getDemandGaps(
      Number.isFinite(parsedDays) ? parsedDays : 90,
      Number.isFinite(parsedLimit) ? parsedLimit : 10,
    );
  }

  @Get('watch')
  async getWatchSettings(@Req() req: Request): Promise<WatchSettings> {
    return this.watchService.getSettings(this.getActor(req));
  }

  @Put('watch')
  async updateWatchSettings(
    @Req() req: Request,
    @Body() dto: UpdateWatchSettingsDto,
  ): Promise<WatchSettings> {
    const actor = this.getActor(req);
    const updated = await this.watchService.updateSettings(
      dto as unknown as Partial<import('./copilot-watch.service').WatchSettings>,
      actor,
    );
    void this.auditService.log({
      action: 'copilot.watch_update',
      entity: 'ai_settings',
      entityId: 'copilot_watch_settings',
      after: { ...updated },
      userId: actor.userId,
      role: actor.role,
    });
    return updated;
  }

  @Post('watch/run')
  async runWatchNow(@Req() req: Request): Promise<{ ran: boolean; message: string }> {
    const actor = this.getActor(req);
    const result = await this.watchService.runOnce(true);
    void this.auditService.log({
      action: 'copilot.watch_run',
      entity: 'ai_settings',
      entityId: 'copilot_watch_settings',
      after: { ran: result.ran },
      userId: actor.userId,
      role: actor.role,
    });
    return result;
  }

  @Post('shopper-demand-gaps/draft')
  async createDraftFromGap(
    @Req() req: Request,
    @Body() dto: CreateDraftFromGapDto,
  ): Promise<CopilotAction & { conversationId: string }> {
    const actor = this.getActor(req);
    const result = await this.copilotService.createDraftFromGap(
      actor.userId,
      actor.role,
      dto.keyword,
      dto.categoryId,
    );
    return { ...result.action, conversationId: result.conversationId };
  }

  @Post('products/backfill-copy')
  async backfillCopy(
    @Req() req: Request,
    @Body() dto: BackfillCopyDto,
  ): Promise<Array<{ id: string; title: string; ok: boolean; filled: string[]; message?: string }>> {
    const actor = this.getActor(req);
    return this.productsService.backfillCopy(
      dto.ids,
      actor,
      (input) => this.copywriterService.generate({
        productNameZh: input.productNameZh,
        category: input.category,
        targetMarket: '北美市场',
      }, actor.userId),
    );
  }

  @Get('watch/preview')
  async previewDigest(
    @Req() req: Request,
    @Query('format') format?: string,
  ): Promise<{ format: string; subject: string; body: string }> {
    const safeFormat = format === 'html' || format === 'markdown' ? format : 'plain';
    const settings = await this.watchService.getSettings(this.getActor(req));
    const { insights, generatedAt } = await this.insightsService.getInsights(this.getActor(req));
    const at = new Date(generatedAt);
    const subject = renderSubject(settings.notifySubjectTemplate, insights, []);
    const body = renderDigest({ insights, newInsights: [], at }, safeFormat);
    return { format: safeFormat, subject, body };
  }

  @Get('products/copy-quality')
  async auditAiCopy(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 100;
    return this.productsService.auditAiCopy(Number.isFinite(parsed) ? parsed : 100);
  }

  @Post('products/:id/mark-reviewed')
  async markReviewed(@Req() req: Request, @Param('id') id: string) {
    const actor = this.getActor(req);
    return this.productsService.markCopyReviewed(id, actor.userId);
  }

  @Get('shopper-product-funnel')
  async getShopperProductFunnel(
    @Req() req: Request,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ): Promise<ShopperProductFunnelResponse> {
    const parsedDays = days ? parseInt(days, 10) : 30;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const actor = this.getActor(req);
    return this.shopperAnalytics.getProductFunnel(
      Number.isFinite(parsedDays) ? parsedDays : 30,
      Number.isFinite(parsedLimit) ? parsedLimit : 20,
      actor.role === 'admin' ? undefined : actor.userId,
    );
  }

  @Get('insights/thresholds')
  async getInsightThresholds(): Promise<CopilotInsightThresholds> {
    return this.insightsService.getThresholds();
  }

  @Put('insights/thresholds')
  async updateInsightThresholds(
    @Req() req: Request,
    @Body() dto: UpdateInsightThresholdsDto,
  ): Promise<CopilotInsightThresholds> {
    const actor = this.getActor(req);
    const sanitized = sanitizeInsightThresholds(dto as Record<string, unknown>);
    const updated = await this.insightsService.updateThresholds(sanitized, actor.userId);
    void this.auditService.log({
      action: 'copilot.insight_thresholds_update',
      entity: 'ai_settings',
      entityId: 'copilot_insight_thresholds',
      before: undefined,
      after: { ...updated },
      userId: actor.userId,
      role: actor.role,
    });
    return updated;
  }

  @Get('conversations')
  async listConversations(@Req() req: Request): Promise<CopilotConversation[]> {
    return this.copilotService.listConversations(this.getActor(req).userId);
  }

  @Post('conversations')
  async createConversation(
    @Req() req: Request,
    @Body() dto: CreateConversationDto,
  ): Promise<CopilotConversation> {
    return this.copilotService.createConversation(this.getActor(req).userId, dto.title);
  }

  @Get('conversations/:id')
  async getConversation(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<CopilotConversationDetail> {
    return this.copilotService.getConversationDetail(this.getActor(req).userId, id);
  }

  @Delete('conversations/:id')
  async deleteConversation(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.copilotService.removeConversation(this.getActor(req).userId, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/messages')
  async sendMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SendCopilotMessageDto,
  ): Promise<CopilotSendResult> {
    const actor = this.getActor(req);
    return this.copilotService.sendMessage(actor.userId, actor.role, id, dto.content);
  }

  @Post('actions/:id/resolve')
  async resolveAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ResolveActionDto,
  ): Promise<CopilotActionResolveResult> {
    const actor = this.getActor(req);
    return this.copilotService.resolveAction(actor.userId, actor.role, id, dto.approve, dto.reason);
  }

  @Get('actions/:id/impact')
  async describeImpact(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ impact: string }> {
    const actor = this.getActor(req);
    return { impact: await this.copilotService.describeActionImpact(actor.userId, id) };
  }

  @Post('batches/:batchId/resolve')
  async resolveBatch(
    @Req() req: Request,
    @Param('batchId') batchId: string,
    @Body() dto: ResolveActionDto,
  ): Promise<CopilotBatchResolveResult> {
    const actor = this.getActor(req);
    return this.copilotService.resolveBatch(actor.userId, actor.role, batchId, dto.approve, dto.reason);
  }
}
