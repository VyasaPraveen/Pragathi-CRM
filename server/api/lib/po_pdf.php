<?php
// ============================================================================
// The Purchase Order as a real PDF, following the company's own reference
// document (shared 28-Sep-2026) page for page:
//
//   Page 1  the Letter of Indent / PO addressed to the supplier, the scopes,
//           the agreed price, the terms, the signature line, the customer's
//           details, and the payment and bank blocks side by side.
//   Page 2  the Bill of Materials on the letterhead, with the estimation and
//           actual quantities, the Pragathi / Customer scope ticks, and the
//           five signature spaces.
//
// This is the supplier-facing Purchase Order. The customer-facing quotation is
// a different document and lives in quotation_pdf.php — the two share the PDF
// writer and nothing else.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

require_once __DIR__ . '/pdf.php';

const PO_MARGIN = 55.0;
const PO_TOP    = 50.0;

// The company's own details, as printed on the reference.
const PO_SUPPLIER = [
  'M/S. Tata Power Renewable Eenergy Ltd',
  '78, Electronic City, Phase 1,',
  'Hosur Road, Bangalore - 560100',
];
const PO_THROUGH = [
  'Pragathi Power Solutions',
  '19-3-12/J, Ground Floor, Ramanuja Circle, Tiruchanoor Road, Tirupati-517501,',
  'Contact No: 7416298989, 9700073796 , 9701461156',
];
const PO_ACCOUNT = [
  ['C. A/C', '33599271521'],
  ['IFSC Code', 'SBIN0010677'],
  ['BANK', 'State Bank of India'],
  ['Branch', 'Ramanuja Circle'],
];

// The terms as approved on the reference. Each is only a default — whatever is
// typed on the PO wins.
const PO_DEFAULTS = [
  'taxes'        => 'GST included.',
  'freight'      => 'Included in the above said prices,',
  'warranty'     => 'BOS - 5 Yrs , Solar Inverter - 8 Yrs, Solar Modules - 30 Yrs',
  'delivery'     => '2-3 Weeks from the receipt of LOI /PO.',
  'installation' => 'Within 10 days from the date of material received.',
  'payment'      => '10% Advance along with PO, 80% Before dispatch the Material, and balance 10% After Installation.',
  'companyScope' => 'System Supply and Installation as per BOM.',
  'customerScope' => 'Civil Works, Elevated Structure, UPVC Pipes, Additional Relay, Additional Cables and Grid Synchronization ,CEIG and Coordination with APSPDCL .',
];

// Purchase orders raised before the terms were revised carry the wording the
// form used to default to. Those exact strings are rewritten on sight, the
// same way the quotation handles its own superseded wording — nobody chose
// them, they were simply what the form put there.
//
// Anything typed by hand is left exactly as it was typed: those are terms
// somebody decided on, and a printed purchase order is an agreement with the
// supplier, not ours to quietly restate.
function popdf_upgrade_term(string $key, string $text): string {
  static $legacy = null;
  if ($legacy === null) {
    $dash = "\u{2013}";
    $legacy = [
      'warrantyTerms' => [
        'Solar Inverter ' . $dash . ' 5 Yrs, Solar Modules- 5 Yrs +20 Yrs' => PO_DEFAULTS['warranty'],
        'Solar Inverter ' . $dash . ' 8 Yrs, Solar Modules- 5 Yrs +20 Yrs' => PO_DEFAULTS['warranty'],
        'Solar Inverter - 5 Yrs, Solar Modules- 5 Yrs +20 Yrs' => PO_DEFAULTS['warranty'],
      ],
      'deliveryTerms' => [
        '3-4 Weeks from the receipt of LOI /PO.' => PO_DEFAULTS['delivery'],
      ],
      'paymentTerms' => [
        '80% Advance along with PO, 20% Before dispatching the materials against PI.' => PO_DEFAULTS['payment'],
      ],
      'customerScope' => [
        'Civil works, UPVC Pipes, Additional cable if required more than 20 metres and Grid Synchronization Charges and Coordination with APSPDCL.' => PO_DEFAULTS['customerScope'],
      ],
    ];
  }
  return $legacy[$key][trim($text)] ?? $text;
}

