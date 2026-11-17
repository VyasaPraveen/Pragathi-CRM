<?php
// ============================================================================
// Push routes: device-token registration + (internal) send. FCM stays on the
// Spark plan — sending is done here in PHP, never via Cloud Functions.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

require_once __DIR__ . '/../lib/fcm.php';

function handle_push(string $action, string $method): void {
  $claims = require_auth();

  // Register / refresh this device's FCM token
  if ($action === 'register' && $method === 'POST') {
    $b = body();
    $token = trim($b['token'] ?? '');
    if ($token === '') fail(400, 'token required');
    $platform = substr((string)($b['platform'] ?? 'web'), 0, 20);
    $st = db()->prepare(
      'INSERT INTO fcm_tokens (token, user_id, user_email, user_name, platform, created_at, updated_at)
       VALUES (?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), user_email=VALUES(user_email), user_name=VALUES(user_name), platform=VALUES(platform), updated_at=UTC_TIMESTAMP()'
    );
    $st->execute([$token, $claims['sub'] ?? '', $claims['email'] ?? '', $claims['name'] ?? '', $platform]);
    json_out(['ok' => true]);
  }

  // Unregister (e.g. on logout)
  if ($action === 'unregister' && $method === 'POST') {
    $b = body();
    $token = trim($b['token'] ?? '');
    if ($token !== '') db()->prepare('DELETE FROM fcm_tokens WHERE token = ?')->execute([$token]);
    json_out(['ok' => true]);
  }

  fail(404, 'Unknown push route');
}
