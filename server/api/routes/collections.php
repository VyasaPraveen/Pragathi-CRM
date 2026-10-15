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
      $doc = row_to_doc($row);
      if ($collection === 'paymentRequests' && !pr_visibility_filter($claims)($doc)) {
        fail(403, 'This payment request is not yours to view');
      }
      if ($collection === 'attendance' && !attendance_visibility_filter($claims)($doc)) {
        fail(403, 'This attendance record is not yours to view');
      }
      json_out($doc);
    }
    $rows = db()->query("SELECT * FROM `$table` ORDER BY created_at DESC")->fetchAll();
    $docs = array_map('row_to_doc', $rows);
    if ($collection === 'paymentRequests') {
      $docs = array_values(array_filter($docs, pr_visibility_filter($claims)));
    }
    if ($collection === 'attendance') {
      $docs = array_values(array_filter($docs, attendance_visibility_filter($claims)));
    }
    json_out($docs);
  }

  // ── all writes require an approved account ──
  if (!(int)($claims['approved'] ?? 0)) fail(403, 'Account not approved');

  // The stock ledger is written only through /stock, where every line is
  // made under lock and applied once. Nothing in it is edited or deleted.
  if ($collection === 'stockTransactions') {
    fail(403, 'Stock transactions are recorded through the stock workflow (receipt, review, approval, dispatch) and are never edited or deleted.');
  }

  // ── CREATE ──
  if ($method === 'POST' && $id === '') {
    enforce_create($collection, $claims);
    $data = body();
    unset($data['id'], $data['createdAt'], $data['updatedAt']);
    if ($collection === 'materials') enforce_materials_write('POST', $claims, $data, []);
    // Force the correct initial status for approval-chain collections so the
    // workflow can't be bypassed by POSTing an already-advanced status (the UI
    // always starts here; this stops the raw API from skipping stages).
    $initialStatus = [
      'expenditures'   => 'Requested',
      'paymentRequests' => 'Requested',
      'leaveRequests'  => 'Awaiting Replacement',
      'leadPOs'        => 'Unapproved',
      'purchaseOrders' => 'Draft',
      'quotations'     => 'Pending Approval',
    ];
    if (isset($initialStatus[$collection])) {
      $data['status'] = $initialStatus[$collection];
      if ($collection === 'leaveRequests') $data['replacementStatus'] = 'Pending';
    }
    // Who must recommend this payment request is decided here, from the team
    // structure on file — not from whatever the client sent. A Team Leader's own
    // request (or one from someone with no leader assigned) skips that step.
    if ($collection === 'paymentRequests') {
      // The Note is compulsory on payment requests, and on nothing else.
      if (trim((string)($data['notes'] ?? '')) === '') {
        fail(422, 'A Note is required on a payment request - say what this payment is for.');
      }
      $tl = team_leader_of($email);
      $data['teamLeaderEmail'] = $tl;
      $data['needsRecommendation'] = ($tl !== '' && $tl !== strtolower(trim($email)));
    }
    $newId = gen_id();
    $st = db()->prepare("INSERT INTO `$table` (id, data, created_at, updated_at, created_by) VALUES (?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),?)");
    $st->execute([$newId, json_encode($data, JSON_UNESCAPED_UNICODE), $email]);
    // A new in-app notification → also fire a web push to the target device(s).
    if ($collection === 'notifications') maybe_send_push($data);
    // The Owner's opening figure on a new material is the ledger's first line.
    if ($collection === 'materials' && (float)($data['balance'] ?? 0) > 0) {
      require_once __DIR__ . '/stock.php';
      stock_record_opening($newId, $data, $claims);
    }
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
    if ($collection === 'materials') enforce_materials_write('PATCH', $claims, $patch, $existing);
    if ($collection === 'leads') enforce_lead_edit($claims, $patch, $existing + ['createdBy' => $existing['createdBy'] ?? (string)($row['created_by'] ?? '')]);
    enforce_status_transition($collection, $role, $patch, $existing, $email);

    $merged = array_merge($existing, $patch);
    $st = db()->prepare("UPDATE `$table` SET data = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?");
    $st->execute([json_encode($merged, JSON_UNESCAPED_UNICODE), $email, $id]);
    $merged['id'] = $id;
    json_out($merged);
  }

  // ── DELETE (admins — plus, for gallery photos, the uploader themselves) ──
  if ($method === 'DELETE') {
    // A material with a history keeps it: deleting the row would orphan the
    // receipts and dispatches recorded against it.
    if ($collection === 'materials' && material_has_ledger($id)) {
      fail(409, 'This material has stock transactions recorded against it and cannot be deleted. Correct its figures with a stock adjustment instead.');
    }
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
  $claims = require_auth();
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
      $docs = array_map('row_to_doc', $rows);
      if ($name === 'paymentRequests') {
        $docs = array_values(array_filter($docs, pr_visibility_filter($claims)));
      }
      if ($name === 'attendance') {
        $docs = array_values(array_filter($docs, attendance_visibility_filter($claims)));
      }
      $out[$name] = $docs;
    } catch (Throwable $e) {
      error_log("batch read failed for $name: " . $e->getMessage());
      $out[$name] = [];
    }
  }
  json_out($out);
}