// popdf_str(), then the legacy rewrite above.
function popdf_term(array $po, string $key, string $fallback): string {
  return popdf_upgrade_term($key, popdf_str($po, $key, $fallback));
}

// The order the printed BOM sheet lists materials in, S.No 1 to 25. Kept in
// step with BOM_REFERENCE_ORDER in src/services/bomOrder.js.
const PO_BOM_ORDER = [
  'Solar PV Module', 'Grid Tie Inverter', 'Junction Box / ACDB', 'Junction Box / DCDB',
  'Earthing Rods', 'LA', 'MC4 Connectors', 'Earth Chemical Bags', 'Earth Chambers',
  'DC Cable', 'AC Cable', 'Earthing Cable', 'MMS -2/4 (PPS Standard)',
  'If Any Elevated MMS (Height)', 'Additional AC Cable', 'Additional DC Cable',
  'Additional Earth Cable', 'UPVC Pipes & Fittings', 'Civil Works', 'Additional Relay',
  'DISCOM Charges', 'Ladder (Height)', 'MCS - Cleaning System', 'Additional Load',
  'Any Misc / Others',
];

// Spacing and punctuation differ between how a material was typed and how the
// sheet prints it, so they are ignored when matching.
function popdf_bom_rank(string $name): ?int {
  static $rank = null;
  if ($rank === null) {
    $rank = [];
    foreach (PO_BOM_ORDER as $i => $n) {
      $rank[preg_replace('/[^a-z0-9]/', '', strtolower($n))] = $i;
    }
  }
  $k = preg_replace('/[^a-z0-9]/', '', strtolower($name));
  return $rank[$k] ?? null;
}

// Materials in sheet order. Anything not on the sheet keeps its own order and
// follows the twenty-five. Applied when the BOM is drawn as well as when it is
// saved, so purchase orders already on file print in order without being
// rewritten.
function popdf_sort_items(array $items): array {
  $keyed = [];
  foreach (array_values($items) as $i => $it) {
    $name = is_array($it) ? (string)($it['materialName'] ?? '') : '';
    $r = popdf_bom_rank($name);
    $keyed[] = ['i' => $i, 'rank' => $r === null ? PHP_INT_MAX : $r, 'it' => $it];
  }
  usort($keyed, fn($a, $b) => $a['rank'] === $b['rank'] ? $a['i'] <=> $b['i'] : $a['rank'] <=> $b['rank']);
  return array_column($keyed, 'it');
}

function popdf_num($v, $fallback = 0) {
  if (is_numeric($v)) return $v + 0;
  $clean = preg_replace('/[^0-9.\-]/', '', (string)$v);
  return is_numeric($clean) ? $clean + 0 : $fallback;
}

function popdf_str($po, string $key, string $fallback = ''): string {
  $v = $po[$key] ?? '';
  $v = is_scalar($v) ? trim((string)$v) : '';
  return $v !== '' ? $v : $fallback;
}

function popdf_inr($n): string {
  $n = (float)$n;
  if ($n <= 0) return '';
  $s = (string)(int)round($n);
  if (strlen($s) > 3) {
    $last3 = substr($s, -3);
    $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', substr($s, 0, -3));
    $s = $rest . ',' . $last3;
  }
  return $s;
}

// "System of 5 kW with 3 Phase of 5 kW Inverter" — the wording the reference
// uses. The phase follows the system size when it has not been set by hand:
// anything above 5 kW is a three-phase connection.
function popdf_system_line(array $po, array $lead = []): string {
  $kw = popdf_str($po, 'systemKw', popdf_str($po, 'kwRequired', (string)($lead['kwRequired'] ?? '')));
  $kw = trim(preg_replace('/\s*kw\s*/i', '', $kw));
  $invKw = popdf_str($po, 'inverterKw', $kw);
  $phase = popdf_str($po, 'phase', '');
  if ($phase === '' && $kw !== '') $phase = popdf_num($kw) > 5 ? '3' : '1';
  $phase = trim(preg_replace('/\s*phase\s*/i', '', $phase));
  $blank = fn($v) => $v === '' ? '____' : $v;
  return 'System of ' . $blank($kw) . ' kW with ' . $blank($phase) . ' Phase of ' . $blank($invKw) . ' kW Inverter';
}

