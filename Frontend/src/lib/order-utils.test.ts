import assert from 'node:assert/strict';
import test from 'node:test';
import { isCompletedOrder } from './order-utils.ts';

test('paid and delivered orders remain archive eligible', () => {
  assert.equal(isCompletedOrder({ status: 'delivered', payment: { status: 'paid' } }), true);
});

test('out for delivery orders remain outside the delivered archive', () => {
  assert.equal(isCompletedOrder({ status: 'out_for_delivery', payment: { status: 'paid' } }), false);
});

test('delivered orders remain outside the archive until payment is paid', () => {
  assert.equal(isCompletedOrder({ status: 'delivered', payment: { status: 'pending' } }), false);
});