// A payment request names an amount and a reason and belongs to the people who
// have a part in it: whoever raised it, their Team Leader, the authorities who
// approve it and the Accountant who pays it. Mirrors canSeePaymentRequest() in
// src/services/permissions.js.
//
// Returns a test to apply to each row. The members reporting to this viewer are
// looked up once here rather than per row, because this runs on the batch read
// that every client repeats every 15 seconds.
function pr_visibility_filter(array $claims): callable {
  $role  = $claims['role'] ?? '';
  $email = strtolower(trim((string)($claims['email'] ?? '')));
  $all = $role === 'super_admin'
      || has_access($role, 'admin')
      || in_array(normalize_role($role), ['operation_manager', 'management', 'accountant'], true);

  $members = [];
  if (!$all && $email !== '') {
    try {
      foreach (db()->query('SELECT email, data FROM users') as $r) {
        $d = $r['data'] ? json_decode($r['data'], true) : [];
        if (is_array($d) && strtolower(trim((string)($d['teamLeader'] ?? ''))) === $email) {
          $members[strtolower(trim((string)$r['email']))] = true;
        }
      }
    } catch (Throwable $e) {
      error_log('pr visibility: could not read the team structure: ' . $e->getMessage());
    }
  }

  return function (array $doc) use ($all, $email, $members): bool {
    if ($all) return true;
    if ($email === '') return false;
    $by = strtolower(trim((string)($doc['requestedBy'] ?? '')));
    if ($by !== '' && $by === $email) return true;              // I raised it
    $tl = strtolower(trim((string)($doc['teamLeaderEmail'] ?? '')));
    if ($tl !== '' && $tl === $email) return true;              // named as its leader
    return $by !== '' && isset($members[$by]);                  // I lead whoever raised it
  };
}

// Attendance is seen by the person it belongs to, by their Team Leader, and by
// the higher authorities - Owner, Management, Admin, Operation Manager (R4,
// 8-Oct; narrowed from "manager level and above" on 9-Oct, RR2, so a Sales or
// Technical Manager who leads a team sees that team and not every other). The screens always filtered
// this way; now the API does too, so one member can never fetch another's
// marks. Mirrors the view rules in src/pages/Attendance.js and
// TeamAttendancePanel.js, and isMine() in src/services/attendance.js: a row
// that carries an email is matched by email, an older row by name.
function attendance_visibility_filter(array $claims): callable {
  $role  = $claims['role'] ?? '';
  $email = strtolower(trim((string)($claims['email'] ?? '')));
  $name  = strtolower(trim((string)($claims['name'] ?? '')));
  $all = $role === 'super_admin' || in_array(normalize_role($role), ['management', 'admin', 'operation_manager'], true);

  $memberEmails = []; $memberNames = [];
  if (!$all && $email !== '') {
    try {
      foreach (db()->query('SELECT email, display_name, data FROM users') as $r) {
        $rowEmail = strtolower(trim((string)$r['email']));
        if ($name === '' && $rowEmail === $email) $name = strtolower(trim((string)($r['display_name'] ?? '')));
        $d = $r['data'] ? json_decode($r['data'], true) : [];
        if (is_array($d) && strtolower(trim((string)($d['teamLeader'] ?? ''))) === $email) {
          $memberEmails[$rowEmail] = true;
          $n = strtolower(trim((string)($r['display_name'] ?? '')));
          if ($n !== '') $memberNames[$n] = true;
        }
      }
    } catch (Throwable $e) {
      error_log('attendance visibility: could not read the team structure: ' . $e->getMessage());
    }
  }

  return function (array $doc) use ($all, $email, $name, $memberEmails, $memberNames): bool {
    if ($all) return true;
    if ($email === '') return false;
    $re = strtolower(trim((string)($doc['employeeEmail'] ?? '')));
    $rn = strtolower(trim((string)($doc['employeeName'] ?? '')));
    if ($re !== '') return $re === $email || isset($memberEmails[$re]);   // my own, or my member's
    if ($rn === '') return false;
    return ($name !== '' && $rn === $name) || isset($memberNames[$rn]);   // an older row, by name
  };
}

// A Team Leader's recommendation on a leave request is an opinion for the
// approver, not a stage of the workflow: it never changes the status, and the
// Sales Manager can approve with or without it. These are the only fields it
// may touch.
function leave_recommendation_only(array $patch): bool {
  if (!$patch) return false;
  $allowed = ['recommendedBy', 'recommendedByName', 'recommendedDate', 'recommendNote'];
  return count(array_diff(array_keys($patch), $allowed)) === 0;
}

// ── Materials: the figures are the ledger's to change (10-Oct) ──────────────
//
// A material's stock, dispatched and balance figures used to be typed into
// the Add / Edit form by anyone at manager level. Now they move only through
// routes/stock.php — a receipt the Owner has approved, a correction the Owner
// has approved or made, or the final dispatch — each recorded as a
// transaction. So here: a new material is created with its figures at zero
// unless the Owner is creating it with an opening figure (recorded as the
// ledger's first line); an edit may change the name, unit and category, and
// a figure that is sent back unchanged is simply dropped from the patch; a
// figure that differs is refused for everybody, Owner included — the Owner
// corrects stock through an adjustment, with the reason on record.
// `installed` is informational (it is not part of the balance) and stays the
// Owner's to set directly. Mirrors MATERIAL_FIGURE_FIELDS in stock.js.
const MATERIAL_FIGURE_FIELDS = ['stock', 'dispatched', 'balance'];

