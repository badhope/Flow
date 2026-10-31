import { Controller, Post, Get, Body, Req, Query, Param, UseGuards, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { aiReports } from '../../database/schema';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { buildOwnerVisibilityCondition, andOptional, type SellerActor } from './seller-scope';
import { AiGatewayService } from './ai-gateway.service';
import { CopywriterService } from './copywriter.service';
import { SupportService } from './support.service';
import { TrendService } from './trend.service';
import { SelectService } from './select.service';
import { TranslationService } from './translation.service';
import { CopywriterDto, SupportChatDto, TranslationDto } from './dto/ai.dto';
import type {
  AICopywriterResponse,
  AITranslationResponse,
  AITrendReport,
  AISelectResponse,
  AIStatusResponse,
  AIReportSummary,
  AIReportDetail,
  SupportChatResponse,
} from '../../../shared/api.interface';

interface UsageStatsResponse {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  successRate: number;
  byAgent: Array<{
    agent: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  }>;
}

@Controller('ai')
export class AiController {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
    private readonly copywriterService: CopywriterService,
    private readonly supportService: SupportService,
    private readonly trendService: TrendService,
    private readonly selectService: SelectService,
    private readonly translationService: TranslationService,
  ) {}

  private getActor(req?: Request): SellerActor {
    return { userId: req?.user?.id, role: req?.user?.role };
  }

  @Get('status')
  async getStatus(@Req() req: Request): Promise<AIStatusResponse> {
    const config = await this.aiGateway.resolveConfig(this.getActor(req));
    const isAuthenticated = Boolean(req.user?.id);
    return {
      configured: config.apiKey.length > 0,
      // 匿名买家只需要知道导购是否可用；不暴露模型供应商/配置来源。
      model: isAuthenticated && config.apiKey.length > 0 ? config.model : undefined,
      source: isAuthenticated ? config.source : undefined,
    };
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get('usage-stats')
  async getUsageStats(
    @Query('agent') agent?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Req() req?: Request,
  ): Promise<UsageStatsResponse> {
    return this.aiGateway.getUsageStats({ agent, startDate, endDate, actor: this.getActor(req) });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get('reports')
  async listReports(
    @Query('type') type?: string,
    @Req() req?: Request,
  ): Promise<AIReportSummary[]> {
    const actor = this.getActor(req);
    const rows = await this.db
      .select({
        id: aiReports.id,
        reportType: aiReports.reportType,
        title: aiReports.title,
        model: aiReports.model,
        createdAt: aiReports.createdAt,
      })
      .from(aiReports)
      .where(andOptional(
        type ? eq(aiReports.reportType, type) : undefined,
        buildOwnerVisibilityCondition(aiReports.userId, actor),
      ))
      .orderBy(desc(aiReports.createdAt))
      .limit(20);

    return rows.map((row) => ({
      id: row.id,
      reportType: row.reportType,
      title: row.title,
      model: row.model ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get('reports/:id')
  async getReport(@Param('id') id: string, @Req() req: Request): Promise<AIReportDetail> {
    const actor = this.getActor(req);
    const rows = await this.db
      .select()
      .from(aiReports)
      .where(andOptional(
        eq(aiReports.id, id),
        buildOwnerVisibilityCondition(aiReports.userId, actor),
      ));
    if (rows.length === 0) {
      throw new NotFoundException('报告不存在');
    }
    const row = rows[0];
    return {
      id: row.id,
      reportType: row.reportType,
      title: row.title,
      model: row.model ?? undefined,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post('copywriter')
  async copywriter(
    @Body() dto: CopywriterDto,
    @Req() req: Request,
  ): Promise<AICopywriterResponse> {
    return this.copywriterService.generate(dto, this.getActor(req));
  }

  // 公开端点（买家用）：额外限流收紧到 10/min 每 IP，防止匿名消耗 LLM 配额
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('support/chat')
  async supportChat(
    @Body() dto: SupportChatDto,
    @Req() req: Request,
  ): Promise<SupportChatResponse> {
    const rawSession = req.headers['x-session-id'];
    const sessionId = Array.isArray(rawSession) ? rawSession[0] : rawSession;
    return this.supportService.chat(dto, {
      ...this.getActor(req),
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post('trend/generate')
  async generateTrend(@Req() req: Request): Promise<AITrendReport> {
    const actor = this.getActor(req);
    if (!actor.userId) throw new BadRequestException('用户未登录');
    return this.trendService.generateTrendReport(actor);
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post('select/generate')
  async generateSelect(@Req() req: Request): Promise<AISelectResponse> {
    return this.selectService.selectProducts(this.getActor(req));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('translate')
  async translate(
    @Body() dto: TranslationDto,
    @Req() req: Request,
  ): Promise<AITranslationResponse> {
    return this.translationService.translate(dto, this.getActor(req));
  }
}
