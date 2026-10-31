<?php
// ============================================================================
// User & team management for the Owner (Req 5, 30-Oct).
//
// The account is the one record of a person: users.id, with the team they
// belong to as data.teamLeader (their leader's email), their standing as
// data.status (active / hold / deactivated) and, on a leader, data.teamName.
// Nothing here ever creates a second account for the same person or deletes
// a business record: moving a person between teams, replacing them, changing
// their role or their standing only rewrites the links, and only the links
// the Owner chose. Every action lands in the Activity Log (module "users")
// with who did it, to whom, and the old and new values.
//
// Routes (Admin and above; what touches an Owner account is the Owner's alone):
//   GET  /users/{id}/records      the records linked to this person
//   POST /users/{id}/reassign     team / role / standing of the records
//   POST /users/{id}/make-leader  this person leads the team instead
//   POST /users/{id}/status       hold / unhold / deactivate / reactivate
//   GET  /users/{id}/history      what was done to this account
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }
require_once __DIR__ . '/auth.php';

const USER_STATUSES = ['active', 'hold', 'deactivated'];

// The record fields that name a person, by collection: the name fields and
// the email fields. These are what a hand-over rewrites and what a rename or
// a change of address keeps pointing at the same person.
const PERSON_FIELDS = [
  'leads'         => ['names' => ['assignedTo', 'salesExecutive'], 'emails' => ['assignedToEmail']],
  'customers'     => ['names' => ['assignedTo'], 'emails' => []],
  'employeeTasks' => ['names' => ['assignedTo'], 'emails' => []],
  'installations' => ['names' => ['siteVisitAssignedTo'], 'emails' => ['siteVisitAssignedToEmail']],
  'leadPOs'       => ['names' => ['dispatchAssignedTo'], 'emails' => ['dispatchAssignedToEmail']],
];
// Fields that carry a person's display name anywhere in the data, for a
// rename. Only these are rewritten — never free text.
const NAME_FIELDS = ['assignedTo', 'salesExecutive', 'employeeName', 'dispatchAssignedTo', 'siteVisitAssignedTo', 'requestedByName', 'replacementName',
  'deliveredBy', 'dispatchReceivedBy', 'dispatchAssignedBy', 'forUser', 'recommendedByName', 'acceptanceProofByName', 'siteVisitReportedBy', 'employee', 'name_'];

function user_row(string $id): ?array {
  $st = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  $r = $st->fetch();
  return $r ?: null;
}
function user_data(array $row): array {
  $d = !empty($row['data']) ? json_decode($row['data'], true) : [];
  return is_array($d) ? $d : [];
}
function user_status(array $row): string {
  $s = (string)(user_data($row)['status'] ?? 'active');
  return in_array($s, USER_STATUSES, true) ? $s : 'active';
}
function save_user_data(string $id, array $data): void {
  db()->prepare('UPDATE users SET data = ? WHERE id = ?')->execute([json_encode($data, JSON_UNESCAPED_UNICODE), $id]);
}
function user_label(array $row): string { return (string)($row['display_name'] ?? '') ?: (string)($row['email'] ?? ''); }

// Approved, active Owner accounts other than this one.
function other_owners(string $exceptId): int {
  $rows = db()->query("SELECT id, data FROM users WHERE role = 'super_admin' AND approved = 1")->fetchAll();
  $n = 0;
  foreach ($rows as $r) {
    if ((string)$r['id'] === $exceptId) continue;
    if (user_status($r) === 'active') $n++;
  }
  return $n;
}