// ── the document ────────────────────────────────────────────────────────────
function pps_po_pdf(array $po, array $lead = [], string $assetDir = ''): string {
  $pdf = new PpsPdf();
  $L = PO_MARGIN;
  $R = PpsPdf::A4_W - PO_MARGIN;
  $W = $R - $L;

  /* ══════════════════ Page 1 — the Purchase Order ══════════════════ */
  $pdf->addPage();
  $pdf->setFill(0, 0, 0);
  $pdf->setDraw(0, 0, 0);

  $y = PO_TOP + 26;
  $pdf->setFont('B', 19);
  $title = 'Purchase Order';
  $pdf->textCentre($L + $W / 2, $y, $title);
  $pdf->setLineWidth(1.1);
  $tw = $pdf->widthOf($title);
  $pdf->line($L + $W / 2 - $tw / 2, $y + 3, $L + $W / 2 + $tw / 2, $y + 3);
  $y += 32;

  // To / Through
  $indent = $L + 55;
  $pdf->setFont('', 10.5);
  $pdf->text($L, $y, 'To');
  $y += 16;
  foreach (array_merge([popdf_str($po, 'vendorName', PO_SUPPLIER[0])], array_slice(PO_SUPPLIER, 1)) as $line) {
    $pdf->text($indent, $y, $line);
    $y += 14;
  }
  $y += 10;
  $pdf->text($L, $y, 'Through');
  $y += 17;
  foreach (PO_THROUGH as $line) {
    $pdf->text($indent, $y, $line);
    $y += 14;
  }
  $y += 12;

  $pdf->setFont('B', 10.5);
  $pdf->text($L, $y, 'Respected Sir,');
  $y += 19;

  // The opening paragraph, with the system description in the reference's words.
  $pdf->setFont('', 10.5);
  $where = popdf_str($po, 'plantLocation', popdf_str($po, 'customerAddress', (string)($lead['address'] ?? '')));
  $para = 'We are pleased to release the Letter of Indent / PO for the Supply & Installation of Tata Power Solar '
    . popdf_system_line($po, $lead) . ' on our Residential Building/ Commercial Plant Location @ '
    . ($where !== '' ? $where : '________________') . '.';
  $y = $pdf->textWrap($indent, $y, $R - $indent, $para, 15) + 6;

  // Scopes and price
  $labelX = $L + 16;
  $valueX = $L + 152;
  $row = function (string $label, string $value, bool $bold = true) use ($pdf, $labelX, $valueX, $R, &$y) {
    $pdf->setFont($bold ? 'B' : '', 10);
    $pdf->text($labelX, $y, $label);
    $pdf->setFont('', 10.5);
    $pdf->text($valueX - 10, $y, ':');
    $y = $pdf->textWrap($valueX, $y, $R - $valueX, $value, 14);
    $y += 4;
  };
  $row('Company Scope', popdf_str($po, 'companyScope', PO_DEFAULTS['companyScope']));
  $row('Customer Scope', popdf_term($po, 'customerScope', PO_DEFAULTS['customerScope']));
  $y += 3;

  // The final agreed price is the figure entered in the PO's "Amount" field.
  // It used to take "Price After Subsidy" (agreedPrice) first, which is a
  // different number with its own purpose; that field is left as it is and
  // only stands in here when no Amount was entered.
  $price = popdf_num($po['amount'] ?? 0) ?: popdf_num($po['agreedPrice'] ?? 0) ?: popdf_num($po['totalValue'] ?? 0);
  $pdf->setFont('', 10.5);
  $pdf->text($L, $y, 'Final agreed price');
  $pdf->text($valueX - 10, $y, ':');
  $pdf->setFont('B', 10.5);
  $pdf->text($valueX, $y, 'Rs.');
  $pdf->setFont('', 10.5);
  $amountText = $price > 0 ? popdf_inr($price) : '';
  $pdf->text($valueX + 24, $y, $amountText !== '' ? $amountText : '');
  // The reference keeps a ruled blank for the figure, so the line is drawn
  // whether or not a price has been agreed yet.
  $pdf->setLineWidth(0.6);
  $pdf->line($valueX + 22, $y + 2, $valueX + 165, $y + 2);
  $pdf->text($valueX + 170, $y, 'Including GST.');
  $y += 18;

  if (popdf_str($po, 'referenceNumber') !== '') {
    $pdf->setFont('', 10);
    $y = $pdf->textWrap($L, $y, $W, 'Note- : All Technical specifications should be inline with your Reference No: '
      . popdf_str($po, 'referenceNumber') . '.', 14) + 6;
  }
  $y += 4;

  // Other Terms & Conditions
  $pdf->setFont('B', 11);
  $pdf->text($L, $y, 'Other Terms & Conditions');
  $pdf->setLineWidth(0.7);
  $pdf->line($L, $y + 2.5, $L + $pdf->widthOf('Other Terms & Conditions'), $y + 2.5);
  $y += 17;

  foreach ([
    ['Taxes', popdf_str($po, 'taxTerms', PO_DEFAULTS['taxes'])],
    ['Freight', popdf_str($po, 'freightTerms', PO_DEFAULTS['freight'])],
    ['Guarantee/Warranty', popdf_term($po, 'warrantyTerms', PO_DEFAULTS['warranty'])],
    ['Delivery Lead Time', popdf_term($po, 'deliveryTerms', PO_DEFAULTS['delivery'])],
    ['Installation Lead Time', popdf_term($po, 'installationTerms', PO_DEFAULTS['installation'])],
    ['Payment-term', popdf_term($po, 'paymentTerms', PO_DEFAULTS['payment'])],
  ] as [$label, $value]) {
    $row($label, $value);
    $y -= 2;
  }

  // With Regards / signature of the Pragathi team
  $y = max($y + 30, 600.0);
  $pdf->setFont('', 10.5);
  $pdf->text($L, $y, 'With Regards,');
  $pdf->text($L + $W * 0.52, $y, 'Signature of the Pragathi Team');
  $y += 42;

  // Customer details — the four the requirement names, straight off the lead.
  $pdf->setFont('', 10.5);
  $cLabel = $L;
  $cColon = $L + 105;
  $cValue = $L + 115;
  foreach ([
    ['Customer Name', popdf_str($po, 'customerName', (string)($lead['name'] ?? ''))],
    ['Mobile number', popdf_str($po, 'customerPhone', (string)($lead['phone'] ?? ''))],
    ['Service Number', popdf_str($po, 'uscNo', (string)($lead['customerServiceNumber'] ?? ($lead['meterNumber'] ?? '')))],
    ['Address', popdf_str($po, 'customerAddress', (string)($lead['address'] ?? ''))],
  ] as [$label, $value]) {
    $pdf->setFont('', 10.5);
    $pdf->text($cLabel, $y, $label);
    $pdf->text($cColon, $y, ':');
    // The address can run long; it wraps rather than sliding off the page.
    $y = $pdf->textWrap($cValue, $y, $R - $cValue - 10, $value, 13);
    $y += 2;
  }
  $y += 16;

  // Payment details (left) and the bank account (right), as on the reference.
  $payTop = $y;
  $pdf->setFont('', 10.5);
  $pdf->text($L, $y, 'Payment Details :');
  $y += 16;
  $ruleFrom = $L + 90;
  $ruleTo = $L + 285;
  foreach ([
    ['Advance', popdf_str($po, 'advancePayment')],
    ['2nd Payment', popdf_str($po, 'secondPayment')],
    ['Final Payment', popdf_str($po, 'finalPayment')],
    ['Any Remarks', popdf_str($po, 'paymentRemarks')],
  ] as $i => [$label, $value]) {
    $pdf->setFont($i === 3 ? 'B' : '', 10);
    $pdf->text($L, $y, $label);
    $pdf->setFont('', 10);
    $pdf->text($ruleFrom - 8, $y, ':');
    if ($value !== '') $pdf->text($ruleFrom, $y, $value);
    $pdf->setLineWidth(0.6);
    $pdf->line($ruleFrom, $y + 2, $ruleTo, $y + 2);
    $y += 16;
  }

  $ay = $payTop;
  $ax = $L + 320;
  $pdf->setFont('', 10.5);
  $pdf->text($ax, $ay, 'Account Details:');
  $ay += 16;
  $pdf->setFont('B', 10.5);
  $pdf->text($ax, $ay, 'M/S Pragathi Power Solutions');
  $ay += 16;
  $pdf->setFont('', 10);
  foreach (PO_ACCOUNT as [$label, $value]) {
    $pdf->text($ax, $ay, $label);
    $pdf->text($ax + 78, $ay, ': ' . $value);
    $ay += 15;
  }

  /* ══════════════════ Page 2 — the Bill of Materials ══════════════════ */
  popdf_bom_page($pdf, $po, $lead, $assetDir);

  return $pdf->output();
}

