<?php
// ============================================================================
// Pragathi CRM API — front controller.
// All /api/* requests are rewritten here (see .htaccess) with the sub-path in
// ?_p=. Routes: /health, /auth/*, /collections/*, /upload, /push/*.
// ============================================================================

define('PPS_API', 1); // guards route/lib includes against direct web access
require __DIR__ . '/lib.php';
send_cors();

$path = trim((string)($_GET['_p'] ?? ''), '/');
$seg  = $path === '' ? [] : explode('/', $path);
$head = $seg[0] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
  switch ($head) {
    case '':
    case 'health':
      json_out(['ok' => true, 'service' => 'pragathi-crm-api', 'time' => gmdate('c')]);
      break;

    case 'auth':
      require __DIR__ . '/routes/auth.php';
      handle_auth($seg, $method);
      break;

    case 'collections':
      require __DIR__ . '/routes/collections.php';
      handle_collections($seg[1] ?? '', $seg[2] ?? '', $method);
      break;

    // Batch read: GET /batch?names=leads,customers,... → { leads:[…], … } in ONE
    // request/one DB connection, so the client's periodic refresh doesn't open a
    // separate connection per collection (avoids max_user_connections exhaustion).
    case 'batch':
      require __DIR__ . '/routes/collections.php';
      handle_batch($method);
      break;

    case 'settings':
      require __DIR__ . '/routes/settings.php';
      handle_settings($method);
      break;

    case 'upload':
      require __DIR__ . '/routes/upload.php';
      handle_upload($method);
      break;

    case 'push':
      require __DIR__ . '/routes/push.php';
      handle_push($seg[1] ?? '', $method);
      break;

    default:
      fail(404, 'Not found');
  }
} catch (Throwable $e) {
  // Never leak internals; log server-side if a logger is configured.
  error_log('API error: ' . $e->getMessage());
  fail(500, 'Server error');
}
