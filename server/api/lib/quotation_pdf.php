<?php
// ============================================================================
// The quotation as a real PDF file.
//
// It follows the company's reference proposal: the covering letter, the four
// marketing pages, the budgetary proposal, the Bill of Materials and the
// benefits page. The marketing pages are the company's own artwork and are
// placed here as images.
//
// This is the only quotation document there is. There used to be a second one
// built as HTML in the browser for printing, and the two drifted apart until
// Print showed one layout and View another; the HTML copy is gone and Print,
// View, Download and WhatsApp all now serve this file.
// Keep the figures below in step with calcQuotation(); they are duplicated
// rather than shared because the two run on different sides of the wire.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

require_once __DIR__ . '/pdf.php';

const QPDF_MARGIN      = 34.0;   // 12mm, matching the on-screen page
const QPDF_TOP         = 28.0;
const QPDF_UNITS_PER_KW = 141;
const QPDF_TARIFF      = 8;
const QPDF_LOAN_RATE   = 0.07;

// The company's authorised signatory. Quotations go out over this name
// whoever they are assigned to, so it is a constant rather than a field.
const QPDF_AUTHORISED_SIGNATORY = 'K. Chandrasekhar';
const QPDF_SIGNATORY_MOBILE = '9701426440';
// Blank height left between the company name and "Authorized Signature"
// for the signature to be written in by hand.
const QPDF_SIGNATURE_GAP = 52.0;

// 1,23,456 — the Indian grouping the rest of the app uses.
function qpdf_inr($n): string {
  $n = (float)$n;
  $neg = $n < 0;
  $n = abs(round($n));
  $s = (string)(int)$n;
  if (strlen($s) > 3) {
    $last3 = substr($s, -3);
    $rest = substr($s, 0, -3);
    $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest);
    $s = $rest . ',' . $last3;
  }
  return ($neg ? '-' : '') . $s;
}

function qpdf_money($n): string { return 'Rs.' . qpdf_inr($n); }

function qpdf_num($v, $fallback = 0) {
  if (is_numeric($v)) return $v + 0;
  $clean = preg_replace('/[^0-9.\-]/', '', (string)$v);
  return is_numeric($clean) ? $clean + 0 : $fallback;
}

function qpdf_str($q, string $key, string $fallback = ''): string {
  $v = $q[$key] ?? '';
  $v = is_scalar($v) ? trim((string)$v) : '';
  return $v !== '' ? $v : $fallback;
}

// The same arithmetic as calcQuotation() on the client.
function qpdf_calc(array $q): array {
  $kw    = qpdf_num($q['kw'] ?? 0);
  $cost  = qpdf_num($q['systemCost'] ?? 0);
  $sub   = qpdf_num($q['subsidy'] ?? 0);
  $rate  = qpdf_num($q['tariff'] ?? 0) ?: QPDF_TARIFF;
  $perKw = qpdf_num($q['unitsPerKwMonth'] ?? 0) ?: QPDF_UNITS_PER_KW;
  $loan  = isset($q['loanRate']) && $q['loanRate'] !== '' && $q['loanRate'] !== null
    ? qpdf_num($q['loanRate']) : QPDF_LOAN_RATE;

  $generation = (int)round($kw * $perKw);
  $monthly    = (int)round($generation * $rate);
  $yearly     = $monthly * 12;
  $net        = max(0, $cost - $sub);
  $payback    = $yearly > 0 ? $net / $yearly : 0;
  $paybackLoan = $yearly > 0 ? ($net * (1 + $loan * $payback)) / $yearly : 0;

  return [
    'generation' => $generation, 'monthlySavings' => $monthly, 'yearlySavings' => $yearly,
    'netCost' => $net, 'tariff' => $rate, 'loan' => $loan,
    'paybackYears' => round($payback, 2), 'paybackLoanYears' => round($paybackLoan, 2),
  ];
}

