<?php
// ============================================================================
// Generic collection CRUD (mirrors the old Firestore document API) with
// server-side enforcement of the approval matrix for the sensitive workflows.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

function handle_collections(string $collection, string $id, string $method): void {
  $claims = require_auth();
  $table = collection_table($collection);
  if (!$table) fail(404, 'Unknown collection');

  $role = $claims['role'] ?? '';
  $email = $claims['email'] ?? '';

  // ── READ (list or single) ──
  if ($method === 'GET') {
    if ($id !== '') {
      $st = db()->prepare("SELECT * FROM `$table` WHERE id = ? LIMIT 1");
      $st->execute([$id]);
      $row = $st->fetch();
      if (!$row) fail(404, 'Not found');
      json_out(row_to_doc($row));
    }
    $rows = db()->query("SELECT * FROM `$table` ORDER BY created_at DESC")->fetchAll();
    json_out(array_map('row_to_doc', $rows));
  }

  // ── all writes require an approved account ──
  if (!(int)($claims['approved'] ?? 0)) fail(403, 'Account not approved');

  // ── CREATE ──
  if ($method === 'POST' && $id === '') {
    enforce_create($collection, $claims);
    $data = body();
    unset($data['id'], $data['createdAt'], $data['updatedAt']);
    // Force the correct initial status for approval-chain collections so the
    // workflow can't be bypassed by POSTing an already-advanced status (the UI
    // always starts here; this stops the raw API from skipping stages).
    $initialStatus = [
      'expenditures'   => 'Requested',
      'paymentRequests' => 'Requested',
      'leaveRequests'  => 'Awaiting Replacement',
      'leadPOs'        => 'Unapproved',
      'purchaseOrders' => 'Draft',
    ];
    if (isset($initialStatus[$collection])) {
      $data['status'] = $initialStatus[$collection];
      if ($collection === 'leaveRequests') $data['replacementStatus'] = 'Pending';
    }
    $newId = gen_id();
    $st = db()->prepare("INSERT INTO `$table` (id, data, created_at, updated_at, created_by) VALUES (?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),?)");
    $st->execute([$newId, json_encode($data, JSON_UNESCAPED_UNICODE), $email]);
    // A new in-app notification → also fire a web push to the target device(s).
    if ($collection === 'notifications') maybe_send_push($data);
    json_out(['id' => $newId] + $data, 201);
  }

  if ($id === '') fail(400, 'Document id required');

  // ── UPDATE (merge) ──
  if ($method === 'PUT' || $method === 'PATCH') {
    $st = db()->prepare("SELECT * FROM `$table` WHERE id = ? LIMIT 1");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) fail(404, 'Not found');
    $existing = $row['data'] ? json_decode($row['data'], true) : [];
    if (!is_array($existing)) $existing = [];

    $patch = body();
    unset($patch['id'], $patch['createdAt'], $patch['updatedAt']);
    enforce_status_transition($collection, $role, $patch, $existing);

    $merged = array_merge($existing, $patch);
    $st = db()->prepare("UPDATE `$table` SET data = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?");
    $st->execute([json_encode($merged, JSON_UNESCAPED_UNICODE), $email, $id]);
    $merged['id'] = $id;
    json_out($merged);
  }

  // ── DELETE (admins — plus, for gallery photos, the uploader themselves) ──
  if ($method === 'DELETE') {
    if (!has_access($role, 'admin')) {
      // A photo may only be removed by the person who uploaded it.
      if ($collection !== 'gallery') fail(403, 'Only admins can delete');
      $st = db()->prepare("SELECT created_by FROM `$table` WHERE id = ? LIMIT 1");
      $st->execute([$id]);
      $row = $st->fetch();
      if (!$row) fail(404, 'Not found');
      if ($email === '' || strcasecmp((string)$row['created_by'], $email) !== 0) {
        fail(403, 'Only the employee who uploaded this photo can delete it');
      }
    }
    db()->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$id]);
    json_out(['ok' => true]);
  }

  fail(405, 'Method not allowed');
}