function enforce_materials_write(string $method, array $claims, array &$data, array $existing): void {
  $role = (string)($claims['role'] ?? '');
  $owner = $role === 'super_admin';
  $num = fn($v) => is_numeric($v) ? round((float)$v, 3) : 0.0;

  if ($method === 'POST') {
    $name = trim((string)($data['name'] ?? ''));
    if ($name === '') fail(422, 'A material needs a name.');
    if (material_name_taken($name, '')) fail(409, "A material called \"$name\" already exists. Receive stock against it rather than adding it again.");
    if ($owner) {
      // The Owner may open a material with stock in hand: stock = balance.
      $opening = $num($data['openingStock'] ?? ($data['stock'] ?? ($data['balance'] ?? 0)));
      if ($opening < 0) fail(422, 'The opening stock cannot be negative.');
      $data['stock'] = $opening; $data['balance'] = $opening; $data['openingStock'] = $opening;
      $data['dispatched'] = 0;
      $data['installed'] = $num($data['installed'] ?? 0);
    } else {
      foreach (['stock', 'dispatched', 'balance', 'openingStock'] as $k) {
        if ($num($data[$k] ?? 0) != 0.0) fail(403, 'A material starts at zero stock; its figures change only through a stock receipt approved by the Owner. Record a receipt once the material is added.');
        $data[$k] = 0;
      }
      $data['installed'] = 0;
    }
    return;
  }

  // PATCH
  if (array_key_exists('name', $data)) {
    $name = trim((string)$data['name']);
    if ($name === '') fail(422, 'A material needs a name.');
    if ($name !== trim((string)($existing['name'] ?? '')) && material_name_taken($name, (string)($existing['id'] ?? ''))) {
      fail(409, "A material called \"$name\" already exists.");
    }
  }
  foreach (MATERIAL_FIGURE_FIELDS as $k) {
    if (!array_key_exists($k, $data)) continue;
    if (abs($num($data[$k]) - $num($existing[$k] ?? 0)) < 1e-9) { unset($data[$k]); continue; }   // unchanged — resent by the form
    fail(403, 'Stock figures are not edited here. Receive stock, record a dispatch, or ' . ($owner ? 'make a stock correction with its reason.' : 'report a discrepancy for the Owner to approve.'));
  }
  if (array_key_exists('openingStock', $data)) unset($data['openingStock']);
  if (array_key_exists('installed', $data) && !$owner && abs($num($data['installed']) - $num($existing['installed'] ?? 0)) >= 1e-9) {
    fail(403, 'Only the Owner can change the installed figure.');
  }
  foreach (['lastStockChangeAt', 'lastStockChangeBy', 'lastStockChangeRef'] as $k) unset($data[$k]);
}

// Is this name (ignoring case, spaces and punctuation) already a material?
function material_name_taken(string $name, string $exceptId): bool {
  $squash = fn($s) => preg_replace('/[^a-z0-9]/', '', strtolower($s));
  $want = $squash($name);
  if ($want === '') return false;
  try {
    foreach (db()->query('SELECT id, data FROM materials') as $r) {
      if ((string)$r['id'] === $exceptId) continue;
      $d = $r['data'] ? json_decode((string)$r['data'], true) : [];
      if (is_array($d) && $squash((string)($d['name'] ?? '')) === $want) return true;
    }
  } catch (Throwable $e) { error_log('materials: name check failed: ' . $e->getMessage()); }
  return false;
}

function material_has_ledger(string $materialId): bool {
  if ($materialId === '') return false;
  try {
    foreach (db()->query('SELECT data FROM stock_transactions') as $r) {
      $d = $r['data'] ? json_decode((string)$r['data'], true) : [];
      if (is_array($d) && (string)($d['materialId'] ?? '') === $materialId) return true;
    }
  } catch (Throwable $e) { /* no ledger table yet: nothing recorded */ }
  return false;
}

// ── Leads: who may change one (Req 2 and Req 4, 15-Oct) ────────────────────
//
// Seeing a lead and editing it are two different things. The details may be
// changed by the authorities (Owner, Management, Operation Manager, Admin),
// by the person the lead is assigned to, by whoever created it, and by its
// Team Leader (named on the lead, or the leader of the assignee in the team
// structure). The BCO and the Warehouse Admin only look; a Technician may
// create a lead but never edit one, their own included. The stamps the
// quotation and follow-up flows write onto a lead are not detail edits and
// stay open to anyone who may work those flows. Mirrors canEditLead() in
// src/services/permissions.js.
const LEAD_EDIT_AUTHORITIES = ['management', 'admin', 'operation_manager'];
const LEAD_VIEW_ONLY_ROLES = ['bco', 'warehouse_admin', 'technician'];
const LEAD_FLOW_KEYS = ['quotationSent', 'quotationAccepted', 'pendingFollowUp', 'followUpStatus', 'notAcceptedReason', 'nextFollowUpDate'];

