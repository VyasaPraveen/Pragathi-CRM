<?php
// ============================================================================
// FCM HTTP v1 sender — uses the Firebase service-account key to mint an OAuth2
// access token (RS256 JWT → token endpoint), then sends messages. This runs on
// the Spark plan: no Cloud Functions, no Blaze. Called server-side on events.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

function fcm_access_token(): ?string {
  $conf = cfg()['fcm'] ?? [];
  if (empty($conf['enabled'])) return null;
  $path = $conf['service_account_path'] ?? '';
  if (!$path || !file_exists($path)) { error_log('FCM: service account key missing'); return null; }

  static $cached = null; static $exp = 0;
  if ($cached && time() < $exp - 60) return $cached;

  $sa = json_decode(file_get_contents($path), true);
  if (!isset($sa['client_email'], $sa['private_key'])) { error_log('FCM: bad service account'); return null; }

  $now = time();
  $header = ['alg' => 'RS256', 'typ' => 'JWT'];
  $claim = [
    'iss'   => $sa['client_email'],
    'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
    'aud'   => 'https://oauth2.googleapis.com/token',
    'iat'   => $now,
    'exp'   => $now + 3600,
  ];
  $b64 = fn($x) => rtrim(strtr(base64_encode($x), '+/', '-_'), '=');
  $seg = $b64(json_encode($header)) . '.' . $b64(json_encode($claim));
  $sig = '';
  if (!openssl_sign($seg, $sig, $sa['private_key'], 'sha256WithRSAEncryption')) return null;
  $assertion = $seg . '.' . $b64($sig);

  $res = http_post_form('https://oauth2.googleapis.com/token', [
    'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'assertion'  => $assertion,
  ]);
  $tok = json_decode($res, true);
  if (!isset($tok['access_token'])) { error_log('FCM token error: ' . $res); return null; }
  $cached = $tok['access_token'];
  $exp = $now + (int)($tok['expires_in'] ?? 3600);
  return $cached;
}

// Send a notification to a set of device tokens. Returns count sent.
function fcm_send(array $tokens, string $title, string $bodyText, array $data = []): int {
  $tokens = array_values(array_unique(array_filter($tokens)));
  if (!$tokens) return 0;
  $access = fcm_access_token();
  if (!$access) return 0;
  $projectId = cfg()['fcm']['project_id'] ?? '';
  $url = "https://fcm.googleapis.com/v1/projects/$projectId/messages:send";

  $sent = 0;
  foreach ($tokens as $t) {
    $msg = ['message' => [
      'token' => $t,
      'notification' => ['title' => $title, 'body' => $bodyText],
      'data' => array_map('strval', $data),
      'webpush' => ['fcmOptions' => ['link' => $data['link'] ?? '/']],
    ]];
    $resp = http_post_json($url, $msg, ["Authorization: Bearer $access"]);
    if ($resp['code'] === 200) { $sent++; }
    elseif ($resp['code'] === 404 || $resp['code'] === 400) {
      // Stale/invalid token — prune it
      db()->prepare('DELETE FROM fcm_tokens WHERE token = ?')->execute([$t]);
    }
  }
  return $sent;
}

// Collect device tokens for a set of user display-names or emails.
function fcm_tokens_for(array $names): array {
  $names = array_values(array_filter(array_map('strval', $names)));
  if (!$names) return [];
  $in = implode(',', array_fill(0, count($names), '?'));
  $st = db()->prepare("SELECT token FROM fcm_tokens WHERE user_name IN ($in) OR user_email IN ($in)");
  $st->execute(array_merge($names, $names));
  return array_column($st->fetchAll(), 'token');
}

// ── tiny HTTP helpers ──
function http_post_form(string $url, array $fields): string {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query($fields),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
  ]);
  $r = curl_exec($ch); curl_close($ch);
  return $r === false ? '' : $r;
}
function http_post_json(string $url, array $payload, array $headers = []): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
  ]);
  $body = curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ['code' => $code, 'body' => $body === false ? '' : $body];
}
