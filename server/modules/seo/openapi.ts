/**
 * OpenAPI 3.1 描述（手写维护，零新依赖）。
 * 只覆盖对外稳定契约：商品/集合/CMS/购物车/订单/支付/健康检查。
 * 目的：让第三方集成、SDK 生成与 AI Agent 能机器读取接口，不必爬文档。
 */
const json = (schema: Record<string, unknown>) => ({ 'application/json': { schema } });

export function buildOpenApiSpec(): Record<string, unknown> {
  const product = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      titleZh: { type: 'string' },
      titleEn: { type: 'string' },
      descZh: { type: 'string' },
      descEn: { type: 'string' },
      minPrice: { type: 'string' },
      maxPrice: { type: 'string' },
      totalStock: { type: 'integer' },
      totalSold: { type: 'integer' },
      status: { type: 'string', enum: ['draft', 'active', 'inactive'] },
      coverImage: { type: 'string' },
      images: { type: 'array', items: { type: 'string' } },
      avgRating: { type: 'number' },
      reviewCount: { type: 'integer' },
    },
  };
  const error = {
    type: 'object',
    properties: {
      statusCode: { type: 'integer' },
      message: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      error: { type: 'string' },
      requestId: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      path: { type: 'string' },
    },
  };
  const errorResponse = (description: string) => ({
    description,
    content: json(error),
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'Flow — AI-Native Cross-Border Commerce API',
      // 与 package.json 的 version 同步；漂移会让集成方按错误版本对接
      version: '1.26.0',
      description: [
        'Buyer storefront + seller AI workbench.',
        'All state-changing browser requests require the X-Requested-With: XMLHttpRequest header (CSRF).',
        'Authentication uses an HttpOnly JWT cookie.',
        'Agent integration is available over MCP at POST /api/mcp (read-only tools).',
        'Order creation accepts an optional idempotencyKey for safe retries.',
      ].join(' '),
      license: { name: 'MIT' },
    },
    servers: [{ url: '/', description: 'Same-origin deployment' }],
    tags: [
      { name: 'catalog', description: 'Products, categories, collections, CMS' },
      { name: 'commerce', description: 'Cart, orders, payments, refunds' },
      { name: 'seller', description: 'Seller workbench APIs (JWT + seller role)' },
      { name: 'system', description: 'Health, SEO, discovery' },
      { name: 'agents', description: 'MCP endpoint for external AI agents (read-only)' },
    ],
    components: {
      schemas: {
        Product: product,
        Error: error,
      },
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'flow_auth' },
      },
    },
    paths: {
      '/api/mcp': {
        post: {
          tags: ['agents'],
          summary: 'MCP Streamable HTTP endpoint (JSON-RPC 2.0)',
          description:
            'Model Context Protocol server. Supports initialize, tools/list and tools/call over Streamable HTTP. '
            + 'Only read tools are exposed; write operations require human approval in the workbench.',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['jsonrpc', 'method'],
              properties: {
                jsonrpc: { type: 'string', enum: ['2.0'] },
                id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
                method: { type: 'string', enum: ['initialize', 'tools/list', 'tools/call', 'ping'] },
                params: { type: 'object' },
              },
            }),
          },
          responses: {
            200: { description: 'JSON-RPC response (result or error)' },
            202: { description: 'Notification accepted (no body)' },
          },
        },
      },
      '/api/mcp/health': {
        get: {
          tags: ['agents'],
          summary: 'MCP endpoint liveness (public, no user data)',
          responses: { 200: { description: 'Endpoint alive', content: json({ type: 'object' }) } },
        },
      },
      '/api/health': {
        get: {
          tags: ['system'],
          summary: 'Liveness + database readiness',
          responses: {
            200: {
              description: 'Service healthy',
              content: json({
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  db: { type: 'string' },
                  time: { type: 'string' },
                },
              }),
            },
            503: errorResponse('Database unavailable'),
          },
        },
      },
      '/api/products': {
        get: {
          tags: ['catalog'],
          summary: 'List publicly visible (active) products',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'keyword', in: 'query', schema: { type: 'string' } },
            { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'minPrice', in: 'query', schema: { type: 'number' } },
            { name: 'maxPrice', in: 'query', schema: { type: 'number' } },
            {
              name: 'sortBy',
              in: 'query',
              schema: { type: 'string', enum: ['newest', 'price_asc', 'price_desc', 'sold_desc'] },
            },
          ],
          responses: {
            200: {
              description: 'Paginated products',
              content: json({
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
                  total: { type: 'integer' },
                  page: { type: 'integer' },
                  pageSize: { type: 'integer' },
                },
              }),
            },
          },
        },
      },
      '/api/products/{id}': {
        get: {
          tags: ['catalog'],
          summary: 'Product detail (public: active only; seller: own drafts)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Product', content: json({ $ref: '#/components/schemas/Product' }) },
            404: errorResponse('Not found or not active'),
          },
        },
      },
      '/api/products/featured': {
        get: {
          tags: ['catalog'],
          summary: 'Featured products (best sellers)',
          responses: {
            200: {
              description: 'Product list',
              content: json({ type: 'array', items: { $ref: '#/components/schemas/Product' } }),
            },
          },
        },
      },
      '/api/collections/storefront': {
        get: {
          tags: ['catalog'],
          summary: 'Featured storefront sections with products',
          responses: { 200: { description: 'Sections', content: json({ type: 'array', items: { type: 'object' } }) } },
        },
      },
      '/api/cart': {
        get: {
          tags: ['commerce'],
          summary: 'Get cart (cookie session or X-Session-Id header)',
          security: [{ cookieAuth: [] }, {}],
          parameters: [{ name: 'X-Session-Id', in: 'header', schema: { type: 'string' } }],
          responses: { 200: { description: 'Cart', content: json({ type: 'object' }) } },
        },
      },
      '/api/orders': {
        post: {
          tags: ['commerce'],
          summary: 'Create order (server recalculates prices, shipping and coupons)',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['buyerName', 'shippingAddress', 'shippingCity', 'shippingCountry', 'paymentMethod', 'items'],
              properties: {
                buyerName: { type: 'string' },
                buyerPhone: { type: 'string' },
                shippingAddress: { type: 'string' },
                shippingCity: { type: 'string' },
                shippingZip: { type: 'string' },
                shippingCountry: { type: 'string' },
                paymentMethod: { type: 'string', enum: ['demo', 'stripe', 'paypal'] },
                couponCode: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['productId', 'quantity'],
                    properties: {
                      productId: { type: 'string', format: 'uuid' },
                      variantId: { type: 'string', format: 'uuid' },
                      quantity: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            }),
          },
          responses: {
            201: { description: 'Created order', content: json({ type: 'object' }) },
            400: errorResponse('Validation failed / stock insufficient'),
          },
        },
      },
      '/api/payments/pay': {
        post: {
          tags: ['commerce'],
          summary: 'Start payment for an order',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['orderId', 'provider'],
              properties: {
                orderId: { type: 'string', format: 'uuid' },
                provider: { type: 'string', enum: ['demo', 'stripe', 'paypal'] },
              },
            }),
          },
          responses: {
            201: {
              description:
                'Payment created. Stripe returns clientSecret, PayPal returns approveUrl; both require provider confirmation before the order becomes paid.',
              content: json({ type: 'object' }),
            },
          },
        },
      },
      '/api/payments/paypal/capture': {
        post: {
          tags: ['commerce'],
          summary: 'Capture an approved PayPal order and settle payment',
          responses: { 201: { description: 'Payment settled', content: json({ type: 'object' }) } },
        },
      },
      '/api/copilot/insights': {
        get: {
          tags: ['seller'],
          summary: 'Merchant operations insights (low stock, stale refunds, unpaid orders, stale shipments)',
          security: [{ cookieAuth: [] }],
          responses: { 200: { description: 'Insights', content: json({ type: 'object' }) } },
        },
      },
    },
  };
}
