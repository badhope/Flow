import { describe, expect, it } from 'vitest';
import { resolveJwtSecret } from './auth.module';

const VALID_SECRET = 'x'.repeat(32);

function resolve(
  nodeEnv: string | undefined,
  jwtSecret: string | undefined,
): string {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;

  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwtSecret;

  try {
    return resolveJwtSecret();
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  }
}

describe('AuthModule JWT secret policy', () => {
  it.each([
    ['unset', undefined],
    ['unknown', 'qa'],
    ['staging', 'staging'],
    ['production', 'production'],
  ])('requires a strong JWT_SECRET when NODE_ENV is %s', (_label, nodeEnv) => {
    expect(() => resolve(nodeEnv, undefined)).toThrow(
      /JWT_SECRET.*32 characters/i,
    );
    expect(() => resolve(nodeEnv, 'short-secret')).toThrow(
      /JWT_SECRET.*32 characters/i,
    );
  });

  it.each(['development', 'test'])(
    'allows the development fallback only in %s',
    (nodeEnv) => {
      expect(resolve(nodeEnv, undefined)).toHaveLength(64);
      expect(resolve(nodeEnv, 'short-secret')).toHaveLength(64);
      expect(resolve(nodeEnv, 'short-secret')).not.toBe('short-secret');
    },
  );

  it.each(['unset', 'unknown', 'staging', 'production'])(
    'accepts a strong JWT_SECRET in %s',
    (_label) => {
      expect(
        resolve(_label === 'unset' ? undefined : _label, VALID_SECRET),
      ).toBe(VALID_SECRET);
    },
  );
});
