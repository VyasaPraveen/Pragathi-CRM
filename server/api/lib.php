<?php
// ============================================================================
// Pragathi CRM API — shared library (no external dependencies).
// PDO/MySQL, JSON+CORS helpers, HS256 JWT, password auth, RBAC matrix,
// and the collection→table allowlist.
// ============================================================================

declare(strict_types=1);
mb_internal_encoding('UTF-8');

function cfg(): array {
  static $c = null;
  if ($c === null) {
    $path = __DIR__ . '/config.php';
    if (!file_exists($path)) { http_response_code(500); echo json_encode(['error' => 'Server not configured']); exit; }
    $c = require $path;
  }
  return $c;
}

// ── Database ────────────────────────────────────────────────────────────────
function db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $d = cfg()['db'];
    $dsn = "mysql:host={$d['host']};dbname={$d['name']};charset={$d['charset']}";
    try {
      $pdo = new PDO($dsn, $d['user'], $d['pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
      ]);
    } catch (Throwable $e) {
      fail(500, 'Database connection failed');
    }
  }
  return $pdo;
}

// ── HTTP / JSON helpers ──────────────────────────────────────────────────────
function send_cors(): void {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  $allowed = cfg()['allowed_origins'] ?? [];
  if ($origin && in_array($origin, $allowed, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
  }
  header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}

function json_out($data, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fail(int $code, string $msg): void { json_out(['error' => $msg], $code); }

function body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $d = json_decode($raw, true);
  return is_array($d) ? $d : [];
}

function gen_id(): string {
  // Firestore-like 20-char id
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  $s = '';
  for ($i = 0; $i < 20; $i++) $s .= $alphabet[random_int(0, 61)];
  return $s;
}

// ── JWT (HS256, dependency-free) ─────────────────────────────────────────────
function b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64url_decode(string $s): string { return base64_decode(strtr($s, '-_', '+/')); }

function jwt_issue(array $claims): string {
  $header = ['alg' => 'HS256', 'typ' => 'JWT'];
  $ttl = (int)(cfg()['jwt_ttl_days'] ?? 30) * 86400;
  $claims = array_merge(['iat' => time(), 'exp' => time() + $ttl], $claims);
  $seg = b64url(json_encode($header)) . '.' . b64url(json_encode($claims));
  $sig = hash_hmac('sha256', $seg, cfg()['jwt_secret'], true);
  return $seg . '.' . b64url($sig);
}

function jwt_verify(string $token): ?array {
  $parts = explode('.', $token);
  if (count($parts) !== 3) return null;
  [$h, $p, $s] = $parts;
  $expected = b64url(hash_hmac('sha256', "$h.$p", cfg()['jwt_secret'], true));
  if (!hash_equals($expected, $s)) return null;
  $claims = json_decode(b64url_decode($p), true);
  if (!is_array($claims) || ($claims['exp'] ?? 0) < time()) return null;
  return $claims;
}

// Return the authenticated user's claims, or null. Enforces via Authorization: Bearer.
function current_user(): ?array {
  $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  if (!$hdr && function_exists('apache_request_headers')) {
    $h = apache_request_headers();
    $hdr = $h['Authorization'] ?? ($h['authorization'] ?? '');
  }
  if (stripos($hdr, 'Bearer ') !== 0) return null;
  return jwt_verify(trim(substr($hdr, 7)));
}

function require_auth(): array {
  $u = current_user();
  if (!$u) fail(401, 'Not authenticated');
  return $u;
}

// ── RBAC (server-side mirror of src/services/permissions.js) ─────────────────
const ALL_ROLES = ['executive','technical_manager','operation_manager','accountant','admin','management','bco','technician','sales_manager','warehouse_admin'];
const ACTION_ROLES = [
  'lead_entry'                 => ALL_ROLES,
  'site_visit'                 => ['executive','technical_manager'],
  'po_record'                  => ['operation_manager','admin','warehouse_admin'],
  'po_recommendation'          => ['operation_manager','admin'],
  'po_management_approval'     => ['management'],
  'po_approval'                => ['admin','management'],
  'expenditure_request'        => ALL_ROLES,
  'expenditure_recommendation' => ['technical_manager','operation_manager','sales_manager'],
  'expenditure_verified'       => ['accountant'],   // Accountant review (req #12)
  'expenditure_approve'        => ['management'],    // Management/Owner final approval
  'payment_release'            => ['accountant'],    // Accountant releases payment
];
const LEGACY_ROLE_MAP = ['manager'=>'operation_manager','coordinator'=>'bco','engineer'=>'technician','staff'=>'executive'];

function normalize_role(?string $role): string {
  $role = $role ?? '';
  return LEGACY_ROLE_MAP[$role] ?? $role;
}
function can(?string $role, string $action): bool {
  if ($role === 'super_admin') return true;
  $r = normalize_role($role);
  $allowed = ACTION_ROLES[$action] ?? null;
  return is_array($allowed) && in_array($r, $allowed, true);
}
const ROLE_LEVELS = [
  'super_admin'=>7,'management'=>6,'admin'=>5,
  'manager'=>4,'operation_manager'=>4,'technical_manager'=>4,'sales_manager'=>4,'warehouse_admin'=>4,
  'coordinator'=>3,'accountant'=>3,'bco'=>3,
  'engineer'=>2,'executive'=>2,'technician'=>2,'staff'=>1,
];
function has_access(?string $role, string $min): bool {
  return (ROLE_LEVELS[$role] ?? 0) >= (ROLE_LEVELS[$min] ?? 0);
}

// ── Collection → table allowlist ─────────────────────────────────────────────
function collection_table(string $collection): ?string {
  static $map = [
    'leads' => 'leads', 'customers' => 'customers', 'installations' => 'installations',
    'team' => 'team', 'materials' => 'materials', 'ongoingWork' => 'ongoing_work',
    'income' => 'income', 'expenses' => 'expenses', 'reminders' => 'reminders',
    'gallery' => 'gallery', 'purchaseOrders' => 'purchase_orders', 'retailers' => 'retailers',
    'influencers' => 'influencers', 'employeeTasks' => 'employee_tasks', 'leadPOs' => 'lead_pos',
    'expenditures' => 'expenditures', 'bomTemplates' => 'bom_templates',
    'activityLog' => 'activity_log', 'notifications' => 'notifications',
    'leaveRequests' => 'leave_requests', 'attendance' => 'attendance', 'tracking' => 'tracking',
  ];
  return $map[$collection] ?? null;
}

// Convert a stored (UTC) MySQL DATETIME to ISO-8601 with Z, so JS `new Date()`
// parses it reliably in every browser (Safari rejects "YYYY-MM-DD HH:MM:SS").
function to_iso(?string $dt): ?string {
  if (!$dt) return null;
  $t = strtotime($dt . ' UTC');
  return $t ? gmdate('Y-m-d\TH:i:s\Z', $t) : $dt;
}

// Assemble a stored document row into the {id, ...data} shape the frontend expects.
function row_to_doc(array $row): array {
  $data = $row['data'] ? json_decode($row['data'], true) : [];
  if (!is_array($data)) $data = [];
  $data['id'] = $row['id'];
  if (isset($row['created_at'])) $data['createdAt'] = to_iso($row['created_at']);
  if (isset($row['updated_at'])) $data['updatedAt'] = to_iso($row['updated_at']);
  // Surface audit columns as fields (parity with the old Firestore docs).
  if (!empty($row['created_by'])) $data['createdBy'] = $data['createdBy'] ?? $row['created_by'];
  if (!empty($row['updated_by'])) $data['updatedBy'] = $data['updatedBy'] ?? $row['updated_by'];
  return $data;
}
