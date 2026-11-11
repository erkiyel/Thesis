<?php
declare(strict_types=1);

/*
 * Jacdash Asia Corp. REST API
 *
 * This intentionally uses Supabase's REST/Auth/Storage APIs instead of a
 * second database layer. The browser only sends its short-lived access token;
 * service-role credentials are read here and never returned to the client.
 */

header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . DIRECTORY_SEPARATOR . 'forecast-sales.php';

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

$configuredOrigins = getenv('ONCOPHIL_ALLOWED_ORIGINS');
$allowedOrigins = [
    'https://jacdash.pages.dev',
    'https://thesis-2lz262yk5-erkiyels-projects.vercel.app',
    'https://thesis-three-nu.vercel.app',
];
if ($configuredOrigins === false || trim($configuredOrigins) === '') {
    array_push($allowedOrigins, 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174');
} else {
    $extraOrigins = array_values(array_filter(array_map(
        static fn(string $origin): string => rtrim(trim($origin), '/'),
        explode(',', $configuredOrigins),
    )));
    array_push($allowedOrigins, ...$extraOrigins);
}
$requestOrigin = rtrim(trim((string)($_SERVER['HTTP_ORIGIN'] ?? '')), '/');
$isAllowedVercelPreview = preg_match('/^https:\/\/thesis-[a-z0-9-]+-erkiyels-projects\.vercel\.app$/i', $requestOrigin) === 1;
$originAllowed = $requestOrigin !== '' && (in_array($requestOrigin, $allowedOrigins, true) || $isAllowedVercelPreview);
if ($originAllowed) {
    header('Access-Control-Allow-Origin: ' . $requestOrigin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Accept, Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    if ($requestOrigin !== '' && !$originAllowed) {
        http_response_code(403);
        exit;
    }
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
    if (empty($user['email_confirmed_at'])) throw new ApiException(403, 'Please confirm your email address before signing in.');

    $profiles = supabaseRequest('/rest/v1/profiles?select=id,full_name,avatar_url,role,approval_status,organization_name&id=eq.' . rawurlencode((string)$user['id']));
    $profile = is_array($profiles) ? ($profiles[0] ?? null) : null;
    if (!$profile) throw new ApiException(403, 'A valid Jacdash Asia Corp. role is required.');
    $approvalStatus = (string)($profile['approval_status'] ?? 'approved');
    if ($approvalStatus !== 'approved') {
        $message = $approvalStatus === 'rejected' ? 'This registration was not approved. Contact the system administrator for help.' : 'Your account is pending administrator approval.';
        throw new ApiException(403, $message);
    }
    if (!in_array($profile['role'] ?? '', ['admin', 'client', 'manager', 'partnership_account'], true)) throw new ApiException(403, 'A valid Jacdash Asia Corp. role is required.');
    return ['id' => (string)$user['id'], 'email' => $user['email'] ?? '', 'profile' => $profile, 'role' => $profile['role']];
}

function requireAdmin(): array {
    $user = currentUser();
    if ($user['role'] !== 'admin') throw new ApiException(403, 'Administrator access required.');
    return $user;
}

function requireManagerOrAdmin(): array {
    $user = currentUser();
    if (!in_array($user['role'], ['admin', 'manager'], true)) throw new ApiException(403, 'Manager or Administrator access required.');
    return $user;
}

function textLength(string $value): int {
    if (function_exists('mb_strlen')) return mb_strlen($value, 'UTF-8');
    $count = preg_match_all('/./us', $value, $matches);
    return $count === false ? strlen($value) : $count;
}

function requireUuid(mixed $value, string $label = 'Record'): string {
    $id = is_string($value) ? trim($value) : '';
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
        fail(400, "{$label} ID is invalid.");
    }
    return strtolower($id);
}

function cleanText(mixed $value, string $label, int $maximum, bool $required = false): string {
    if (!is_string($value) && !is_numeric($value)) fail(400, "{$label} must be text.");
    $withoutControls = preg_replace('/[\\x00-\\x1F\\x7F]/u', '', (string)$value);
    if (!is_string($withoutControls)) fail(400, "{$label} must contain valid text.");
    $text = trim($withoutControls);
    if (($required && $text === '') || textLength($text) > $maximum) fail(400, "{$label} is required and must be {$maximum} characters or fewer.");
    return $text;
}

function nonnegativeInteger(mixed $value, string $label, bool $positive = false): int {
    if (!(is_int($value) || is_string($value)) || !preg_match('/^\\d+$/', (string)$value)) fail(400, "{$label} must be a whole number.");
    $number = filter_var((string)$value, FILTER_VALIDATE_INT);
    if ($number === false || $number > 1000000000 || ($positive && $number < 1)) fail(400, "{$label} must be between " . ($positive ? '1' : '0') . ' and 1,000,000,000.');
    return $number;
}

function nonnegativePrice(mixed $value): float {
    if (!(is_int($value) || is_float($value) || is_string($value)) || !preg_match('/^\\d+(?:\\.\\d{1,2})?$/', (string)$value)) fail(400, 'Price must be a nonnegative amount with up to two decimal places.');
    $price = (float)$value;
    if (!is_finite($price) || $price > 1000000000) fail(400, 'Price is outside the allowed range.');
    return round($price, 2);
}

function validDateOnly(mixed $value, string $label): ?string {
    if ($value === null || $value === '') return null;
    if (!is_string($value) || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $value)) fail(400, "{$label} must be a valid date.");
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || ($errors && ($errors['warning_count'] || $errors['error_count'])) || $date->format('Y-m-d') !== $value) fail(400, "{$label} must be a valid date.");
    return $value;
}

