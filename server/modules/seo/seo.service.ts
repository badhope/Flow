import { Inject, Injectable } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import { cmsPages, collections, products } from '../../database/schema';

export interface PageMeta {
  title: string;
  description: string;
  canonicalPath: string;
  ogType: 'website' | 'product' | 'article';
  image?: string;
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
}

const SITE_NAME = 'Flow';
const DEFAULT_TITLE = 'Flow — 让跨境生意更简单 · Cross-Border Commerce, Simplified';
const DEFAULT_DESCRIPTION =
  'Flow 是 AI 原生的跨境出口电商平台：买家商城 + 卖家 AI 工作台，内置 5 个真实 AI Agent 与人工审批式运营副驾，覆盖上架、获客、成交、客服与复盘全链路。';
/**
 * 站点绝对 URL 的解析顺序：
 *   1. APP_URL（生产必配，最权威）
 *   2. 请求的 X-Forwarded-Proto / Host（多环境、预览部署、反向代理都能自洽）
 *   3. localhost:3000（仅本地兜底）
 *
 * 之前只用 process.env.APP_URL 兜底 localhost，导致任何未配置 APP_URL 的
 * 环境（预览、自托管、测试端口）在 sitemap / llms.txt / agent-card 里
 * 全部输出 localhost:3000 —— 对外部爬虫和 Agent 都是错误地址。
 */
const FALLBACK_SITE_URL = 'http://localhost:3000';

