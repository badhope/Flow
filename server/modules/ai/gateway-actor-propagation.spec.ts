import { describe, expect, it, vi } from 'vitest';
import { CopywriterService } from './copywriter.service';
import { TranslationService } from './translation.service';
import { SupportService } from './support.service';

describe('AI gateway actor propagation', () => {
  it('R32: copywriter and translation pass seller role', async () => {
    const gateway = { chat: vi.fn().mockResolvedValue({ content: '{"titleEn":"x","bulletPoints":[],"longDescription":"","seoKeywords":""}' }) };
    const copywriter = new CopywriterService(gateway as never);
    await copywriter.generate({ productNameZh: '商品' }, { userId: 'seller-1', role: 'seller' });
    const translation = new TranslationService(gateway as never);
    await translation.translate({ text: 'hello', targetLang: 'zh' }, { userId: 'seller-1', role: 'seller' });
    expect(gateway.chat.mock.calls[0][1]).toEqual(expect.objectContaining({ userId: 'seller-1', role: 'seller' }));
    expect(gateway.chat.mock.calls[1][1]).toEqual(expect.objectContaining({ userId: 'seller-1', role: 'seller' }));
  });

  it('R33: support passes admin role', async () => {
    const gateway = { chat: vi.fn().mockResolvedValue({ content: 'ok' }) };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    };
    const support = new SupportService(db as never, gateway as never);
    await support.chat({ message: 'hello' }, { userId: 'admin-1', role: 'admin' });
    expect(gateway.chat.mock.calls[0][1]).toEqual(expect.objectContaining({ userId: 'admin-1', role: 'admin' }));
  });
});