// The lines nobody crosses: an Admin never touches an Owner account, nobody
// holds, deactivates, deletes or demotes themselves, and the last active
// Owner can never be removed or demoted.
function guard_owner(array $actor, array $target, string $what): void {
  $actorRole = (string)($actor['role'] ?? '');
  $self = (string)($actor['sub'] ?? '') === (string)$target['id'];
  if ((string)$target['role'] === 'super_admin' && $actorRole !== 'super_admin') fail(403, 'Only the Owner can change an Owner account.');
  if ($self && in_array($what, ['hold', 'deactivate', 'delete', 'demote', 'role'], true)) fail(403, 'You cannot ' . ($what === 'role' ? 'change the role of' : $what) . ' your own account. Ask another Owner or Admin.');
  if ((string)$target['role'] === 'super_admin' && in_array($what, ['hold', 'deactivate', 'delete', 'demote'], true) && other_owners((string)$target['id']) === 0) {
    fail(409, 'This is the only active Owner account. Make another account an Owner first, so the system is never left without one.');
  }
}

// Hold / unhold / deactivate / reactivate. The account keeps everything it
// has; only its standing changes, and its current device is signed out.
function set_user_status(array $actor, array $target, string $status, string $note): array {
  if (!in_array($status, USER_STATUSES, true)) fail(400, 'Unknown status');
  $old = user_status($target);
  if ($old === $status) return user_data($target);
  if ($status !== 'active') guard_owner($actor, $target, $status === 'hold' ? 'hold' : 'deactivate');
  $d = user_data($target);
  $d['status'] = $status;
  $d['statusAt'] = gmdate('Y-m-d\TH:i:s\Z');
  $d['statusBy'] = (string)($actor['email'] ?? '');
  $d['statusNote'] = trim($note);
  if ($status !== 'active') unset($d['activeSession']);
  save_user_data((string)$target['id'], $d);
  if ($status !== 'active') db()->prepare('DELETE FROM fcm_tokens WHERE user_id = ?')->execute([(string)$target['id']]);
  $label = ['active' => 'Reactivated', 'hold' => 'Put on hold', 'deactivated' => 'Deactivated'][$status];
  if ($status === 'active') $label = $old === 'hold' ? 'Hold removed' : 'Reactivated';
  audit_user_event($actor, $label, ($note !== '' ? $note : 'no note') . ' (was ' . $old . ')', $target, ['oldValue' => $old, 'newValue' => $status]);
  return $d;
}

// Walk a decoded document and replace every string equal to $old (the
// person's email, case-insensitive) with $new. Returns whether it changed.
function replace_email_in(array &$doc, string $old, string $new): bool {
  $changed = false;
  foreach ($doc as $k => &$v) {
    if (is_array($v)) { if (replace_email_in($v, $old, $new)) $changed = true; }
    elseif (is_string($v) && strcasecmp(trim($v), $old) === 0) { $v = $new; $changed = true; }
  }
  return $changed;
}
// Replace the person's display name in the named fields only.
function replace_name_in(array &$doc, string $old, string $new): bool {
  $changed = false;
  foreach ($doc as $k => &$v) {
    if (is_array($v)) {
      // supportingTeam-style lists of names
      if (in_array($k, ['supportingTeam', 'supportingMembers', 'members'], true)) {
        foreach ($v as &$item) { if (is_string($item) && strcasecmp(trim($item), $old) === 0) { $item = $new; $changed = true; } }
        unset($item);
      } elseif (replace_name_in($v, $old, $new)) $changed = true;
    } elseif (is_string($v) && in_array((string)$k, NAME_FIELDS, true) && strcasecmp(trim($v), $old) === 0) { $v = $new; $changed = true; }
  }
  return $changed;
}

// Every document table the records live in.
function document_tables(): array {
  return ['leads', 'customers', 'installations', 'team', 'materials', 'ongoing_work', 'income', 'expenses', 'reminders', 'gallery', 'purchase_orders',
    'retailers', 'influencers', 'employee_tasks', 'lead_pos', 'expenditures', 'payment_requests', 'bom_templates', 'quotations', 'activity_log',
    'notifications', 'leave_requests', 'attendance', 'tracking', 'bco_ops', 'stock_transactions'];
}

