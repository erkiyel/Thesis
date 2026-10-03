<?php
declare(strict_types=1);

/*
 * Oncophil REST API
 *
 * This intentionally uses Supabase's REST/Auth/Storage APIs instead of a
 * second database layer. The browser only sends its short-lived access token;
 * service-role credentials are read here and never returned to the client.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, OPTIONS');

// Load local server settings for PHP's built-in development server. Hosting
// providers should continue to supply these values as environment variables.
$localEnv = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
if (is_file($localEnv) && is_readable($localEnv)) {
    foreach (file($localEnv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$name, $value] = explode('=', $line, 2);
        $name = trim($name);
        $value = trim(trim($value), "\"'");
        if ($name !== '' && getenv($name) === false) {
            putenv("{$name}={$value}");
            $_ENV[$name] = $value;
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

final class ApiException extends RuntimeException {
    public int $status;
    public function __construct(int $status, string $message) {
        parent::__construct($message);
        $this->status = $status;
    }
}

function envValue(string $key, bool $required = true): string {
    $value = getenv($key);
    if ($value === false || trim($value) === '') {
        if ($required) throw new ApiException(500, "Server configuration is missing {$key}.");
        return '';
    }
    return trim($value);
}

function jsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new ApiException(400, 'Request body must be valid JSON.');
    return $data;
}

function respond(mixed $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $message): never {
    respond(['error' => $message], $status);
}

function readPayload(string $body): mixed {
    if ($body === '') return null;
    $data = json_decode($body, true);
    return json_last_error() === JSON_ERROR_NONE ? $data : $body;
}

function payloadMessage(mixed $payload, string $fallback): string {
    if (is_array($payload)) {
        foreach (['message', 'error_description', 'error', 'msg', 'details', 'hint'] as $key) {
            if (isset($payload[$key]) && is_string($payload[$key]) && trim($payload[$key]) !== '') return $payload[$key];
        }
    }
    return is_string($payload) && trim($payload) !== '' ? $payload : $fallback;
}

/** Make an HTTPS request using cURL when available, with a PHP streams fallback. */
function httpRequest(string $url, string $method, array $headers, ?string $body, int $timeout): array {
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => $timeout,
        ]);
        if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        $response = curl_exec($curl);
        if ($response === false) {
            $error = curl_error($curl);
            curl_close($curl);
            throw new ApiException(502, "Supabase request failed: {$error}");
        }
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        return [$response, $status];
    }

    if (!filter_var((string)ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
        throw new ApiException(500, 'PHP requires either the cURL extension or allow_url_fopen for Supabase requests.');
    }
    $options = [
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body ?? '',
            'timeout' => $timeout,
            'ignore_errors' => true,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ];
    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);
    $status = 0;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $matches)) $status = (int)$matches[1];
    }
    if (!is_string($response)) {
        $lastError = error_get_last();
        throw new ApiException(502, 'Supabase request failed: ' . ($lastError['message'] ?? 'PHP could not open the HTTPS stream.'));
    }
    return [$response, $status];
}

function supabaseRequest(string $path, string $method = 'GET', mixed $body = null, array $headers = [], bool $service = true): mixed {
    $base = rtrim(envValue('NEXT_PUBLIC_SUPABASE_URL'), '/');
    $key = $service ? envValue('SUPABASE_SERVICE_ROLE_KEY') : envValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    $requestHeaders = [
        'apikey: ' . $key,
        'Authorization: Bearer ' . $key,
        'Accept: application/json',
    ];
    foreach ($headers as $header) $requestHeaders[] = $header;
    if ($body !== null && !isset(array_change_key_case(array_fill_keys($headers, true), CASE_LOWER)['content-type'])) {
        $requestHeaders[] = 'Content-Type: application/json';
    }

    $encodedBody = $body === null ? null : (is_string($body) ? $body : json_encode($body));
    [$response, $status] = httpRequest($base . $path, $method, $requestHeaders, $encodedBody, 25);
    $payload = readPayload($response);
    if ($status < 200 || $status >= 300) {
        throw new ApiException($status === 404 ? 404 : ($status >= 500 ? 502 : $status), payloadMessage($payload, 'Supabase request failed.'));
    }
    return $payload;
}

function bearerToken(): string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) throw new ApiException(401, 'Authentication required.');
    return trim($matches[1]);
}