function validateAccountInput(array $input, bool $includePassword): array {
    foreach (['fullName', 'email', 'organizationName'] as $key) if (isset($input[$key]) && !is_string($input[$key])) fail(400, 'Account details must be text.');
    $fullName = trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($input['fullName'] ?? '')));
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $organization = trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($input['organizationName'] ?? '')));
    if ($fullName === '' || textLength($fullName) > 120) fail(400, 'Enter a full name up to 120 characters.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) fail(400, 'Enter a valid email address.');
    if (textLength($organization) > 160) fail(400, 'Organization name must be 160 characters or fewer.');
    $result = ['fullName' => $fullName, 'email' => $email, 'organizationName' => $organization !== '' ? $organization : null];
    if ($includePassword) {
        if (isset($input['password']) && !is_string($input['password'])) fail(400, 'Password must be text.');
        $password = (string)($input['password'] ?? '');
        if (textLength($password) < 8 || textLength($password) > 128) fail(400, 'Password must be between 8 and 128 characters.');
        $result['password'] = $password;
    }
    return $result;
}

function createPendingRegistration(array $input): array {
    $account = validateAccountInput($input, true);
    $redirectTo = trim((string)($input['emailRedirectTo'] ?? ''));
    $redirect = parse_url($redirectTo);
    $redirectOrigin = is_array($redirect) ? strtolower((string)($redirect['scheme'] ?? '') . '://' . (string)($redirect['host'] ?? '') . (isset($redirect['port']) ? ':' . $redirect['port'] : '')) : '';
    global $allowedOrigins;
    $redirectOriginAllowed = in_array($redirectOrigin, $allowedOrigins, true)
        || preg_match('/^https:\\/\\/thesis-[a-z0-9-]+-erkiyels-projects\\.vercel\\.app$/i', $redirectOrigin) === 1;
    if (!is_array($redirect) || !in_array(strtolower((string)($redirect['scheme'] ?? '')), ['http', 'https'], true)
        || empty($redirect['host']) || ($redirect['path'] ?? '') !== '/auth/callback'
        || !$redirectOriginAllowed
        || isset($redirect['user']) || isset($redirect['pass']) || isset($redirect['query']) || isset($redirect['fragment'])) {
        fail(400, 'A valid email confirmation redirect is required.');
    }
    try {
        $auth = supabaseRequest('/auth/v1/signup?redirect_to=' . rawurlencode($redirectTo), 'POST', [
            'email' => $account['email'],
            'password' => $account['password'],
            'data' => ['full_name' => $account['fullName']],
        ], [], false);
    } catch (ApiException $error) {
        if ($error->status === 422 || preg_match('/already|exist|registered/i', $error->getMessage())) fail(409, 'An account with that email already exists.');
        throw $error;
    }
    $authUser = is_array($auth) && isset($auth['user']) && is_array($auth['user']) ? $auth['user'] : $auth;
    if (!is_array($authUser) || empty($authUser['id'])) throw new ApiException(502, 'Supabase did not return the registered account.');
    if (isset($authUser['identities']) && is_array($authUser['identities']) && count($authUser['identities']) === 0) {
        fail(409, 'An account with that email already exists.');
    }
    if (!empty($auth['session'])) {
        // A session means email confirmation is disabled in Supabase Auth. Do not
        // accept this registration as verified; remove the new Auth user instead.
        try { supabaseRequest('/auth/v1/admin/users/' . rawurlencode((string)$authUser['id']), 'DELETE'); } catch (Throwable) {}
        throw new ApiException(503, 'Email confirmation is not enabled for this Supabase project. Please contact the system administrator.');
    }
    try {
        $profile = insertTable('profiles', [
            'id' => $authUser['id'],
            'full_name' => $account['fullName'],
            'avatar_url' => '',
            'role' => 'client',
            'approval_status' => 'pending',
            'organization_name' => $account['organizationName'],
        ]);
    } catch (Throwable $error) {
        try { supabaseRequest('/auth/v1/admin/users/' . rawurlencode((string)$authUser['id']), 'DELETE'); } catch (Throwable) {}
        throw $error;
    }
    return ['id' => (string)$authUser['id'], 'fullName' => $profile['full_name'], 'approvalStatus' => 'pending'];
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
        'price' => money($row['price'] ?? 0),
        'stockQuantity' => (int)($row['stock_quantity'] ?? $row['stock'] ?? $row['quantity'] ?? 0),
        'isAvailable' => (bool)($row['is_available'] ?? $row['available'] ?? true),
        'imageUrl' => $row['image_url'] ?? null,
        'expirationDate' => $row['expiration_date'] ?? null,
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

function imageUpload(?string $existing = null, string $folder = ''): ?string {
    if (!isset($_FILES['image'])) return $existing;
    $file = $_FILES['image'];
    if (!is_array($file) || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) throw new ApiException(400, 'Choose a valid image file to upload.');
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) throw new ApiException(400, 'The image could not be uploaded.');
    $actualSize = is_file($file['tmp_name']) ? filesize($file['tmp_name']) : false;
    if (!is_int($actualSize) || $actualSize < 1 || $actualSize > 5 * 1024 * 1024 || (int)($file['size'] ?? 0) !== $actualSize) throw new ApiException(400, 'Images must be between 1 byte and 5 MB.');
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']) ?: '';
    $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($allowed[$mime])) throw new ApiException(400, 'Images must be JPG, PNG, or WebP.');
    // This must match the existing public Storage bucket. Never fall back to
    // a guessed bucket name: Storage reports a missing bucket as an upload error.
    $bucket = envValue('SUPABASE_MEDICINE_BUCKET', false) ?: 'medicine-images';
    $objectPath = ($folder !== '' ? trim($folder, '/') . '/' : '') . bin2hex(random_bytes(16)) . '.' . $allowed[$mime];
    $base = rtrim(envValue('NEXT_PUBLIC_SUPABASE_URL'), '/');
    $key = envValue('SUPABASE_SERVICE_ROLE_KEY');
    $content = file_get_contents($file['tmp_name']);
    if (!is_string($content)) throw new ApiException(400, 'The uploaded image could not be read.');
    [$response, $status] = httpRequest($base . '/storage/v1/object/' . rawurlencode($bucket) . '/' . $objectPath, 'POST', ["apikey: {$key}", "Authorization: Bearer {$key}", 'Content-Type: ' . $mime, 'x-upsert: true'], $content, 25);
    if ($status < 200 || $status >= 300) {
        $payload = readPayload($response);
        throw new ApiException(502, 'Supabase Storage upload failed: ' . payloadMessage($payload, 'check that the medicine-images bucket is available to the server.'));
    }
    return $base . '/storage/v1/object/public/' . rawurlencode($bucket) . '/' . $objectPath;
}

