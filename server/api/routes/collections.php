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
    enforce_create($collection, $role);
    $data = body();
    unset($data['id'], $data['createdAt'], $data['updatedAt']);
    // Force the correct initial status for approval-chain collections so the
    // workflow can't be bypassed by POSTing an already-advanced status (the UI
    // always starts here; this stops the raw API from skipping stages).
    $initialStatus = [
      'expenditures'   => 'Requested',
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

  // ── DELETE (admin only, matching the UI) ──
  if ($method === 'DELETE') {
    if (!has_access($role, 'admin')) fail(403, 'Only admins can delete');
    db()->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$id]);
    json_out(['ok' => true]);
  }

  fail(405, 'Method not allowed');
}

// Who may CREATE in a given collection.
function enforce_create(string $collection, string $role): void {
  switch ($collection) {
    case 'leadPOs':
    case 'purchaseOrders':
      if (!can($role, 'po_record')) fail(403, 'Not authorised to create purchase orders');
      break;
    case 'expenditures':
      if (!can($role, 'expenditure_request')) fail(403, 'Not authorised to raise expenditures');
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
  if (!array_key_exists('status', $patch)) return;
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
    // Strict step-by-step ordering — a request may not skip a stage (req #12).
    $prev = ['Recommended' => 'Requested', 'Verified' => 'Recommended', 'Approved' => 'Verified', 'Released' => 'Approved'];
    if (isset($prev[$to])) {
      $from = $existing['status'] ?? 'Requested';
      if ($from !== $prev[$to]) fail(409, "Out of order: this expenditure must be '{$prev[$to]}' before it can move to '{$to}'.");
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
      'link'      => '/',
    ]);
  } catch (Throwable $e) {
    error_log('push send failed: ' . $e->getMessage());
  }
}
