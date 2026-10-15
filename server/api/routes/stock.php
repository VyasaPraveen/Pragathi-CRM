<?php
// ============================================================================
// The stock ledger — Materials & Inventory (10-Oct).
//
// Every change to a material's figures is a transaction in `stock_transactions`
// and is made HERE, inside a database transaction with the rows locked, never
// by writing the material directly. The generic collection route refuses the
// figures (see enforce_materials_write() in collections.php), so a Warehouse
// user, an Operation Manager or anyone calling the API by hand cannot change
// a balance; they can only submit an entry that the Owner approves.
//
//   receipt     Warehouse enters what arrived (against a PO where there is one)
//               → "Pending Review" → the Operation Manager forwards it
//               → "Forwarded to Owner" → the Owner approves → stock + balance up
//   adjustment  A physical count that differs from the book figure, with the
//               reason → the same review → the Owner approves → balance moved
//               by the difference. The Owner's own correction applies at once.
//   dispatch    The final dispatch confirmation on a purchase order whose
//               items have been sent, assigned and received: one transaction
//               per material, balance down, exactly once per PO.
//   opening     The figure a material was created with by the Owner.
//
// A figure is applied exactly once: the transaction's status is the guard, it
// is read under lock, and a second approval or a second dispatch of the same
// PO is refused with 409 rather than counted twice.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }
require_once __DIR__ . '/collections.php';   // maybe_send_push(), module_link()

// Who may ENTER a receipt or report a discrepancy: the warehouse side — which
// includes the BCO and the Technical Manager (8-Oct) — and the office roles
// who stand in for it. Mirrors STOCK_ENTRY_ROLES in src/services/stock.js.
const STOCK_ENTRY_ROLES  = ['warehouse_admin', 'technical_manager', 'bco', 'operation_manager', 'admin', 'management', 'super_admin'];
// Who REVIEWS an entry and forwards it to the Owner: the Operation Manager,
// with Admin / Management able to cover. Mirrors STOCK_REVIEW_ROLES.
const STOCK_REVIEW_ROLES = ['operation_manager', 'admin', 'management', 'super_admin'];
// Below this balance a material is "Low Stock" — the figure the Materials
// page has always used. Mirrors STOCK_LOW in stock.js.
const STOCK_LOW = 10;

const STOCK_PENDING   = 'Pending Review';
const STOCK_FORWARDED = 'Forwarded to Owner';
const STOCK_APPROVED  = 'Approved';
const STOCK_REJECTED  = 'Rejected';
const STOCK_APPLIED   = 'Applied';

function stock_is_owner(string $role): bool { return $role === 'super_admin'; }
function stock_can_enter(string $role): bool { return $role === 'super_admin' || in_array(normalize_role($role), STOCK_ENTRY_ROLES, true); }
function stock_can_review(string $role): bool { return $role === 'super_admin' || in_array(normalize_role($role), STOCK_REVIEW_ROLES, true); }
function stock_is_admin(string $role): bool { return $role === 'super_admin' || has_access($role, 'admin'); }

function handle_stock(string $action, string $method): void {
  $claims = require_auth();
  if ($method !== 'POST') fail(405, 'Method not allowed');
  if (!(int)($claims['approved'] ?? 0)) fail(403, 'Account not approved');
  if (!may_module($claims, 'materials')) fail(403, 'You do not have access to Materials & Inventory');
  $b = body();
  try {
    switch ($action) {
      case 'receipt':    stock_submit_receipt($claims, $b); break;
      case 'adjustment': stock_submit_adjustment($claims, $b); break;
      case 'review':     stock_review($claims, $b); break;
      case 'approve':    stock_approve($claims, $b); break;
      case 'dispatch':   stock_final_dispatch($claims, $b); break;
      default: fail(404, 'Not found');
    }
  } catch (Throwable $e) {
    // fail() leaves through here in the test harness (where it throws) and
    // nothing half-done may stay behind. In production fail() exits and the
    // open transaction is rolled back by the connection closing.
    if (db()->inTransaction()) db()->rollBack();
    throw $e;
  }
}