function removeOwnedProfileImage(?string $publicUrl, string $userId): ?string {
    if (!$publicUrl) return null;
    $bucket = envValue('SUPABASE_MEDICINE_BUCKET', false) ?: 'medicine-images';
    $path = parse_url($publicUrl, PHP_URL_PATH);
    $marker = '/storage/v1/object/public/' . rawurlencode($bucket) . '/';
    $markerPosition = is_string($path) ? strpos($path, $marker) : false;
    if ($markerPosition === false) return 'The profile was updated, but the previous image could not be removed from its storage location.';
    $objectPath = rawurldecode(substr($path, $markerPosition + strlen($marker)));
    if (!str_starts_with($objectPath, $userId . '/')) return 'The profile was updated, but the previous image is outside your account folder and was left in storage.';

    $base = rtrim(envValue('NEXT_PUBLIC_SUPABASE_URL'), '/');
    $key = envValue('SUPABASE_SERVICE_ROLE_KEY');
    $encodedPath = implode('/', array_map('rawurlencode', explode('/', $objectPath)));
    try {
        [$response, $status] = httpRequest($base . '/storage/v1/object/' . rawurlencode($bucket) . '/' . $encodedPath, 'DELETE', ["apikey: {$key}", "Authorization: Bearer {$key}", 'Accept: application/json'], null, 25);
    } catch (Throwable) {
        return 'The profile was updated, but the previous image could not be removed from storage.';
    }
    if ($status < 200 || $status >= 300) {
        return 'The profile was updated, but the previous image could not be removed from storage.';
    }
    return null;
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
    if (!is_resource($process)) throw new ApiException(503, 'Python forecasting could not be started. Contact the system administrator to check the server configuration.');
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
    $orders = selectAllRows('orders', 'id,order_status,created_at', 'order_status=eq.delivered&order=created_at.asc');
    if (!$orders) return [];
    $byId = [];
    foreach ($orders as $order) $byId[(string)$order['id']] = $order;
    $deliveredOrders = array_values($byId);
    $payments = [];
    foreach (array_chunk(array_keys($byId), 100) as $orderIds) {
        $ids = implode(',', array_map(static fn(string $id): string => rawurlencode($id), $orderIds));
        array_push($payments, ...selectAllRows('payments', 'order_id,payment_status,created_at', 'order_id=in.(' . $ids . ')&order=created_at.desc'));
    }
    $byId = [];
    foreach (paidAndDeliveredOrders($deliveredOrders, $payments) as $order) $byId[(string)$order['id']] = $order;
    if (!$byId) return [];
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
    $account = validateAccountInput([
        'fullName' => $input['fullName'] ?? null,
        'email' => $input['email'] ?? null,
        'password' => $input['initialPassword'] ?? null,
    ], true);
    $auth = supabaseRequest('/auth/v1/admin/users', 'POST', [
        'email' => $account['email'],
        'password' => $account['password'],
        'email_confirm' => true,
        'user_metadata' => ['full_name' => $account['fullName']],
        'app_metadata' => ['role' => 'client'],
    ]);
    if (!is_array($auth) || empty($auth['id'])) throw new ApiException(502, 'Supabase did not return the new account.');
    try {
        $profile = insertTable('profiles', ['id' => $auth['id'], 'full_name' => $account['fullName'], 'avatar_url' => '', 'role' => 'client']);
    } catch (Throwable $error) {
        try { supabaseRequest('/auth/v1/admin/users/' . rawurlencode((string)$auth['id']), 'DELETE'); } catch (Throwable) {}
        throw $error;
    }
    return ['id' => (string)$auth['id'], 'fullName' => $profile['full_name'], 'email' => $auth['email'] ?? $input['email'], 'role' => 'client', 'status' => 'active'];
}

