export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];
