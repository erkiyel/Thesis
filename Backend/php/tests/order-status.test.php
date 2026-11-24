<?php
declare(strict_types=1);

require_once dirname(__DIR__) . DIRECTORY_SEPARATOR . 'order-status.php';

$cases = [
    ['pending', 'pending'],
    ['processing', 'processing'],
    ['shipped', 'shipped'],
    ['out_for_delivery', 'out_for_delivery'],
    ['delivered', 'delivered'],
    ['cancelled', 'cancelled'],
    [' PENDING ', 'pending'],
    ['OUT_FOR_DELIVERY', 'out_for_delivery'],
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

$frontendSourcePath = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'Frontend' . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'order-status.ts';
$frontendSource = file_get_contents($frontendSourcePath);
if (!is_string($frontendSource) || !preg_match('/ORDER_STATUSES\s*=\s*\[([^\]]*)\]/', $frontendSource, $match)) {
    fwrite(STDERR, 'Could not read the frontend order-status definitions.' . PHP_EOL);
    exit(1);
}
preg_match_all("/'([^']+)'/", $match[1], $frontendMatches);
if (($frontendMatches[1] ?? []) !== supportedOrderStatuses()) {
    fwrite(STDERR, 'Frontend order choices do not match PHP/database enum values.' . PHP_EOL);
    exit(1);
}
$cases[] = ['frontend/PHP status list parity', 'passed'];

echo count($cases) . " order-status regression assertions passed." . PHP_EOL;