function route(string $method, string $path): void {
    if ($path === '/healthz' && $method === 'GET') respond(['status' => 'ok']);
    if ($path === '/register' && $method === 'POST') {
        $input = jsonBody();
        respond(createPendingRegistration($input), 201);
    }
    $user = currentUser();

    if ($path === '/admin/approvals' && $method === 'GET') {
        requireAdmin();
        $profiles = selectTable('profiles', 'id,full_name,role,approval_status,organization_name', 'approval_status=eq.pending');
        $auth = supabaseRequest('/auth/v1/admin/users?page=1&per_page=1000');
        $users = is_array($auth) && isset($auth['users']) ? $auth['users'] : (is_array($auth) ? $auth : []);
        $byId = [];
        foreach ($users as $account) $byId[(string)($account['id'] ?? '')] = $account;
        $output = [];
        foreach ($profiles as $profile) {
            $account = $byId[(string)$profile['id']] ?? [];
            $output[] = ['id' => (string)$profile['id'], 'fullName' => (string)$profile['full_name'], 'email' => (string)($account['email'] ?? ''), 'organizationName' => $profile['organization_name'] ?? null, 'approvalStatus' => 'pending'];
        }
        respond($output);
    }
    if (preg_match('#^/admin/approvals/([^/]+)$#', $path, $match) && $method === 'POST') {
        requireAdmin();
        $accountId = requireUuid($match[1], 'Account');
        $input = jsonBody();
        $action = is_string($input['action'] ?? null) ? $input['action'] : '';
        $profile = oneTable('profiles', 'id=eq.' . rawurlencode($accountId) . '&approval_status=eq.pending');
        if (!$profile) fail(404, 'Pending registration not found.');
        if ($action === 'approve_manager') {
            $updated = updateTable('profiles', 'id=eq.' . rawurlencode($accountId) . '&approval_status=eq.pending', ['role' => 'manager', 'approval_status' => 'approved']);
        } elseif ($action === 'approve_partnership') {
            // `client` is the established partnership role used by existing rows and policies.
            $updated = updateTable('profiles', 'id=eq.' . rawurlencode($accountId) . '&approval_status=eq.pending', ['role' => 'client', 'approval_status' => 'approved']);
        } elseif ($action === 'reject') {
            $updated = updateTable('profiles', 'id=eq.' . rawurlencode($accountId) . '&approval_status=eq.pending', ['approval_status' => 'rejected']);
        } else fail(400, 'Choose a valid approval action.');
        respond(['id' => (string)$updated['id'], 'role' => (string)$updated['role'], 'approvalStatus' => (string)$updated['approval_status']]);
    }

    if ($path === '/admin/clients' && $method === 'GET') {
        requireAdmin();
        $profiles = selectTable('profiles', 'id,full_name,avatar_url,role,approval_status,organization_name', 'role=in.(client,partnership_account,manager)&approval_status=eq.approved');
        $auth = supabaseRequest('/auth/v1/admin/users?page=1&per_page=1000');
        $users = is_array($auth) && isset($auth['users']) ? $auth['users'] : (is_array($auth) ? $auth : []);
        $byId = [];
        foreach ($users as $account) $byId[(string)($account['id'] ?? '')] = $account;
        $output = [];
        foreach ($profiles as $profile) {
            $account = $byId[(string)$profile['id']] ?? [];
            if (!isset($account['email'])) continue;
            $status = (!empty($account['deleted_at']) || !empty($account['banned_until'])) ? 'disabled' : (empty($account['email_confirmed_at']) ? 'unconfirmed' : 'active');
            $storedRole = (string)$profile['role'];
            $displayRole = $storedRole === 'manager' ? 'Manager' : 'Partnership Account';
            $output[] = ['id' => (string)$profile['id'], 'fullName' => $profile['full_name'], 'email' => $account['email'], 'role' => $displayRole, 'status' => $status, 'approvalStatus' => 'approved', 'organizationName' => $profile['organization_name'] ?? null];
        }
        respond($output);
    }
    if ($path === '/admin/clients' && $method === 'POST') {
        requireAdmin();
        $input = jsonBody();
        validateAccountInput(['fullName' => $input['fullName'] ?? null, 'email' => $input['email'] ?? null, 'password' => $input['initialPassword'] ?? null], true);
        try { respond(createClientAccount($input), 201); } catch (ApiException $error) {
            if ($error->status === 422 || preg_match('/already|exist|registered/i', $error->getMessage())) fail(409, 'An account with that email already exists.');
            throw $error;
        }
    }

    if ($path === '/medicines' && $method === 'GET') {
        $rows = selectTable('medicines', '*', in_array($user['role'], ['admin', 'manager'], true) ? '' : 'is_available=eq.true&stock_quantity=gt.0&order=name.asc');
        respond(array_map('medicineOutput', $rows));
    }
    if ($path === '/profile/avatar' && $method === 'POST') {
        $avatarUrl = imageUpload(null, $user['id']);
        if (!$avatarUrl) fail(400, 'Choose a profile photo to upload.');
        $previousUrl = (string)($user['profile']['avatar_url'] ?? '');
        try {
            updateTable('profiles', 'id=eq.' . rawurlencode($user['id']), ['avatar_url' => $avatarUrl]);
        } catch (Throwable $error) {
            removeOwnedProfileImage($avatarUrl, $user['id']);
            throw $error;
        }
        respond(['url' => $avatarUrl, 'warning' => removeOwnedProfileImage($previousUrl, $user['id'])]);
    }
    if ($path === '/profile/avatar' && $method === 'DELETE') {
        $previousUrl = (string)($user['profile']['avatar_url'] ?? '');
        updateTable('profiles', 'id=eq.' . rawurlencode($user['id']), ['avatar_url' => '']);
        respond(['warning' => removeOwnedProfileImage($previousUrl, $user['id'])]);
    }
    if ($path === '/admin/medicines' && $method === 'POST') {
        requireAdmin();
        $input = $_POST ?: jsonBody();
        $name = cleanText($input['name'] ?? '', 'Medicine name', 160, true);
        $rawAvailable = $input['isAvailable'] ?? true;
        if (!in_array($rawAvailable, [true, false, 1, 0, '1', '0', 'true', 'false', 'on'], true)) fail(400, 'Availability must be true or false.');
        $data = [
            'name' => $name,
            'price' => nonnegativePrice($input['price'] ?? null),
            'stock_quantity' => nonnegativeInteger($input['stockQuantity'] ?? null, 'Stock quantity'),
            'is_available' => filter_var($rawAvailable, FILTER_VALIDATE_BOOLEAN),
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
        if (!$data['image_url']) fail(400, 'Please upload a product image before adding this medicine.');
        respond(medicineOutput(insertTable('medicines', $data)), 201);
    }
    if (preg_match('#^/admin/medicines/([^/]+)$#', $path, $match) && in_array($method, ['POST', 'PUT'], true)) {
        requireAdmin();
        $medicineId = requireUuid($match[1], 'Medicine');
        $input = $_POST ?: jsonBody();
        $existing = oneTable('medicines', 'id=eq.' . rawurlencode($medicineId));
        if (!$existing) fail(404, 'Medicine not found.');
        $name = cleanText($input['name'] ?? $existing['name'] ?? '', 'Medicine name', 160, true);
        $rawAvailable = $input['isAvailable'] ?? ($existing['is_available'] ?? true);
        if (!in_array($rawAvailable, [true, false, 1, 0, '1', '0', 'true', 'false', 'on'], true)) fail(400, 'Availability must be true or false.');
        $data = [
            'name' => $name,
            'price' => nonnegativePrice($input['price'] ?? $existing['price'] ?? null),
            'stock_quantity' => nonnegativeInteger($input['stockQuantity'] ?? $existing['stock_quantity'] ?? null, 'Stock quantity'),
            'is_available' => filter_var($rawAvailable, FILTER_VALIDATE_BOOLEAN),
            'image_url' => imageUpload($existing['image_url'] ?? null),
        ];
        respond(medicineOutput(updateTable('medicines', 'id=eq.' . rawurlencode($medicineId), $data)));
    }
    if (preg_match('#^/admin/medicines/([^/]+)$#', $path, $match) && $method === 'DELETE') {
        requireAdmin();
        $medicineId = requireUuid($match[1], 'Medicine');
        $medicine = oneTable('medicines', 'id=eq.' . rawurlencode($medicineId));
        if (!$medicine) fail(404, 'Medicine not found.');
        if (selectTable('order_items', 'id', 'medicine_id=eq.' . rawurlencode($medicineId) . '&limit=1')) {
            fail(409, 'This medicine is referenced by order history and cannot be deleted. You can mark it unavailable instead.');
        }
        if (selectTable('forecast_results', 'id', 'medicine_id=eq.' . rawurlencode($medicineId) . '&limit=1')) {
            fail(409, 'This medicine is referenced by forecast history and cannot be deleted. You can mark it unavailable instead.');
        }
        try {
            $deleted = supabaseRequest('/rest/v1/medicines?id=eq.' . rawurlencode($medicineId) . '&select=id', 'DELETE', null, ['Prefer: return=representation']);
        } catch (ApiException $error) {
            if (preg_match('/foreign key|violates.*constraint|23503/i', $error->getMessage())) {
                fail(409, 'This medicine is referenced by existing records and cannot be deleted. You can mark it unavailable instead.');
            }
            throw $error;
        }
        if (!is_array($deleted) || !$deleted) fail(404, 'Medicine not found.');
        respond(['id' => $medicineId, 'deleted' => true]);
    }

    if ($path === '/orders' && $method === 'GET') {
        $query = in_array($user['role'], ['admin', 'manager'], true) ? 'order=created_at.desc' : 'client_id=eq.' . rawurlencode($user['id']) . '&order=created_at.desc';
        $orders = selectTable('orders', '*', $query);
        respond(array_map('loadOrderDetails', $orders));
    }
    if ($path === '/orders' && $method === 'POST') {
        if (!in_array($user['role'], ['client', 'partnership_account'], true)) fail(403, 'Only Partnership Accounts can place orders.');
        $input = jsonBody();
        $items = is_array($input['items'] ?? null) ? $input['items'] : [];
        $paymentMethod = is_string($input['paymentMethod'] ?? null) ? strtolower($input['paymentMethod']) : '';
        if (!$items || count($items) > 100 || !in_array($paymentMethod, ['gcash', 'cash'], true)) fail(400, 'Choose between 1 and 100 medicines and a GCash or Cash payment method.');
        $total = 0.0; $normalized = []; $seenMedicineIds = [];
        foreach ($items as $item) {
            if (!is_array($item)) fail(400, 'Each order item must include a medicine and quantity.');
            $medicineId = requireUuid($item['medicineId'] ?? null, 'Medicine');
            if (isset($seenMedicineIds[$medicineId])) fail(400, 'Each medicine can appear only once in an order.');
            $seenMedicineIds[$medicineId] = true;
            $quantity = nonnegativeInteger($item['quantity'] ?? null, 'Order quantity', true);
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
        $orderId = requireUuid($match[1], 'Order');
        $order = oneTable('orders', 'id=eq.' . rawurlencode($orderId));
        if (!$order || (!in_array($user['role'], ['admin', 'manager'], true) && (string)($order['client_id'] ?? $order['user_id'] ?? '') !== $user['id'])) fail(404, 'Order not found.');
        respond(loadOrderDetails($order));
    }
    if (preg_match('#^/admin/orders/([^/]+)$#', $path, $match) && in_array($method, ['PATCH', 'PUT'], true)) {
        requireManagerOrAdmin();
        $orderId = requireUuid($match[1], 'Order');
        $input = jsonBody();
        $order = oneTable('orders', 'id=eq.' . rawurlencode($orderId));
        if (!$order) fail(404, 'Order not found.');
        $allowedStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
        $rawStatus = $input['status'] ?? $order['order_status'] ?? 'pending';
        $status = is_string($rawStatus) ? strtolower($rawStatus) : '';
        if (!in_array($status, $allowedStatuses, true)) fail(400, 'Invalid order status.');
        $paymentStatus = null;
        if (isset($input['paymentStatus'])) {
            if (!is_string($input['paymentStatus'])) fail(400, 'Invalid payment status.');
            $paymentStatus = strtolower($input['paymentStatus']);
            if (!in_array($paymentStatus, ['unpaid', 'pending', 'paid', 'refunded'], true)) fail(400, 'Invalid payment status.');
        }
        $updated = updateTable('orders', 'id=eq.' . rawurlencode($orderId), ['order_status' => $status]);
        if ($paymentStatus !== null) {
            $payments = selectTable('payments', '*', 'order_id=eq.' . rawurlencode($orderId) . '&limit=1');
            if ($payments) {
                $paymentData = ['payment_status' => $paymentStatus];
                if ($paymentStatus === 'paid') $paymentData['paid_at'] = gmdate('c');
                elseif (in_array($paymentStatus, ['unpaid', 'pending'], true)) $paymentData['paid_at'] = null;
                updateTable('payments', 'id=eq.' . rawurlencode((string)$payments[0]['id']), $paymentData);
            }
        }
        if (isset($input['location']) || isset($input['estimatedDelivery']) || isset($input['notes'])) {
            $location = cleanText($input['location'] ?? '', 'Tracking location', 160);
            $notes = cleanText($input['notes'] ?? '', 'Tracking notes', 1000);
            $estimated = validDateOnly($input['estimatedDelivery'] ?? null, 'Estimated delivery date');
            if ($estimated !== null && !empty($order['created_at']) && $estimated < substr((string)$order['created_at'], 0, 10)) fail(400, 'Estimated delivery cannot be earlier than the order date.');
            insertTable('order_tracking_events', ['order_id' => $orderId, 'status' => $status, 'location' => $location, 'estimated_delivery_at' => $estimated, 'notes' => $notes, 'recorded_by' => $user['id']]);
        }
        respond(loadOrderDetails($updated));
    }
    if ($path === '/admin/forecasts/preview' && $method === 'POST') {
        requireManagerOrAdmin();
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) fail(400, 'Choose an Excel workbook to preview.');
        $extension = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
        if ($extension !== 'xlsx') fail(400, 'Upload an .xlsx workbook.');
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
        $admin = requireManagerOrAdmin();
        $input = jsonBody();
        $rawHorizon = $input['horizon'] ?? 3;
        if (!(is_int($rawHorizon) || (is_string($rawHorizon) && preg_match('/^\\d+$/', $rawHorizon))) || !in_array((int)$rawHorizon, [1, 3, 6, 12], true)) fail(400, 'Choose a forecast horizon of 1, 3, 6, or 12 months.');
        $horizon = (int)$rawHorizon;
        $excelSales = [];
        $importId = is_string($input['importId'] ?? null) ? $input['importId'] : '';
        if (isset($input['importId']) && !is_string($input['importId'])) fail(400, 'Historical sales preview is invalid. Upload the workbook again.');
        if ($importId !== '') {
            if (!preg_match('/^[a-f0-9]{40}$/', $importId)) fail(400, 'Historical sales preview is invalid. Upload the workbook again.');
            $importPath = forecastRuntimeDirectory() . DIRECTORY_SEPARATOR . 'imports' . DIRECTORY_SEPARATOR . $importId . '.json';
            $importData = is_file($importPath) ? json_decode((string)file_get_contents($importPath), true) : null;
            if (is_array($importData) && (string)($importData['uploadedBy'] ?? '') !== (string)$admin['id']) fail(403, 'This historical sales import belongs to another account. Upload the workbook again.');
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
            'model_type' => (string)($result['modelType'] ?? 'linear_regression'),
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
        $result['modelType'] = (string)($run['model_type'] ?? $result['modelType'] ?? 'linear_regression');
        $result['evaluationMethod'] = (string)($result['evaluationMethod'] ?? 'holdout_test_data');
        $result['importId'] = $importId !== '' ? $importId : null;
        forecastMetadata((string)$run['id'], $result);
        respond($result, 201);
    }
    if ($path === '/admin/forecasts' && $method === 'GET') {
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        requireManagerOrAdmin();
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
                'forecastVersion' => $details['forecastVersion'] ?? null,
                'forecastedMedicineCount' => $details['forecastedMedicineCount'] ?? count(array_unique(array_map(static fn(array $row): string => !empty($row['medicine_id']) ? (string)$row['medicine_id'] : 'historical:' . strtolower(trim((string)($row['medicine_name'] ?? ''))), $resultsByRun[$id] ?? []))),
                'metrics' => $details['metrics'] ?? null,
                'trainingObservationCount' => $details['trainingObservationCount'] ?? null,
                'testObservationCount' => $details['testObservationCount'] ?? null,
                'evaluationMethod' => $details['evaluationMethod'] ?? null,
                'evaluationDetails' => $details['evaluationDetails'] ?? null,
                'medicines' => $details['medicines'] ?? [],
                'modelComparisons' => $details['modelComparisons'] ?? [],
                'chart' => $details['chart'] ?? [],
                'chartOverall' => $details['chartOverall'] ?? [],
                'results' => array_map(static fn(array $row): array => ['medicineId' => $row['medicine_id'] ?? null, 'medicineName' => $row['medicine_name'] ?? null, 'period' => $row['forecast_period'], 'quantity' => (float)$row['predicted_quantity']], $resultsByRun[$id] ?? []),
            ];
        }
        respond(['runs' => $output]);
    }
    if ($path === '/admin/forecasts/imports' && $method === 'GET') {
        requireManagerOrAdmin();
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
        requireManagerOrAdmin();
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