function lead_editor(array $claims, array $lead): bool {
  $role = (string)($claims['role'] ?? '');
  if ($role === 'super_admin') return true;
  $r = normalize_role($role);
  if (in_array($r, LEAD_EDIT_AUTHORITIES, true)) return true;
  if (in_array($r, LEAD_VIEW_ONLY_ROLES, true)) return false;
  $me = strtolower(trim((string)($claims['email'] ?? '')));
  if ($me === '') return false;
  $myName = strtolower(trim((string)($claims['name'] ?? '')));
  if ($myName === '') $myName = strtolower(display_name_of($me));
  foreach (['assignedTo', 'salesExecutive', 'teamLeader', 'createdBy', 'assignedToEmail'] as $k) {
    $v = strtolower(trim((string)($lead[$k] ?? '')));
    if ($v !== '' && ($v === $me || ($myName !== '' && $v === $myName))) return true;
  }
  $tl = lead_team_leader_from($lead);
  return $tl !== '' && $tl === $me;
}
function lead_flow_patch(array $patch): bool {
  return count($patch) > 0 && count(array_diff(array_keys($patch), LEAD_FLOW_KEYS)) === 0;
}
function enforce_lead_edit(array $claims, array $patch, array $lead): void {
  if (!$patch || lead_editor($claims, $lead)) return;
  $r = normalize_role((string)($claims['role'] ?? ''));
  if ($r === 'technician') fail(403, 'A Technician can submit a lead but cannot edit it afterwards; the Team Leader or the assigned person takes it from there.');
  if (in_array($r, LEAD_VIEW_ONLY_ROLES, true)) fail(403, 'This lead is view-only for your role. Its details are edited by the assigned person, their Team Leader, the Operation Manager or an Admin.');
  if (lead_flow_patch($patch)) return;   // a quotation / follow-up stamp by someone working that flow
  fail(403, 'Only the person this lead is assigned to, its creator, their Team Leader, the Operation Manager or an Admin can edit it.');
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
    'leaveRequests' => 'leave', 'quotations' => 'leads',
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
    case 'quotations':
      // A quotation is raised from a lead, by whoever may work that lead.
      if (!can($role, 'lead_entry')) fail(403, 'Not authorised to create leads');
      break;
    case 'bcoOps':
      if (!bco_ops_editor($role)) fail(403, 'Only the BCO, the Operation Manager or an Admin can record BCO operations');
      break;
    default:
      // other collections: any approved user may create (UI already restricts)
      break;
  }
}

// Enforce the approval-chain transitions server-side (can't be forged via API).
// The Team Leader of whoever a lead is assigned to, or '' if there is no
// lead, no assignee, or no leader. Two small lookups, done only when a PO
// recommendation is actually being attempted.
// Patches the system makes to a quotation that are not edits to the quoted
// figures: the BOM carried over from the confirmed purchase order, the Team
// Leader's recommendation, and the customer's acceptance proof. These are
// allowed whatever stage the quotation has reached.
function quotation_system_patch(array $patch): bool {
  static $allowed = [
    'bomItems', 'bomSource', 'poId', 'poIds',
    'recommendedBy', 'recommendedByName', 'recommendedAt', 'recommendNote',
    'acceptanceProofUrl', 'acceptanceProofName', 'acceptanceProofAt',
    'acceptanceProofBy', 'acceptanceProofByName',
  ];
  if (!$patch) return false;
  foreach (array_keys($patch) as $k) {
    if (!in_array($k, $allowed, true)) return false;
  }
  return true;
}

// Who may record the BCO operations on a lead: the BCO, with the Operation
// Manager, Admin, Management and the Owner able to edit as well.
function bco_ops_editor(string $role): bool {
  if ($role === 'super_admin' || has_access($role, 'admin')) return true;
  return in_array(normalize_role($role), ['bco', 'operation_manager'], true);
}

// The fields the warehouse writes when dispatching an approved purchase
// order. They are the only fields that may change on a PO after approval, and
// only the warehouse side (or the office standing in for it) may change them.
const PO_DISPATCH_FIELDS = [
  'dispatchItems', 'dispatchStatus', 'dispatchUpdatedAt', 'dispatchUpdatedBy',
  'dispatchCompletedAt', 'dispatchCompletedBy', 'dispatchNote',
];
const PO_DISPATCH_CONFIRM_FIELDS = ['dispatchConfirmedAt', 'dispatchConfirmedBy', 'dispatchConfirmNote'];
// The handover (R6, 8-Oct): the Operation Manager assigns the sent items to
// a person, and that person records receipt. An assignment also resets the
// receipt fields, so they appear in both lists; which step a patch is, is
// decided by whether it names an assignee.
const PO_DISPATCH_ASSIGN_FIELDS = [
  'dispatchAssignedTo', 'dispatchAssignedToEmail', 'dispatchAssignedBy', 'dispatchAssignedAt', 'dispatchAssignNote',
  'dispatchReceivedBy', 'dispatchReceivedAt', 'dispatchReceivedNote', 'handoverItems',
];
// Req 3 (15-Oct): the first handover checks every item (Yes / No + note); the
// second — delivery at the customer's location — checks them again, with
// photographs as proof. Each is written once, by the assigned person.
const PO_DISPATCH_RECEIVE_FIELDS = ['dispatchReceivedBy', 'dispatchReceivedAt', 'dispatchReceivedNote', 'handoverItems'];
const PO_DELIVERY_FIELDS = ['deliveryItems', 'deliveryPhotos', 'deliveredBy', 'deliveredByEmail', 'deliveredAt', 'deliveryNote', 'deliveryLocation'];
function po_dispatch_delivering(array $patch): bool {
  return count($patch) > 0 && count(array_diff(array_keys($patch), PO_DELIVERY_FIELDS)) === 0;
}

