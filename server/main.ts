import 'dotenv/config';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { SeoService } from './modules/seo/seo.service';
import { buildOpenApiSpec } from './modules/seo/openapi';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';

async function bootstrap(): Promise<void> {
  // rawBody: 保留原始请求体，供 Stripe webhook 签名校验使用
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.use(cookieParser());
  app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
  app.use(new SecurityHeadersMiddleware().use.bind(new SecurityHeadersMiddleware()));
  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 反向代理部署时设置 TRUST_PROXY=1（或代理跳数），使 req.ip 正确还原客户端地址；
  // 未设置时不信任任何 X-Forwarded-* 头，防止伪造来源 IP 绕过限流与审计。
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const value = /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy;
    app.getHttpAdapter().getInstance().set('trust proxy', value);
  }

  const isProd = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: isProd
      ? (process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ??
        [process.env.APP_URL ?? 'http://localhost:3000'])
      : true,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // 站点级发现端点（不在 /api 前缀下）：sitemap / robots / llms.txt，
  // 以及机器可读的 OpenAPI 与页面元信息。放在 SPA 回退之前注册。
  const seo = app.get(SeoService);
  const http = app.getHttpAdapter().getInstance();
  http.get('/sitemap.xml', async (_req: Request, res: Response) => {
    res.type('application/xml').send(await seo.sitemap());
  });
  http.get('/robots.txt', (_req: Request, res: Response) => {
    res.type('text/plain').send(seo.robots());
  });
  http.get('/llms.txt', (_req: Request, res: Response) => {
    res.type('text/plain').send(seo.llmsTxt());
  });
  http.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(buildOpenApiSpec());
  });
  http.get('/api/seo/meta', async (req: Request, res: Response) => {
    const raw = typeof req.query.path === 'string' ? req.query.path : '/';
    res.json(await seo.resolvePath(raw));
  });

  // 单进程部署（Docker/裸机）：同源托管前端构建产物 + SPA 回退；开发态由 Vite 提供前端。
  const clientDist = [join(__dirname, '..', 'dist'), join(__dirname, '..', '..', 'dist')]
    .find((dir) => existsSync(join(dir, 'index.html')));
  if (clientDist) {
    // 带 content hash 的资源长缓存；index.html 不缓存，保证发版后立即生效
    app.useStaticAssets(clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (/\.(js|css|woff2?|png|jpe?g|svg|webp|avif|mp4)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });

    // SEO-lite：服务端把 meta/OG/JSON-LD 注入 index.html，
    // 解决纯 SPA 首屏无描述、无 canonical、社交分享无卡片的问题（无需引入 SSR 框架）。
    const templatePath = join(clientDist, 'index.html');
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || extname(req.path)) {
        return next();
      }
      try {
        const template = await readFile(templatePath, 'utf8');
        const meta = await seo.resolvePath(req.path);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(seo.renderHtml(template, meta));
      } catch (err) {
        Logger.warn(`SEO render failed: ${(err as Error).message}`, 'Bootstrap');
        res.sendFile(templatePath);
      }
    });
    Logger.log(`Serving client build from ${clientDist}`, 'Bootstrap');
  }

  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST;
  if (host) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }
  Logger.log(`Flow server running on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