// ── Small helpers ────────────────────────────────────────────────────────────
function stock_now(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function stock_today_ist(): string { return (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('Y-m-d'); }
function stock_num($v): float { return is_numeric($v) ? round((float)$v, 3) : 0.0; }
function stock_str($v, int $max = 500): string { return mb_substr(trim((string)($v ?? '')), 0, $max); }
function stock_reference(string $prefix): string {
  return $prefix . '-' . gmdate('ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 5));
}
function stock_actor(array $claims): array {
  $email = strtolower(trim((string)($claims['email'] ?? '')));
  $name = trim((string)($claims['name'] ?? ''));
  if ($name === '' && $email !== '') $name = display_name_of($email);
  return ['name' => $name !== '' ? $name : $email, 'email' => $email];
}
function stock_same_person(string $stored, array $actor): bool {
  $s = strtolower(trim($stored));
  return $s !== '' && ($s === $actor['email'] || $s === strtolower($actor['name']));
}
// "AC Cable 6sqmm" and "ac-cable-6-sqmm" are the same name.
function stock_squash(string $s): string { return preg_replace('/[^a-z0-9]/', '', strtolower($s)); }

// ── Rows ────────────────────────────────────────────────────────────────────
// A document, by id, optionally locked for the rest of the transaction.
function stock_fetch(string $table, string $id, bool $lock = false): ?array {
  if ($id === '') return null;
  $st = db()->prepare("SELECT id, data FROM `$table` WHERE id = ? LIMIT 1" . ($lock ? ' FOR UPDATE' : ''));
  $st->execute([$id]);
  $r = $st->fetch();
  if (!$r) return null;
  $d = $r['data'] ? json_decode((string)$r['data'], true) : [];
  if (!is_array($d)) $d = [];
  $d['id'] = $r['id'];
  return $d;
}
function stock_insert(string $table, array $doc, string $email): string {
  $id = gen_id();
  unset($doc['id'], $doc['createdAt'], $doc['updatedAt']);
  db()->prepare("INSERT INTO `$table` (id, data, created_at, updated_at, created_by) VALUES (?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),?)")
    ->execute([$id, json_encode($doc, JSON_UNESCAPED_UNICODE), $email]);
  return $id;
}
function stock_save(string $table, string $id, array $doc, string $email): void {
  unset($doc['id'], $doc['createdAt'], $doc['updatedAt']);
  db()->prepare("UPDATE `$table` SET data = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?")
    ->execute([json_encode($doc, JSON_UNESCAPED_UNICODE), $email, $id]);
}
function stock_all(string $table): array {
  $out = [];
  foreach (db()->query("SELECT id, data FROM `$table`") as $r) {
    $d = $r['data'] ? json_decode((string)$r['data'], true) : [];
    if (!is_array($d)) $d = [];
    $d['id'] = $r['id'];
    $out[] = $d;
  }
  return $out;
}
// Every transaction, oldest first — the ledger is small and read whole.
function stock_ledger(): array {
  $rows = stock_all('stock_transactions');
  usort($rows, fn($a, $b) => strcmp((string)($a['submittedAt'] ?? ''), (string)($b['submittedAt'] ?? '')));
  return $rows;
}
function stock_history(array $doc, string $action, array $actor, string $note = ''): array {
  $h = is_array($doc['history'] ?? null) ? $doc['history'] : [];
  $h[] = ['at' => stock_now(), 'by' => $actor['name'], 'byEmail' => $actor['email'], 'action' => $action, 'note' => $note];
  $doc['history'] = $h;
  return $doc;
}

// ── Notifications ───────────────────────────────────────────────────────────
// Everyone with one of these roles, as the key a notification is addressed by.
function stock_people_by_role(array $roles): array {
  $out = [];
  try {
    foreach (db()->query('SELECT email, display_name, role FROM users WHERE approved = 1') as $r) {
      $role = (string)($r['role'] ?? '');
      if ($role === 'super_admin' ? in_array('super_admin', $roles, true) : in_array(normalize_role($role), $roles, true)) {
        $out[] = trim((string)($r['display_name'] ?? '')) ?: strtolower(trim((string)$r['email']));
      }
    }
  } catch (Throwable $e) { error_log('stock: could not read users: ' . $e->getMessage()); }
  return $out;
}
// One notification per person, never to the person acting, never twice.
function stock_notify(array $targets, string $title, string $message, string $relatedId, array $actor): int {
  $seen = []; $n = 0;
  foreach ($targets as $t) {
    $key = trim((string)$t);
    $k = strtolower($key);
    if ($k === '' || isset($seen[$k]) || $k === $actor['email'] || $k === strtolower($actor['name'])) continue;
    $seen[$k] = true;
    $note = ['forUser' => $key, 'title' => $title, 'message' => $message, 'type' => 'status_update',
             'module' => 'materials', 'relatedId' => $relatedId, 'read' => false, 'fromUser' => $actor['name'] ?: 'System'];
    try {
      stock_insert('notifications', $note, $actor['email']);
      maybe_send_push($note);
      $n++;
    } catch (Throwable $e) { error_log('stock notify failed: ' . $e->getMessage()); }
  }
  return $n;
}
function stock_qty_text(float $q, string $unit): string {
  $s = rtrim(rtrim(number_format($q, 3, '.', ''), '0'), '.');
  return $s . ($unit !== '' ? ' ' . $unit : '');
}

// The figures on a material as numbers, whatever was stored.
function stock_figures(array $m): array {
  return ['stock' => stock_num($m['stock'] ?? 0), 'dispatched' => stock_num($m['dispatched'] ?? 0),
          'installed' => stock_num($m['installed'] ?? 0), 'balance' => stock_num($m['balance'] ?? 0)];
}

// Tell the Owner and the Operation Manager when a balance has just dropped
// below the Low Stock line. Only on the way down through it, so a material
// that stays low does not raise the alarm on every movement.
function stock_low_alert(array $material, float $before, float $after, array $actor): void {
  if (!($after < STOCK_LOW && $before >= STOCK_LOW)) return;
  $unit = (string)($material['unit'] ?? '');
  stock_notify(stock_people_by_role(['super_admin', 'operation_manager']), 'Low Stock — ' . ($material['name'] ?? ''),
    "{$material['name']} is down to " . stock_qty_text($after, $unit) . ' (was ' . stock_qty_text($before, $unit) . '). Below ' . STOCK_LOW . " is Low Stock.",
    (string)$material['id'], ['name' => 'System', 'email' => '']);
}

// ── The PO a receipt is recorded against ────────────────────────────────────
// Received so far against one PO line: every receipt that is still live
// (pending, forwarded or approved). Rejected ones do not count.
function stock_received_against(array $ledger, string $poId, int $index): array {
  $approved = 0.0; $pending = 0.0;
  foreach ($ledger as $t) {
    if (($t['type'] ?? '') !== 'receipt' || (string)($t['poId'] ?? '') !== $poId || (int)($t['poItemIndex'] ?? -1) !== $index) continue;
    $s = (string)($t['status'] ?? '');
    if ($s === STOCK_APPROVED) $approved += stock_num($t['quantity'] ?? 0);
    elseif ($s === STOCK_PENDING || $s === STOCK_FORWARDED) $pending += stock_num($t['quantity'] ?? 0);
  }
  return ['approved' => $approved, 'pending' => $pending, 'live' => $approved + $pending];
}

// ── 1. Warehouse: a stock receipt ───────────────────────────────────────────
function stock_submit_receipt(array $claims, array $b): void {
  $role = (string)($claims['role'] ?? '');
  if (!stock_can_enter($role)) fail(403, 'Only the Warehouse (or the Operation Manager / an Admin) can record a stock receipt.');
  $actor = stock_actor($claims);

  // The same form sent twice (a double tap, a retry) is one receipt.
  $clientRef = stock_str($b['clientRef'] ?? '', 80);
  if ($clientRef !== '') {
    foreach (stock_ledger() as $t) {
      if (($t['clientRef'] ?? '') === $clientRef && ($t['type'] ?? '') === 'receipt') json_out($t);
    }
  }

  $material = stock_fetch('materials', (string)($b['materialId'] ?? ''));
  if (!$material) fail(404, 'Choose the material this receipt is for.');
  $qty = stock_num($b['quantity'] ?? 0);
  if ($qty <= 0) fail(422, 'The quantity received must be more than zero.');
  $date = stock_str($b['receiptDate'] ?? '', 10);
  if ($date === '') $date = stock_today_ist();
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !strtotime($date)) fail(422, 'The receipt date is not a valid date.');
  if ($date > stock_today_ist()) fail(422, 'The receipt date cannot be in the future.');
  $remarks = stock_str($b['remarks'] ?? '');

  // Against a purchase order, where there is one: the line is named, and the
  // quantity is checked against what that line still has to come.
  $po = null; $poTable = ''; $poId = stock_str($b['poId'] ?? '', 40); $poSource = ''; $index = -1; $item = null; $over = false;
  if ($poId !== '') {
    $poSource = ($b['poSource'] ?? '') === 'standalone' ? 'standalone' : 'lead';
    $poTable = $poSource === 'standalone' ? 'purchase_orders' : 'lead_pos';
    $po = stock_fetch($poTable, $poId);
    if (!$po) fail(404, 'That purchase order no longer exists.');
    $index = (int)($b['poItemIndex'] ?? -1);
    $items = is_array($po['items'] ?? null) ? $po['items'] : [];
    if ($index < 0 || !isset($items[$index])) fail(422, 'Choose which line of the purchase order this receipt is against.');
    $item = $items[$index];
    $ordered = stock_num($item['quantity'] ?? 0);
    $soFar = stock_received_against(stock_ledger(), $poId, $index);
    $remaining = $ordered - $soFar['live'];
    if ($ordered > 0 && $qty > $remaining + 1e-9) {
      $unit = (string)($material['unit'] ?? '');
      $msg = 'This receipt is more than the purchase order line still has to come: ordered ' . stock_qty_text($ordered, $unit)
        . ', already received or awaiting approval ' . stock_qty_text($soFar['live'], $unit) . ', remaining ' . stock_qty_text(max(0, $remaining), $unit) . '.';
      if (!stock_is_admin($role)) fail(409, $msg . ' Ask an Admin or the Owner to record the excess.');
      if ($remarks === '') fail(422, $msg . ' Say in the remarks why the excess is being recorded.');
      $over = true;
    }
  }

  $figures = stock_figures($material);
  $doc = [
    'type' => 'receipt', 'reference' => stock_reference('RCP'), 'clientRef' => $clientRef,
    'materialId' => $material['id'], 'materialName' => (string)($material['name'] ?? ''), 'unit' => (string)($material['unit'] ?? ''),
    'category' => (string)($material['category'] ?? ''),
    'quantity' => $qty, 'receiptDate' => $date, 'supplier' => stock_str($b['supplier'] ?? '', 190), 'remarks' => $remarks,
    'poId' => $poId, 'poSource' => $poId !== '' ? $poSource : '', 'poNumber' => $po ? (string)($po['poNumber'] ?? '') : '',
    'poItemIndex' => $poId !== '' ? $index : null, 'poItemName' => $item ? (string)($item['materialName'] ?? '') : '',
    'poOrderedQty' => $item ? stock_num($item['quantity'] ?? 0) : null, 'overReceipt' => $over,
    'balanceAtSubmission' => $figures['balance'],
    'status' => STOCK_PENDING,
    'submittedBy' => $actor['name'], 'submittedByEmail' => $actor['email'], 'submittedAt' => stock_now(),
  ];
  $doc = stock_history($doc, 'Submitted for review', $actor, $remarks);
  $id = stock_insert('stock_transactions', $doc, $actor['email']);
  $doc['id'] = $id;

  $unit = $doc['unit'];
  stock_notify(stock_people_by_role(['operation_manager', 'admin']), 'Stock Receipt to Review — ' . $doc['materialName'],
    "{$actor['name']} recorded a receipt of " . stock_qty_text($qty, $unit) . " of {$doc['materialName']} on $date"
    . ($doc['poNumber'] !== '' ? " against PO {$doc['poNumber']}" : '') . '. Current available stock ' . stock_qty_text($figures['balance'], $unit)
    . ($remarks !== '' ? ". Remarks: $remarks" : '') . ". Ref {$doc['reference']}. Open Materials to review and forward it to the Owner.",
    $id, $actor);
  json_out($doc, 201);
}

// ── 2. Warehouse: a discrepancy (or the Owner's own correction) ─────────────
function stock_submit_adjustment(array $claims, array $b): void {
  $role = (string)($claims['role'] ?? '');
  if (!stock_can_enter($role)) fail(403, 'Only the Warehouse (or the Operation Manager / an Admin) can report a stock discrepancy.');
  $actor = stock_actor($claims);
  $direct = !empty($b['direct']);
  if ($direct && !stock_is_owner($role)) fail(403, 'Only the Owner can change a stock figure directly. Submit a discrepancy report instead.');

  $clientRef = stock_str($b['clientRef'] ?? '', 80);
  if ($clientRef !== '') {
    foreach (stock_ledger() as $t) {
      if (($t['clientRef'] ?? '') === $clientRef && ($t['type'] ?? '') === 'adjustment') json_out($t);
    }
  }
  $reason = stock_str($b['reason'] ?? '');
  if ($reason === '') fail(422, 'A reason is required for every stock correction.');
  if (!isset($b['countedQuantity']) || !is_numeric($b['countedQuantity'])) fail(422, 'Enter the quantity physically counted.');
  $counted = stock_num($b['countedQuantity']);
  if ($counted < 0) fail(422, 'The counted quantity cannot be negative.');

  if ($direct) db()->beginTransaction();
  $material = stock_fetch('materials', (string)($b['materialId'] ?? ''), $direct);
  if (!$material) fail(404, 'Choose the material this correction is for.');
  $figures = stock_figures($material);
  $delta = round($counted - $figures['balance'], 3);
  if (abs($delta) < 1e-9) fail(409, 'The counted quantity is the same as the book figure — there is nothing to correct.');
  $unit = (string)($material['unit'] ?? '');

  $doc = [
    'type' => 'adjustment', 'reference' => stock_reference('ADJ'), 'clientRef' => $clientRef,
    'materialId' => $material['id'], 'materialName' => (string)($material['name'] ?? ''), 'unit' => $unit,
    'category' => (string)($material['category'] ?? ''),
    'quantity' => $delta, 'countedQuantity' => $counted, 'balanceAtSubmission' => $figures['balance'],
    'reason' => $reason, 'remarks' => $reason,
    'status' => STOCK_PENDING,
    'submittedBy' => $actor['name'], 'submittedByEmail' => $actor['email'], 'submittedAt' => stock_now(),
  ];
  $doc = stock_history($doc, $direct ? 'Corrected by the Owner' : 'Discrepancy reported', $actor, $reason);

  if ($direct) {
    // The Owner's own correction: applied here and now, recorded like any other.
    $doc = stock_apply($doc, $material, $actor, 'Owner correction');
    $id = stock_insert('stock_transactions', $doc, $actor['email']);
    db()->commit();
    $doc['id'] = $id;
    stock_low_alert($material, $figures['balance'], $counted, $actor);
    stock_notify(stock_people_by_role(['operation_manager']), 'Stock Corrected by the Owner — ' . $doc['materialName'],
      "{$actor['name']} corrected {$doc['materialName']} from " . stock_qty_text($figures['balance'], $unit) . ' to ' . stock_qty_text($counted, $unit)
      . " ($reason). Ref {$doc['reference']}.", $id, $actor);
    json_out($doc, 201);
  }

  $id = stock_insert('stock_transactions', $doc, $actor['email']);
  $doc['id'] = $id;
  stock_notify(stock_people_by_role(['operation_manager', 'admin', 'super_admin']), 'Stock Discrepancy Reported — ' . $doc['materialName'],
    "{$actor['name']} counted " . stock_qty_text($counted, $unit) . " of {$doc['materialName']}; the book figure is " . stock_qty_text($figures['balance'], $unit)
    . ' (difference ' . ($delta > 0 ? '+' : '') . stock_qty_text($delta, $unit) . "). Reason: $reason. Ref {$doc['reference']}. The Operation Manager reviews it and the Owner decides.",
    $id, $actor);
  json_out($doc, 201);
}

// Move the material's figures by a transaction, once. Called under lock.
function stock_apply(array $doc, array &$material, array $actor, string $how): array {
  if (!empty($doc['appliedAt'])) fail(409, 'This entry has already been applied to the stock.');
  $f = stock_figures($material);
  $type = (string)($doc['type'] ?? '');
  $q = stock_num($doc['quantity'] ?? 0);
  $before = $f['balance'];
  if ($type === 'receipt') { $f['stock'] += $q; $f['balance'] += $q; }
  elseif ($type === 'adjustment') { $f['stock'] += $q; $f['balance'] += $q; }
  elseif ($type === 'dispatch') { $f['dispatched'] += $q; $f['balance'] -= $q; }
  elseif ($type === 'opening') { $f['stock'] += $q; $f['balance'] += $q; }
  else fail(422, 'Unknown stock transaction type.');
  if ($f['balance'] < -1e-9) fail(409, 'This would take ' . ($material['name'] ?? 'the material') . ' below zero (available ' . stock_qty_text($before, (string)($material['unit'] ?? '')) . ').');
  $f['stock'] = max(0, round($f['stock'], 3)); $f['balance'] = round($f['balance'], 3); $f['dispatched'] = round($f['dispatched'], 3);
  $material['stock'] = $f['stock']; $material['dispatched'] = $f['dispatched']; $material['balance'] = $f['balance'];
  $material['lastStockChangeAt'] = stock_now(); $material['lastStockChangeBy'] = $actor['name']; $material['lastStockChangeRef'] = (string)($doc['reference'] ?? '');
  stock_save('materials', (string)$material['id'], $material, $actor['email']);
  $doc['previousBalance'] = $before; $doc['newBalance'] = $f['balance'];
  $doc['appliedAt'] = stock_now(); $doc['appliedBy'] = $actor['name']; $doc['appliedByEmail'] = $actor['email'];
  $doc['status'] = in_array($type, ['receipt', 'adjustment'], true) && $how !== 'Owner correction' ? STOCK_APPROVED : STOCK_APPLIED;
  return $doc;
}

// ── 3. Operation Manager: forward to the Owner, or reject ──────────────────
function stock_review(array $claims, array $b): void {
  $role = (string)($claims['role'] ?? '');
  if (!stock_can_review($role)) fail(403, 'Only the Operation Manager (or an Admin) reviews stock entries.');
  $actor = stock_actor($claims);
  $action = (string)($b['action'] ?? '');
  $note = stock_str($b['note'] ?? '');
  db()->beginTransaction();
  $t = stock_fetch('stock_transactions', (string)($b['id'] ?? ''), true);
  if (!$t) fail(404, 'That stock entry no longer exists.');
  if (!in_array($t['type'] ?? '', ['receipt', 'adjustment'], true)) fail(409, 'Only receipts and discrepancy reports are reviewed.');
  if (($t['status'] ?? '') !== STOCK_PENDING) fail(409, 'This entry is ' . strtolower((string)($t['status'] ?? 'not pending')) . ' and is no longer waiting for review.');
  $unit = (string)($t['unit'] ?? ''); $q = stock_num($t['quantity'] ?? 0);
  $what = ($t['type'] === 'receipt' ? 'receipt of ' . stock_qty_text($q, $unit) : 'correction of ' . ($q > 0 ? '+' : '') . stock_qty_text($q, $unit)) . " of {$t['materialName']}";

  if ($action === 'forward') {
    $t['status'] = STOCK_FORWARDED;
    $t['reviewedBy'] = $actor['name']; $t['reviewedByEmail'] = $actor['email']; $t['reviewedAt'] = stock_now(); $t['reviewNote'] = $note;
    $t = stock_history($t, 'Forwarded to the Owner', $actor, $note);
    stock_save('stock_transactions', $t['id'], $t, $actor['email']);
    db()->commit();
    stock_notify(stock_people_by_role(['super_admin']), 'Stock Entry for Your Approval — ' . $t['materialName'],
      "{$actor['name']} reviewed the $what recorded by {$t['submittedBy']} (ref {$t['reference']}) and forwarded it for your approval."
      . ($note !== '' ? " Note: $note." : '') . ' Open Materials → Approvals.', $t['id'], $actor);
    stock_notify([(string)($t['submittedBy'] ?? '')], 'Stock Entry Forwarded — ' . $t['materialName'],
      "Your $what (ref {$t['reference']}) was reviewed by {$actor['name']} and sent to the Owner for approval.", $t['id'], $actor);
    json_out($t);
  }
  if ($action === 'reject') {
    if ($note === '') fail(422, 'Give the reason for rejecting this entry.');
    $t['status'] = STOCK_REJECTED;
    $t['rejectedBy'] = $actor['name']; $t['rejectedByEmail'] = $actor['email']; $t['rejectedAt'] = stock_now(); $t['rejectReason'] = $note; $t['rejectedAtStage'] = 'review';
    $t = stock_history($t, 'Rejected at review', $actor, $note);
    stock_save('stock_transactions', $t['id'], $t, $actor['email']);
    db()->commit();
    stock_notify([(string)($t['submittedBy'] ?? '')], 'Stock Entry Rejected — ' . $t['materialName'],
      "Your $what (ref {$t['reference']}) was rejected by {$actor['name']}. Reason: $note. The stock figure has not changed.", $t['id'], $actor);
    json_out($t);
  }
  fail(422, 'The review action must be "forward" or "reject".');
}

// ── 4. Owner: approve (apply) or reject ─────────────────────────────────────
function stock_approve(array $claims, array $b): void {
  $role = (string)($claims['role'] ?? '');
  if (!stock_is_owner($role)) fail(403, 'Only the Owner can approve a change to the stock.');
  $actor = stock_actor($claims);
  $action = (string)($b['action'] ?? '');
  $note = stock_str($b['note'] ?? '');
  db()->beginTransaction();
  $t = stock_fetch('stock_transactions', (string)($b['id'] ?? ''), true);
  if (!$t) fail(404, 'That stock entry no longer exists.');
  if (!in_array($t['type'] ?? '', ['receipt', 'adjustment'], true)) fail(409, 'Only receipts and discrepancy reports are approved.');
  if (!in_array($t['status'] ?? '', [STOCK_PENDING, STOCK_FORWARDED], true)) {
    fail(409, 'This entry is already ' . strtolower((string)($t['status'] ?? '')) . '.');
  }
  $unit = (string)($t['unit'] ?? ''); $q = stock_num($t['quantity'] ?? 0);
  $what = ($t['type'] === 'receipt' ? 'receipt of ' . stock_qty_text($q, $unit) : 'correction of ' . ($q > 0 ? '+' : '') . stock_qty_text($q, $unit)) . " of {$t['materialName']}";
  $tell = array_filter([(string)($t['submittedBy'] ?? ''), (string)($t['reviewedBy'] ?? '')]);

  if ($action === 'approve') {
    $material = stock_fetch('materials', (string)($t['materialId'] ?? ''), true);
    if (!$material) fail(409, 'The material this entry is for no longer exists.');
    $before = stock_figures($material)['balance'];
    $t['approvedBy'] = $actor['name']; $t['approvedByEmail'] = $actor['email']; $t['approvedAt'] = stock_now(); $t['approvalNote'] = $note;
    $t = stock_apply($t, $material, $actor, 'Owner approval');
    $t = stock_history($t, 'Approved by the Owner — stock updated', $actor, $note);
    stock_save('stock_transactions', $t['id'], $t, $actor['email']);
    db()->commit();
    stock_low_alert($material, $before, stock_num($t['newBalance']), $actor);
    stock_notify(array_merge($tell, stock_people_by_role(['operation_manager'])), 'Stock Entry Approved — ' . $t['materialName'],
      "The Owner approved the $what (ref {$t['reference']}). {$t['materialName']}: " . stock_qty_text(stock_num($t['previousBalance']), $unit)
      . ' → ' . stock_qty_text(stock_num($t['newBalance']), $unit) . ($note !== '' ? ". Note: $note" : '') . '.', $t['id'], $actor);
    json_out($t);
  }
  if ($action === 'reject') {
    if ($note === '') fail(422, 'Give the reason for rejecting this entry.');
    $t['status'] = STOCK_REJECTED;
    $t['rejectedBy'] = $actor['name']; $t['rejectedByEmail'] = $actor['email']; $t['rejectedAt'] = stock_now(); $t['rejectReason'] = $note; $t['rejectedAtStage'] = 'owner';
    $t = stock_history($t, 'Rejected by the Owner', $actor, $note);
    stock_save('stock_transactions', $t['id'], $t, $actor['email']);
    db()->commit();
    stock_notify($tell, 'Stock Entry Rejected by the Owner — ' . $t['materialName'],
      "The $what (ref {$t['reference']}) was rejected by the Owner. Reason: $note. The stock figure has not changed.", $t['id'], $actor);
    json_out($t);
  }
  fail(422, 'The approval action must be "approve" or "reject".');
}

// ── 5. The final dispatch: the one step that takes stock out ───────────────
// On a purchase order whose items the warehouse sent, the Operation Manager
// assigned and the person received. The assigned person (or the Operation
// Manager / an Admin) confirms it, naming which inventory material each sent
// line is, and the balance comes down — once.
function stock_final_dispatch(array $claims, array $b): void {
  $role = (string)($claims['role'] ?? '');
  $actor = stock_actor($claims);
  db()->beginTransaction();
  $po = stock_fetch('lead_pos', (string)($b['poId'] ?? ''), true);
  if (!$po) fail(404, 'That purchase order no longer exists.');
  if (($po['status'] ?? '') !== 'Approved') fail(409, 'Material is dispatched only on an approved purchase order.');
  if (($po['dispatchStatus'] ?? '') !== 'Completed') fail(409, 'The warehouse has not sent this dispatch yet (OK & Send).');
  if (empty($po['dispatchAssignedTo'])) fail(409, 'The Operation Manager has not assigned these items to anyone yet.');
  if (empty($po['dispatchReceivedAt'])) fail(409, 'The assigned person has not confirmed receipt of the items yet.');
  if (!empty($po['stockDispatchedAt'])) fail(409, 'The stock for this purchase order was already deducted on ' . $po['stockDispatchedAt'] . ' (ref ' . ($po['stockDispatchRef'] ?? '') . '). It is not deducted twice.');
  $isAssignee = stock_same_person((string)($po['dispatchAssignedToEmail'] ?? ''), $actor) || stock_same_person((string)($po['dispatchAssignedTo'] ?? ''), $actor);
  if (!$isAssignee && !stock_can_review($role)) fail(403, 'Only the person the items were assigned to, the Operation Manager or an Admin can confirm the final dispatch.');

  $items = is_array($po['items'] ?? null) ? $po['items'] : [];
  $marks = is_array($po['dispatchItems'] ?? null) ? $po['dispatchItems'] : [];
  $chosen = is_array($b['items'] ?? null) ? $b['items'] : [];
  if (!$chosen) fail(422, 'Name the inventory material for at least one dispatched item.');

  // Gather what comes out of each material, line by line.
  $lines = []; $perMaterial = []; $seenIndex = [];
  foreach ($chosen as $c) {
    $i = (int)($c['index'] ?? -1);
    if (!isset($items[$i])) fail(422, "Item " . ($i + 1) . ' is not on this purchase order.');
    if (isset($seenIndex[$i])) fail(422, 'Item ' . ($i + 1) . ' is listed twice.');
    $seenIndex[$i] = true;
    if (empty($marks[$i]['dispatched'])) fail(409, 'Item ' . ($i + 1) . ' (' . ($items[$i]['materialName'] ?? '') . ') was not dispatched by the warehouse.');
    $mid = stock_str($c['materialId'] ?? '', 40);
    if ($mid === '') fail(422, 'Choose the inventory material for item ' . ($i + 1) . ' (' . ($items[$i]['materialName'] ?? '') . ').');
    $qty = stock_num($c['quantity'] ?? ($items[$i]['quantity'] ?? 0));
    if ($qty <= 0) fail(422, 'Item ' . ($i + 1) . ' (' . ($items[$i]['materialName'] ?? '') . ') has no quantity to dispatch.');
    $lines[] = ['index' => $i, 'materialId' => $mid, 'quantity' => $qty, 'itemName' => (string)($items[$i]['materialName'] ?? ''), 'spec' => (string)($items[$i]['specification'] ?? '')];
    $perMaterial[$mid] = ($perMaterial[$mid] ?? 0) + $qty;
  }

  // Lock every material, and refuse the whole dispatch if any one is short —
  // nothing is deducted until all of it can be.
  $materials = []; $short = [];
  foreach ($perMaterial as $mid => $qty) {
    $m = stock_fetch('materials', $mid, true);
    if (!$m) fail(404, 'One of the chosen inventory materials no longer exists.');
    $materials[$mid] = $m;
    $bal = stock_figures($m)['balance'];
    if ($qty > $bal + 1e-9) $short[] = "{$m['name']}: needs " . stock_qty_text($qty, (string)($m['unit'] ?? '')) . ', available ' . stock_qty_text($bal, (string)($m['unit'] ?? ''));
  }
  if ($short) fail(409, 'Not enough stock to dispatch — ' . implode('; ', $short) . '. Receive stock first or correct the quantities.');

  $ref = stock_reference('DSP');
  $destination = stock_str($b['destination'] ?? '', 300);
  if ($destination === '') $destination = trim((string)($po['customerName'] ?? '') . ' ' . (string)($po['customerAddress'] ?? ''));
  $note = stock_str($b['note'] ?? '');
  $lowBefore = [];
  foreach ($materials as $mid => $m) $lowBefore[$mid] = stock_figures($m)['balance'];

  $written = [];
  foreach ($lines as $ln) {
    $m = &$materials[$ln['materialId']];
    $doc = [
      'type' => 'dispatch', 'reference' => $ref, 'dispatchRef' => $ref,
      'materialId' => $m['id'], 'materialName' => (string)($m['name'] ?? ''), 'unit' => (string)($m['unit'] ?? ''), 'category' => (string)($m['category'] ?? ''),
      'quantity' => $ln['quantity'], 'dispatchDate' => stock_today_ist(),
      'poId' => $po['id'], 'poSource' => 'lead', 'poNumber' => (string)($po['poNumber'] ?? ''), 'poItemIndex' => $ln['index'], 'poItemName' => $ln['itemName'], 'poItemSpec' => $ln['spec'],
      'leadId' => (string)($po['leadId'] ?? ''), 'customerName' => (string)($po['customerName'] ?? ''),
      'installationId' => stock_str($b['installationId'] ?? '', 40), 'destination' => $destination, 'remarks' => $note,
      'assignedTo' => (string)($po['dispatchAssignedTo'] ?? ''), 'receivedBy' => (string)($po['dispatchReceivedBy'] ?? ''),
      'confirmedBy' => $actor['name'], 'confirmedByEmail' => $actor['email'],
      'submittedBy' => $actor['name'], 'submittedByEmail' => $actor['email'], 'submittedAt' => stock_now(),
    ];
    $doc = stock_apply($doc, $m, $actor, 'Final dispatch');
    $doc = stock_history($doc, 'Final dispatch confirmed — stock deducted', $actor, $note);
    $id = stock_insert('stock_transactions', $doc, $actor['email']);
    $doc['id'] = $id;
    $written[] = $doc;
    unset($m);
  }

  $po['stockDispatchedAt'] = stock_now(); $po['stockDispatchedBy'] = $actor['name']; $po['stockDispatchedByEmail'] = $actor['email'];
  $po['stockDispatchRef'] = $ref; $po['stockDispatchDestination'] = $destination; $po['stockDispatchNote'] = $note;
  $po['stockDispatchItems'] = array_map(fn($d) => ['index' => $d['poItemIndex'], 'materialId' => $d['materialId'], 'materialName' => $d['materialName'],
    'quantity' => $d['quantity'], 'unit' => $d['unit'], 'transactionId' => $d['id'], 'previousBalance' => $d['previousBalance'], 'newBalance' => $d['newBalance']], $written);
  stock_save('lead_pos', $po['id'], $po, $actor['email']);
  db()->commit();

  foreach ($materials as $mid => $m) stock_low_alert($m, $lowBefore[$mid], stock_figures($m)['balance'], $actor);
  $label = 'PO ' . ($po['poNumber'] ?? '') . (!empty($po['customerName']) ? " for \"{$po['customerName']}\"" : '');
  $list = implode(', ', array_map(fn($d) => $d['materialName'] . ' ' . stock_qty_text(stock_num($d['quantity']), $d['unit'])
    . ' (' . stock_qty_text(stock_num($d['previousBalance']), $d['unit']) . ' → ' . stock_qty_text(stock_num($d['newBalance']), $d['unit']) . ')', $written));
  stock_notify(array_merge(stock_people_by_role(['super_admin', 'operation_manager']), [(string)($po['dispatchAssignedBy'] ?? '')]),
    'Final Dispatch — Stock Deducted', "{$actor['name']} confirmed the final dispatch for $label (ref $ref). Stock deducted: $list." . ($destination !== '' ? " Destination: $destination." : ''),
    $po['id'], $actor);
  json_out(['ok' => true, 'reference' => $ref, 'transactions' => $written, 'po' => $po]);
}

// ── The figure a material is created with ───────────────────────────────────
// Called from the generic POST once the material row exists: the Owner's
// opening figure becomes the first line of the ledger, so even that is not a
// number that appeared from nowhere.
function stock_record_opening(string $materialId, array $material, array $claims): void {
  $qty = stock_num($material['balance'] ?? 0);
  if ($qty <= 0) return;
  $actor = stock_actor($claims);
  $doc = [
    'type' => 'opening', 'reference' => stock_reference('OPN'),
    'materialId' => $materialId, 'materialName' => (string)($material['name'] ?? ''), 'unit' => (string)($material['unit'] ?? ''),
    'category' => (string)($material['category'] ?? ''),
    'quantity' => $qty, 'previousBalance' => 0, 'newBalance' => $qty, 'balanceAtSubmission' => 0,
    'remarks' => 'Opening stock recorded by the Owner when the material was added',
    'status' => STOCK_APPLIED, 'appliedAt' => stock_now(), 'appliedBy' => $actor['name'], 'appliedByEmail' => $actor['email'],
    'submittedBy' => $actor['name'], 'submittedByEmail' => $actor['email'], 'submittedAt' => stock_now(),
  ];
  $doc = stock_history($doc, 'Opening stock', $actor, '');
  stock_insert('stock_transactions', $doc, $actor['email']);
}