function currentUser(): array {
    $token = bearerToken();
    $base = rtrim(envValue('NEXT_PUBLIC_SUPABASE_URL'), '/');
    $key = envValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    [$response, $status] = httpRequest($base . '/auth/v1/user', 'GET', ["apikey: {$key}", "Authorization: Bearer {$token}", 'Accept: application/json'], null, 15);
    $user = readPayload($response);
    if ($status < 200 || $status >= 300 || !is_array($user) || empty($user['id'])) throw new ApiException(401, 'Your session is invalid or expired.');

    $profiles = supabaseRequest('/rest/v1/profiles?select=id,full_name,avatar_url,role&id=eq.' . rawurlencode((string)$user['id']));
    $profile = is_array($profiles) ? ($profiles[0] ?? null) : null;
    if (!$profile || !in_array($profile['role'] ?? '', ['admin', 'client'], true)) throw new ApiException(403, 'A valid Oncophil role is required.');
    return ['id' => (string)$user['id'], 'email' => $user['email'] ?? '', 'profile' => $profile, 'role' => $profile['role']];
}

function requireAdmin(): array {
    $user = currentUser();
    if ($user['role'] !== 'admin') throw new ApiException(403, 'Administrator access required.');
    return $user;
}

function selectTable(string $table, string $select = '*', string $query = ''): array {
    $rows = supabaseRequest('/rest/v1/' . $table . '?select=' . rawurlencode($select) . ($query !== '' ? '&' . $query : ''));
    return is_array($rows) ? $rows : [];
}

function oneTable(string $table, string $query): ?array {
    $rows = selectTable($table, '*', $query . '&limit=1');
    return $rows[0] ?? null;
}

function insertTable(string $table, array $data, string $select = '*'): array {
    $rows = supabaseRequest('/rest/v1/' . $table . '?select=' . rawurlencode($select), 'POST', $data, ['Prefer: return=representation']);
    if (!is_array($rows) || !isset($rows[0]) || !is_array($rows[0])) throw new ApiException(502, "Supabase did not return the created {$table} record.");
    return $rows[0];
}

function updateTable(string $table, string $query, array $data): array {
    $rows = supabaseRequest('/rest/v1/' . $table . '?' . $query, 'PATCH', $data, ['Prefer: return=representation']);
    if (!is_array($rows) || !isset($rows[0]) || !is_array($rows[0])) throw new ApiException(404, 'Record not found.');
    return $rows[0];
}

function money(float|int|string $value): float {
    return round((float)$value, 2);
}

function medicineOutput(array $row): array {
    return [
        'id' => (string)($row['id'] ?? ''),
        'name' => (string)($row['name'] ?? $row['medicine_name'] ?? ''),
        'description' => (string)($row['description'] ?? ''),
        'price' => money($row['price'] ?? 0),
        'stockQuantity' => (int)($row['stock_quantity'] ?? $row['stock'] ?? $row['quantity'] ?? 0),
        'isAvailable' => (bool)($row['is_available'] ?? $row['available'] ?? true),
        'imageUrl' => $row['image_url'] ?? null,
        'createdAt' => $row['created_at'] ?? null,
        'updatedAt' => $row['updated_at'] ?? null,
    ];
}

function orderOutput(array $row, array $items = [], array $payment = [], array $tracking = []): array {
    $status = (string)($row['order_status'] ?? 'pending');
    return [
        'id' => (string)($row['id'] ?? ''),
        'clientId' => (string)($row['client_id'] ?? $row['user_id'] ?? ''),
        'total' => money($row['total_amount'] ?? $row['order_total'] ?? $row['total'] ?? 0),
        'status' => $status,
        'createdAt' => $row['created_at'] ?? null,
        'updatedAt' => $row['updated_at'] ?? null,
        'items' => $items,
        'payment' => $payment ?: null,
        'tracking' => $tracking,
    ];
}