// The BOM sheet. Rows that do not fit carry onto a further page, with the
// column headings repeated, and the signatures always sit under the last one.
function popdf_bom_page(PpsPdf $pdf, array $po, array $lead, string $assetDir): void {
  $L = PO_MARGIN - 20;
  $R = PpsPdf::A4_W - (PO_MARGIN - 20);
  $W = $R - $L;

  // S.No | Description | UOM | Make | Model/Rating | Est | Actuals | Pragathi | Customer
  // Model/Rating is the widest of the text columns because it carries the
  // specifications ("Mono Perc 595Wp DCR Bifacial", "wind rated 150 kmph...");
  // giving it room is what stops a long entry stretching the whole row.
  // Description of Material takes what is left, and the columns either side
  // were trimmed to give it more of it — material names are the longest text
  // on the sheet and were the most squeezed.
  // Description of Material takes whatever is left and gets the most of it;
  // Model/Rating is next because it carries the specifications. The rest are
  // set to just clear their own headings.
  $cols = [24.0, 0.0, 30.0, 66.0, 100.0, 46.0, 36.0, 40.0, 43.0];
  $cols[1] = $W - array_sum($cols);

  $header = function (bool $continued = false) use ($pdf, $po, $lead, $assetDir, $L, $R, $W, $cols) {
    $pdf->addPage();
    $pdf->setFill(0, 0, 0);
    $y = PO_TOP - 20;
    if ($continued) {
      $pdf->setFont('B', 11);
      $pdf->text($L, $y + 12, 'Bill of Materials (continued)');
      $y += 22;
      return popdf_bom_heads($pdf, $L, $y, $cols);
    }
    if ($assetDir !== '') {
      $file = rtrim($assetDir, '/\\') . DIRECTORY_SEPARATOR . 'letterhead.jpg';
      $h = $pdf->image($file, $L, $y, $W);
      if ($h > 0) $y += $h + 3;
    }
    if ($y < PO_TOP) $y = PO_TOP;

    // Title strip
    $pdf->setDraw(0, 0, 0);
    $pdf->setLineWidth(0.8);
    $pdf->rect($L, $y, $W, 20);
    $pdf->setFont('B', 12);
    $pdf->textCentre($L + $W / 2, $y + 14, 'Bill of Materials');
    $y += 20;

    // The header grid, as the reference sheet lays it out: three rows of two
    // label/value pairs — Refered By | Source of Lead, Customer Name | PO No /
    // Date, USC NO | Amount.
    $poDate = popdf_str($po, 'poDate');
    if ($poDate !== '') { $ts = strtotime($poDate); if ($ts) $poDate = date('d-m-Y', $ts); }
    $amount = popdf_num($po['amount'] ?? 0) ?: popdf_num($po['agreedPrice'] ?? 0) ?: popdf_num($po['totalValue'] ?? 0);
    $grid = [
      ['Refered By', popdf_str($po, 'referredBy', (string)($lead['referredByName'] ?? '')),
       'Source of Lead', popdf_str($po, 'sourceOfLead', (string)($lead['leadReference'] ?? ''))],
      ['Customer Name', popdf_str($po, 'customerName', (string)($lead['name'] ?? '')),
       'PO No / Date', trim(popdf_str($po, 'poNumber') . ($poDate !== '' ? ' / ' . $poDate : ''))],
      ['USC NO', popdf_str($po, 'uscNo', (string)($lead['customerServiceNumber'] ?? '')),
       'Amount', $amount > 0 ? 'Rs.' . popdf_inr($amount) : ''],
    ];
    // Four columns: label, value, label, value. The split is put where the
    // table's own column boundary falls, so the lines meet the ones below.
    $labelW = 92.0;
    $splitX = $L + $cols[0] + $cols[1] + $cols[2] + $cols[3];
    $rowH = 13.0;
    foreach ($grid as $g) {
      $pdf->setLineWidth(0.5);
      $pdf->rect($L, $y, $labelW, $rowH);
      $pdf->rect($L + $labelW, $y, $splitX - $L - $labelW, $rowH);
      $pdf->rect($splitX, $y, $labelW, $rowH);
      $pdf->rect($splitX + $labelW, $y, $R - $splitX - $labelW, $rowH);
      $pdf->setFont('B', 8.5);
      $pdf->text($L + 4, $y + 9.2, $g[0]);
      $pdf->text($splitX + 4, $y + 9.2, $g[2]);
      $pdf->setFont('', 8.5);
      $pdf->text($L + $labelW + 4, $y + 9.2, $g[1]);
      $pdf->text($splitX + $labelW + 4, $y + 9.2, $g[3]);
      $y += $rowH;
    }

    // The grouped Quantity / Scope headings sit directly above their columns.
    $qx = $L + $cols[0] + $cols[1] + $cols[2] + $cols[3] + $cols[4];
    $pdf->rect($L, $y, $qx - $L, 16);
    $pdf->rect($qx, $y, $cols[5] + $cols[6], 16);
    $pdf->rect($qx + $cols[5] + $cols[6], $y, $cols[7] + $cols[8], 16);
    $pdf->setFont('B', 9);
    $pdf->textCentre($qx + ($cols[5] + $cols[6]) / 2, $y + 11, 'Quantity');
    $pdf->textCentre($qx + $cols[5] + $cols[6] + ($cols[7] + $cols[8]) / 2, $y + 11, 'Scope');
    $y += 16;

    return popdf_bom_heads($pdf, $L, $y, $cols);
  };

  $y = $header();
  $bottom = PpsPdf::A4_H - 58;    // rows may run to the foot of the page

  $items = array_values(array_filter($po['items'] ?? [], fn($it) =>
    is_array($it) && (trim((string)($it['materialName'] ?? '')) !== '' || ($it['quantity'] ?? '') !== '')));
  // Sheet order, whatever order they were picked in.
  $items = popdf_sort_items($items);

  // How tall each row will be, worked out before any of them is drawn.
  $pdf->setFont('', 8.5);
  $heights = [];
  foreach ($items as $it) {
    $heights[] = max(14.0,
      $pdf->wrapHeight(trim((string)($it['materialName'] ?? '')), $cols[1] - 7, 9.5) + 5,
      $pdf->wrapHeight(trim((string)($it['make'] ?? '')), $cols[3] - 7, 9.5) + 5,
      $pdf->wrapHeight(trim((string)($it['specification'] ?? '')), $cols[4] - 7, 9.5) + 5);
  }
  $tailH = 18.0 + 6.0 + 104.0;   // the Total row, then the signature block

  $totalEst = 0;
  foreach ($items as $i => $it) {
    $name = trim((string)($it['materialName'] ?? ''));
    $make = trim((string)($it['make'] ?? ''));
    $model = trim((string)($it['specification'] ?? ''));
    $uom = trim((string)($it['unit'] ?? ''));
    $est = ($it['quantity'] ?? '') === '' || $it['quantity'] === null ? '' : (string)$it['quantity'];
    $act = ($it['actualQuantity'] ?? '') === '' || ($it['actualQuantity'] ?? null) === null ? '' : (string)$it['actualQuantity'];
    $totalEst += popdf_num($est);

    // The row is as tall as its tallest wrapped cell, so a long description
    // pushes the row down instead of overrunning the one below it.
    $pdf->setFont('', 8.5);
    $rowH = $heights[$i];

    // The last row has to leave room for what closes the table, so the
    // signatures never end up alone on a page after it.
    $limit = ($i === count($items) - 1) ? (PpsPdf::A4_H - 40 - $tailH) : $bottom;
    if ($y + $rowH > $limit) { $y = $header(true); }

    $pdf->setDraw(0, 0, 0);
    $pdf->setLineWidth(0.5);
    $x = $L;
    foreach ($cols as $cw) { $pdf->rect($x, $y, $cw, $rowH); $x += $cw; }

    $pdf->setFont('', 8.5);
    $mid = $y + $rowH / 2 + 3;
    $pdf->textCentre($L + $cols[0] / 2, $mid, (string)($i + 1));
    $pdf->textWrap($L + $cols[0] + 4, $y + 10, $cols[1] - 7, $name, 9.5);
    $x = $L + $cols[0] + $cols[1];
    $pdf->textCentre($x + $cols[2] / 2, $mid, $uom);
    $x += $cols[2];
    $pdf->textWrap($x + 4, $y + 10, $cols[3] - 7, $make, 9.5);
    $x += $cols[3];
    $pdf->textWrap($x + 4, $y + 10, $cols[4] - 7, $model, 9.5);
    $x += $cols[4];
    $pdf->textCentre($x + $cols[5] / 2, $mid, $est);
    $x += $cols[5];
    $pdf->textCentre($x + $cols[6] / 2, $mid, $act);
    $x += $cols[6];
    $pdf->setFont('B', 10);
    if (!empty($it['scopePragathi'])) $pdf->textCentre($x + $cols[7] / 2, $mid, 'X');
    $x += $cols[7];
    if (!empty($it['scopeCustomer'])) $pdf->textCentre($x + $cols[8] / 2, $mid, 'X');
    $y += $rowH;
  }

  if (!$items) {
    $pdf->setFont('', 9);
    $pdf->rect($L, $y, $W, 20);
    $pdf->textCentre($L + $W / 2, $y + 14, 'No materials have been added to this purchase order yet.');
    $y += 20;
  }

  // Total Quantity closes the table, as on the reference.
  $pdf->setFont('B', 9);
  $x = $L;
  foreach ($cols as $cw) { $pdf->rect($x, $y, $cw, 18); $x += $cw; }
  $pdf->text($L + $cols[0] + 4, $y + 12, 'Total Quantity');
  $pdf->textCentre($L + $cols[0] + $cols[1] + $cols[2] / 2, $y + 12, 'Nos');
  $pdf->textCentre($L + $cols[0] + $cols[1] + $cols[2] + $cols[3] + $cols[4] + $cols[5] / 2, $y + 12,
    $totalEst > 0 ? (string)(round($totalEst, 2) + 0) : '');
  $y += 18;

  // Declaration and the five signature spaces. They are never split across a
  // page break, so if the table finished near the foot they move to their own.
  $boxH = 104.0;
  if ($y + 6 + $boxH > PpsPdf::A4_H - 40) { $y = $header(true); }
  $boxTop = $y + 6;
  $pdf->setLineWidth(0.8);
  $pdf->rect($L, $boxTop, $W, $boxH);
  $pdf->setFont('', 10);
  $pdf->text($L + 8, $boxTop + 18, 'We here by agreed and confirm that the above -Bill of materials & Scope of works');
  $pdf->setFont('', 9.5);
  $pdf->text($L + 40, $boxTop + 54, 'Customer Signature');
  $pdf->text($L + $W * 0.52, $boxTop + 54, 'Pragathi Sales Representative');
  $pdf->text($L + 8, $boxTop + 94, 'Procurement');
  $pdf->textCentre($L + $W / 2, $boxTop + 94, 'Finance Dept');
  $pdf->textRight($R - 8, $boxTop + 94, 'Management');
}

// The BOM column headings. Drawn from here for the first page and for every
// carried-over page, so the two can never drift apart.
function popdf_bom_heads(PpsPdf $pdf, float $L, float $y, array $cols): float {
  $heads = ['S. No', 'Description of Material', 'UOM', 'Make', 'Model/ Rating', 'Estimation', 'Actuals', 'Pragathi', 'Customer'];
  $pdf->setFont('B', 8.5);
  $pdf->setDraw(0, 0, 0);
  $pdf->setLineWidth(0.5);
  $x = $L;
  foreach ($cols as $i => $cw) {
    $pdf->rect($x, $y, $cw, 18);
    $pdf->textCentre($x + $cw / 2, $y + 12, $heads[$i]);
    $x += $cw;
  }
  return $y + 18;
}