// Batch read of several collections in a single request (one DB connection).
// GET /batch?names=leads,customers,...  → { leads:[…docs…], customers:[…], … }
// Unknown names are skipped silently. Read-only; same auth as a normal GET.
function handle_batch(string $method): void {
  require_auth();
  if ($method !== 'GET') fail(405, 'Method not allowed');
  $names = array_filter(array_map('trim', explode(',', (string)($_GET['names'] ?? ''))));
  $out = [];
  foreach ($names as $name) {
    if (isset($out[$name])) continue;
    $table = collection_table($name);
    if (!$table) continue;
    // One unreadable table (e.g. a collection added by a newer build before its
    // table exists) must not fail the whole batch and blank the app.
    try {
      $rows = db()->query("SELECT * FROM `$table` ORDER BY created_at DESC")->fetchAll();
      $out[$name] = array_map('row_to_doc', $rows);
    } catch (Throwable $e) {
      error_log("batch read failed for $name: " . $e->getMessage());
      $out[$name] = [];
    }
  }
  json_out($out);
}

// Who may CREATE in a given collection.
function enforce_create(string $collection, array $claims): void {
  $role = $claims['role'] ?? '';
  // A section switched off for this user (Settings -> Permission Management, or
  // the Technician role default) cannot be written to through the raw API either.
  static $moduleOf = [
    'leads' => 'leads', 'customers' => 'customers', 'installations' => 'installations',
    'ongoingWork' => 'ongoing_work', 'materials' => 'materials', 'team' => 'team',
    'purchaseOrders' => 'purchase_orders', 'leadPOs' => 'purchase_orders',
    'expenditures' => 'expenditure', 'paymentRequests' => 'payment_requests',
    'income' => 'revenue', 'expenses' => 'revenue', 'retailers' => 'retailers',
    'influencers' => 'influencers', 'employeeTasks' => 'tasks', 'gallery' => 'gallery',
    'reminders' => 'reminders', 'attendance' => 'attendance', 'tracking' => 'tracking',
    'leaveRequests' => 'leave',
  ];
  if (isset($moduleOf[$collection]) && !may_module($claims, $moduleOf[$collection])) {
    fail(403, 'You do not have access to this section');
  }
  switch ($collection) {
    case 'leadPOs':
    case 'purchaseOrders':
      // Role action + the Admin-managed per-user "New PO" permission.
      if (!may_module($claims, 'new_po')) fail(403, 'Not authorised to create purchase orders');
      break;
    case 'expenditures':
      if (!can($role, 'expenditure_request')) fail(403, 'Not authorised to raise expenditures');
      break;
    case 'paymentRequests':
      if (!can($role, 'pr_create')) fail(403, 'Not authorised to raise payment requests');
      break;
    case 'leads':
      if (!can($role, 'lead_entry')) fail(403, 'Not authorised to create leads');
      break;
    default:
      // other collections: any approved user may create (UI already restricts)
      break;
  }
}

