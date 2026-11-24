import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthRedirectUrl } from './auth-redirect.ts';

test('production recovery redirect uses the JacDASH Pages origin even when requested locally', () => {
  assert.equal(
    buildAuthRedirectUrl('reset-password', { production: true, currentOrigin: 'http://localhost:5173' }),
    'https://jacdash.pages.dev/reset-password',
  );
});

test('local recovery redirect stays on the current local origin', () => {
  assert.equal(
    buildAuthRedirectUrl('reset-password', { production: false, currentOrigin: 'http://localhost:5174' }),
    'http://localhost:5174/reset-password',
  );
});

test('production redirect retains a configured frontend base path', () => {
  assert.equal(
    buildAuthRedirectUrl('auth/callback', { production: true, currentOrigin: 'http://localhost:5173', configuredAppUrl: 'https://jacdash.pages.dev', baseUrl: '/app/' }),
    'https://jacdash.pages.dev/app/auth/callback',
  );
});

test('production redirect rejects insecure configured URLs', () => {
  assert.throws(
    () => buildAuthRedirectUrl('reset-password', { production: true, currentOrigin: 'http://localhost:5173', configuredAppUrl: 'http://jacdash.pages.dev' }),
    /configured JacDASH Pages origin/,
  );
});

test('production redirect rejects an unapproved HTTPS host', () => {
  assert.throws(
    () => buildAuthRedirectUrl('reset-password', { production: true, currentOrigin: 'http://localhost:5173', configuredAppUrl: 'https://attacker.example' }),
    /configured JacDASH Pages origin/,
  );
});
