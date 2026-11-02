import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import type { Request } from 'express';

function contextWith(user: { role: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }) as unknown as Request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('R1: rejects an unauthenticated request', () => {
    const guard = new RolesGuard(['seller']);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(/请先登录/);
  });

  it('R2: rejects a role outside the allow-list', () => {
    const guard = new RolesGuard(['seller']);
    expect(() => guard.canActivate(contextWith({ role: 'buyer' }))).toThrow(/权限不足/);
  });

  it('R3: accepts an allowed role', () => {
    const guard = new RolesGuard(['seller', 'admin']);
    expect(guard.canActivate(contextWith({ role: 'seller' }))).toBe(true);
    expect(guard.canActivate(contextWith({ role: 'admin' }))).toBe(true);
  });

  it('R4: an empty allow-list rejects every role (fail-closed)', () => {
    const guard = new RolesGuard([]);
    expect(() => guard.canActivate(contextWith({ role: 'admin' }))).toThrow(ForbiddenException);
  });

  it('R5: role comparison is exact, not prefix based', () => {
    const guard = new RolesGuard(['seller']);
    expect(() => guard.canActivate(contextWith({ role: 'seller-admin' }))).toThrow(ForbiddenException);
  });
});
