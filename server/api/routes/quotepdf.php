<?php
// ============================================================================
// GET/POST /quotation-pdf?id=<quotation id>
//
// Builds the quotation as a real PDF file and keeps it under uploads/quotations
// so it has a stable address that can be opened, downloaded, or handed to
// WhatsApp. The quotation is read from the database rather than taken from the
// request body, so what the customer receives is what was approved.
//
//   ?download=1  → the file itself, as an attachment
//   otherwise    → { url, name, bytes, quotationRef }
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

require_once __DIR__ . '/../lib/quotation_pdf.php';

// The mobile number on the account of the person with this display name, or
// '' when there is none. The phone column is what Settings / User Management
// write; a number kept in the data JSON is accepted as well.
function qpdf_user_phone(string $displayName): string {
  $name = strtolower(trim($displayName));
  if ($name === '') return '';
  try {
    $st = db()->prepare('SELECT phone, data FROM `users` WHERE LOWER(display_name) = ? LIMIT 1');
    $st->execute([$name]);
    $r = $st->fetch();
    if (!$r) return '';
    $phone = trim((string)($r['phone'] ?? ''));
    if ($phone === '' && !empty($r['data'])) {
      $d = json_decode((string)$r['data'], true);
      if (is_array($d)) $phone = trim((string)($d['phone'] ?? ''));
    }
    return $phone;
  } catch (Throwable $e) {
    error_log('quotation pdf: could not read the signatory phone: ' . $e->getMessage());
    return '';
  }
}

// The role on the account of the person with this display name, as the word
// printed under their name on page 1 ("Executive", "Sales Manager", ...), or
// '' when there is no such account. Req 6 (15-Oct): the role is read from the
// account each time, never typed in.
function qpdf_user_role(string $displayName): string {
  $name = strtolower(trim($displayName));
  if ($name === '') return '';
  try {
    $st = db()->prepare('SELECT role FROM `users` WHERE LOWER(display_name) = ? LIMIT 1');
    $st->execute([$name]);
    $r = $st->fetch();
    return $r ? qpdf_role_label((string)($r['role'] ?? '')) : '';
  } catch (Throwable $e) {
    error_log('quotation pdf: could not read the signatory role: ' . $e->getMessage());
    return '';
  }
}
// The role keys as the account stores them → the words the customer reads.
// Mirrors roleLabel() in src/services/permissions.js; the Owner's account
// signs as the Owner.
function qpdf_role_label(string $role): string {
  static $labels = [
    'executive' => 'Executive', 'technical_manager' => 'Technical Manager', 'operation_manager' => 'Operation Manager',
    'accountant' => 'Accountant', 'admin' => 'Admin', 'management' => 'Management', 'bco' => 'BCO',
    'technician' => 'Technician', 'team_leader' => 'Team Leader', 'sales_manager' => 'Sales Manager',
    'warehouse_admin' => 'Warehouse Admin', 'super_admin' => 'Owner',
    // the legacy keys some older accounts still carry
    'manager' => 'Operation Manager', 'coordinator' => 'BCO', 'engineer' => 'Technician', 'staff' => 'Executive',
  ];
  return $labels[$role] ?? ucwords(str_replace('_', ' ', $role));
}

function handle_quotation_pdf(string $method): void {
  $claims = require_auth();
  if (!in_array($method, ['GET', 'POST'], true)) fail(405, 'Method not allowed');
  if (!may_module($claims, 'leads')) fail(403, 'You do not have access to quotations');

  $id = trim((string)($_GET['id'] ?? (body()['id'] ?? '')));
  if ($id === '') fail(400, 'Quotation id required');

  $st = db()->prepare('SELECT id, data FROM `quotations` WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  $row = $st->fetch();
  if (!$row) fail(404, 'Quotation not found');

  $q = json_decode((string)$row['data'], true);
  if (!is_array($q)) fail(500, 'Quotation could not be read');
  $q['id'] = $row['id'];

  // R11 (8-Oct): page 1 is signed by the assigned person, with their mobile.
  // The quotation rarely carries the number, so it is taken from the person's
  // own account here; the quotation record itself is not changed.
  if (trim((string)($q['executivePhone'] ?? '')) === '' && trim((string)($q['executiveName'] ?? '')) !== '') {
    $q['executivePhone'] = qpdf_user_phone((string)$q['executiveName']);
  }
  // Req 6 (15-Oct): and their role, printed under the name — Executive, Sales
  // Manager, whatever the account says — fetched the same way.
  if (trim((string)($q['executiveName'] ?? '')) !== '') {
    $q['executiveRole'] = qpdf_user_role((string)$q['executiveName']);
  }

  // The artwork lives beside the app, not in the API folder.
  $assets = realpath(__DIR__ . '/../../quotation') ?: (__DIR__ . '/../../quotation');
  $pdf = pps_quotation_pdf($q, $assets);
  if ($pdf === '' || substr($pdf, 0, 4) !== '%PDF') fail(500, 'Could not build the quotation PDF');

  // Req 11 — the file is named after the customer and their village, taken
  // from the lead, because "Quotation-016.pdf" tells nobody anything once it
  // is sitting in a WhatsApp thread or a downloads folder.
  //   Vijay-Badvel.pdf
  // The quotation reference is kept as a fallback for a record with neither.
  $file = qpdf_pdf_filename($q);

  if (!empty($_GET['download'])) {
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $file . '"');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
    exit;
  }

  // Saved under a folder of its own so a re-generated quotation replaces the
  // previous file instead of leaving copies behind for the customer to confuse.
  $dir = rtrim(cfg()['upload_dir'], '/\\') . '/quotations';
  if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) fail(500, 'Cannot create the quotations folder');
  $name = $id . '_' . $file;
  if (file_put_contents($dir . '/' . $name, $pdf) === false) fail(500, 'Could not save the quotation PDF');

  json_out([
    'url' => rtrim(cfg()['upload_url_base'], '/') . '/quotations/' . rawurlencode($name),
    'customerName' => (string)($q['customerName'] ?? ''),
    'name' => $file,
    'bytes' => strlen($pdf),
    'quotationRef' => qpdf_ref($q),
  ]);
}