// A person's address changed: every record and link that carried the old one
// carries the new one, so nothing is left pointing at an address nobody has.
function cascade_email(string $old, string $new): int {
  $old = strtolower(trim($old)); $new = strtolower(trim($new));
  if ($old === '' || $old === $new) return 0;
  $n = 0;
  // Members who report to this person.
  foreach (db()->query('SELECT id, data FROM users')->fetchAll() as $r) {
    $d = $r['data'] ? json_decode($r['data'], true) : [];
    if (is_array($d) && strcasecmp(trim((string)($d['teamLeader'] ?? '')), $old) === 0) {
      $d['teamLeader'] = $new; save_user_data((string)$r['id'], $d); $n++;
    }
  }
  foreach (document_tables() as $t) {
    $rows = db()->query("SELECT id, data, created_by, updated_by FROM `$t`")->fetchAll();
    $upd = db()->prepare("UPDATE `$t` SET data = ?, created_by = ?, updated_by = ? WHERE id = ?");
    foreach ($rows as $r) {
      $d = $r['data'] ? json_decode($r['data'], true) : [];
      if (!is_array($d)) $d = [];
      $changed = replace_email_in($d, $old, $new);
      $cb = (string)($r['created_by'] ?? ''); $ub = (string)($r['updated_by'] ?? '');
      if (strcasecmp(trim($cb), $old) === 0) { $cb = $new; $changed = true; }
      if (strcasecmp(trim($ub), $old) === 0) { $ub = $new; $changed = true; }
      if ($changed) { $upd->execute([json_encode($d, JSON_UNESCAPED_UNICODE), $cb ?: null, $ub ?: null, (string)$r['id']]); $n++; }
    }
  }
  db()->prepare('UPDATE fcm_tokens SET user_email = ? WHERE user_email = ?')->execute([$new, $old]);
  return $n;
}

// A person's name changed: the records that name them follow.
function cascade_name(string $old, string $new): int {
  $old = trim($old); $new = trim($new);
  if ($old === '' || $new === '' || strcasecmp($old, $new) === 0) return 0;
  $n = 0;
  foreach (document_tables() as $t) {
    $rows = db()->query("SELECT id, data FROM `$t`")->fetchAll();
    $upd = db()->prepare("UPDATE `$t` SET data = ? WHERE id = ?");
    foreach ($rows as $r) {
      $d = $r['data'] ? json_decode($r['data'], true) : [];
      if (!is_array($d)) $d = [];
      if (replace_name_in($d, $old, $new)) { $upd->execute([json_encode($d, JSON_UNESCAPED_UNICODE), (string)$r['id']]); $n++; }
    }
  }
  db()->prepare('UPDATE fcm_tokens SET user_name = ? WHERE user_name = ?')->execute([$new, $old]);
  return $n;
}

// Is this record this person's? By email where the record has one, else by name.
function record_is_persons(array $doc, array $fields, array $person): bool {
  $email = strtolower(trim((string)($person['email'] ?? '')));
  $name = trim((string)($person['display_name'] ?? ''));
  foreach ($fields['emails'] as $f) { if ($email !== '' && strcasecmp(trim((string)($doc[$f] ?? '')), $email) === 0) return true; }
  foreach ($fields['names'] as $f) { if ($name !== '' && strcasecmp(trim((string)($doc[$f] ?? '')), $name) === 0) return true; }
  return false;
}

