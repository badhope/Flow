import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Third-party webhook callbacks cannot send browser-only custom headers, so
// these exact paths bypass the check. Matching is exact (after stripping one
// trailing slash) — a prefix match would also exempt lookalike routes such as
// `/api/payments/stripe-webhook-evil`.
const EXEMPT_PATHS = new Set([
  '/api/payments/stripe-webhook',
  '/api/payments/paypal-webhook',
]);

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

@Injectable()
export class CsrfHeaderMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const method = req.method.toUpperCase();
    if (!STATE_CHANGING_METHODS.includes(method)) {
      next();
      return;
    }
    if (EXEMPT_PATHS.has(normalizePath(req.path))) {
      next();
      return;
    }
    const header = req.headers['x-requested-with'];
    if (!header || header !== 'XMLHttpRequest') {
      throw new ForbiddenException('CSRF 校验失败：缺少 X-Requested-With 请求头');
    }
    next();
  }
}
