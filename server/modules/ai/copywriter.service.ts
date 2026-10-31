import { Injectable } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import type { SellerActor } from './seller-scope';
import { parseLlmJson } from './llm-json';
import type { AICopywriterRequest, AICopywriterResponse } from '../../../shared/api.interface';

@Injectable()
export class CopywriterService {
  constructor(private readonly aiGateway: AiGatewayService) {}

  async generate(dto: AICopywriterRequest, actorOrUserId?: SellerActor | string): Promise<AICopywriterResponse> {
    const actor: SellerActor = typeof actorOrUserId === 'string' ? { userId: actorOrUserId } : (actorOrUserId ?? {});
    const systemPrompt = '你是专业的跨境电商文案专家，擅长为英文市场撰写有吸引力的商品文案。请用英文输出。';

    const userPrompt = `基于以下商品信息生成电商商品文案，要求返回严格的 JSON 格式：
- 商品中文名：${dto.productNameZh}
- 规格参数：${dto.specs || '未提供'}
- 类目：${dto.category || '未提供'}
- 目标市场：${dto.targetMarket || '北美市场'}

请输出以下 JSON 结构：
{
  "titleEn": "英文商品标题，不超过80字符，包含核心关键词",
  "bulletPoints": ["5条卖点描述，每条不超过150字符"],
  "longDescription": "详细商品描述，300-500字",
  "seoKeywords": "SEO关键词，用逗号分隔"
}`;

    const { content } = await this.aiGateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.8, maxTokens: 1500, responseFormat: 'json', agent: 'copywriter', userId: actor.userId, role: actor.role },
    );

    const parsed = parseLlmJson<AICopywriterResponse>(content);
    return {
      titleEn: parsed.titleEn || '',
      bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
      longDescription: parsed.longDescription || '',
      seoKeywords: parsed.seoKeywords || '',
    };
  }

}