// Enforce the approval-chain transitions server-side (can't be forged via API).
function enforce_status_transition(string $collection, string $role, array $patch, array $existing): void {
  // A patch with no `status` key is a plain field edit. For approval-chain
  // collections, lock those once the record has left its initial stage so
  // amounts/details can't be altered after review/approval (only Admin/Owner may
  // still correct them). Other collections keep the open edit model.
  if (!array_key_exists('status', $patch)) {
    static $initialOnly = ['expenditures' => 'Requested', 'paymentRequests' => 'Requested', 'leaveRequests' => 'Awaiting Replacement', 'leadPOs' => 'Unapproved', 'purchaseOrders' => 'Draft'];
    if (isset($initialOnly[$collection]) && $role !== 'super_admin' && !has_access($role, 'admin')) {
      $cur = $existing['status'] ?? $initialOnly[$collection];
      if ($cur !== $initialOnly[$collection]) fail(403, 'This record has entered its approval workflow and can no longer be edited.');
    }
    return;
  }
  $to = $patch['status'];

  if ($collection === 'leadPOs' || $collection === 'purchaseOrders') {
    if ($to === 'Recommended'          && !can($role, 'po_recommendation'))      fail(403, 'Not authorised to recommend POs');
    if ($to === 'Management Approved'  && !can($role, 'po_management_approval')) fail(403, 'Only Management can grant this approval');
    if ($to === 'Approved'             && !can($role, 'po_approval'))            fail(403, 'Not authorised to approve POs');
    // Management approval is mandatory before final approval
    if ($to === 'Approved' && ($existing['status'] ?? '') !== 'Management Approved') fail(409, 'Management approval required before approval');
  }

  // Mandatory 10% advance before a lead-sourced PO can move "to Sir" (req #4).
  // Enforced here as well as in the UI so it can't be bypassed via the raw API.
  if ($collection === 'leadPOs' && in_array($to, ['Recommended', 'Management Approved', 'Approved'], true)) {
    if (!po_advance_ok(array_merge($existing, $patch))) {
      fail(409, 'The mandatory 10% advance must be recorded on the lead before this PO can be sent for approval.');
    }
  }

  if ($collection === 'expenditures') {
    if ($to === 'Recommended' && !can($role, 'expenditure_recommendation')) fail(403, 'Not authorised to recommend');
    if ($to === 'Verified'    && !can($role, 'expenditure_verified'))       fail(403, 'Not authorised to review (Accountant)');
    if ($to === 'Approved'    && !can($role, 'expenditure_approve'))        fail(403, 'Only Management/Owner can give final approval');
    if ($to === 'Released'    && !can($role, 'payment_release'))            fail(403, 'Only the Accountant can release payment');
    // Rejection: only a chain participant may reject, and not once paid/rejected.
    if ($to === 'Rejected') {
      $r = normalize_role($role);
      $chain = ['technical_manager', 'operation_manager', 'sales_manager', 'accountant', 'management', 'admin'];
      if ($role !== 'super_admin' && !in_array($r, $chain, true)) fail(403, 'Not authorised to reject this expenditure');
      if (in_array($existing['status'] ?? '', ['Released', 'Rejected'], true)) fail(409, 'A released or already-rejected expenditure cannot be rejected.');
    }
    // Strict step-by-step ordering — a request may not skip a stage (req #12).
    $prev = ['Recommended' => 'Requested', 'Verified' => 'Recommended', 'Approved' => 'Verified', 'Released' => 'Approved'];
    if (isset($prev[$to])) {
      $from = $existing['status'] ?? 'Requested';
      if ($from !== $prev[$to]) fail(409, "Out of order: this expenditure must be '{$prev[$to]}' before it can move to '{$to}'.");
    }
  }

  // Payment requests: Team Member -> Team Leader (Recommend) -> Admin/Management/
  // Operation Manager (Main Approval) -> Accountant (Payment Transfer) ->
  // Accountant (Work Proposal / Pre-PO) -> Admin/Management/Operation Manager.
  if ($collection === 'paymentRequests') {
    $gate = [
      'Recommended'        => ['pr_recommend',        'Not authorised to recommend payment requests'],
      'Approved'           => ['pr_approve',          'Only Admin / Management / Operation Manager can give the main approval'],
      'Paid'               => ['pr_transfer',         'Only the Accountant can transfer the payment'],
      'Proposal Submitted' => ['pr_proposal',         'Only the Accountant can submit the Work Proposal / Pre-PO'],
      'Closed'             => ['pr_proposal_approve', 'Only Admin / Management / Operation Manager can close the request'],
    ];
    if (isset($gate[$to]) && !can($role, $gate[$to][0])) fail(403, $gate[$to][1]);
    // Strict step-by-step ordering - no stage can be skipped.
    $prev = ['Recommended' => 'Requested', 'Approved' => 'Recommended', 'Paid' => 'Approved', 'Proposal Submitted' => 'Paid', 'Closed' => 'Proposal Submitted'];
    if (isset($prev[$to])) {
      $from = $existing['status'] ?? 'Requested';
      if ($from !== $prev[$to]) fail(409, "Out of order: this payment request must be '{$prev[$to]}' before it can move to '{$to}'.");
    }
    if ($to === 'Rejected') {
      $stageAction = ['Requested' => 'pr_recommend', 'Recommended' => 'pr_approve', 'Approved' => 'pr_transfer', 'Paid' => 'pr_proposal', 'Proposal Submitted' => 'pr_proposal_approve'];
      $cur = $existing['status'] ?? 'Requested';
      if (in_array($cur, ['Closed', 'Rejected'], true)) fail(409, 'A closed or already-rejected payment request cannot be rejected.');
      $act = $stageAction[$cur] ?? '';
      if ($role !== 'super_admin' && !has_access($role, 'admin') && !($act && can($role, $act))) {
        fail(403, 'Only the person responsible for the current stage can reject this payment request.');
      }
    }
  }

  // Leave requests: only the Sales Manager (or Management/Admin/Owner) may
  // approve or reject; the final approval step follows replacement acceptance (req #1).
  if ($collection === 'leaveRequests') {
    if (in_array($to, ['Approved', 'Rejected'], true)) {
      $r = normalize_role($role);
      if ($role !== 'super_admin' && !in_array($r, ['sales_manager', 'management', 'admin'], true)) {
        fail(403, 'Only the Sales Manager can approve or reject leave.');
      }
      // The manager step is reachable only after the replacement has accepted.
      if ($to === 'Approved' && ($existing['status'] ?? '') !== 'Awaiting Manager') {
        fail(409, 'Leave must be accepted by the assigned replacement before the manager can approve it.');
      }
    }
  }
}