function po_dispatch_patch(array $patch): bool {
  if (!$patch) return false;
  foreach (array_keys($patch) as $k) {
    if (!in_array($k, PO_DISPATCH_FIELDS, true) && !in_array($k, PO_DISPATCH_CONFIRM_FIELDS, true)
        && !in_array($k, PO_DISPATCH_ASSIGN_FIELDS, true) && !in_array($k, PO_DELIVERY_FIELDS, true)) return false;
  }
  return true;
}
function po_dispatch_editor(string $role): bool {
  if ($role === 'super_admin' || has_access($role, 'admin')) return true;
  // "Warehouse / BCO" in the client's words (8-Oct): the BCO dispatches too.
  return in_array(normalize_role($role), ['warehouse_admin', 'technical_manager', 'bco', 'operation_manager'], true);
}
// Is this patch the handover's assignment step, or its receipt step?
function po_dispatch_assigning(array $patch): bool {
  return count(array_intersect(array_keys($patch), ['dispatchAssignedTo', 'dispatchAssignedToEmail', 'dispatchAssignedBy', 'dispatchAssignedAt', 'dispatchAssignNote'])) > 0;
}
function po_dispatch_receiving(array $patch): bool {
  return count($patch) > 0 && count(array_diff(array_keys($patch), PO_DISPATCH_RECEIVE_FIELDS)) === 0;
}
function po_dispatch_confirmer(string $role): bool {
  if ($role === 'super_admin' || has_access($role, 'admin')) return true;
  return normalize_role($role) === 'operation_manager';
}

function lead_team_leader(string $leadId): string {
  if ($leadId === '') return '';
  try {
    $st = db()->prepare('SELECT data FROM `leads` WHERE id = ? LIMIT 1');
    $st->execute([$leadId]);
    $row = $st->fetch();
    if (!$row) return '';
    $lead = json_decode((string)$row['data'], true);
    if (!is_array($lead)) return '';
    return lead_team_leader_from($lead);
  } catch (Throwable $e) {
    return '';
  }
}
function lead_team_leader_from(array $lead): string {
  try {
    $owner = trim((string)($lead['assignedTo'] ?? ($lead['salesExecutive'] ?? '')));
    if ($owner === '') return '';
    // The lead stores a display name; the team structure is keyed by email.
    $us = db()->prepare('SELECT email FROM `users` WHERE LOWER(display_name) = ? OR LOWER(email) = ? LIMIT 1');
    $us->execute([strtolower($owner), strtolower($owner)]);
    $u = $us->fetch();
    if (!$u) return '';
    return team_leader_of((string)$u['email']);
  } catch (Throwable $e) {
    return '';
  }
}