// "QTN-001" or "QTN-001 - R2".
function qpdf_ref(array $q): string {
  $base = qpdf_str($q, 'quotationNumber');
  $rev = (int)qpdf_num($q['revision'] ?? 0);
  return $rev > 0 ? $base . ' - R' . $rev : $base;
}

// The seven standard rows, used while the quotation is still a proposal.
function qpdf_default_bom($kw): array {
  $k = qpdf_num($kw);
  $modules = $k > 0 ? (string)(int)ceil(($k * 1000) / 595) : '';
  $phase = $k > 5 ? '3 Phase' : '1 Phase';
  return [
    ['material' => 'Modules', 'specification' => 'Mono Perc 595Wp DCR (Bifacial)', 'quantity' => $modules, 'warranty' => '30 Years Performance Warranty as per MNRE'],
    ['material' => 'Solar On Grid tie String inverter', 'specification' => ($k ?: '__') . 'KW - ' . $phase . ' - 1 Nos', 'quantity' => '1 Nos', 'warranty' => '8 Years - Per Inverter (Extended Warranty Options are also available)'],
    ['material' => 'ACDB', 'specification' => 'Standard', 'quantity' => '1 Nos', 'warranty' => 'NA'],
    ['material' => 'DCDB', 'specification' => 'Standard', 'quantity' => '1 Nos', 'warranty' => 'NA'],
    ['material' => 'AC Cables', 'specification' => '3C X 4 Sqmm - 20 Mtrs Poly Cab', 'quantity' => '20 mtrs', 'warranty' => 'NA'],
    ['material' => 'DC Cable', 'specification' => '4 Sq - Poly Cab', 'quantity' => '20 mtrs', 'warranty' => 'NA'],
    ['material' => 'Earthing Kits & Lightening Arrester', 'specification' => 'Standard 60 Meters Cable with Earth Pits', 'quantity' => '3', 'warranty' => 'NA'],
  ];
}

// Quotations raised before the 28-Sep wording change still carry the old text.
function qpdf_warranty(string $text): string {
  static $legacy = [
    '25 Years Performance Warranty as per MNRE' => '30 Years Performance Warranty as per MNRE',
    '5 Years with Entire System (Extended Warranty Options are also available)' => '8 Years - Per Inverter (Extended Warranty Options are also available)',
    '5 Yrs -Complete System & 25 Yrs for Solar Modules' => '8 Yrs - Per Inverter, 5 Yrs - Complete System & 30 Yrs for Solar Modules',
  ];
  $t = trim($text);
  return $legacy[$t] ?? $text;
}

// Which picture belongs beside a material — same rules as bomImageFor().
function qpdf_bom_image(string $material): string {
  static $exact = [
    'Modules' => 'modules',
    'Solar On Grid tie String inverter' => 'inverter',
    'ACDB' => 'acdb', 'DCDB' => 'dcdb',
    'AC Cables' => 'ac-cable', 'DC Cable' => 'dc-cable',
    'Earthing Kits & Lightening Arrester' => 'earthing',
  ];
  $name = trim($material);
  if ($name === '') return '';
  if (isset($exact[$name])) return $exact[$name];
  foreach ([
    '/mounting\s*structure|\bmms\b/i' => '',
    '/earth|lightening|lightning|\bla\b/i' => 'earthing',
    '/inverter/i'                     => 'inverter',
    '/acdb/i'                         => 'acdb',
    '/dcdb/i'                         => 'dcdb',
    '/\bac\b[\s-]*cable/i'            => 'ac-cable',
    '/\bdc\b[\s-]*cable/i'            => 'dc-cable',
    '/module|panel/i'                 => 'modules',
  ] as $re => $img) {
    if (preg_match($re, $name)) return $img;
  }
  return '';
}

