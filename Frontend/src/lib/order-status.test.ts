import assert from 'node:assert/strict';
import test from 'node:test';
import { ORDER_STATUSES } from './order-status.ts';

test('frontend order choices exclude the database-rejected confirmed enum value', () => {
  assert.deepEqual(ORDER_STATUSES, ['pending', 'processing', 'shipped', 'delivered', 'cancelled']);
  assert.equal((ORDER_STATUSES as readonly string[]).includes('confirmed'), false);
});
