export type OrderCompletionState = {
  status: string;
  payment?: { status: string } | null;
};

export function isCompletedOrder(order: OrderCompletionState): boolean {
  return order.status.trim().toLowerCase() === 'delivered'
    && order.payment?.status.trim().toLowerCase() === 'paid';
}
