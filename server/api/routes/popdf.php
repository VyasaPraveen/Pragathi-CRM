<?php
// ============================================================================
// GET/POST /po-pdf?id=<lead PO id>
//
// Builds the Purchase Order — the PO letter and its Bill of Materials — as a
// real PDF, following the company's reference document. Saved under
// uploads/purchase-orders so it has a stable address for opening, downloading
// or sending on.
//
//   ?download=1  → the file itself, as an attachment
//   otherwise    → { url, name, bytes, poNumber, materials }
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

require_once __DIR__ . '/../lib/po_pdf.php';

function handle_po_pdf(string $method): void {
  $claims = require_auth();
  if (!in_array($method, ['GET', 'POST'], true)) fail(405, 'Method not allowed');
  if (!may_module($claims, 'purchase_orders')) fail(403, 'You do not have access to purchase orders');

  $id = trim((string)($_GET['id'] ?? (body()['id'] ?? '')));
  if ($id === '') fail(400, 'Purchase order id required');

  $st = db()->prepare('SELECT id, data FROM `lead_pos` WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  $row = $st->fetch();
  if (!$row) fail(404, 'Purchase order not found');

  $po = json_decode((string)$row['data'], true);
  if (!is_array($po)) fail(500, 'Purchase order could not be read');
  $po['id'] = $row['id'];

  // The lead behind it, so the customer details fill themselves in even when
  // the PO was saved before they were entered.
  $lead = [];
  if (!empty($po['leadId'])) {
    $ls = db()->prepare('SELECT data FROM `leads` WHERE id = ? LIMIT 1');
    $ls->execute([$po['leadId']]);
    $lr = $ls->fetch();
    if ($lr) {
      $decoded = json_decode((string)$lr['data'], true);
      if (is_array($decoded)) $lead = $decoded;
    }
  }

  $assets = realpath(__DIR__ . '/../../quotation') ?: (__DIR__ . '/../../quotation');
  $pdf = pps_po_pdf($po, $lead, $assets);
  if ($pdf === '' || substr($pdf, 0, 4) !== '%PDF') fail(500, 'Could not build the purchase order PDF');

  $ref = preg_replace('/[^A-Za-z0-9_-]+/', '-', (string)($po['poNumber'] ?? '')) ?: 'purchase-order';
  $who = preg_replace('/[^A-Za-z0-9]+/', '-', (string)($po['customerName'] ?? ($lead['name'] ?? ''))) ?: 'customer';
  $file = trim($ref . '_' . substr($who, 0, 40), '-') . '.pdf';

  if (!empty($_GET['download'])) {
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $file . '"');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
    exit;
  }

  $dir = rtrim(cfg()['upload_dir'], '/\\') . '/purchase-orders';
  if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) fail(500, 'Cannot create the purchase-orders folder');
  $name = $id . '_' . $file;
  if (file_put_contents($dir . '/' . $name, $pdf) === false) fail(500, 'Could not save the purchase order PDF');

  $materials = 0;
  foreach (($po['items'] ?? []) as $it) {
    if (is_array($it) && trim((string)($it['materialName'] ?? '')) !== '') $materials++;
  }

  json_out([
    'url' => rtrim(cfg()['upload_url_base'], '/') . '/purchase-orders/' . rawurlencode($name),
    'name' => $file,
    'bytes' => strlen($pdf),
    'poNumber' => (string)($po['poNumber'] ?? ''),
    'materials' => $materials,
  ]);
}
