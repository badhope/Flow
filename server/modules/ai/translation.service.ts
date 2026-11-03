import { BadRequestException, Injectable } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import type { SellerActor } from './seller-scope';
import type { AITranslationRequest, AITranslationResponse } from '../../../shared/api.interface';

const MAX_TEXT_LENGTH = 5000;

/** 支持的目标语言（12 种，与 README 语言清单保持一致） */
export const LANGUAGE_NAMES: Record<string, string> = {
  zh: '中文',
  en: '英文',
  ja: '日文',
  ko: '韩文',
  fr: '法文',
  de: '德文',
  es: '西班牙文',
  pt: '葡萄牙文',
  it: '意大利文',
  ru: '俄文',
  ar: '阿拉伯文',
  th: '泰文',
};

@Injectable()
export class TranslationService {
  constructor(private readonly aiGateway: AiGatewayService) {}

  async translate(dto: AITranslationRequest, actorOrUserId?: SellerActor | string): Promise<AITranslationResponse> {
    const actor: SellerActor = typeof actorOrUserId === 'string' ? { userId: actorOrUserId } : (actorOrUserId ?? {});
    const text = dto.text?.trim() ?? '';
    if (!text) {
      throw new BadRequestException('待翻译文本不能为空');
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException(`文本不能超过 ${MAX_TEXT_LENGTH} 个字符`);
    }

    const targetLang = LANGUAGE_NAMES[dto.targetLang];
    if (!targetLang) {
      throw new BadRequestException(`不支持的目标语言: ${dto.targetLang}`);
    }

    const sourceLang = dto.sourceLang && LANGUAGE_NAMES[dto.sourceLang]
      ? LANGUAGE_NAMES[dto.sourceLang]
      : '自动检测';

    const systemPrompt = '你是专业的多语言翻译专家，擅长跨境电商场景下的精准翻译。请直接输出翻译结果，不要添加任何解释或标记。';

    const userPrompt = `请将以下文本从${sourceLang}翻译为${targetLang}：

${text}`;

    const { content } = await this.aiGateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.3, maxTokens: 2000, agent: 'translation', userId: actor.userId, role: actor.role },
    );

    return { translatedText: content.trim() };
  }
}
