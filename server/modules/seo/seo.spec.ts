import { afterEach, describe, expect, it } from 'vitest';
import { SeoService } from './seo.service';
import { buildOpenApiSpec } from './openapi';

describe('SEO 渲染', () => {
  const service = new SeoService({} as never);

  it('注入 title / description / OG / JSON-LD 并移除模板兜底 title', () => {
    const template = '<html><head><!--seo--><title>fallback</title></head><body></body></html>';
    const html = service.renderHtml(template, {
      title: 'Test Product · Flow',
      description: 'A <script>alert(1)</script> description',
      canonicalPath: '/products/abc',
      ogType: 'product',
      jsonLd: { '@type': 'Product', name: 'Test' },
    });
    expect(html).toContain('<title>Test Product · Flow</title>');
    expect(html).toContain('application/ld+json');
    expect(html.split('<title>').length).toBe(2);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('og:type" content="product"');
  });

  it('订单/结算/卖家路由标记 noindex', async () => {
    const orders = await service.resolvePath('/orders');
    expect(orders.noindex).toBe(true);
    const home = await service.resolvePath('/');
    expect(home.noindex).toBeUndefined();
    expect(home.jsonLd?.['@type']).toBe('Organization');
  });
});

describe('OpenAPI 描述', () => {
  it('是有效的 3.1 文档且包含核心端点与安全方案', () => {
    const spec = buildOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    const paths = spec.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toContain('/api/products');
    expect(Object.keys(paths)).toContain('/api/orders');
    expect(Object.keys(paths)).toContain('/api/payments/pay');
    const components = spec.components as { securitySchemes: Record<string, unknown> };
    expect(components.securitySchemes.cookieAuth).toBeTruthy();
  });
});

/**
 * 站点绝对 URL 的解析。
 *
 * 真实缺陷：此前 `SITE_URL` 只读 process.env.APP_URL，未配置时一律输出
 * localhost:3000。自托管、预览部署、任意非 3000 端口上，sitemap / llms.txt /
 * agent-card 全部指向不存在的地址 —— 对外部爬虫和 AI Agent 是静默错误。
 */
describe('SeoService absolute URL resolution', () => {
  const originalEnv = process.env.APP_URL;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalEnv;
  });

  it('S1: APP_URL 优先于请求头', () => {
    process.env.APP_URL = 'https://shop.example.com';
    const service = new SeoService({} as never);
    const card = service.agentCard({ headers: { host: 'internal:3413' } }) as Record<string, unknown>;
    expect(card.url).toBe('https://shop.example.com/api/mcp');
  });

  it('S2: 未配置 APP_URL 时按请求 Host 推导，而不是写死 localhost', () => {
    delete process.env.APP_URL;
    const service = new SeoService({} as never);
    const card = service.agentCard({ headers: { host: 'flow.example.org' } }) as Record<string, unknown>;
    expect(card.url).toBe('http://flow.example.org/api/mcp');
  });

  it('S3: 尊重 X-Forwarded-Proto（反向代理后仍是 https）', () => {
    delete process.env.APP_URL;
    const service = new SeoService({} as never);
    const card = service.agentCard({
      headers: { host: 'flow.example.org', 'x-forwarded-proto': 'https' },
    }) as Record<string, unknown>;
    expect(card.url).toBe('https://flow.example.org/api/mcp');
  });

  it('S4: 多值 X-Forwarded-Proto 取第一段', () => {
    delete process.env.APP_URL;
    const service = new SeoService({} as never);
    const card = service.agentCard({
      headers: { host: 'flow.example.org', 'x-forwarded-proto': 'https, http' },
    }) as Record<string, unknown>;
    expect(card.url).toBe('https://flow.example.org/api/mcp');
  });

  it('S5: 无请求上下文时回落 localhost 兜底（不崩）', () => {
    delete process.env.APP_URL;
    const service = new SeoService({} as never);
    const card = service.agentCard() as Record<string, unknown>;
    expect(String(card.url)).toContain('/api/mcp');
    expect(String(card.url)).toContain('localhost:3000');
  });

  it('S6: agent card 只声明读技能，并说明写操作被门禁拦截', () => {
    delete process.env.APP_URL;
    const service = new SeoService({} as never);
    const card = service.agentCard({ headers: { host: 'x.test' } }) as Record<string, any>;
    expect(Array.isArray(card.skills)).toBe(true);
    expect(card.skills.length).toBeGreaterThan(0);
    expect(card['x-flow-mcp'].writeToolsExcluded).toBe(true);
  });
});