// Req 11 — what the saved file is called.
//
// "<Customer> - <Village>.pdf", e.g. Vijay-Badvel.pdf. The village is the
// lead's city, falling back to its district. Anything a filesystem or a URL
// would object to is stripped, and the quotation reference stands in when the
// record carries neither a name nor a place.
function qpdf_pdf_filename(array $q): string {
  $clean = function ($v) {
    $v = preg_replace('/[^A-Za-z0-9 .&-]+/', ' ', (string)$v);
    return trim(preg_replace('/\s+/', ' ', $v));
  };
  $who = $clean($q['customerName'] ?? '');
  $where = $clean($q['city'] ?? '');
  if ($where === '') $where = $clean($q['district'] ?? '');

  $parts = array_values(array_filter([$who, $where], 'strlen'));
  $name = implode('-', $parts);
  // A name with no letter or digit in it is no name at all: a record holding
  // only punctuation would otherwise save as "....pdf". Falls back the same
  // way an empty one does.
  if (!preg_match('/[A-Za-z0-9]/', $name)) $name = $clean(qpdf_ref($q)) ?: 'Quotation';
  // Keep it short enough for any mail client or filesystem to be happy.
  if (strlen($name) > 80) $name = rtrim(substr($name, 0, 80));
  return $name . '.pdf';
}

// ── the document ────────────────────────────────────────────────────────────
// The closing page: the benefits of the system and what the modules and the
// inverter are rated for. Drawn rather than placed as artwork, because the
// module warranty has to say 30 years and the old page said 25 in a picture.
const QPDF_BENEFITS = [
  ['Benefits', [
    'Hedge against increasing grid prices which have increased by 40% in past 5 years',
    'Savings in electricity bill for 25 long years',
    'Expandable - Multiple grid tie inverters may be networked together for increased net metering capacity or future system growth',
    'Maintenance free system',
    'Accelerated depreciation benefit - Your rooftop investment is eligible for accelerated depreciation of 80% in first year of commissioning i.e. 30% times 80% of project cost is tax-savings in first year',
  ]],
  ['Solar Modules', [
    'IEC certified modules with 30 years warranty',
    'Reliability under extreme weather conditions, certified to withstand snow loads of up to 5400 Pa',
    'Greater energy generated due to positive tolerance',
  ]],
  ['Inverter', [
    'IP-65, environmental protection rating, can withstand extreme weather conditions',
    'High yield output with maximum efficiency of over 97%',
    'Wide input voltage range',
    'Compact Design with easy installation',
    'In-built anti-islanding feature',
  ]],
];