// $patch is taken by reference: a rule may stamp the record (the below-Rs.1,000
// direct payment does) and the stamp has to reach what is stored.
function enforce_status_transition(string $collection, string $role, array &$patch, array $existing, string $email = ''): void {
  // ── Quotations: the revision ladder is enforced here, not in the browser ──
  // The main number never changes; revisions run R1 → R3, one step at a time,
  // and anything past R3 needs an Admin's approval recorded on the quotation.
  if ($collection === 'quotations') {
    if (array_key_exists('extraRevisionApprovedBy', $patch) && !can($role, 'quotation_revision_override')) {
      fail(403, 'Only an Admin can approve a further revision after R3.');
    }
    if (array_key_exists('revision', $patch)) {
      $newRev = (int)$patch['revision'];
      $curRev = (int)($existing['revision'] ?? 0);
      if ($newRev !== $curRev && $newRev !== $curRev + 1) {
        fail(409, 'A quotation revision moves one step at a time (R' . ($curRev + 1) . ' is next).');
      }
      $approvedExtra = !empty($patch['extraRevisionApprovedBy']) || !empty($existing['extraRevisionApprovedBy']);
      if ($newRev > 3 && !$approvedExtra) {
        fail(409, 'R3 is the last revision allowed without Admin approval for a further revision.');
      }
    }
    if (array_key_exists('quotationNumber', $patch) && ($existing['quotationNumber'] ?? '') !== ''
        && $patch['quotationNumber'] !== $existing['quotationNumber']) {
      fail(409, 'The quotation number stays the same across revisions.');
    }
    // A recommendation is one person's own endorsement, so it is checked here
    // and not only in the browser — the same rule the leave request and the
    // purchase order recommendations already follow. Checked ahead of the
    // status rules below so it cannot be slipped in beside a status change.
    // Clearing one, which an edit does, and re-sending the one already on the
    // record are both left alone; only newly recording one is checked.
    if (array_key_exists('recommendedBy', $patch)) {
      $newRec = strtolower(trim((string)($patch['recommendedBy'] ?? '')));
      $curRec = strtolower(trim((string)($existing['recommendedBy'] ?? '')));
      if ($newRec !== '' && $newRec !== $curRec) {
        $me = strtolower(trim($email));
        if ($me === '' || $newRec !== $me) fail(403, 'A recommendation has to be recorded in your own name.');
        if (!can($role, 'quotation_approve') && !has_access($role, 'admin') && $role !== 'super_admin') {
          $tl = lead_team_leader((string)($existing['leadId'] ?? ''));
          if ($tl === '' || $tl !== $me) {
            fail(403, 'Only this lead\'s Team Leader, the Operation Manager or an Admin can recommend this quotation.');
          }
        }
      }
    }
  }

  // A patch with no `status` key is a plain field edit. For approval-chain
  // collections, lock those once the record has left its initial stage so
  // amounts/details can't be altered after review/approval (only Admin/Owner may
  // still correct them). Other collections keep the open edit model.
  if (!array_key_exists('status', $patch)) {
    if ($collection === 'leaveRequests' && leave_recommendation_only($patch)) {
      $applicant = strtolower(trim((string)($existing['employeeEmail'] ?? '')));
      $me = strtolower(trim($email));
      if ($me !== '' && $me === $applicant) fail(403, 'You cannot recommend your own leave.');
      // Admin and above may always record one, and asking the database who
      // leads whom is only worth doing for everybody else.
      if ($role === 'super_admin' || has_access($role, 'admin')) return;
      $tl = $applicant === '' ? '' : team_leader_of($applicant);
      if ($tl === '' || $tl !== $me) {
        fail(403, 'Only this employee\'s Team Leader can recommend their leave.');
      }
      return;
    }
    // A quotation may be corrected while it is still awaiting approval, or
    // once it has come back Rejected or Not Accepted. Approved, Shared and
    // Accepted are fixed. The system's own patches below are exempt.
    if ($collection === 'quotations' && !quotation_system_patch($patch)
        && $role !== 'super_admin' && !has_access($role, 'admin')) {
      $cur = (string)($existing['status'] ?? 'Pending Approval');
      if (!in_array($cur, ['Pending Approval', 'Rejected', 'Not Accepted'], true)) {
        fail(403, 'This quotation has been approved and can no longer be edited. Create a revision instead.');
      }
    }

    // A purchase order may be corrected right up to final approval — that is
    // the point at which it becomes an order. It used to lock as soon as it
    // was recommended, which left no way to fix a PO that came back for a
    // change without an Admin doing it.
    static $lockedAt = ['expenditures' => 'Requested', 'paymentRequests' => 'Requested', 'leaveRequests' => 'Awaiting Replacement', 'purchaseOrders' => 'Draft'];
    // The warehouse dispatch is written onto the approved PO, and is the one
    // thing that may change on it after approval. It is open only once the PO
    // is Approved, only to the warehouse side, and the confirmation only to
    // the Operation Manager and above. Once confirmed it is fixed.
    // The final-dispatch stamps are written by /stock/dispatch alone, when
    // the stock actually comes off; they are not something a patch may set.
    if ($collection === 'leadPOs') {
      foreach (array_keys($patch) as $k) {
        if (strncmp((string)$k, 'stockDispatch', 13) === 0) {
          fail(403, 'The final dispatch is recorded through "Confirm Final Dispatch", which deducts the stock; it cannot be set by hand.');
        }
      }
    }
    if ($collection === 'leadPOs' && po_dispatch_patch($patch)) {
      if (($existing['status'] ?? 'Unapproved') !== 'Approved') {
        fail(409, 'Material can be dispatched only once the purchase order is approved.');
      }
      $confirming = count(array_intersect(array_keys($patch), PO_DISPATCH_CONFIRM_FIELDS)) > 0;
      $isAdmin = $role === 'super_admin' || has_access($role, 'admin');
      // The handover: assignment by the Operation Manager (or above), receipt
      // by the named person — each only once the warehouse has sent the list.
      if (po_dispatch_assigning($patch)) {
        if (!po_dispatch_confirmer($role)) fail(403, 'Only the Operation Manager or an Admin can assign dispatched items.');
        if (($existing['dispatchStatus'] ?? '') !== 'Completed') fail(409, 'The warehouse has not sent this dispatch yet (OK & Send).');
        if (!empty($existing['dispatchReceivedAt']) && !$isAdmin) fail(409, 'These items have already been received; the assignment can no longer be changed.');
        if (count(array_diff(array_keys($patch), PO_DISPATCH_ASSIGN_FIELDS)) > 0) fail(403, 'An assignment may only set the assignment fields.');
        return;
      }
      if (po_dispatch_delivering($patch)) {
        if (($existing['dispatchStatus'] ?? '') !== 'Completed') fail(409, 'The warehouse has not sent this dispatch yet.');
        if (empty($existing['dispatchAssignedTo'])) fail(409, 'These items have not been assigned to anyone yet.');
        if (empty($existing['dispatchReceivedAt'])) fail(409, 'Confirm the handover from the warehouse ("Handover Received") before recording the delivery.');
        $me = strtolower(trim($email));
        $assignedEmail = strtolower(trim((string)($existing['dispatchAssignedToEmail'] ?? '')));
        $assignedName = strtolower(trim((string)($existing['dispatchAssignedTo'] ?? '')));
        $isAssignee = ($assignedEmail !== '' && $assignedEmail === $me)
          || ($assignedName !== '' && $me !== '' && $assignedName === strtolower(display_name_of($email)));
        if (!$isAssignee && !$isAdmin) fail(403, 'Only the person the items were assigned to can confirm the delivery at the customer location.');
        if (!empty($existing['deliveredAt']) && !$isAdmin) fail(409, 'The delivery has already been confirmed for this purchase order.');
        if (array_key_exists('deliveredAt', $patch) && !empty($patch['deliveredAt'])) {
          $photos = $patch['deliveryPhotos'] ?? ($existing['deliveryPhotos'] ?? []);
          $photos = is_array($photos) ? array_filter($photos, fn($p) => is_array($p) && trim((string)($p['url'] ?? '')) !== '') : [];
          if (!$photos) fail(422, 'Upload at least one photograph of the delivered material as proof before confirming the delivery.');
          $items = $patch['deliveryItems'] ?? ($existing['deliveryItems'] ?? null);
          if (!is_array($items) || !$items) fail(422, 'Mark each delivered item Yes or No before confirming the delivery.');
        }
        return;
      }
      if (po_dispatch_receiving($patch)) {
        if (($existing['dispatchStatus'] ?? '') !== 'Completed') fail(409, 'The warehouse has not sent this dispatch yet.');
        if (empty($existing['dispatchAssignedTo'])) fail(409, 'These items have not been assigned to anyone yet.');
        $me = strtolower(trim($email));
        $assignedEmail = strtolower(trim((string)($existing['dispatchAssignedToEmail'] ?? '')));
        $assignedName = strtolower(trim((string)($existing['dispatchAssignedTo'] ?? '')));
        $isAssignee = ($assignedEmail !== '' && $assignedEmail === $me)
          || ($assignedName !== '' && $me !== '' && $assignedName === strtolower(display_name_of($email)));
        if (!$isAssignee && !$isAdmin) fail(403, 'Only the person the items were assigned to can confirm receipt.');
        if (!empty($existing['dispatchReceivedAt']) && !$isAdmin) fail(409, 'Receipt has already been recorded for these items.');
        return;
      }
      if ($confirming) {
        if (!po_dispatch_confirmer($role)) fail(403, 'Only the Operation Manager or an Admin can confirm a dispatch.');
        if (($existing['dispatchStatus'] ?? '') !== 'Completed') fail(409, 'The warehouse has not marked this dispatch complete yet.');
      } else {
        if (!po_dispatch_editor($role)) fail(403, 'Only the warehouse can record a dispatch.');
        if (!empty($existing['dispatchConfirmedAt']) && $role !== 'super_admin' && !has_access($role, 'admin')) {
          fail(409, 'This dispatch has been confirmed and can no longer be changed.');
        }
        // Req 3 (15-Oct): "Stock OK" locks the warehouse's own entry. Until the
        // confirmation only the Operation Manager (or an Admin) may correct it.
        if (($existing['dispatchStatus'] ?? '') === 'Completed' && !po_dispatch_confirmer($role)) {
          fail(409, 'Stock OK has been submitted for this purchase order; the warehouse can no longer change the material verification. The Operation Manager can correct it if needed.');
        }
      }
      return;
    }
    if ($collection === 'leadPOs' && $role !== 'super_admin' && !has_access($role, 'admin')) {
      if (($existing['status'] ?? 'Unapproved') === 'Approved') {
        fail(403, 'This purchase order has been approved and can no longer be edited.');
      }
    }
    // The BCO operations record is the BCO's own; the authorities may edit it.
    if ($collection === 'bcoOps' && !bco_ops_editor($role)) {
      fail(403, 'Only the BCO, the Operation Manager or an Admin can update BCO operations.');
    }
    if (isset($lockedAt[$collection]) && $role !== 'super_admin' && !has_access($role, 'admin')) {
      $cur = $existing['status'] ?? $lockedAt[$collection];
      if ($cur !== $lockedAt[$collection]) fail(403, 'This record has entered its approval workflow and can no longer be edited.');
    }
    return;
  }
  $to = $patch['status'];

  if ($collection === 'leadPOs' || $collection === 'purchaseOrders') {
    if ($to === 'Recommended' && !can($role, 'po_recommendation')) {
      // The Team Leader of the person the lead is assigned to may recommend it
      // as well as the roles that always could. Looked up only here, because
      // this is the one step that needs to know.
      $tl = lead_team_leader((string)($existing['leadId'] ?? ''));
      if ($tl === '' || $tl !== strtolower(trim($email))) {
        fail(403, 'Only this lead\'s Team Leader, the Operation Manager or an Admin can recommend this PO');
      }
    }
    if ($to === 'Management Approved'  && !can($role, 'po_management_approval')) fail(403, 'Only Management can grant this approval');
    if ($to === 'Approved'             && !can($role, 'po_approval'))            fail(403, 'Not authorised to approve POs');
    // Nothing in the app moves a PO backwards; if one ever has to be reopened
    // it is the approvers' call, not something the API lets anyone do.
    if ($to === 'Unapproved' && ($existing['status'] ?? 'Unapproved') !== 'Unapproved'
        && $role !== 'super_admin' && !has_access($role, 'admin') && !can($role, 'po_approval')) {
      fail(403, 'Only an Admin or Management can reopen an approved purchase order');
    }
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
    $me = strtolower(trim($email));
    $requester = strtolower(trim((string)($existing['requestedBy'] ?? '')));
    $needsRec = ($existing['needsRecommendation'] ?? true) !== false;


    // A requester may never move their own request along.
    if ($requester !== '' && $requester === $me && $to !== 'Rejected') {
      fail(403, 'You cannot recommend or approve your own payment request.');
    }

    // Nothing advances without a Note saying what the money is for. A request
    // raised before the Note was compulsory can still be rejected; it just
    // cannot be recommended, approved or paid until one is written.
    // The note being written in the same request as the approval counts too,
    // so adding one and approving in a single call is not refused.
    $prNote = array_key_exists('notes', $patch) ? (string)$patch['notes'] : (string)($existing['notes'] ?? '');
    if ($to !== 'Rejected' && trim($prNote) === '') {
      fail(422, 'This payment request has no Note. Add one saying what the payment is for before it can be ' . strtolower($to) . '.');
    }

    if ($to === 'Recommended') {
      if (!$needsRec) fail(409, 'This request does not need a Team Leader recommendation.');
      // Their own Team Leader recommends. A Team Leader has no say over another
      // leader's members, so only the stand-in managers may cover.
      // The leader stamped on the request, or — for older requests raised
      // before their member had one — whoever leads them today. Looked up only
      // here, because this is the only step that needs to know.
      $prLeader = strtolower(trim((string)($existing['teamLeaderEmail'] ?? '')));
      if ($prLeader === '' && $requester !== '') $prLeader = team_leader_of($requester);
      if (!($prLeader !== '' && $prLeader === $me)) {
        if (normalize_role($role) === 'team_leader') fail(403, 'You can only recommend requests from your own team members');
        if (!can($role, 'pr_recommend')) fail(403, 'Only the Team Leader of this team member can recommend this request');
      }
    }
    $gate = [
      'Approved'           => ['pr_approve',          'Only Operation Manager / Management / Admin / Owner can give the final approval'],
      'Paid'               => ['pr_transfer',         'Only the Accountant can transfer the payment'],
      'Proposal Submitted' => ['pr_proposal',         'Only the Accountant can submit the Work Proposal / Pre-PO'],
      'Closed'             => ['pr_proposal_approve', 'Only Admin / Management / Operation Manager can close the request'],
    ];
    if (isset($gate[$to]) && !can($role, $gate[$to][0])) fail(403, $gate[$to][1]);
    // Strict step-by-step ordering - no stage can be skipped. When no Team
    // Leader recommendation is due, final approval follows the request itself.
    $prev = ['Recommended' => 'Requested', 'Approved' => ($needsRec ? 'Recommended' : 'Requested'), 'Paid' => 'Approved', 'Proposal Submitted' => 'Paid', 'Closed' => 'Proposal Submitted'];
    if (isset($prev[$to])) {
      $from = $existing['status'] ?? 'Requested';
      // Below Rs.1,000 the Accountant may pay straight away, without waiting
      // for the approval step. The amount is read from the record as it
      // stands, not from the patch, so it cannot be lowered in the same call;
      // and the request is stamped here as a direct payment so the Owner's
      // notice and the trail say so. At Rs.1,000 and above nothing changes.
      $directPay = $to === 'Paid'
        && in_array($from, ['Requested', 'Recommended'], true)
        && !array_key_exists('amount', $patch)
        && (float)($existing['amount'] ?? 0) > 0
        && (float)($existing['amount'] ?? 0) < 1000;
      if ($directPay) {
        $patch['directPayment'] = true;
        $patch['directPaymentRule'] = 'Below Rs.1,000 - paid directly by the Accountant without the approval step';
      } elseif ($from !== $prev[$to]) {
        fail(409, "Out of order: this payment request must be '{$prev[$to]}' before it can move to '{$to}'.");
      }
    }
    if ($to === 'Rejected') {
      $stageAction = ['Requested' => ($needsRec ? 'pr_recommend' : 'pr_approve'), 'Recommended' => 'pr_approve', 'Approved' => 'pr_transfer', 'Paid' => 'pr_proposal', 'Proposal Submitted' => 'pr_proposal_approve'];
      $cur = $existing['status'] ?? 'Requested';
      if (in_array($cur, ['Closed', 'Rejected'], true)) fail(409, 'A closed or already-rejected payment request cannot be rejected.');
      $act = $stageAction[$cur] ?? '';
      if ($role !== 'super_admin' && !has_access($role, 'admin') && !($act && can($role, $act))) {
        fail(403, 'Only the person responsible for the current stage can reject this payment request.');
      }
    }
  }

  // Quotations: Pending Approval → Approved (any ONE of the four authorities)
  // → Shared with Customer → Accepted / Not Accepted. Nothing may be skipped.
  if ($collection === 'quotations') {
    $from = $existing['status'] ?? 'Pending Approval';
    // Saving a revision resends the record as it stands, status included. That
    // is a field edit, not a transition, so it must not be judged as one.
    if ($to !== $from) {
      if (in_array($to, ['Approved', 'Rejected'], true) && !can($role, 'quotation_approve')) {
        fail(403, 'Only Admin / Operation Manager / Management / Owner can approve a quotation.');
      }
      $prev = [
        'Approved'             => 'Pending Approval',
        'Rejected'             => 'Pending Approval',
        'Shared with Customer' => 'Approved',
        'Accepted'             => 'Shared with Customer',
        'Not Accepted'         => 'Shared with Customer',
      ];
      if (isset($prev[$to]) && $from !== $prev[$to]) {
        fail(409, "Out of order: this quotation must be '{$prev[$to]}' before it can move to '{$to}'.");
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
    'leads' => '/leads', 'quotations' => '/leads', 'customers' => '/customers', 'employeeTasks' => '/tasks',
    'tasks' => '/tasks', 'installations' => '/installations', 'ongoingWork' => '/ongoing',
    'materials' => '/materials', 'purchaseOrders' => '/purchase-orders', 'leadPOs' => '/purchase-orders', 'assignedMaterials' => '/assigned-materials',
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