@Injectable()
export class SeoService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  /** 请求级 base URL：APP_URL 优先，其次按请求头推导，最后本地兜底 */
  private baseUrl(req?: { headers?: Record<string, unknown> }): string {
    const envUrl = process.env.APP_URL?.trim();
    if (envUrl) return envUrl.replace(/\/$/, '');
    const headers = req?.headers ?? {};
    const host = typeof headers['host'] === 'string' ? headers['host'] : '';
    if (host) {
      const proto = typeof headers['x-forwarded-proto'] === 'string'
        ? headers['x-forwarded-proto'].split(',')[0].trim()
        : 'http';
      return `${proto}://${host}`;
    }
    return FALLBACK_SITE_URL;
  }

  private absolute(path: string, req?: { headers?: Record<string, unknown> }): string {
    return `${this.baseUrl(req)}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async productMeta(id: string): Promise<PageMeta | null> {
    const rows = await this.db
      .select({
        id: products.id,
        titleZh: products.titleZh,
        titleEn: products.titleEn,
        descZh: products.descZh,
        descEn: products.descEn,
        coverImage: products.coverImage,
        totalStock: products.totalStock,
        avgRating: products.avgRating,
        reviewCount: products.reviewCount,
        createdAt: products.createdAt,
      })
      .from(products)
      .where(and(eq(products.id, id), eq(products.status, 'active')))
      .limit(1);
    const p = rows[0];
    if (!p) return null;
    const priceRows = await this.db.execute<{ price: string }>(sql`
      SELECT MIN(price)::text AS price FROM product_variants
      WHERE product_id = ${id} AND status = 'active'
    `);
    const price = priceRows[0]?.price ?? '0';
    const title = `${p.titleEn || p.titleZh} · ${SITE_NAME}`;
    const description = (p.descEn || p.descZh || '').slice(0, 200) || DEFAULT_DESCRIPTION;
    return {
      title,
      description,
      canonicalPath: `/products/${p.id}`,
      ogType: 'product',
      image: p.coverImage || undefined,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.titleEn || p.titleZh,
        description,
        image: p.coverImage ? [p.coverImage] : undefined,
        sku: p.id,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'USD',
          price,
          availability: p.totalStock > 0
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          url: this.absolute(`/products/${p.id}`),
        },
        ...(Number(p.reviewCount) > 0
          ? {
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: Number(p.avgRating),
                reviewCount: Number(p.reviewCount),
              },
            }
          : {}),
      },
    };
  }

  private async collectionMeta(slug: string): Promise<PageMeta | null> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(and(eq(collections.slug, slug), eq(collections.status, 'active')))
      .limit(1);
    const c = rows[0];
    if (!c) return null;
    return {
      title: `${c.titleEn || c.titleZh} · ${SITE_NAME}`,
      description: (c.descriptionEn || c.descriptionZh || DEFAULT_DESCRIPTION).slice(0, 200),
      canonicalPath: `/collections/${c.slug}`,
      ogType: 'website',
      image: c.coverImage || undefined,
    };
  }

  private async cmsMeta(slug: string): Promise<PageMeta | null> {
    const rows = await this.db
      .select()
      .from(cmsPages)
      .where(and(eq(cmsPages.slug, slug), eq(cmsPages.isPublished, true)))
      .limit(1);
    const page = rows[0];
    if (!page) return null;
    return {
      title: `${page.metaTitleEn || page.titleEn || page.titleZh} · ${SITE_NAME}`,
      description: (page.metaDescEn || page.metaDescZh || DEFAULT_DESCRIPTION).slice(0, 200),
      canonicalPath: `/page/${page.slug}`,
      ogType: 'article',
    };
  }

  /** 根据前端路由解析页面元信息（供 SSR-lite 注入与客户端兜底） */
  async resolvePath(rawPath: string): Promise<PageMeta> {
    const path = rawPath.split('?')[0].replace(/\/$/, '') || '/';
    try {
      const productMatch = /^\/products\/([\w-]+)$/.exec(path);
      if (productMatch) {
        const meta = await this.productMeta(productMatch[1]);
        if (meta) return meta;
      }
      const collectionMatch = /^\/collections\/([\w-]+)$/.exec(path);
      if (collectionMatch) {
        const meta = await this.collectionMeta(collectionMatch[1]);
        if (meta) return meta;
      }
      const cmsMatch = /^\/page\/([\w-]+)$/.exec(path);
      if (cmsMatch) {
        const meta = await this.cmsMeta(cmsMatch[1]);
        if (meta) return meta;
      }
    } catch {
      // 数据库不可用时退回默认元信息，不影响页面访问
    }

    if (path === '/' || path === '') {
      return {
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        canonicalPath: '/',
        ogType: 'website',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: SITE_NAME,
          url: this.baseUrl(),
          description: DEFAULT_DESCRIPTION,
        },
      };
    }
    return {
      title: path.startsWith('/seller') ? `卖家工作台 · ${SITE_NAME}` : DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      canonicalPath: path,
      ogType: 'website',
      noindex: path.startsWith('/seller') || path.startsWith('/checkout') || path.startsWith('/orders'),
    };
  }

  /** SEO-lite 注入：把 meta / OG / JSON-LD 写进 index.html 的占位注释 */
  renderHtml(template: string, meta: PageMeta): string {
    const esc = (value: string): string =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const canonical = this.absolute(meta.canonicalPath);
    const tags = [
      `<title>${esc(meta.title)}</title>`,
      `<meta name="description" content="${esc(meta.description)}">`,
      `<link rel="canonical" href="${esc(canonical)}">`,
      meta.noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow">',
      `<meta property="og:site_name" content="${SITE_NAME}">`,
      `<meta property="og:title" content="${esc(meta.title)}">`,
      `<meta property="og:description" content="${esc(meta.description)}">`,
      `<meta property="og:type" content="${meta.ogType}">`,
      `<meta property="og:url" content="${esc(canonical)}">`,
      meta.image ? `<meta property="og:image" content="${esc(meta.image)}">` : '',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="' + esc(meta.title) + '">',
      '<meta name="twitter:description" content="' + esc(meta.description) + '">',
      meta.jsonLd
        ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\u003c')}</script>`
        : '',
    ].filter(Boolean).join('\n  ');
    // 先移除模板里的兜底 title，再注入服务端生成的 title（顺序不能反，否则会删掉注入结果）
    return template
      .replace(/<title>[\s\S]*?<\/title>/, '')
      .replace('<!--seo-->', tags);
  }

  async sitemap(req?: { headers?: Record<string, unknown> }): Promise<string> {
    const [productRows, collectionRows, pageRows] = await Promise.all([
      this.db
        .select({ id: products.id, updatedAt: products.updatedAt })
        .from(products)
        .where(eq(products.status, 'active'))
        .orderBy(desc(products.updatedAt))
        .limit(5000),
      this.db
        .select({ slug: collections.slug, updatedAt: collections.updatedAt })
        .from(collections)
        .where(eq(collections.status, 'active'))
        .limit(1000),
      this.db
        .select({ slug: cmsPages.slug, updatedAt: cmsPages.updatedAt })
        .from(cmsPages)
        .where(eq(cmsPages.isPublished, true))
        .limit(1000),
    ]);

    const entry = (path: string, lastmod?: Date, priority = '0.7'): string =>
      `<url><loc>${this.absolute(path)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${priority}</priority></url>`;

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      entry('/', undefined, '1.0'),
      entry('/products', undefined, '0.9'),
      ...collectionRows.map((row) => entry(`/collections/${row.slug}`, row.updatedAt, '0.7')),
      ...productRows.map((row) => entry(`/products/${row.id}`, row.updatedAt, '0.8')),
      ...pageRows.map((row) => entry(`/page/${row.slug}`, row.updatedAt, '0.5')),
      '</urlset>',
    ].join(String.fromCharCode(10));
  }

  robots(req?: { headers?: Record<string, unknown> }): string {
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /seller',
      'Disallow: /checkout',
      'Disallow: /orders',
      'Disallow: /api/',
      '',
      `Sitemap: ${this.absolute('/sitemap.xml', req)}`,
      '',
    ].join(String.fromCharCode(10));
  }

  /**
   * Agent Card（A2A 约定，`/.well-known/agent-card.json`）。
   *
   * 作用：让外部 Agent 框架在**不读文档**的情况下发现"这个站点提供什么能力、
   * 怎么鉴权、有哪些技能"。没有它，每个集成方都要人工对接一遍。
   *
   * 刻意只声明**读**技能：Flow 的写操作必须过人审门禁，不能通过 Agent 直连执行。
   * 这不是能力缺失，而是产品边界——写进 agent card 让集成方一眼看清。
   */
  agentCard(req?: { headers?: Record<string, unknown> }): Record<string, unknown> {
    return {
      name: 'Flow Commerce',
      description:
        'AI-native cross-border commerce platform. Exposes read-only store data to external agents; '
        + 'all write operations require human approval inside the Flow workbench.',
      url: this.absolute('/api/mcp', req),
      provider: { organization: 'Flow', url: this.absolute('/', req) },
      version: '1.0.0',
      protocolVersion: '0.3.0',
      capabilities: {
        // 与 MCP 端点实际支持的能力保持一致，不声明未实现的
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'flow_auth',
          description: 'Seller or admin session cookie issued by the Flow workbench login.',
        },
      },
      security: [{ sessionCookie: [] }],
      skills: [
        {
          id: 'store-overview',
          name: 'Store overview',
          description: 'GMV, order counts, visitor counts and pending-shipment totals for the seller store.',
          tags: ['commerce', 'analytics', 'read-only'],
          examples: ['How is my store doing today?', 'Show GMV for the last 90 days'],
        },
        {
          id: 'order-query',
          name: 'Order lookup',
          description: 'List and filter orders by status or order number.',
          tags: ['commerce', 'orders', 'read-only'],
          examples: ['Show unpaid orders', 'Find order ORD20261104ABC'],
        },
        {
          id: 'product-query',
          name: 'Product lookup',
          description: 'List products with price, stock and sales, or filter by status.',
          tags: ['catalog', 'read-only'],
          examples: ['Which products are drafts?', 'Show my best sellers'],
        },
        {
          id: 'inventory-alert',
          name: 'Low stock alert',
          description: 'List variants below a stock threshold.',
          tags: ['inventory', 'read-only'],
          examples: ['What is running low?'],
        },
        {
          id: 'refund-queue',
          name: 'Pending refunds',
          description: 'List refund requests awaiting seller decision.',
          tags: ['commerce', 'refunds', 'read-only'],
          examples: ['Any refunds to review?'],
        },
      ],
      'x-flow-mcp': {
        transport: 'streamable-http',
        protocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26'],
        writeToolsExcluded: true,
        reason: 'Write operations are gated behind human approval in the Flow workbench.',
      },
    };
  }

  /** llms.txt：给 AI 代理/爬虫的可读站点说明（agentic commerce 入口） */
  llmsTxt(req?: { headers?: Record<string, unknown> }): string {
    return [
      '# Flow — AI-Native Cross-Border Commerce Platform',
      '',
      '> Flow is an open-source AI-native cross-border e-commerce platform with a buyer storefront and a seller AI workbench. It ships 5 real LLM agents and a human-in-the-loop operations copilot.',
      '',
      '## Public routes',
      `- Storefront: ${this.absolute('/', req)}`,
      `- Products: ${this.absolute('/products', req)}`,
      `- Collections: ${this.absolute('/collections/{slug}', req)}`,
      `- CMS pages: ${this.absolute('/page/{slug}', req)}`,
      '',
      '## APIs',
      `- Product list: GET ${this.absolute('/api/products', req)} (JSON, paginated)`,
      `- Product detail: GET ${this.absolute('/api/products/{id}', req)}`,
      `- Storefront sections: GET ${this.absolute('/api/collections/storefront', req)}`,
      `- Health: GET ${this.absolute('/api/health', req)}`,
      `- OpenAPI: ${this.absolute('/api/openapi.json', req)}`,
      '',
      '## Agent integration (MCP)',
      `- MCP endpoint: POST ${this.absolute('/api/mcp', req)} (JSON-RPC 2.0, Streamable HTTP transport)`,
      `- MCP health: GET ${this.absolute('/api/mcp/health', req)}`,
      '- Protocol versions: 2025-11-25, 2025-06-18, 2025-03-26',
      '- Read-only by design: only read tools are exposed. Write operations (refunds, price changes, replies)',
      '  require human approval inside the Flow workbench and are intentionally not callable over MCP.',
      '- Authentication: the same session cookie as the seller workbench (seller or admin role).',
      '',
      '## Notes',
      '- Prices are in USD. Only products with status=active are publicly visible.',
      '- AI features degrade honestly: without a configured model they return an explicit error instead of fabricated data.',
      '- Order creation accepts an optional `idempotencyKey`; repeated submissions with the same key return the same order.',
      '',
    ].join(String.fromCharCode(10));
  }
}