function loadOrderDetails(array $order): array {
    $orderId = (string)$order['id'];
    // order_items has no created_at column; id is its existing stable key.
    $items = selectTable('order_items', '*', 'order_id=eq.' . rawurlencode($orderId) . '&order=id.asc');
    $medicineIds = array_values(array_filter(array_map(fn($item) => $item['medicine_id'] ?? null, $items)));
    $medicineMap = [];
    if ($medicineIds) {
        $medicineRows = selectTable('medicines', '*', 'id=in.(' . implode(',', array_map('rawurlencode', $medicineIds)) . ')');
        foreach ($medicineRows as $medicine) $medicineMap[(string)$medicine['id']] = medicineOutput($medicine);
    }
    $itemOutput = array_map(function (array $item) use ($medicineMap): array {
        $medicine = $medicineMap[(string)($item['medicine_id'] ?? '')] ?? null;
        $quantity = (int)($item['quantity'] ?? 0);
        $unitPrice = money($item['unit_price'] ?? $item['price'] ?? ($medicine['price'] ?? 0));
        return [
            'id' => (string)($item['id'] ?? ''),
            'medicineId' => (string)($item['medicine_id'] ?? ''),
            'medicineName' => $medicine['name'] ?? (string)($item['medicine_name'] ?? 'Medicine'),
            'quantity' => $quantity,
            'unitPrice' => $unitPrice,
            'subtotal' => money($item['subtotal'] ?? $quantity * $unitPrice),
        ];
    }, $items);
    $payments = selectTable('payments', '*', 'order_id=eq.' . rawurlencode($orderId) . '&order=created_at.desc&limit=1');
    $payment = $payments[0] ?? [];
    $tracking = selectTable('order_tracking_events', '*', 'order_id=eq.' . rawurlencode($orderId) . '&order=event_time.desc');
    $trackingOutput = array_map(fn(array $event): array => [
        'id' => (string)($event['id'] ?? ''),
        'status' => (string)($event['status'] ?? ''),
        'location' => (string)($event['location'] ?? ''),
        'estimatedDelivery' => $event['estimated_delivery_at'] ?? null,
        'notes' => (string)($event['notes'] ?? ''),
        'createdAt' => $event['event_time'] ?? null,
    ], $tracking);
    return orderOutput($order, $itemOutput, $payment ? [
        'id' => (string)($payment['id'] ?? ''),
        'method' => (string)($payment['payment_method'] ?? $payment['method'] ?? ''),
        'status' => (string)($payment['payment_status'] ?? 'unpaid'),
        'amount' => money($payment['amount'] ?? $order['total_amount'] ?? 0),
    ] : [], $trackingOutput);
}

function imageUpload(?string $existing = null): ?string {
    if (!isset($_FILES['image']) || !is_uploaded_file($_FILES['image']['tmp_name'])) return $existing;
    $file = $_FILES['image'];
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) throw new ApiException(400, 'The medicine image could not be uploaded.');
    if (($file['size'] ?? 0) > 5 * 1024 * 1024) throw new ApiException(400, 'Medicine images must be 5 MB or smaller.');
    $mime = mime_content_type($file['tmp_name']) ?: '';
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($allowed[$mime])) throw new ApiException(400, 'Medicine images must be JPG, PNG, or WebP.');
    // This must match the existing public Storage bucket. Never fall back to
    // a guessed bucket name: Storage reports a missing bucket as an upload error.
    $bucket = envValue('SUPABASE_MEDICINE_BUCKET', false) ?: 'medicine-images';
    $objectPath = bin2hex(random_bytes(16)) . '.' . $allowed[$mime];
    $base = rtrim(envValue('NEXT_PUBLIC_SUPABASE_URL'), '/');
    $key = envValue('SUPABASE_SERVICE_ROLE_KEY');
    $content = file_get_contents($file['tmp_name']);
    [$response, $status] = httpRequest($base . '/storage/v1/object/' . rawurlencode($bucket) . '/' . $objectPath, 'POST', ["apikey: {$key}", "Authorization: Bearer {$key}", 'Content-Type: ' . $mime, 'x-upsert: true'], $content, 25);
    if ($status < 200 || $status >= 300) {
        $payload = readPayload($response);
        throw new ApiException(502, 'Supabase Storage upload failed: ' . payloadMessage($payload, 'check that the medicine-images bucket is available to the server.'));
    }
    return $base . '/storage/v1/object/public/' . rawurlencode($bucket) . '/' . $objectPath;
}

function forecastRuntimeDirectory(): string {
    $directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'runtime';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new ApiException(500, 'Forecast storage could not be initialized.');
    return $directory;
}

