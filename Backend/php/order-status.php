<?php
declare(strict_types=1);

function supportedOrderStatuses(): array {
    return ['pending', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
}

function normalizeOrderStatus(mixed $value): ?string {
    if (!is_string($value)) return null;
    $status = strtolower(trim($value));
    return in_array($status, supportedOrderStatuses(), true) ? $status : null;
}
