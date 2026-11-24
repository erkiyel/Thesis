<?php
declare(strict_types=1);

require_once dirname(__DIR__) . DIRECTORY_SEPARATOR . 'order-status.php';

$cases = [
    ['pending', 'pending'],
    ['processing', 'processing'],
    ['shipped', 'shipped'],
    ['delivered', 'delivered'],
    ['cancelled', 'cancelled'],
    [' PENDING ', 'pending'],
    ['confirmed', null],
    ['', null],
    [null, null],
    [42, null],
    ['unexpected', null],
];

foreach ($cases as [$input, $expected]) {
    $actual = normalizeOrderStatus($input);
    if ($actual !== $expected) {
        fwrite(STDERR, 'Failed order-status case: ' . var_export($input, true) . PHP_EOL);
        exit(1);
    }
}

echo count($cases) . " order-status regression assertions passed." . PHP_EOL;
