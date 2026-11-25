import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rejectHtmlApiResponse, requireApiArray, resolveApiRoot } from './api-base.ts';

test('production frontend points to the deployed PHP API, not the Cloudflare SPA origin', () => {
  const productionEnv = readFileSync(new URL('../../.env.production', import.meta.url), 'utf8');
  const configured = productionEnv.match(/^VITE_API_BASE_URL=(.+)$/m)?.[1]?.trim();
  assert.equal(configured, 'https://thesis-9pft.onrender.com');
  assert.equal(resolveApiRoot(configured), 'https://thesis-9pft.onrender.com/api');
});

test('development keeps using the Vite same-origin API proxy', () => {
  assert.equal(resolveApiRoot(undefined), '/api');
  assert.equal(resolveApiRoot('  '), '/api');
});

test('an API base already ending in /api is not duplicated', () => {
  assert.equal(resolveApiRoot('https://api.example.test/api/'), 'https://api.example.test/api');
});

test('successful HTML fallback responses are reported as API routing failures', () => {
  assert.throws(
    () => rejectHtmlApiResponse('text/html; charset=utf-8', '/medicines'),
    /returned an HTML page instead of JSON.*VITE_API_BASE_URL/,
  );
  assert.doesNotThrow(() => rejectHtmlApiResponse('application/json; charset=utf-8', '/medicines'));
});

test('medicine collection validation accepts real empty arrays and rejects SPA or wrapped payloads', () => {
  assert.deepEqual(requireApiArray([], '/medicines'), []);
  assert.throws(() => requireApiArray('<!DOCTYPE html>', '/medicines'), /expected a JSON array/);
  assert.throws(() => requireApiArray({ data: [] }, '/medicines'), /expected a JSON array/);
});