// The records linked to this person, by collection — what the Owner picks
// from when deciding what moves.
function records_of_user(array $target): array {
  $out = [];
  foreach (PERSON_FIELDS as $collection => $fields) {
    $table = collection_table($collection);
    $rows = db()->query("SELECT id, data FROM `$table` ORDER BY created_at DESC")->fetchAll();
    $list = [];
    foreach ($rows as $r) {
      $d = $r['data'] ? json_decode($r['data'], true) : [];
      if (!is_array($d)) continue;
      if (!record_is_persons($d, $fields, $target)) continue;
      // A dispatch already received is history, not an open assignment.
      if ($collection === 'leadPOs' && !empty($d['dispatchReceivedAt'])) continue;
      $list[] = [
        'id' => (string)$r['id'],
        'title' => (string)($d['name'] ?? $d['customerName'] ?? $d['title'] ?? $d['poNumber'] ?? $r['id']),
        'status' => (string)($d['status'] ?? $d['installationStatus'] ?? ''),
        'date' => (string)($d['dateGenerated'] ?? $d['dueDate'] ?? $d['poDate'] ?? $d['startDate'] ?? ''),
        'teamLeader' => (string)($d['teamLeader'] ?? ''),
      ];
    }
    $out[$collection] = $list;
  }
  return $out;
}

// Rewrite the chosen records: to another person (a hand-over) and/or to
// another team (the leads' team link). Each record keeps a note of the move.
function transfer_records(array $actor, array $from, ?array $to, string $newLeader, array $chosen, bool $relinkTeam): array {
  $counts = [];
  $stamp = ['at' => gmdate('Y-m-d\TH:i:s\Z'), 'by' => (string)($actor['email'] ?? ''), 'from' => user_label($from)];
  if ($to) $stamp['to'] = user_label($to);
  foreach (PERSON_FIELDS as $collection => $fields) {
    $ids = array_values(array_filter(array_map('strval', (array)($chosen[$collection] ?? []))));
    if (!$ids) continue;
    $table = collection_table($collection);
    $sel = db()->prepare("SELECT id, data FROM `$table` WHERE id = ? LIMIT 1");
    $upd = db()->prepare("UPDATE `$table` SET data = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?");
    $n = 0;
    foreach (array_unique($ids) as $id) {
      $sel->execute([$id]); $r = $sel->fetch();
      if (!$r) continue;
      $d = $r['data'] ? json_decode($r['data'], true) : [];
      if (!is_array($d)) $d = [];
      if (!record_is_persons($d, $fields, $from)) continue;   // never someone else's record
      $changed = false;
      if ($to) {
        $toName = user_label($to); $toEmail = strtolower(trim((string)$to['email']));
        foreach ($fields['names'] as $f) { if (strcasecmp(trim((string)($d[$f] ?? '')), trim((string)$from['display_name'])) === 0) { $d[$f] = $toName; $changed = true; } }
        foreach ($fields['emails'] as $f) { if (isset($d[$f]) || $f === 'assignedToEmail') { $d[$f] = $toEmail; $changed = true; } }
        if ($collection === 'leads') {
          // The lead's team follows its new person.
          $tl = team_leader_of($toEmail);
          if ((string)($d['teamLeader'] ?? '') !== $tl) { $d['teamLeader'] = $tl; $changed = true; }
        }
      } elseif ($relinkTeam && $collection === 'leads') {
        if ((string)($d['teamLeader'] ?? '') !== $newLeader) { $d['teamLeader'] = $newLeader; $changed = true; }
      }
      if (!$changed) continue;
      $d['transferHistory'] = array_values((array)($d['transferHistory'] ?? []));
      $d['transferHistory'][] = $stamp + ['what' => $to ? 'handed over' : 'team changed'];
      $upd->execute([json_encode($d, JSON_UNESCAPED_UNICODE), (string)($actor['email'] ?? ''), $id]);
      $n++;
    }
    $counts[$collection] = $n;
  }
  return $counts;
}

