<?php
// ============================================================================
// Auth routes: login, signup, me, password change, and admin user management.
// Mirrors the behaviour of the old Firebase AuthContext / UserManagement.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

function public_user(array $row): array {
  // Shape sent to the client — never include password_hash.
  $extra = $row['data'] ? json_decode($row['data'], true) : [];
  if (!is_array($extra)) $extra = [];
  return array_merge($extra, [
    'id'          => $row['id'],
    'uid'         => $row['id'],
    'email'       => $row['email'],
    'displayName' => $row['display_name'],
    'phone'       => $row['phone'],
    'role'        => $row['role'],
    'designation' => $row['designation'],
    'approved'    => (bool)$row['approved'],
    'permissions' => $row['permissions'] ? json_decode($row['permissions'], true) : null,
    'createdAt'   => to_iso($row['created_at'] ?? null),
    'lastLogin'   => to_iso($row['last_login'] ?? null),
  ]);
}

function find_user_by_email(string $email): ?array {
  $st = db()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
  $st->execute([strtolower(trim($email))]);
  $r = $st->fetch();
  return $r ?: null;
}

function handle_auth(array $seg, string $method): void {
  $action = $seg[1] ?? '';

  // ── LOGIN ──
  if ($action === 'login' && $method === 'POST') {
    $b = body();
    $email = strtolower(trim($b['email'] ?? ''));
    $pass  = (string)($b['password'] ?? '');
    if ($email === '' || $pass === '') fail(400, 'Email and password required');
    $u = find_user_by_email($email);
    // Constant-ish behaviour to avoid leaking which part failed
    if (!$u || !$u['password_hash'] || !password_verify($pass, $u['password_hash'])) {
      fail(401, 'Invalid email or password');
    }
    if (!(int)$u['approved']) {
      // Still issue a token so the app can show the "pending approval" screen
      $token = jwt_issue(['sub' => $u['id'], 'email' => $u['email'], 'role' => $u['role']]);
      json_out(['token' => $token, 'user' => public_user($u)]);
    }
    db()->prepare('UPDATE users SET last_login = UTC_TIMESTAMP() WHERE id = ?')->execute([$u['id']]);
    $token = jwt_issue(['sub' => $u['id'], 'email' => $u['email'], 'role' => $u['role'], 'name' => $u['display_name'], 'approved' => (int)$u['approved']]);
    json_out(['token' => $token, 'user' => public_user($u)]);
  }

  // ── SIGNUP ──
  if ($action === 'signup' && $method === 'POST') {
    $b = body();
    $email = strtolower(trim($b['email'] ?? ''));
    $pass  = (string)($b['password'] ?? '');
    $name  = trim($b['displayName'] ?? '');
    $desig = trim($b['designation'] ?? '');
    $phone = preg_replace('/\D/', '', (string)($b['phone'] ?? ''));
    if ($phone) $phone = substr($phone, -10);
    if ($email === '' || strlen($pass) < 6) fail(400, 'Valid email and 6+ char password required');
    if (find_user_by_email($email)) fail(409, 'An account with this email already exists');

    $count = (int)db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
    $isFirst = $count === 0;
    $role = $isFirst ? 'super_admin' : role_from_designation($desig);
    $designation = $isFirst ? 'Super Admin' : ($desig ?: 'Executive');
    $approved = $isFirst ? 1 : 0;

    $id = gen_id();
    $st = db()->prepare('INSERT INTO users (id,email,password_hash,display_name,phone,role,designation,approved,data,created_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())');
    $st->execute([$id, $email, password_hash($pass, PASSWORD_DEFAULT), $name, $phone, $role, $designation, $approved, json_encode(new stdClass())]);

    if ($approved) {
      $u = find_user_by_email($email);
      $token = jwt_issue(['sub' => $u['id'], 'email' => $u['email'], 'role' => $u['role'], 'name' => $u['display_name'], 'approved' => (int)$u['approved']]);
      json_out(['approved' => true, 'token' => $token, 'user' => public_user($u)]);
    }
    json_out(['approved' => false]);
  }

  // ── ME (refresh current user) ──
  if ($action === 'me' && $method === 'GET') {
    $claims = require_auth();
    $st = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $st->execute([$claims['sub']]);
    $u = $st->fetch();
    if (!$u) fail(401, 'Account not found');
    json_out(['user' => public_user($u)]);
  }

  // ── CHANGE OWN PASSWORD ──
  if ($action === 'password' && $method === 'POST') {
    $claims = require_auth();
    $b = body();
    $new = (string)($b['newPassword'] ?? '');
    if (strlen($new) < 6) fail(400, 'Password must be at least 6 characters');
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $claims['sub']]);
    json_out(['ok' => true]);
  }

  // ── SELF-SERVICE PASSWORD RESET REQUEST (routes to admins) ──
  if ($action === 'request-reset' && $method === 'POST') {
    $b = body();
    $email = strtolower(trim($b['email'] ?? ''));
    $u = $email ? find_user_by_email($email) : null;
    if ($u) {
      $admins = db()->query("SELECT display_name, email FROM users WHERE role IN ('admin','super_admin','management') AND approved = 1")->fetchAll();
      $ins = db()->prepare('INSERT INTO notifications (id, data, created_at, updated_at) VALUES (?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())');
      foreach ($admins as $a) {
        $note = [
          'forUser'  => $a['display_name'] ?: $a['email'],
          'title'    => 'Password reset requested',
          'message'  => (($u['display_name'] ?: $u['email'])) . ' requested a password reset.',
          'type'     => 'info', 'module' => 'users', 'read' => false, 'fromUser' => 'System',
        ];
        $ins->execute([gen_id(), json_encode($note, JSON_UNESCAPED_UNICODE)]);
      }
    }
    json_out(['ok' => true]); // enumeration-safe: always ok
  }

  // ── DIRECTORY (any authenticated user) — minimal fields for @mentions,
  //    assignment and admin-notification targeting. No phone/permissions leaked.
  if ($action === 'directory' && $method === 'GET') {
    require_auth();
    $rows = db()->query('SELECT id, email, display_name, role, designation, approved FROM users WHERE approved = 1')->fetchAll();
    $out = array_map(fn($r) => [
      'id' => $r['id'], 'email' => $r['email'], 'displayName' => $r['display_name'],
      'role' => $r['role'], 'designation' => $r['designation'], 'approved' => (bool)$r['approved'],
    ], $rows);
    json_out(['users' => $out]);
  }

  // ── ADMIN: user management ── /auth/users ...
  if ($action === 'users') {
    $claims = require_auth();
    if (!has_access($claims['role'], 'admin')) fail(403, 'Admins only');
    $uid = $seg[2] ?? '';

    if ($method === 'GET' && $uid === '') {
      $rows = db()->query('SELECT * FROM users ORDER BY approved ASC, created_at DESC')->fetchAll();
      json_out(['users' => array_map('public_user', $rows)]);
    }

    // Admin creates an account (e.g. the 9 role logins, or from a team member)
    if ($method === 'POST' && $uid === '') {
      $b = body();
      $email = strtolower(trim($b['email'] ?? ''));
      $pass  = (string)($b['password'] ?? '');
      if ($email === '') fail(400, 'Email required');
      if (strlen($pass) < 6) fail(400, 'Password must be at least 6 characters');
      if (find_user_by_email($email)) fail(409, 'An account with this email already exists');
      $desig = trim($b['designation'] ?? 'Executive');
      $phone = substr(preg_replace('/\D/', '', (string)($b['phone'] ?? '')), -10);
      $id = gen_id();
      db()->prepare('INSERT INTO users (id,email,password_hash,display_name,phone,role,designation,approved,data,created_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())')
        ->execute([$id, $email, password_hash($pass, PASSWORD_DEFAULT), trim($b['displayName'] ?? ''), $phone, role_from_designation($desig), $desig, array_key_exists('approved', $b) ? ($b['approved'] ? 1 : 0) : 1, json_encode(new stdClass())]);
      json_out(['ok' => true, 'id' => $id], 201);
    }

    if ($uid === '') fail(404, 'User id required');

    if ($method === 'PATCH' || $method === 'PUT') {
      $b = body();
      $fields = []; $vals = [];
      if (array_key_exists('approved', $b))    { $fields[] = 'approved = ?';    $vals[] = $b['approved'] ? 1 : 0; }
      if (array_key_exists('designation', $b)) { $fields[] = 'designation = ?'; $vals[] = trim($b['designation']); $fields[] = 'role = ?'; $vals[] = role_from_designation(trim($b['designation'])); }
      if (array_key_exists('displayName', $b)) { $fields[] = 'display_name = ?'; $vals[] = trim($b['displayName']); }
      if (array_key_exists('phone', $b))       { $fields[] = 'phone = ?';       $vals[] = substr(preg_replace('/\D/', '', (string)$b['phone']), -10); }
      if (array_key_exists('permissions', $b)) { $fields[] = 'permissions = ?'; $vals[] = json_encode($b['permissions']); }
      if (array_key_exists('password', $b) && strlen((string)$b['password']) >= 6) { $fields[] = 'password_hash = ?'; $vals[] = password_hash((string)$b['password'], PASSWORD_DEFAULT); }
      // Extra profile fields live in the data JSON column (merged, not replaced).
      $extra = [];
      foreach (['address', 'department', 'notes'] as $k) { if (array_key_exists($k, $b)) $extra[$k] = $b[$k]; }
      if ($extra) {
        $rowq = db()->prepare('SELECT data FROM users WHERE id = ?'); $rowq->execute([$uid]); $r = $rowq->fetch();
        $cur = ($r && $r['data']) ? json_decode($r['data'], true) : [];
        if (!is_array($cur)) $cur = [];
        $fields[] = 'data = ?'; $vals[] = json_encode(array_merge($cur, $extra), JSON_UNESCAPED_UNICODE);
      }
      if (!$fields) fail(400, 'No changes');
      $vals[] = $uid;
      db()->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($vals);
      json_out(['ok' => true]);
    }

    if ($method === 'DELETE') {
      db()->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
      json_out(['ok' => true]);
    }
  }

  fail(404, 'Unknown auth route');
}

// Designation → role (mirror of helpers.js getRoleFromDesignation)
function role_from_designation(string $d): string {
  static $map = [
    'Super Admin' => 'super_admin', 'Management' => 'management', 'Admin' => 'admin',
    'Operation Manager' => 'operation_manager', 'Technical Manager' => 'technical_manager',
    'Sales Manager' => 'sales_manager', 'Accountant' => 'accountant', 'BCO' => 'bco',
    'Executive' => 'executive', 'Technician' => 'technician',
    'Warehouse Admin' => 'warehouse_admin',
    // legacy aliases
    'Operations Manager' => 'operation_manager', 'Admin Manager' => 'admin',
    'Business Coordinator' => 'bco', 'Quality Coordinator' => 'operation_manager',
    'Senior Engineer' => 'technician', 'Engineer' => 'technician', 'Staff' => 'executive',
  ];
  return $map[$d] ?? 'staff';
}
