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
  // The session id never leaves the server; when it was last used may.
  $session = $extra['activeSession'] ?? null;
  unset($extra['activeSession']);
  if (is_array($session) && !empty($session['id'])) {
    $extra['session'] = ['at' => $session['at'] ?? null, 'seen' => $session['seen'] ?? null, 'ua' => $session['ua'] ?? '', 'active' => session_is_active($session, time())];
  }
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
    $d = $u['data'] ? json_decode($u['data'], true) : [];
    if (!is_array($d)) $d = [];
    // Hold / deactivated (Req 5): no sign-in at all.
    $status = (string)($d['status'] ?? 'active');
    if ($status === 'hold') fail(403, 'This account is on hold. Please contact the Owner.');
    if ($status === 'deactivated') fail(403, 'This account has been deactivated. Please contact the Owner.');
    // One device at a time (Req 4).
    $device = substr(trim((string)($b['device'] ?? '')), 0, 64);
    $decision = session_login_decision($d['activeSession'] ?? null, $device, !empty($b['force']), (string)$u['role'], time());
    if (!$decision['ok']) {
      json_out(['error' => SESSION_BUSY_MESSAGE, 'code' => 'device_active', 'canForce' => !empty($decision['canForce'])], 409);
    }
    $session = session_new($device, (string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $d['activeSession'] = $session;
    db()->prepare('UPDATE users SET last_login = UTC_TIMESTAMP(), data = ? WHERE id = ?')->execute([json_encode($d, JSON_UNESCAPED_UNICODE), $u['id']]);
    if ($decision['reason'] === 'forced') audit_user_event($u, 'Signed out another device', $u['email'] . ' took the account over on a new device', $u);
    $u['data'] = json_encode($d, JSON_UNESCAPED_UNICODE);
    $token = jwt_issue(['sub' => $u['id'], 'email' => $u['email'], 'role' => $u['role'], 'name' => $u['display_name'], 'approved' => (int)$u['approved'], 'sid' => $session['id']]);
    json_out(['token' => $token, 'user' => public_user($u)]);
  }

  // ── LOGOUT: release this device's session so another may sign in ──
  if ($action === 'logout' && $method === 'POST') {
    $claims = current_user();
    if ($claims && !empty($claims['sub'])) release_session((string)$claims['sub'], (string)($claims['sid'] ?? ''));
    json_out(['ok' => true]);
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
    // A temporary password handed out by an Admin has now been replaced.
    $rowq = db()->prepare('SELECT data FROM users WHERE id = ?'); $rowq->execute([$claims['sub']]); $r = $rowq->fetch();
    $cur = ($r && $r['data']) ? json_decode($r['data'], true) : [];
    if (is_array($cur) && !empty($cur['mustChangePassword'])) {
      unset($cur['mustChangePassword']);
      db()->prepare('UPDATE users SET data = ? WHERE id = ?')->execute([json_encode($cur, JSON_UNESCAPED_UNICODE), $claims['sub']]);
    }
    audit_user_event($claims, 'Password changed', 'by the account holder', ['id' => $claims['sub'], 'email' => $claims['email'] ?? '', 'display_name' => $claims['name'] ?? '']);
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
    // `teamLeader` travels with the directory so a Team Leader's own screen can
    // show the members assigned to them. No phone, permissions or profile data.
    $rows = db()->query('SELECT id, email, display_name, role, designation, approved, data FROM users WHERE approved = 1')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
      $d = $r['data'] ? json_decode($r['data'], true) : [];
      if (!is_array($d)) $d = [];
      $status = (string)($d['status'] ?? 'active');
      if ($status === 'deactivated') continue;   // gone from every picker; their records keep their names
      $out[] = [
        'id' => $r['id'], 'email' => $r['email'], 'displayName' => $r['display_name'],
        'role' => $r['role'], 'designation' => $r['designation'], 'approved' => (bool)$r['approved'],
        'teamLeader' => !empty($d['teamLeader']) ? $d['teamLeader'] : '',
        'status' => $status, 'teamName' => (string)($d['teamName'] ?? ''),
      ];
    }
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
      if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'Enter a valid email address');
      $desig = trim($b['designation'] ?? 'Executive');
      $role = role_from_designation($desig);
      if ($role === 'super_admin' && (string)($claims['role'] ?? '') !== 'super_admin') fail(403, 'Only the Owner can create an Owner account.');
      $phone = substr(preg_replace('/\D/', '', (string)($b['phone'] ?? '')), -10);
      $name = trim($b['displayName'] ?? '');
      $data = [];
      if (!empty($b['teamLeader'])) {
        $tl = strtolower(trim((string)$b['teamLeader']));
        if ($tl === $email) fail(400, 'A person cannot report to themselves');
        if (!find_user_by_email($tl)) fail(404, 'That Team Leader has no account');
        $data['teamLeader'] = $tl;
      }
      if (!empty($b['mustChangePassword'])) $data['mustChangePassword'] = true;
      $id = gen_id();
      db()->prepare('INSERT INTO users (id,email,password_hash,display_name,phone,role,designation,approved,data,created_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())')
        ->execute([$id, $email, password_hash($pass, PASSWORD_DEFAULT), $name, $phone, $role, $desig, array_key_exists('approved', $b) ? ($b['approved'] ? 1 : 0) : 1, json_encode($data ?: new stdClass(), JSON_UNESCAPED_UNICODE)]);
      // The person appears in the Team section too (Req 5.9), once — never a
      // second record for an email the directory already has.
      if (!empty($b['addTeamRecord'])) {
        $have = false;
        foreach (db()->query('SELECT data FROM team')->fetchAll() as $tr) {
          $td = $tr['data'] ? json_decode($tr['data'], true) : [];
          if (is_array($td) && strcasecmp(trim((string)($td['email'] ?? '')), $email) === 0) { $have = true; break; }
        }
        if (!$have) {
          $trow = ['name' => $name, 'email' => $email, 'phone' => $phone, 'role' => $desig, 'status' => 'Active', 'joiningDate' => gmdate('Y-m-d'), 'attendance' => 0];
          db()->prepare('INSERT INTO team (id, data, created_at, updated_at, created_by) VALUES (?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),?)')->execute([gen_id(), json_encode($trow, JSON_UNESCAPED_UNICODE), (string)($claims['email'] ?? '')]);
        }
      }
      audit_user_event($claims, 'User created', $desig . (!empty($data['teamLeader']) ? ' under ' . $data['teamLeader'] : '') . (!empty($data['mustChangePassword']) ? '; temporary password' : ''), ['id' => $id, 'email' => $email, 'display_name' => $name]);
      json_out(['ok' => true, 'id' => $id], 201);
    }

    if ($uid === '') fail(404, 'User id required');

    if ($method === 'PATCH' || $method === 'PUT') {
      require_once __DIR__ . '/users.php';
      $b = body();
      $target = user_row($uid);
      if (!$target) fail(404, 'User not found');
      // An Admin never changes an Owner account; nobody changes their own role.
      if ((string)$target['role'] === 'super_admin' && (string)($claims['role'] ?? '') !== 'super_admin') fail(403, 'Only the Owner can change an Owner account.');
      $fields = []; $vals = []; $audit = []; $after = [];
      if (array_key_exists('approved', $b)) {
        $want = $b['approved'] ? 1 : 0;
        if ($want !== (int)$target['approved']) {
          if (!$want) guard_owner($claims, $target, 'deactivate');
          $fields[] = 'approved = ?'; $vals[] = $want; $audit[] = $want ? 'access approved' : 'access revoked';
        }
      }
      if (array_key_exists('designation', $b)) {
        $desig = trim((string)$b['designation']); $role = role_from_designation($desig);
        if ($desig !== (string)$target['designation'] || $role !== (string)$target['role']) {
          if ($role === 'super_admin' && (string)($claims['role'] ?? '') !== 'super_admin') fail(403, 'Only the Owner can make someone an Owner.');
          guard_owner($claims, $target, (string)$target['role'] === 'super_admin' && $role !== 'super_admin' ? 'demote' : 'role');
          $fields[] = 'designation = ?'; $vals[] = $desig; $fields[] = 'role = ?'; $vals[] = $role;
          $audit[] = 'role: ' . ($target['designation'] ?: $target['role']) . ' → ' . $desig;
        }
      }
      if (array_key_exists('displayName', $b)) {
        $name = trim((string)$b['displayName']);
        if ($name !== (string)$target['display_name']) {
          $fields[] = 'display_name = ?'; $vals[] = $name;
          $audit[] = 'name: ' . $target['display_name'] . ' → ' . $name;
          $after[] = fn() => cascade_name((string)$target['display_name'], $name);
        }
      }
      if (array_key_exists('email', $b)) {
        $newEmail = strtolower(trim((string)$b['email']));
        if ($newEmail !== strtolower((string)$target['email'])) {
          if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) fail(400, 'Enter a valid email address');
          if (find_user_by_email($newEmail)) fail(409, 'An account with this email already exists');
          $fields[] = 'email = ?'; $vals[] = $newEmail;
          $audit[] = 'email: ' . $target['email'] . ' → ' . $newEmail;
          $after[] = fn() => cascade_email((string)$target['email'], $newEmail);
          // The signed-in device carries the old address in its token.
          $after[] = function () use ($uid) { release_session($uid, ''); return 0; };
        }
      }
      if (array_key_exists('phone', $b)) {
        $phone = substr(preg_replace('/\D/', '', (string)$b['phone']), -10);
        if ($phone !== (string)$target['phone']) { $fields[] = 'phone = ?'; $vals[] = $phone; $audit[] = 'phone: ' . ($target['phone'] ?: '-') . ' → ' . ($phone ?: '-'); }
      }
      if (array_key_exists('permissions', $b)) {
        $fields[] = 'permissions = ?'; $vals[] = json_encode($b['permissions']);
        $old = $target['permissions'] ? json_decode($target['permissions'], true) : [];
        $new = is_array($b['permissions']) ? $b['permissions'] : [];
        $diff = [];
        foreach (array_unique(array_merge(array_keys(is_array($old) ? $old : []), array_keys($new))) as $k) {
          if (($old[$k] ?? null) !== ($new[$k] ?? null)) $diff[] = $k . '=' . (($new[$k] ?? null) === null ? 'default' : ($new[$k] ? 'on' : 'off'));
        }
        $audit[] = 'permissions: ' . ($diff ? implode(', ', $diff) : 'unchanged');
      }
      if (array_key_exists('password', $b) && strlen((string)$b['password']) >= 6) {
        $fields[] = 'password_hash = ?'; $vals[] = password_hash((string)$b['password'], PASSWORD_DEFAULT);
        $audit[] = 'password reset' . (!empty($b['mustChangePassword']) ? ' (temporary — must be changed at next sign-in)' : '');
        $after[] = function () use ($uid) { release_session($uid, ''); return 0; };
      }
      // Extra profile fields live in the data JSON column (merged, not replaced).
      $extra = [];
      foreach (['address', 'department', 'notes'] as $k) { if (array_key_exists($k, $b)) $extra[$k] = $b[$k]; }
      if ($extra) $audit[] = 'details: ' . implode(', ', array_keys($extra));
      // teamLeader is an email used as a key, so it is normalised; the free-text
      // fields above keep whatever casing the user typed.
      if (array_key_exists('teamLeader', $b)) {
        $tl = strtolower(trim((string)$b['teamLeader']));
        if ($tl !== '' && $tl === strtolower((string)$target['email'])) fail(400, 'A person cannot report to themselves');
        $extra['teamLeader'] = $tl;
        $was = strtolower(trim((string)(user_data($target)['teamLeader'] ?? '')));
        if ($was !== $tl) $audit[] = 'team: ' . ($was ?: 'none') . ' → ' . ($tl ?: 'none');
      }
      if (array_key_exists('teamName', $b)) { $extra['teamName'] = trim((string)$b['teamName']); $audit[] = 'team name: ' . $extra['teamName']; }
      if (array_key_exists('password', $b) && strlen((string)$b['password']) >= 6) {
        if (!empty($b['mustChangePassword'])) $extra['mustChangePassword'] = true; else $extra['mustChangePassword'] = null;
      }
      if ($extra) {
        $cur = user_data($target);
        $merged = array_merge($cur, $extra);
        foreach ($merged as $k => $v) { if ($v === null) unset($merged[$k]); }
        $fields[] = 'data = ?'; $vals[] = json_encode($merged, JSON_UNESCAPED_UNICODE);
      }
      // Standing (hold / deactivated / active) goes through its own path so the
      // guards and the sign-out apply.
      if (array_key_exists('status', $b)) {
        set_user_status($claims, $target, (string)$b['status'], (string)($b['statusNote'] ?? ''));
        $target = user_row($uid);
      }
      if (!$fields && !array_key_exists('status', $b)) fail(400, 'No changes');
      if ($fields) {
        $vals[] = $uid;
        db()->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($vals);
      }
      $linked = 0;
      foreach ($after as $fn) { $linked += (int)$fn(); }
      if ($audit) audit_user_event($claims, 'Account updated', implode('; ', $audit) . ($linked ? "; $linked linked record(s) updated to match" : ''), $target);
      json_out(['ok' => true, 'linked' => $linked]);
    }

    // An Admin releases the device a person can no longer reach (Req 4).
    if ($method === 'POST' && ($seg[3] ?? '') === 'release-session') {
      $rowq = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1'); $rowq->execute([$uid]); $target = $rowq->fetch();
      if (!$target) fail(404, 'User not found');
      release_session($uid, '');
      audit_user_event($claims, 'Released device session', 'so the account can sign in on another device', $target);
      json_out(['ok' => true]);
    }

    if ($method === 'DELETE') {
      require_once __DIR__ . '/users.php';
      $target = user_row($uid);
      if (!$target) fail(404, 'User not found');
      guard_owner($claims, $target, 'delete');
      audit_user_event($claims, 'Account deleted', 'the login was removed; the person\'s records keep their name', $target);
      db()->prepare('DELETE FROM fcm_tokens WHERE user_id = ?')->execute([$uid]);
      db()->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
      json_out(['ok' => true]);
    }
  }

  fail(404, 'Unknown auth route');
}