function forecastMetadata(?string $key = null, mixed $value = null): mixed {
    $file = forecastRuntimeDirectory() . DIRECTORY_SEPARATOR . 'forecast-metadata.json';
    $handle = fopen($file, 'c+');
    if ($handle === false) throw new ApiException(500, 'Forecast history metadata is unavailable.');
    try {
        if (!flock($handle, LOCK_EX)) throw new ApiException(500, 'Forecast history metadata is unavailable.');
        $contents = stream_get_contents($handle);
        $metadata = is_string($contents) && $contents !== '' ? json_decode($contents, true) : [];
        if (!is_array($metadata)) $metadata = [];
        if ($key === null) return $metadata;
        $metadata[$key] = $value;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        fflush($handle);
        return $value;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function runForecastEngine(array $payload): array {
    $backend = dirname(__DIR__);
    $script = $backend . DIRECTORY_SEPARATOR . 'python' . DIRECTORY_SEPARATOR . 'forecast.py';
    $configured = getenv('ONCOPHIL_PYTHON') ?: '';
    $venvPython = $backend . DIRECTORY_SEPARATOR . '.venv' . DIRECTORY_SEPARATOR . 'Scripts' . DIRECTORY_SEPARATOR . 'python.exe';
    $python = $configured !== '' ? $configured : (is_file($venvPython) ? $venvPython : 'python');
    $process = proc_open([$python, $script], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $backend);
    if (!is_resource($process)) throw new ApiException(503, 'Python forecasting could not be started. Install Backend/python/requirements.txt or set ONCOPHIL_PYTHON.');
    fwrite($pipes[0], json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);
    $decoded = is_string($output) ? json_decode($output, true) : null;
    if ($exitCode !== 0 || !is_array($decoded)) {
        error_log('Forecast process failed: ' . trim((string)$stderr));
        throw new ApiException(502, 'The forecasting process failed. Check the PHP server log and Python dependencies.');
    }
    if (empty($decoded['ok'])) throw new ApiException(422, (string)($decoded['error'] ?? 'Forecast input could not be processed.'));
    return $decoded['data'];
}

function selectAllRows(string $table, string $select, string $query = ''): array {
    $all = [];
    for ($offset = 0; ; $offset += 1000) {
        $pageQuery = ($query !== '' ? $query . '&' : '') . 'limit=1000&offset=' . $offset;
        $page = selectTable($table, $select, $pageQuery);
        array_push($all, ...$page);
        if (count($page) < 1000) return $all;
    }
}

function completedSystemSales(): array {
    $orders = selectAllRows('orders', 'id,created_at', 'order_status=eq.delivered&order=created_at.asc');
    if (!$orders) return [];
    $byId = [];
    foreach ($orders as $order) $byId[(string)$order['id']] = $order;
    $medicineRows = selectAllRows('medicines', 'id,name');
    $medicineNames = [];
    foreach ($medicineRows as $medicine) $medicineNames[(string)$medicine['id']] = $medicine['name'];
    $sales = [];
    foreach (array_chunk(array_keys($byId), 100) as $orderIds) {
        $ids = implode(',', array_map(static fn(string $id): string => rawurlencode($id), $orderIds));
        $items = selectAllRows('order_items', 'order_id,medicine_id,quantity', 'order_id=in.(' . $ids . ')');
        foreach ($items as $item) {
            $order = $byId[(string)$item['order_id']] ?? null;
            $medicineId = (string)($item['medicine_id'] ?? '');
            if (!$order || !isset($medicineNames[$medicineId])) continue;
            $sales[] = ['medicineId' => $medicineId, 'medicine' => $medicineNames[$medicineId], 'date' => $order['created_at'], 'quantity' => (float)$item['quantity']];
        }
    }
    return $sales;
}

function createClientAccount(array $input): array {
    $auth = supabaseRequest('/auth/v1/admin/users', 'POST', [
        'email' => strtolower(trim((string)$input['email'])),
        'password' => (string)$input['initialPassword'],
        'email_confirm' => true,
        'user_metadata' => ['full_name' => trim((string)$input['fullName'])],
        'app_metadata' => ['role' => 'client'],
    ]);
    if (!is_array($auth) || empty($auth['id'])) throw new ApiException(502, 'Supabase did not return the new account.');
    try {
        $profile = insertTable('profiles', ['id' => $auth['id'], 'full_name' => trim((string)$input['fullName']), 'avatar_url' => '', 'role' => 'client']);
    } catch (Throwable $error) {
        try { supabaseRequest('/auth/v1/admin/users/' . rawurlencode((string)$auth['id']), 'DELETE'); } catch (Throwable) {}
        throw $error;
    }
    return ['id' => (string)$auth['id'], 'fullName' => $profile['full_name'], 'email' => $auth['email'] ?? $input['email'], 'role' => 'client', 'status' => 'active'];
}

function route(string $method, string $path): void {
    if ($path === '/healthz' && $method === 'GET') respond(['status' => 'ok']);
    $user = currentUser();

    if ($path === '/admin/clients' && $method === 'GET') {
        requireAdmin();
        $profiles = selectTable('profiles', 'id,full_name,avatar_url,role', 'role=eq.client');
        $auth = supabaseRequest('/auth/v1/admin/users?page=1&per_page=1000');
        $users = is_array($auth) && isset($auth['users']) ? $auth['users'] : (is_array($auth) ? $auth : []);
        $byId = [];
        foreach ($users as $account) $byId[(string)($account['id'] ?? '')] = $account;
        $output = [];
        foreach ($profiles as $profile) {
            $account = $byId[(string)$profile['id']] ?? [];
            if (!isset($account['email'])) continue;
            $status = (!empty($account['deleted_at']) || !empty($account['banned_until'])) ? 'disabled' : (empty($account['email_confirmed_at']) ? 'unconfirmed' : 'active');
            $output[] = ['id' => (string)$profile['id'], 'fullName' => $profile['full_name'], 'email' => $account['email'], 'role' => 'client', 'status' => $status];
        }
        respond($output);
    }
    if ($path === '/admin/clients' && $method === 'POST') {
        requireAdmin();
        $input = jsonBody();
        if (strlen(trim((string)($input['fullName'] ?? ''))) < 1 || !filter_var($input['email'] ?? '', FILTER_VALIDATE_EMAIL) || strlen((string)($input['initialPassword'] ?? '')) < 8) fail(400, 'Full name, valid email, and an initial password of at least 8 characters are required.');
        try { respond(createClientAccount($input), 201); } catch (ApiException $error) {
            if ($error->status === 422 || preg_match('/already|exist|registered/i', $error->getMessage())) fail(409, 'An account with that email already exists.');
            throw $error;
        }
    }

    if ($path === '/medicines' && $method === 'GET') {
        $rows = selectTable('medicines', '*', $user['role'] === 'admin' ? '' : 'is_available=eq.true&stock_quantity=gt.0&order=name.asc');
        respond(array_map('medicineOutput', $rows));
    }
    if ($path === '/admin/medicines' && $method === 'POST') {
        requireAdmin();
        $input = $_POST ?: jsonBody();
        $name = trim((string)($input['name'] ?? ''));
        if ($name === '') fail(400, 'Medicine name is required.');
        $data = [
            'name' => $name,
            'description' => trim((string)($input['description'] ?? '')),
            'price' => money($input['price'] ?? 0),
            'stock_quantity' => max(0, (int)($input['stockQuantity'] ?? 0)),
            'is_available' => filter_var($input['isAvailable'] ?? true, FILTER_VALIDATE_BOOLEAN),
        ];
        $existing = null;
        if ($method === 'PUT') {
            $id = basename($path);
            $existing = oneTable('medicines', 'id=eq.' . rawurlencode($id));
            if (!$existing) fail(404, 'Medicine not found.');
            $data['image_url'] = imageUpload($existing['image_url'] ?? null);
            respond(medicineOutput(updateTable('medicines', 'id=eq.' . rawurlencode($id), $data)));
        }
        $data['image_url'] = imageUpload(null);
        respond(medicineOutput(insertTable('medicines', $data)), 201);
    }
    if (preg_match('#^/admin/medicines/([^/]+)$#', $path, $match) && in_array($method, ['POST', 'PUT'], true)) {
        requireAdmin();
        $input = $_POST ?: jsonBody();
        $existing = oneTable('medicines', 'id=eq.' . rawurlencode($match[1]));
        if (!$existing) fail(404, 'Medicine not found.');
        $data = [
            'name' => trim((string)($input['name'] ?? $existing['name'] ?? '')),
            'description' => trim((string)($input['description'] ?? $existing['description'] ?? '')),
            'price' => money($input['price'] ?? $existing['price'] ?? 0),
            'stock_quantity' => max(0, (int)($input['stockQuantity'] ?? $existing['stock_quantity'] ?? 0)),
            'is_available' => filter_var($input['isAvailable'] ?? ($existing['is_available'] ?? true), FILTER_VALIDATE_BOOLEAN),
            'image_url' => imageUpload($existing['image_url'] ?? null),
        ];
        respond(medicineOutput(updateTable('medicines', 'id=eq.' . rawurlencode($match[1]), $data)));
    }

    if ($path === '/orders' && $method === 'GET') {
        $query = $user['role'] === 'admin' ? 'order=created_at.desc' : 'client_id=eq.' . rawurlencode($user['id']) . '&order=created_at.desc';
        $orders = selectTable('orders', '*', $query);
        respond(array_map('loadOrderDetails', $orders));
    }
    if ($path === '/orders' && $method === 'POST') {
        if ($user['role'] !== 'client') fail(403, 'Only client accounts can place orders.');
        $input = jsonBody();
        $items = is_array($input['items'] ?? null) ? $input['items'] : [];
        $paymentMethod = strtolower((string)($input['paymentMethod'] ?? ''));
        if (!$items || !in_array($paymentMethod, ['gcash', 'cash'], true)) fail(400, 'Choose at least one medicine and a GCash or Cash payment method.');
        $total = 0.0; $normalized = [];
        foreach ($items as $item) {
            $medicineId = (string)($item['medicineId'] ?? '');
            $quantity = (int)($item['quantity'] ?? 0);
            if ($quantity < 1) fail(400, 'Order quantities must be at least 1.');
            $medicine = oneTable('medicines', 'id=eq.' . rawurlencode($medicineId) . '&is_available=eq.true');
            if (!$medicine || (int)($medicine['stock_quantity'] ?? 0) < $quantity) fail(400, 'One or more selected medicines are no longer available in that quantity.');
            $unitPrice = money($medicine['price'] ?? 0); $subtotal = money($unitPrice * $quantity); $total += $subtotal;
            $normalized[] = ['medicine' => $medicine, 'quantity' => $quantity, 'subtotal' => $subtotal];
        }
        $order = insertTable('orders', ['client_id' => $user['id'], 'total_amount' => money($total), 'order_status' => 'pending']);
        foreach ($normalized as $line) {
            insertTable('order_items', ['order_id' => $order['id'], 'medicine_id' => $line['medicine']['id'], 'quantity' => $line['quantity'], 'unit_price' => money($line['medicine']['price'])]);
            updateTable('medicines', 'id=eq.' . rawurlencode((string)$line['medicine']['id']), ['stock_quantity' => max(0, (int)$line['medicine']['stock_quantity'] - $line['quantity'])]);
        }
        insertTable('payments', ['order_id' => $order['id'], 'payment_method' => $paymentMethod, 'payment_status' => 'unpaid']);
        respond(loadOrderDetails($order), 201);
    }
    if (preg_match('#^/orders/([^/]+)/tracking$#', $path, $match) && $method === 'GET') {
        $order = oneTable('orders', 'id=eq.' . rawurlencode($match[1]));
        if (!$order || ($user['role'] !== 'admin' && (string)($order['client_id'] ?? $order['user_id'] ?? '') !== $user['id'])) fail(404, 'Order not found.');
        respond(loadOrderDetails($order));
    }
    if (preg_match('#^/admin/orders/([^/]+)$#', $path, $match) && in_array($method, ['PATCH', 'PUT'], true)) {
        requireAdmin();
        $input = jsonBody();
        $order = oneTable('orders', 'id=eq.' . rawurlencode($match[1]));
        if (!$order) fail(404, 'Order not found.');
        $allowedStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
        $status = strtolower((string)($input['status'] ?? $order['order_status'] ?? 'pending'));
        if (!in_array($status, $allowedStatuses, true)) fail(400, 'Invalid order status.');
        $updated = updateTable('orders', 'id=eq.' . rawurlencode($match[1]), ['order_status' => $status]);
        if (isset($input['paymentStatus'])) {
            $payments = selectTable('payments', '*', 'order_id=eq.' . rawurlencode($match[1]) . '&limit=1');
            if ($payments) updateTable('payments', 'id=eq.' . rawurlencode((string)$payments[0]['id']), ['payment_status' => strtolower((string)$input['paymentStatus'])]);
        }
        if (isset($input['location']) || isset($input['estimatedDelivery']) || isset($input['notes'])) {
            insertTable('order_tracking_events', ['order_id' => $match[1], 'status' => $status, 'location' => trim((string)($input['location'] ?? '')), 'estimated_delivery_at' => $input['estimatedDelivery'] ?? null, 'notes' => trim((string)($input['notes'] ?? '')), 'recorded_by' => $user['id']]);
        }
        respond(loadOrderDetails($updated));
    }
    if ($path === '/admin/forecasts/preview' && $method === 'POST') {
        requireAdmin();
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) fail(400, 'Choose an Excel workbook to preview.');
        $extension = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
        if (!in_array($extension, ['xlsx', 'xls'], true)) fail(400, 'Upload an .xlsx or .xls workbook.');
        if (($file['size'] ?? 0) < 1 || ($file['size'] ?? 0) > 10 * 1024 * 1024) fail(400, 'Excel files must be 10 MB or smaller.');
        $bytes = file_get_contents($file['tmp_name']);
        if (!is_string($bytes)) fail(400, 'The uploaded workbook could not be read.');
        $preview = runForecastEngine(['action' => 'preview', 'excelBase64' => base64_encode($bytes)]);
        $importId = null;
        if (($preview['invalidRows'] ?? 1) === 0 && !empty($preview['records'])) {
            $importId = bin2hex(random_bytes(20));
            $importDirectory = forecastRuntimeDirectory() . DIRECTORY_SEPARATOR . 'imports';
            if (!is_dir($importDirectory) && !mkdir($importDirectory, 0700, true) && !is_dir($importDirectory)) throw new ApiException(500, 'Historical sales import storage could not be initialized.');
            $importData = ['records' => $preview['records'], 'fileName' => basename((string)$file['name']), 'rowCount' => (int)$preview['validRows'], 'uploadedBy' => $user['id'], 'createdAt' => gmdate(DATE_ATOM)];
            $saved = file_put_contents($importDirectory . DIRECTORY_SEPARATOR . $importId . '.json', json_encode($importData, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), LOCK_EX);
            if ($saved === false) throw new ApiException(500, 'Historical sales import could not be saved.');
        }
        unset($preview['records']);
        respond(['valid' => $importId !== null, 'importId' => $importId, ...$preview]);
    }
    if ($path === '/admin/forecasts/run' && $method === 'POST') {
        $admin = requireAdmin();
        $input = jsonBody();
        $horizon = (int)($input['horizon'] ?? 3);
        if ($horizon < 1 || $horizon > 12) fail(400, 'Forecast horizon must be between 1 and 12 months.');
        $excelSales = [];
        $importId = (string)($input['importId'] ?? '');
        if ($importId !== '') {
            if (!preg_match('/^[a-f0-9]{40}$/', $importId)) fail(400, 'Historical sales preview is invalid. Upload the workbook again.');
            $importPath = forecastRuntimeDirectory() . DIRECTORY_SEPARATOR . 'imports' . DIRECTORY_SEPARATOR . $importId . '.json';
            $importData = is_file($importPath) ? json_decode((string)file_get_contents($importPath), true) : null;
            $excelSales = is_array($importData) ? ($importData['records'] ?? null) : null;
            if (!is_array($excelSales)) fail(400, 'Historical sales import is unavailable. Upload the workbook again.');
        }
        $medicines = selectAllRows('medicines', 'id,name,stock_quantity');
        $result = runForecastEngine([
            'action' => 'forecast',
            'horizon' => $horizon,
            'medicines' => $medicines,
            'systemSales' => completedSystemSales(),
            'excelSales' => $excelSales,
        ]);
        $run = insertTable('forecast_runs', [
            'generated_by' => $admin['id'],
            'historical_start_date' => $result['historicalStartDate'],
            'historical_end_date' => $result['historicalEndDate'],
            'period_granularity' => 'monthly',
            'forecast_horizon' => $horizon,
            'model_type' => 'linear_regression',
        ]);
        // Persist only columns that exist in forecast_results. Historical-only
        // products keep their name and have no linked inventory medicine.
        $databaseResults = array_map(static fn(array $row): array => [
            'forecast_run_id' => $run['id'],
            'medicine_id' => $row['medicine_id'] ?? null,
            'medicine_name' => (string)($row['medicine_name'] ?? ''),
            'forecast_period' => (string)$row['forecast_period'],
            'predicted_quantity' => (float)$row['predicted_quantity'],
        ], $result['results']);
        if ($databaseResults) {
            supabaseRequest('/rest/v1/forecast_results?select=*', 'POST', $databaseResults, ['Prefer: return=representation']);
        }
        $result['id'] = (string)$run['id'];
        $result['createdAt'] = $run['created_at'] ?? null;
        $result['modelType'] = (string)($run['model_type'] ?? 'linear_regression');
        $result['importId'] = $importId !== '' ? $importId : null;
        forecastMetadata((string)$run['id'], $result);
        respond($result, 201);
    }
    if ($path === '/admin/forecasts' && $method === 'GET') {
        requireAdmin();
        $runs = selectAllRows('forecast_runs', '*', 'order=created_at.desc');
        if (!$runs) respond(['runs' => []]);
        $runIds = array_map(static fn(array $row): string => rawurlencode((string)$row['id']), $runs);
        $storedResults = selectAllRows('forecast_results', '*', 'forecast_run_id=in.(' . implode(',', $runIds) . ')');
        $resultsByRun = [];
        foreach ($storedResults as $forecastRow) $resultsByRun[(string)$forecastRow['forecast_run_id']][] = $forecastRow;
        $metadata = forecastMetadata();
        $output = [];
        foreach ($runs as $run) {
            $id = (string)$run['id'];
            $details = $metadata[$id] ?? [];
            $output[] = [
                'id' => $id,
                'createdAt' => $run['created_at'] ?? null,
                'historicalStartDate' => $run['historical_start_date'] ?? null,
                'historicalEndDate' => $run['historical_end_date'] ?? null,
                'periodGranularity' => $run['period_granularity'] ?? 'monthly',
                'forecastHorizon' => (int)($run['forecast_horizon'] ?? 0),
                'modelType' => $run['model_type'] ?? 'linear_regression',
                'forecastedMedicineCount' => $details['forecastedMedicineCount'] ?? count(array_unique(array_map(static fn(array $row): string => !empty($row['medicine_id']) ? (string)$row['medicine_id'] : 'historical:' . strtolower(trim((string)($row['medicine_name'] ?? ''))), $resultsByRun[$id] ?? []))),
                'metrics' => $details['metrics'] ?? null,
                'medicines' => $details['medicines'] ?? [],
                'chart' => $details['chart'] ?? [],
                'chartOverall' => $details['chartOverall'] ?? [],
                'results' => array_map(static fn(array $row): array => ['medicineId' => $row['medicine_id'] ?? null, 'medicineName' => $row['medicine_name'] ?? null, 'period' => $row['forecast_period'], 'quantity' => (float)$row['predicted_quantity']], $resultsByRun[$id] ?? []),
            ];
        }
        respond(['runs' => $output]);
    }
    if ($path === '/admin/forecasts/imports' && $method === 'GET') {
        requireAdmin();
        $directory = forecastRuntimeDirectory() . DIRECTORY_SEPARATOR . 'imports';
        $imports = [];
        foreach (glob($directory . DIRECTORY_SEPARATOR . '*.json') ?: [] as $importPath) {
            $importId = basename($importPath, '.json');
            if (!preg_match('/^[a-f0-9]{40}$/', $importId)) continue;
            $importData = json_decode((string)file_get_contents($importPath), true);
            if (!is_array($importData) || ($importData['uploadedBy'] ?? '') !== $user['id']) continue;
            $imports[] = ['id' => $importId, 'fileName' => $importData['fileName'] ?? 'Historical workbook', 'rowCount' => (int)($importData['rowCount'] ?? 0), 'createdAt' => $importData['createdAt'] ?? null];
        }
        usort($imports, static fn(array $a, array $b): int => strcmp((string)($b['createdAt'] ?? ''), (string)($a['createdAt'] ?? '')));
        respond(['imports' => $imports]);
    }
    if ($path === '/admin/dashboard' && $method === 'GET') {
        requireAdmin();
        $medicines = selectTable('medicines', 'id,stock_quantity,is_available');
        $orders = selectTable('orders', 'id,order_status,total_amount,created_at');
        respond([
            'medicineCount' => count($medicines),
            'availableMedicineCount' => count(array_filter($medicines, fn($m) => ($m['is_available'] ?? true) && (int)($m['stock_quantity'] ?? 0) > 0)),
            'lowStockCount' => count(array_filter($medicines, fn($m) => (int)($m['stock_quantity'] ?? 0) <= 5)),
            'orderCount' => count($orders),
            'pendingOrderCount' => count(array_filter($orders, fn($o) => in_array($o['order_status'] ?? '', ['pending', 'confirmed', 'processing'], true))),
            'revenue' => money(array_sum(array_map(fn($o) => money($o['total_amount'] ?? 0), array_filter($orders, fn($o) => ($o['order_status'] ?? '') !== 'cancelled')))),
        ]);
    }
    throw new ApiException(404, 'API route not found.');
}

try {
    $requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = preg_replace('#^/api#', '', $requestPath) ?: '/';
    route($_SERVER['REQUEST_METHOD'] ?? 'GET', rtrim($path, '/') ?: '/');
} catch (ApiException $error) {
    fail($error->status, $error->getMessage());
} catch (Throwable $error) {
    error_log($error->getMessage());
    fail(500, 'Unable to complete the request.');
}
