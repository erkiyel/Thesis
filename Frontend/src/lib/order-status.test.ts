import assert from 'node:assert/strict';
import test from 'node:test';
import { ORDER_STATUSES } from './order-status.ts';

test('frontend order choices exactly match the verified database enum', () => {
  assert.deepEqual(ORDER_STATUSES, ['pending', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled']);
  assert.equal((ORDER_STATUSES as readonly string[]).includes('confirmed'), false);
});