// Is the mandatory 10% advance recorded for this lead-sourced PO? Mirrors
// advanceGate() in src/services/permissions.js exactly, so the server never
// rejects anything the UI would have allowed.
function po_advance_ok(array $po): bool {
  $cost = (float)($po['agreedPrice'] ?? 0);
  if ($cost <= 0) $cost = (float)($po['totalValue'] ?? 0);
  if ($cost <= 0) return false; // unknown cost → cannot verify the advance
  $required = round($cost * 0.10);
  $leadId = (string)($po['leadId'] ?? '');
  if ($leadId === '') return false;
  $st = db()->prepare('SELECT data FROM leads WHERE id = ? LIMIT 1');
  $st->execute([$leadId]);
  $row = $st->fetch();
  if (!$row) return false;
  $lead = $row['data'] ? json_decode($row['data'], true) : [];
  if (!is_array($lead)) $lead = [];
  $paid = (($lead['advancePaid'] ?? '') === 'Yes') ? (float)($lead['advanceLeadAmount'] ?? 0) : 0.0;
  return $paid >= $required;
}

// Map a notification module to the in-app route it should open, so tapping a
// push lands the employee on the relevant screen instead of the dashboard.
// Keep in step with the routes in src/components/AppLayout.js.
function module_link(string $module): string {
  static $routes = [
    'leads' => '/leads', 'customers' => '/customers', 'employeeTasks' => '/tasks',
    'tasks' => '/tasks', 'installations' => '/installations', 'ongoingWork' => '/ongoing',
    'materials' => '/materials', 'purchaseOrders' => '/purchase-orders', 'leadPOs' => '/purchase-orders',
    'revenue' => '/revenue', 'expenditure' => '/expenditure', 'expenditures' => '/expenditure',
    'paymentRequests' => '/payment-requests', 'reports' => '/reports', 'team' => '/team',
    'attendance' => '/attendance', 'tracking' => '/tracking', 'leaveRequests' => '/leave',
    'leave' => '/leave', 'reminders' => '/reminders', 'retailers' => '/retailers',
    'influencers' => '/influencers', 'gallery' => '/gallery', 'users' => '/user-management',
  ];
  return $routes[$module] ?? '/';
}

// Send a web push for a freshly-created in-app notification. Best-effort and
// non-fatal — a push failure must never break the notification write. Returns
// immediately (no DB hit) when FCM is disabled in config.
function maybe_send_push(array $note): void {
  if (empty(cfg()['fcm']['enabled'])) return;
  try {
    require_once __DIR__ . '/../lib/fcm.php';
    $target = (string)($note['forUser'] ?? '');
    if ($target === '') return;
    $tokens = fcm_tokens_for([$target]);
    if (!$tokens) return;
    fcm_send($tokens, (string)($note['title'] ?? 'Pragathi Power CRM'), (string)($note['message'] ?? ''), [
      'module'    => (string)($note['module'] ?? ''),
      'relatedId' => (string)($note['relatedId'] ?? ''),
      // Tapping the notification opens the screen the notification is about.
      'link'      => module_link((string)($note['module'] ?? '')),
    ]);
  } catch (Throwable $e) {
    error_log('push send failed: ' . $e->getMessage());
  }
}