// The leads a team's leader is on record for (lead.teamLeader), as the
// Owner picks which should carry the next leader. Only picked leads that
// really carry the old leader move; each keeps a note of the change.
function relink_team_leads(array $actor, array $prevLeader, string $newLeader, array $ids): int {
  $ids = array_values(array_unique(array_filter(array_map('strval', $ids))));
  if (!$ids) return 0;
  $old = strtolower(trim((string)$prevLeader['email']));
  $sel = db()->prepare('SELECT id, data FROM `leads` WHERE id = ? LIMIT 1');
  $upd = db()->prepare('UPDATE `leads` SET data = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?');
  $n = 0;
  foreach ($ids as $id) {
    $sel->execute([$id]); $r = $sel->fetch();
    if (!$r) continue;
    $d = $r['data'] ? json_decode($r['data'], true) : [];
    if (!is_array($d) || strcasecmp(trim((string)($d['teamLeader'] ?? '')), $old) !== 0) continue;
    $d['teamLeader'] = $newLeader;
    $d['transferHistory'] = array_values((array)($d['transferHistory'] ?? []));
    $d['transferHistory'][] = ['at' => gmdate('Y-m-d\TH:i:s\Z'), 'by' => (string)($actor['email'] ?? ''), 'from' => user_label($prevLeader), 'to' => $newLeader, 'what' => 'team leader changed'];
    $upd->execute([json_encode($d, JSON_UNESCAPED_UNICODE), (string)($actor['email'] ?? ''), $id]);
    $n++;
  }
  return $n;
}

// The leads that carry this person as their Team Leader.
function team_leads_of(array $leader): array {
  $email = strtolower(trim((string)$leader['email']));
  $out = [];
  foreach (db()->query('SELECT id, data FROM `leads` ORDER BY created_at DESC')->fetchAll() as $r) {
    $d = $r['data'] ? json_decode($r['data'], true) : [];
    if (!is_array($d) || strcasecmp(trim((string)($d['teamLeader'] ?? '')), $email) !== 0) continue;
    $out[] = ['id' => (string)$r['id'], 'title' => (string)($d['name'] ?? $r['id']), 'status' => (string)($d['status'] ?? ''), 'date' => (string)($d['dateGenerated'] ?? ''), 'assignedTo' => (string)($d['assignedTo'] ?? '')];
  }
  return $out;
}