// Clear the active session on an account. With a session id, only that
// session is cleared (a stale logout from an old device never signs out the
// new one); with '' the account is released whatever device holds it.
function release_session(string $uid, string $sid): void {
  $q = db()->prepare('SELECT data FROM users WHERE id = ? LIMIT 1'); $q->execute([$uid]); $r = $q->fetch();
  if (!$r) return;
  $d = $r['data'] ? json_decode($r['data'], true) : [];
  if (!is_array($d)) $d = [];
  $cur = $d['activeSession'] ?? null;
  if (!$cur) return;
  if ($sid !== '' && (string)($cur['id'] ?? '') !== $sid) return;
  unset($d['activeSession']);
  db()->prepare('UPDATE users SET data = ? WHERE id = ?')->execute([json_encode($d, JSON_UNESCAPED_UNICODE), $uid]);
}

// The audit trail of what was done to an account, in the Activity Log
// (module "users"), by whom and when. Never a password or a token.
function audit_user_event(array $actor, string $action, string $details, ?array $target = null, array $extra = []): void {
  try {
    $who = (string)($actor['name'] ?? $actor['display_name'] ?? $actor['email'] ?? 'System');
    $t = $target ? ((string)($target['display_name'] ?? '') ?: (string)($target['email'] ?? '')) : '';
    $note = ['user' => $who, 'userEmail' => (string)($actor['email'] ?? ''), 'action' => $action, 'module' => 'users',
             'details' => trim(($t ? $t . ' — ' : '') . $details), 'timestamp' => gmdate('Y-m-d\TH:i:s\Z')] + $extra;
    if ($target && !empty($target['id'])) $note['targetId'] = (string)$target['id'];
    db()->prepare('INSERT INTO activity_log (id, data, created_at, updated_at, created_by) VALUES (?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),?)')
      ->execute([gen_id(), json_encode($note, JSON_UNESCAPED_UNICODE), (string)($actor['email'] ?? '')]);
  } catch (Throwable $e) { error_log('audit: ' . $e->getMessage()); }
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