// ── the document ───────────────────────────────────────────────────────────
function pps_quotation_pdf(array $q, string $assetDir): string {
  $pdf = new PpsPdf();
  $asset = fn(string $n) => rtrim($assetDir, '/\\') . DIRECTORY_SEPARATOR . $n . '.jpg';
  $L = QPDF_MARGIN;
  $R = PpsPdf::A4_W - QPDF_MARGIN;
  $W = $R - $L;

  $calc = qpdf_calc($q);
  $ref  = qpdf_ref($q);
  $date = qpdf_str($q, 'date');
  $ts = $date !== '' ? strtotime($date) : time();
  $dateText = date('d/m/Y', $ts ?: time());

  // Letterhead, address rule and dealer footer — the frame every text page has.
  $frame = function () use ($pdf, $asset, $L, $R, $W) {
    $pdf->addPage();
    $y = QPDF_TOP;
    $y += $pdf->image($asset('letterhead'), $L, $y, $W);
    $y += 10;
    $pdf->setFont('', 7.5);
    $pdf->setFill(0, 0, 0);
    $pdf->text($L, $y, '#19-3-12/J, Ramanuja Circle, Tiruchanoor Road, Tirupati 517501, Mob: 9701461156  Website : www.pragathipowersolutions.com');
    $y += 4;
    $pdf->setLineWidth(1.4);
    $pdf->setDraw(0, 0, 0);
    $pdf->line($L, $y, $R, $y);
    return $y + 18;
  };
  $footer = function () use ($pdf, $asset, $L, $W) {
    $fw = $W * 0.62;
    $size = $pdf->imageSize($asset('footer-dealer'));
    $fh = $size ? $fw * $size['h'] / $size['w'] : 40;
    $pdf->image($asset('footer-dealer'), $L + ($W - $fw) / 2, PpsPdf::A4_H - QPDF_TOP - $fh, $fw);
  };
  // A marketing page is the artwork alone, edge to edge.
  $fullPage = function (string $name) use ($pdf, $asset) {
    $file = $asset($name);
    $size = $pdf->imageSize($file);
    if (!$size) return;
    $pdf->addPage();
    $h = PpsPdf::A4_W * $size['h'] / $size['w'];
    $pdf->image($file, 0, max(0, (PpsPdf::A4_H - $h) / 2), PpsPdf::A4_W);
  };

  // ── Page 1 — covering letter ───────────────────────────────────────────────
  $y = $frame();
  // The reference block sits on the right, with the date above it:
  //   Date
  //   PPS Ref
  //   Quotation No
  // The customer's own details stay on the left, below it.
  $pdf->setFont('', 9.5);
  $pdf->textRight($R, $y, 'Date: ' . $dateText);
  $y += 13;
  $pdf->textRight($R, $y, 'PPS Ref: ' . qpdf_str($q, 'ppsRef'));
  $y += 13;
  $quoteLabel = 'Quotation No: ';
  $pdf->setFont('B', 9.5);
  $refW = $pdf->widthOf($ref);
  $pdf->setFont('', 9.5);
  $pdf->text($R - $refW - $pdf->widthOf($quoteLabel), $y, $quoteLabel);
  $pdf->setFont('B', 9.5);
  $pdf->textRight($R, $y, $ref);
  $pdf->setFont('', 9.5);
  $y += 24;

  $addr = array_filter([qpdf_str($q, 'customerAddress'), qpdf_str($q, 'city'), qpdf_str($q, 'district')], 'strlen');
  $addrLine = implode(', ', $addr);
  if (qpdf_str($q, 'pincode') !== '') $addrLine .= ' - ' . qpdf_str($q, 'pincode');
  $pdf->setFont('', 10);
  $pdf->text($L, $y, 'To,'); $y += 14;
  $pdf->setFont('B', 10);
  $pdf->text($L, $y, qpdf_str($q, 'customerName') . ','); $y += 14;
  $pdf->setFont('', 10);
  if ($addrLine !== '') $y = $pdf->textWrap($L, $y, $W * 0.7, $addrLine, 14);
  $pdf->text($L, $y, 'Mob: ' . qpdf_str($q, 'customerPhone'));
  $y += 26;

  $pdf->text($L, $y, 'Sir/Madam,'); $y += 20;
  $pdf->setFont('B', 10);
  $pdf->text($L, $y, 'Sub:');
  $pdf->setFont('', 10);
  $pdf->text($L + 26, $y, 'Tentative Proposal for Solar Power Generating System Req-Reg.');
  $y += 16;
  $pdf->textCentre($L + $W / 2, $y, '***');
  $y += 20;

  foreach ([
    'With reference to the our discussion and site visit with your good selves regarding the requirement of Power Generating Systems, please find enclosed our budgetary proposal for "Solar Net metering System" for your kind perusal.',
    'Hope the details provided by us are in line with your requirement, please feel free to contact for clarifications if any.',
    'We assure the best services all the times.',
    'Thanking You in Advance for your kind cooperation',
  ] as $para) {
    $y = $pdf->textWrap($L, $y, $W, $para, 15) + 8;
  }

  // Req 4 — the authorised signature.
  //
  // The name here is the company's authorised signatory and is always
  // K. Chandrasekhar, whoever the quotation happens to be assigned to. It
  // used to print executiveName, which is why quotations went out over the
  // assigned executive's name.
  //
  // The gap below the company name is left deliberately empty: the printed
  // copy is signed by hand there, so nothing may be drawn into it.
  $y += 24;
  $pdf->text($L, $y, 'Yours Truly,');
  $y += 15;
  $pdf->text($L, $y, 'Pragathi Power Solutions,');
  $y += QPDF_SIGNATURE_GAP;        // room for the physical signature
  $pdf->text($L, $y, 'Authorized Signature');
  $y += 15;
  $pdf->setFont('B', 10);
  $pdf->text($L, $y, QPDF_AUTHORISED_SIGNATORY);
  $pdf->setFont('', 10);
  $y += 15;
  $pdf->text($L, $y, 'Mobile : ' . qpdf_str($q, 'executivePhone', QPDF_SIGNATORY_MOBILE));
  $footer();

  // ── Pages 2-5 — the company's marketing pages ──────────────────────────────
  foreach (['p2-netmetering', 'p3-schematic', 'p4-generation', 'p5-comparison'] as $p) $fullPage($p);

  // ── Page 6 — budgetary proposal ────────────────────────────────────────────
  $y = $frame();
  $pdf->setFont('B', 11.5);
  $pdf->setFill(31, 56, 100);
  $pdf->text($L, $y, 'Budgetary Proposal for Solar Rooftop as per Site Condition:');
  $pdf->setLineWidth(0.6);
  $pdf->setDraw(31, 56, 100);
  $pdf->line($L, $y + 2.5, $L + $pdf->widthOf('Budgetary Proposal for Solar Rooftop as per Site Condition:'), $y + 2.5);
  $pdf->setFill(0, 0, 0);
  $y += 16;

  $valX = $R - 118;                  // where the figures column starts
  $rowH = 17.0;
  $drawRow = function (string $label, string $value, array $opt = []) use ($pdf, $L, $R, $valX, &$y, $rowH) {
    $h = $opt['h'] ?? $rowH;
    $pdf->setDraw(68, 68, 68);
    $pdf->setLineWidth(0.5);
    $pdf->rect($L, $y, $valX - $L, $h);
    $pdf->rect($valX, $y, $R - $valX, $h);
    $colour = $opt['colour'] ?? [0, 0, 0];
    $pdf->setFill($colour[0], $colour[1], $colour[2]);
    $pdf->setFont($opt['labelBold'] ?? '' ? 'B' : '', 9);
    $pdf->text($L + 6, $y + $h - 5.5, $label);
    $pdf->setFont('B', 9);
    $pdf->textRight($R - 6, $y + $h - 5.5, $value);
    $pdf->setFill(0, 0, 0);
    $y += $h;
  };

  // Header band
  $pdf->setFill(31, 154, 214);
  $pdf->rect($L, $y, $W, 30, 'F');
  $pdf->setFill(255, 255, 255);
  $pdf->setFont('B', 11);
  $pdf->text($L + 6, $y + 13, 'Solar Rooftop System');
  $pdf->text($L + 6, $y + 25, 'Project Details');
  $pdf->setFont('B', 13);
  $pdf->textCentre($valX + ($R - $valX) / 2, $y + 20, qpdf_str($q, 'kw', '__') . 'KW');
  $pdf->setFill(0, 0, 0);
  $y += 30;

  $subsidy = qpdf_num($q['subsidy'] ?? 0);
  $costTop = $y;
  $drawRow('System Cost ( Including GST)', $subsidy > 0 ? '' : qpdf_money($q['systemCost'] ?? 0),
    ['h' => $subsidy > 0 ? 28 : $rowH]);
  if ($subsidy > 0) {
    // Cost on the first line, the subsidy in blue underneath it — the way the
    // reference proposal shows them. Both are drawn here so the two baselines
    // cannot land on top of each other.
    $pdf->setFont('B', 9);
    $pdf->textRight($R - 6, $costTop + 13, qpdf_money($q['systemCost'] ?? 0));
    $pdf->setFont('', 8);
    $pdf->setFill(31, 154, 214);
    $pdf->textRight($R - 6, $costTop + 24, '-' . qpdf_inr($subsidy));
    $pdf->setFill(0, 0, 0);
  }
  $drawRow('Solar Generation (Avg Units p.m)', (string)$calc['generation']);
  $drawRow('Monthly Avg. EB Savings Rs.' . $calc['tariff'], qpdf_money($calc['monthlySavings']));
  $drawRow('Yearly Avg. EB Savings Rs.', qpdf_money($calc['yearlySavings']));
  $drawRow('ROI / Pay Back ( In Years) by own Funds', number_format($calc['paybackYears'], 2));
  $drawRow('ROI / Pay Back by Bank Loan @' . round($calc['loan'] * 100) . '%', number_format($calc['paybackLoanYears'], 2));

  $pdf->setFill(112, 48, 160);
  $drawRow('Additional Charges/Customer Scope :', '', ['labelBold' => true, 'colour' => [112, 48, 160]]);
  foreach ([
    '- CEIG & SPDCL Grid Synchronization(except formalities)',
    '- Any Civil Works / Elevated Structure',
    '- UPVC Pipes , Additional Relay & If any other than BOS Materials',
  ] as $line) {
    $drawRow($line, 'Actuals', ['colour' => [204, 0, 0]]);
  }

  // Pragathi's own scope, then the terms block, both full width.
  $pdf->setDraw(68, 68, 68);
  $pdf->rect($L, $y, $W, 26);
  $pdf->setFont('B', 9);
  $pdf->text($L + 6, $y + 11, 'Pragathi Scope');
  $pdf->setFont('', 9);
  $pdf->text($L + 6, $y + 22, '-Supply&Installation as per BOM');
  $y += 26;

  $terms = [
    ['a.  Taxes', qpdf_str($q, 'gstNote', 'GST 8.9 % Applicable')],
    ['b.  Payment Terms', qpdf_str($q, 'paymentTerms', '100% Along with PO')],
    ['c.  Delivery Time', qpdf_str($q, 'deliveryTime', '20-30 Days for Material & next 30 Days for Project Completion')],
    ['d.  Warranty', qpdf_warranty(qpdf_str($q, 'warranty', '8 Yrs - Per Inverter, 5 Yrs - Complete System & 30 Yrs for Solar Modules'))],
    ['e.  Offer Validity', 'Validity of the present offer for ' . ((int)qpdf_num($q['validityDays'] ?? 0) ?: 15) . ' Days Only'],
  ];
  // The text goes down first and the box is drawn round whatever height it
  // ended up needing — measuring it in advance once left the bottom rule
  // running straight through the OPTION - II line.
  $labelW = 95.0;
  $ty = $y + 12;
  $pdf->setFont('B', 9);
  $pdf->text($L + 6, $ty, 'General Terms and Conditions for Supply:');
  $ty += 14;
  foreach ($terms as [$label, $val]) {
    $pdf->setFont('', 8.5);
    $pdf->text($L + 16, $ty, $label);
    $pdf->text($L + 16 + $labelW, $ty, ':');
    $ty = $pdf->textWrap($L + 24 + $labelW, $ty, $W - $labelW - 34, $val, 11);
    $ty += 1;
  }
  $ty += 9;
  $pdf->setFont('B', 9);
  $pdf->setFill(0, 0, 255);
  $pdf->text($L + 6, $ty, 'OPTION - II : ' . qpdf_str($q, 'optionTwo', 'Waree / Adani / Kirloskar / Luminous'));
  $pdf->setFill(0, 0, 0);
  $termsH = ($ty + 7) - $y;
  $pdf->setDraw(68, 68, 68);
  $pdf->setLineWidth(0.5);
  $pdf->rect($L, $y, $W, $termsH);
  $y += $termsH + 16;

  $pdf->setFont('B', 10.5);
  $pdf->setFill(31, 56, 100);
  $pdf->text($L, $y, 'Our Bank NEFT Details:');
  $pdf->setDraw(31, 56, 100);
  $pdf->line($L, $y + 2.5, $L + $pdf->widthOf('Our Bank NEFT Details:'), $y + 2.5);
  $pdf->setFill(0, 0, 0);
  $y += 15;
  $pdf->setFont('', 9.5);
  foreach (['PRAGATHI POWER SOLUTIONS,', 'STATE BANK OF INDIA,', 'Current A/C NO: 33599271521',
            'IFSC Code: SBIN0010677', 'RAMANUJA CIRCLE BRANCH, TIRUPATHI-01.'] as $line) {
    $pdf->text($L, $y, $line);
    $y += 13;
  }
  $footer();

  // ── Page 7+ — Bill of Materials ────────────────────────────────────────────
  $rows = [];
  foreach (($q['bomItems'] ?? []) as $r) {
    if (!is_array($r)) continue;
    $rows[] = [
      'material' => trim((string)($r['material'] ?? '')),
      'specification' => trim((string)($r['specification'] ?? '')),
      'quantity' => trim((string)($r['quantity'] ?? '')),
      'warranty' => qpdf_warranty(trim((string)($r['warranty'] ?? ''))),
    ];
  }
  if (!$rows) $rows = qpdf_default_bom($q['kw'] ?? 0);

  // S.No | Material | Picture | Specification | Qty | Warranty
  // S.No | Material Details | picture | Specification | Quantity | Warranty
  // The material column is the one that was squeezing names like
  // "Earthing Kits & Lightening Arrester" onto three lines; the picture
  // column had room to spare because the images are capped at 72pt wide.
  $cols = [26.0, 112.0, 92.0, 134.0, 46.0, 0.0];
  $cols[5] = $W - array_sum($cols);
  $headings = ['S.No', 'Material Details', '', 'Specification', 'Quantity', 'Warranty/ Gaurantee'];

  $y = $frame();
  $pdf->setFont('B', 11.5);
  $pdf->setFill(31, 56, 100);
  $pdf->text($L, $y, 'Bill of Materials');
  $pdf->setDraw(31, 56, 100);
  $pdf->line($L, $y + 2.5, $L + $pdf->widthOf('Bill of Materials'), $y + 2.5);
  $pdf->setFill(0, 0, 0);
  $y += 14;
  if (($q['bomSource'] ?? '') === 'po') {
    $pdf->setFont('', 8);
    $pdf->setFill(31, 56, 100);
    $pdf->text($L, $y, 'As per the confirmed Purchase Order.');
    $pdf->setFill(0, 0, 0);
    $y += 10;
  }

  $drawHead = function () use ($pdf, $L, $cols, $headings, &$y) {
    $pdf->setFont('B', 8.5);
    $pdf->setDraw(68, 68, 68);
    $pdf->setLineWidth(0.5);
    $x = $L;
    foreach ($cols as $i => $cw) {
      $pdf->rect($x, $y, $cw, 20);
      if ($headings[$i] !== '') $pdf->textCentre($x + $cw / 2, $y + 13, $headings[$i]);
      $x += $cw;
    }
    $y += 20;
  };
  $drawHead();

  // A row is as tall as its tallest cell, and never splits across a page.
  $bottom = PpsPdf::A4_H - QPDF_TOP - 52;
  foreach ($rows as $i => $r) {
    $pdf->setFont('', 8);
    $specH = $pdf->wrapHeight($r['specification'], $cols[3] - 8, 10);
    $warrH = $pdf->wrapHeight($r['warranty'] !== '' ? $r['warranty'] : 'NA', $cols[5] - 8, 10);
    $matH  = $pdf->wrapHeight($r['material'], $cols[1] - 8, 10);
    $img   = qpdf_bom_image($r['material']);
    $imgFile = $img !== '' ? $asset('bom-' . $img) : '';
    $imgSize = $imgFile !== '' ? $pdf->imageSize($imgFile) : null;
    $imgW = 0.0; $imgH = 0.0;
    if ($imgSize) {
      $imgW = min($cols[2] - 10, 72.0);
      $imgH = $imgW * $imgSize['h'] / $imgSize['w'];
      if ($imgH > 52) { $imgH = 52.0; $imgW = $imgH * $imgSize['w'] / $imgSize['h']; }
    }
    $rowH = max(22.0, $specH + 8, $warrH + 8, $matH + 8, $imgH + 8);

    if ($y + $rowH > $bottom) {
      $footer();
      $y = $frame();
      $pdf->setFont('B', 11.5);
      $pdf->setFill(31, 56, 100);
      $pdf->text($L, $y, 'Bill of Materials (continued)');
      $pdf->setFill(0, 0, 0);
      $y += 14;
      $drawHead();
    }

    $pdf->setDraw(68, 68, 68);
    $pdf->setLineWidth(0.5);
    $x = $L;
    foreach ($cols as $cw) { $pdf->rect($x, $y, $cw, $rowH); $x += $cw; }

    $pdf->setFont('', 8);
    $pdf->textCentre($L + $cols[0] / 2, $y + $rowH / 2 + 3, (string)($i + 1));
    // Each wrapped cell is centred in its row. They used to start at a fixed
    // offset from the top, so a one-line specification sat high against a
    // tall row while the quantity beside it was centred.
    $midWrap = function (float $x, float $w, string $text) use ($pdf, &$y, $rowH) {
      if (trim($text) === '') return;
      $h = $pdf->wrapHeight($text, $w, 10);
      $pdf->textWrap($x, $y + ($rowH - $h) / 2 + 8, $w, $text, 10);
    };
    $midWrap($L + $cols[0] + 4, $cols[1] - 8, $r['material']);
    if ($imgSize) {
      $pdf->image($imgFile, $L + $cols[0] + $cols[1] + ($cols[2] - $imgW) / 2, $y + ($rowH - $imgH) / 2, $imgW, $imgH);
    }
    $sx = $L + $cols[0] + $cols[1] + $cols[2];
    $midWrap($sx + 4, $cols[3] - 8, $r['specification']);
    $pdf->textCentre($sx + $cols[3] + $cols[4] / 2, $y + $rowH / 2 + 3, $r['quantity']);
    $midWrap($sx + $cols[3] + $cols[4] + 4, $cols[5] - 8, $r['warranty'] !== '' ? $r['warranty'] : 'NA');
    $y += $rowH;
  }

  $pdf->setFont('', 7.5);
  $pdf->setFill(85, 85, 85);
  $pdf->textRight($R, $y + 10, count($rows) . ' material' . (count($rows) === 1 ? '' : 's') . ' in this Bill of Materials.');
  $pdf->setFill(0, 0, 0);
  $footer();

  // ── Last page — benefits ───────────────────────────────────────────────────
  // ── Last page — benefits, modules and inverter ─────────────────────────────
  $y = $frame();
  foreach (QPDF_BENEFITS as [$heading, $points]) {
    $pdf->setFont('B', 13);
    $pdf->setFill(31, 56, 100);
    $pdf->text($L, $y, $heading);
    $pdf->setFill(0, 0, 0);
    $y += 18;
    $pdf->setFont('', 10);
    foreach ($points as $point) {
      // A small filled square stands in for the bullet: the standard fonts
      // have no dependable bullet glyph once the text is folded to WinAnsi.
      $pdf->rect($L + 14, $y - 4.2, 2.6, 2.6, 'F');
      $y = $pdf->textWrap($L + 24, $y, $W - 34, $point, 14) + 3;
    }
    $y += 12;
  }
  $footer();

  return $pdf->output();
}