function handle_users(array $seg, string $method): void {
  $claims = require_auth();
  if (!has_access((string)($claims['role'] ?? ''), 'admin')) fail(403, 'Admins only');
  $uid = $seg[1] ?? '';
  $op = $seg[2] ?? '';
  if ($uid === '') fail(404, 'User id required');
  $target = user_row($uid);
  if (!$target) fail(404, 'User not found');

  if ($op === 'records' && $method === 'GET') {
    // ?as=leader: the team's leads (by their Team Leader), for a leader change.
    if (($_GET['as'] ?? '') === 'leader') {
      $leads = team_leads_of($target);
      json_out(['records' => ['leads' => $leads], 'counts' => ['leads' => count($leads)], 'total' => count($leads)]);
    }
    $recs = records_of_user($target);
    $counts = array_map('count', $recs);
    json_out(['records' => $recs, 'counts' => $counts, 'total' => array_sum($counts)]);
  }

  if ($op === 'history' && $method === 'GET') {
    $rows = db()->query("SELECT id, data, created_at FROM activity_log ORDER BY created_at DESC")->fetchAll();
    $out = [];
    $label = user_label($target);
    foreach ($rows as $r) {
      $d = $r['data'] ? json_decode($r['data'], true) : [];
      if (!is_array($d) || ($d['module'] ?? '') !== 'users') continue;
      if ((string)($d['targetId'] ?? '') !== $uid && stripos((string)($d['details'] ?? ''), $label) === false) continue;
      $d['id'] = (string)$r['id']; $d['createdAt'] = to_iso($r['created_at']);
      $out[] = $d;
      if (count($out) >= 200) break;
    }
    json_out(['history' => $out]);
  }

  if ($op === 'status' && $method === 'POST') {
    $b = body();
    $d = set_user_status($claims, $target, (string)($b['status'] ?? ''), (string)($b['note'] ?? ''));
    json_out(['ok' => true, 'status' => $d['status'] ?? 'active']);
  }

  // Team / role change, with the Owner's choice of what happens to the records.
  if ($op === 'reassign' && $method === 'POST') {
    $b = body();
    $mode = (string)($b['recordMode'] ?? 'keep');
    if (!in_array($mode, ['selected', 'fresh', 'keep'], true)) fail(400, 'Choose what happens to the existing records');
    $d = user_data($target);
    $changes = [];
    // 1. the team
    $leaderGiven = array_key_exists('teamLeader', $b);
    $newLeader = $leaderGiven ? strtolower(trim((string)$b['teamLeader'])) : strtolower(trim((string)($d['teamLeader'] ?? '')));
    if ($leaderGiven) {
      if ($newLeader !== '' && $newLeader === strtolower(trim((string)$target['email']))) fail(400, 'A person cannot report to themselves');
      if ($newLeader !== '' && !find_user_by_email($newLeader)) fail(404, 'That Team Leader has no account');
      $oldLeader = strtolower(trim((string)($d['teamLeader'] ?? '')));
      if ($oldLeader !== $newLeader) { $d['teamLeader'] = $newLeader; $changes[] = 'team: ' . ($oldLeader ?: 'none') . ' → ' . ($newLeader ?: 'none'); }
    }
    // 2. the role
    if (!empty($b['designation'])) {
      $desig = trim((string)$b['designation']);
      $role = role_from_designation($desig);
      if ($role !== (string)$target['role'] || $desig !== (string)$target['designation']) {
        if ($role === 'super_admin' && (string)($claims['role'] ?? '') !== 'super_admin') fail(403, 'Only the Owner can make someone an Owner.');
        guard_owner($claims, $target, (string)$target['role'] === 'super_admin' && $role !== 'super_admin' ? 'demote' : 'role');
        db()->prepare('UPDATE users SET role = ?, designation = ? WHERE id = ?')->execute([$role, $desig, $uid]);
        $changes[] = 'role: ' . $target['designation'] . ' → ' . $desig;
      }
    }
    save_user_data($uid, $d);
    // 3. the records
    $to = null;
    if (!empty($b['toUserId'])) {
      $to = user_row((string)$b['toUserId']);
      if (!$to) fail(404, 'The person to hand the records to has no account');
      if ((string)$to['id'] === $uid) fail(400, 'Choose a different person to hand the records to');
      if (user_status($to) !== 'active' || !(int)$to['approved']) fail(409, 'The person to hand the records to is not an active account');
    }
    $counts = [];
    if ($mode === 'selected') {
      $counts = transfer_records($claims, $target, $to, $newLeader, (array)($b['records'] ?? []), $leaderGiven);
    }
    $moved = array_sum($counts);
    $what = $mode === 'selected' ? "$moved record(s) moved" : ($mode === 'fresh' ? 'existing records left as they are; new work follows the new assignment' : 'existing records left unchanged');
    audit_user_event($claims, 'Reassigned', (implode('; ', $changes) ?: 'no change to team or role') . '; ' . $what . ($to ? ' to ' . user_label($to) : ''), $target,
      ['oldValue' => ['teamLeader' => (string)(user_data($target)['teamLeader'] ?? ''), 'role' => (string)$target['designation']], 'newValue' => ['teamLeader' => $newLeader, 'role' => (string)($b['designation'] ?? $target['designation'])], 'records' => $counts]);
    json_out(['ok' => true, 'changes' => $changes, 'records' => $counts]);
  }

  // This person leads the team from now on.
  if ($op === 'make-leader' && $method === 'POST') {
    $b = body();
    $fromId = (string)($b['fromLeaderId'] ?? '');
    $prev = $fromId !== '' ? user_row($fromId) : null;
    if ($fromId !== '' && !$prev) fail(404, 'The current Team Leader has no account');
    if ($prev && (string)$prev['id'] === $uid) fail(400, 'This person already leads that team');
    if (user_status($target) !== 'active' || !(int)$target['approved']) fail(409, 'Only an active, approved account can lead a team');
    $newEmail = strtolower(trim((string)$target['email']));
    $d = user_data($target);
    // The new leader: the role, the team's name, and no leader above them.
    $oldRole = (string)$target['designation'];
    if ((string)$target['role'] !== 'team_leader' && !has_access((string)$target['role'], 'manager')) {
      db()->prepare("UPDATE users SET role = 'team_leader', designation = 'Team Leader' WHERE id = ?")->execute([$uid]);
    }
    if ($prev) { $pd = user_data($prev); if (!empty($pd['teamName'])) $d['teamName'] = $pd['teamName']; }
    if (!empty($b['teamName'])) $d['teamName'] = trim((string)$b['teamName']);
    $d['teamLeader'] = '';
    save_user_data($uid, $d);
    // The members move under the new leader.
    $moved = 0;
    if ($prev) {
      $prevEmail = strtolower(trim((string)$prev['email']));
      foreach (db()->query('SELECT id, data FROM users')->fetchAll() as $r) {
        if ((string)$r['id'] === $uid) continue;
        $md = $r['data'] ? json_decode($r['data'], true) : [];
        if (!is_array($md)) $md = [];
        if (strcasecmp(trim((string)($md['teamLeader'] ?? '')), $prevEmail) === 0) { $md['teamLeader'] = $newEmail; save_user_data((string)$r['id'], $md); $moved++; }
      }
      // The previous leader: stays as a member, or takes the role the Owner chose.
      $pd = user_data($prev);
      unset($pd['teamName']);
      $stays = !empty($b['previousStays']);
      $pd['teamLeader'] = $stays ? $newEmail : '';
      save_user_data((string)$prev['id'], $pd);
      $newDesig = trim((string)($b['previousDesignation'] ?? ''));
      if ($newDesig !== '' && $newDesig !== (string)$prev['designation']) {
        $r = role_from_designation($newDesig);
        if ($r === 'super_admin' && (string)($claims['role'] ?? '') !== 'super_admin') fail(403, 'Only the Owner can make someone an Owner.');
        guard_owner($claims, $prev, (string)$prev['role'] === 'super_admin' && $r !== 'super_admin' ? 'demote' : 'role');
        db()->prepare('UPDATE users SET role = ?, designation = ? WHERE id = ?')->execute([$r, $newDesig, (string)$prev['id']]);
      } elseif ($stays && (string)$prev['role'] === 'team_leader') {
        db()->prepare("UPDATE users SET role = 'executive', designation = 'Executive' WHERE id = ?")->execute([(string)$prev['id']]);
      }
    }
    // The leads: only the ones the Owner picked follow the new leader.
    $counts = [];
    $mode = (string)($b['recordMode'] ?? 'keep');
    if ($mode === 'selected' && $prev) {
      $counts = ['leads' => relink_team_leads($claims, $prev, $newEmail, (array)(($b['records'] ?? [])['leads'] ?? []))];
    }
    audit_user_event($claims, 'Made Team Leader', ($prev ? 'in place of ' . user_label($prev) . "; $moved member(s) moved across" : 'of a new team') . ($oldRole !== 'Team Leader' ? "; role was $oldRole" : '') . (array_sum($counts) ? '; ' . array_sum($counts) . ' lead(s) relinked' : ''),
      $target, ['oldValue' => $prev ? user_label($prev) : '', 'newValue' => user_label($target), 'records' => $counts]);
    if ($prev) audit_user_event($claims, 'Stepped down as Team Leader', (!empty($b['previousStays']) ? 'stays in the team as a member' : 'no longer in the team') . (!empty($b['previousDesignation']) ? '; now ' . $b['previousDesignation'] : ''), $prev);
    json_out(['ok' => true, 'membersMoved' => $moved, 'records' => $counts]);
  }

  fail(404, 'Unknown users route');
}
