<?php
declare(strict_types=1);

/**
 * Keep only delivered orders whose most recent payment record is paid.
 * The payments array must be ordered newest first (created_at desc).
 */
function paidAndDeliveredOrders(array $orders, array $payments): array {
    $latestPaymentStatus = [];
    foreach ($payments as $payment) {
        $orderId = (string)($payment['order_id'] ?? '');
        if ($orderId === '' || array_key_exists($orderId, $latestPaymentStatus)) continue;
        $latestPaymentStatus[$orderId] = strtolower(trim((string)($payment['payment_status'] ?? '')));
    }

    return array_values(array_filter($orders, static function (array $order) use ($latestPaymentStatus): bool {
        $orderId = (string)($order['id'] ?? '');
        $deliveryStatus = strtolower(trim((string)($order['order_status'] ?? '')));
        return $orderId !== ''
            && $deliveryStatus === 'delivered'
            && ($latestPaymentStatus[$orderId] ?? '') === 'paid';
    }));
}
