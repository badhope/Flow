import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CsrfHeaderMiddleware } from './csrf-header.middleware';
import type { Request, Response } from 'express';

function run(method: string, path: string, headers: Record<string, string> = {}) {
  const middleware = new CsrfHeaderMiddleware();
  const next = vi.fn();
  const req = { method, path, headers } as unknown as Request;
  middleware.use(req, {} as Response, next);
  return next;
}

describe('CsrfHeaderMiddleware', () => {
  it('R1: lets safe methods through without the header', () => {
    expect(run('GET', '/api/products')).toHaveBeenCalledOnce();
    expect(run('HEAD', '/api/products')).toHaveBeenCalledOnce();
    expect(run('OPTIONS', '/api/products')).toHaveBeenCalledOnce();
  });

  it('R2: rejects a state-changing request without X-Requested-With', () => {
    expect(() => run('POST', '/api/cart')).toThrow(ForbiddenException);
    expect(() => run('PUT', '/api/products/1')).toThrow(ForbiddenException);
    expect(() => run('PATCH', '/api/products/1')).toThrow(ForbiddenException);
    expect(() => run('DELETE', '/api/products/1')).toThrow(ForbiddenException);
  });

  it('R3: rejects a wrong header value', () => {
    expect(() => run('POST', '/api/cart', { 'x-requested-with': 'fetch' })).toThrow(ForbiddenException);
  });

  it('R4: accepts the exact header value', () => {
    expect(run('POST', '/api/cart', { 'x-requested-with': 'XMLHttpRequest' })).toHaveBeenCalledOnce();
  });

  it('R5: exempts the Stripe webhook path', () => {
    expect(run('POST', '/api/payments/stripe-webhook')).toHaveBeenCalledOnce();
  });

  it('R6: exempts the PayPal webhook path', () => {
    expect(run('POST', '/api/payments/paypal-webhook')).toHaveBeenCalledOnce();
  });

  it('R7: does not exempt a lookalike path', () => {
    expect(() => run('POST', '/api/payments/stripe-webhook-evil')).toThrow(ForbiddenException);
  });

  it('R8: the exemption list does not leak to sibling payment routes', () => {
    expect(() => run('POST', '/api/payments/checkout')).toThrow(ForbiddenException);
  });
});
