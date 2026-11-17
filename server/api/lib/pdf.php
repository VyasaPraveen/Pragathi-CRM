<?php
// ============================================================================
// A very small PDF writer — enough for the quotation, and nothing more.
//
// Hostinger gives us PHP without Composer, so there is no FPDF or dompdf to
// lean on. Everything the quotation needs is here: A4 pages, the two standard
// Helvetica faces, rules and filled boxes, and JPEG images placed at an exact
// size. JPEGs go in untouched as DCTDecode streams, so the company's own
// letterhead and marketing pages are reproduced exactly rather than redrawn.
//
// Coordinates are given with the origin at the TOP-LEFT of the page and y
// growing downwards, which is how the pages are described in quotation_pdf.php.
// PDF's own bottom-left origin is dealt with here and nowhere else.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

class PpsPdf {
  const A4_W = 595.28;
  const A4_H = 841.89;

  private array $objects = [];     // object bodies, numbered from 1
  private array $pages = [];       // ['content' => string, 'images' => [name => objId]]
  private ?int $cur = null;
  private array $images = [];      // path => ['id','name','w','h']
  private string $font = 'F1';
  private float $size = 11.0;

  public float $w = self::A4_W;
  public float $h = self::A4_H;

  // Standard-14 Helvetica widths, in 1/1000 em, for codes 32..126. Needed for
  // word wrapping and for right-aligning the money columns.
  private const W_REG = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,
  ];
  private const W_BOLD = [
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,
  ];

  public function addPage(): void {
    $this->pages[] = ['content' => '', 'images' => []];
    $this->cur = count($this->pages) - 1;
  }

  public function pageCount(): int { return count($this->pages); }

  private function put(string $s): void {
    if ($this->cur === null) $this->addPage();
    $this->pages[$this->cur]['content'] .= $s . "\n";
  }

  // ── graphics state ────────────────────────────────────────────────────────
  public function setFont(string $face, float $size): void {
    $this->font = ($face === 'B') ? 'F2' : 'F1';
    $this->size = $size;
  }
  public function setFill(int $r, int $g, int $b): void {
    $this->put(sprintf('%.3F %.3F %.3F rg', $r / 255, $g / 255, $b / 255));
  }
  public function setDraw(int $r, int $g, int $b): void {
    $this->put(sprintf('%.3F %.3F %.3F RG', $r / 255, $g / 255, $b / 255));
  }
  public function setLineWidth(float $w): void { $this->put(sprintf('%.2F w', $w)); }

  // ── text ──────────────────────────────────────────────────────────────────
  // y is the BASELINE, measured down from the top of the page.
  public function text(float $x, float $y, string $s): void {
    if ($s === '') return;
    $this->put(sprintf('BT /%s %.2F Tf %.2F %.2F Td (%s) Tj ET',
      $this->font, $this->size, $x, $this->h - $y, self::esc($s)));
  }
  public function textRight(float $right, float $y, string $s): void {
    $this->text($right - $this->widthOf($s), $y, $s);
  }
  public function textCentre(float $centre, float $y, string $s): void {
    $this->text($centre - $this->widthOf($s) / 2, $y, $s);
  }

  public function widthOf(string $s): float {
    $t = self::toWinAnsi($s);
    $tbl = $this->font === 'F2' ? self::W_BOLD : self::W_REG;
    $total = 0;
    for ($i = 0, $n = strlen($t); $i < $n; $i++) {
      $c = ord($t[$i]);
      $total += ($c >= 32 && $c <= 126) ? $tbl[$c - 32] : 556;
    }
    return $total * $this->size / 1000;
  }

  // Break a paragraph to fit $w and draw it. Returns the baseline just past the
  // last line, so callers stack blocks without counting lines themselves.
  public function textWrap(float $x, float $y, float $w, string $s, float $leading = 0, string $align = 'L'): float {
    $leading = $leading ?: $this->size * 1.45;
    foreach ($this->wrapLines($s, $w) as $line) {
      if ($align === 'R') $this->textRight($x + $w, $y, $line);
      elseif ($align === 'C') $this->textCentre($x + $w / 2, $y, $line);
      else $this->text($x, $y, $line);
      $y += $leading;
    }
    return $y;
  }

  // How tall would textWrap be, without drawing anything?
  public function wrapHeight(string $s, float $w, float $leading = 0): float {
    $leading = $leading ?: $this->size * 1.45;
    return count($this->wrapLines($s, $w)) * $leading;
  }

  public function wrapLines(string $s, float $w): array {
    $out = [];
    foreach (preg_split('/\r\n|\r|\n/', (string)$s) as $para) {
      $words = preg_split('/\s+/', trim($para));
      if (!$words || $words === ['']) { $out[] = ''; continue; }
      $line = '';
      foreach ($words as $word) {
        $try = $line === '' ? $word : $line . ' ' . $word;
        if ($this->widthOf($try) <= $w || $line === '') { $line = $try; continue; }
        $out[] = $line;
        $line = $word;
      }
      $out[] = $line;
    }
    return $out;
  }

  // ── shapes ────────────────────────────────────────────────────────────────
  public function rect(float $x, float $y, float $w, float $h, string $style = 'S'): void {
    $op = $style === 'F' ? 'f' : ($style === 'FD' ? 'B' : 'S');
    $this->put(sprintf('%.2F %.2F %.2F %.2F re %s', $x, $this->h - $y - $h, $w, $h, $op));
  }
  public function line(float $x1, float $y1, float $x2, float $y2): void {
    $this->put(sprintf('%.2F %.2F m %.2F %.2F l S', $x1, $this->h - $y1, $x2, $this->h - $y2));
  }

  // ── images ────────────────────────────────────────────────────────────────
  // Returns the height actually drawn, so a caller can place the next block
  // under it without recomputing the aspect ratio.
  public function image(string $path, float $x, float $y, float $w, ?float $h = null): float {
    $info = $this->imageObject($path);
    if (!$info) return 0.0;
    if ($h === null) $h = $w * $info['h'] / $info['w'];
    $this->pages[$this->cur]['images'][$info['name']] = $info['id'];
    $this->put(sprintf('q %.2F 0 0 %.2F %.2F %.2F cm /%s Do Q',
      $w, $h, $x, $this->h - $y - $h, $info['name']));
    return $h;
  }

  public function imageSize(string $path): ?array {
    $info = $this->imageObject($path);
    return $info ? ['w' => $info['w'], 'h' => $info['h']] : null;
  }

  private function imageObject(string $path): ?array {
    if (array_key_exists($path, $this->images)) return $this->images[$path];
    $this->images[$path] = null;     // remember the miss too, so a bad path is read once
    if (!is_file($path) || !is_readable($path)) return null;
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') return null;
    $meta = self::jpegMeta($raw);
    if (!$meta || $meta['w'] < 1 || $meta['h'] < 1) return null;

    $name = 'Im' . (count($this->images));
    $space = ['1' => '/DeviceGray', '3' => '/DeviceRGB', '4' => '/DeviceCMYK'][(string)$meta['channels']] ?? '/DeviceRGB';
    // Adobe writes CMYK JPEGs inverted; the Decode array puts that right.
    $decode = $meta['channels'] === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    $dict = '<< /Type /XObject /Subtype /Image /Width ' . $meta['w'] . ' /Height ' . $meta['h']
      . ' /ColorSpace ' . $space . ' /BitsPerComponent 8 /Filter /DCTDecode' . $decode
      . ' /Length ' . strlen($raw) . ' >>';
    $id = $this->addObject($dict . "\nstream\n" . $raw . "\nendstream");
    return $this->images[$path] = ['id' => $id, 'name' => $name, 'w' => $meta['w'], 'h' => $meta['h']];
  }

  // Width, height and channel count straight out of the JPEG's frame header.
  private static function jpegMeta(string $raw): ?array {
    if (substr($raw, 0, 2) !== "\xFF\xD8") return null;
    $i = 2; $n = strlen($raw);
    while ($i + 9 < $n) {
      if ($raw[$i] !== "\xFF") { $i++; continue; }
      $marker = ord($raw[$i + 1]);
      // Padding, and the markers that carry no length field.
      if ($marker === 0xFF) { $i++; continue; }
      if ($marker === 0xD8 || $marker === 0x01 || ($marker >= 0xD0 && $marker <= 0xD7)) { $i += 2; continue; }
      if ($marker === 0xD9 || $marker === 0xDA) return null;   // end of header section
      $len = (ord($raw[$i + 2]) << 8) + ord($raw[$i + 3]);
      if ($len < 2) return null;
      // SOF0..SOF15, minus the three that are not frame headers.
      if ($marker >= 0xC0 && $marker <= 0xCF && !in_array($marker, [0xC4, 0xC8, 0xCC], true)) {
        return [
          'h' => (ord($raw[$i + 5]) << 8) + ord($raw[$i + 6]),
          'w' => (ord($raw[$i + 7]) << 8) + ord($raw[$i + 8]),
          'channels' => ord($raw[$i + 9]),
        ];
      }
      $i += 2 + $len;
    }
    return null;
  }

  // ── output ────────────────────────────────────────────────────────────────
  private function addObject(string $body): int {
    $this->objects[] = $body;
    return count($this->objects);
  }

  public function output(): string {
    $contentIds = [];
    foreach ($this->pages as $p) {
      $stream = $p['content'];
      $contentIds[] = $this->addObject('<< /Length ' . strlen($stream) . " >>\nstream\n" . $stream . "\nendstream");
    }
    $fontReg  = $this->addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    $fontBold = $this->addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    // Each page must name its parent, which does not exist yet — so the id it
    // will get is worked out first and checked once the object is really added.
    $pagesId = count($this->objects) + count($this->pages) + 1;
    $pageIds = [];
    foreach ($this->pages as $i => $p) {
      $xo = '';
      foreach ($p['images'] as $name => $id) $xo .= '/' . $name . ' ' . $id . ' 0 R ';
      $res = '<< /Font << /F1 ' . $fontReg . ' 0 R /F2 ' . $fontBold . ' 0 R >>'
        . ($xo !== '' ? ' /XObject << ' . $xo . '>>' : '') . ' >>';
      $pageIds[] = $this->addObject(sprintf(
        '<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2F %.2F] /Resources %s /Contents %d 0 R >>',
        $pagesId, $this->w, $this->h, $res, $contentIds[$i]));
    }
    $kids = implode(' ', array_map(fn($id) => $id . ' 0 R', $pageIds));
    $realPagesId = $this->addObject('<< /Type /Pages /Kids [' . $kids . '] /Count ' . count($pageIds) . ' >>');
    if ($realPagesId !== $pagesId) {
      foreach ($pageIds as $pid) {
        $this->objects[$pid - 1] = preg_replace('#/Parent \d+ 0 R#', '/Parent ' . $realPagesId . ' 0 R', $this->objects[$pid - 1], 1);
      }
    }
    $catalog = $this->addObject('<< /Type /Catalog /Pages ' . $realPagesId . ' 0 R >>');

    $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    $offsets = [];
    foreach ($this->objects as $i => $body) {
      $offsets[$i + 1] = strlen($out);
      $out .= ($i + 1) . " 0 obj\n" . $body . "\nendobj\n";
    }
    $xref = strlen($out);
    $count = count($this->objects) + 1;
    $out .= "xref\n0 " . $count . "\n0000000000 65535 f \n";
    for ($i = 1; $i < $count; $i++) $out .= sprintf("%010d 00000 n \n", $offsets[$i]);
    $out .= "trailer\n<< /Size " . $count . ' /Root ' . $catalog . " 0 R >>\nstartxref\n" . $xref . "\n%%EOF";
    return $out;
  }

  // ── string handling ───────────────────────────────────────────────────────
  // The standard fonts are single-byte. Everything is folded to WinAnsi, with
  // the handful of characters the quotation actually uses spelled out first so
  // they never come through as a question mark.
  public static function toWinAnsi(string $s): string {
    $s = strtr($s, [
      "\u{20B9}" => 'Rs.', "\u{2013}" => '-', "\u{2014}" => '-',
      "\u{2018}" => "'", "\u{2019}" => "'", "\u{201C}" => '"', "\u{201D}" => '"',
      "\u{2022}" => '-', "\u{00A0}" => ' ', "\u{2026}" => '...', "\u{00B7}" => '-',
      "\u{00D7}" => 'x', "\u{2122}" => '(TM)', "\u{00BD}" => '1/2',
    ]);
    $conv = @iconv('UTF-8', 'Windows-1252//TRANSLIT', $s);
    if ($conv === false) $conv = @iconv('UTF-8', 'Windows-1252//IGNORE', $s);
    return $conv === false ? preg_replace('/[^\x20-\x7E]/', '', $s) : $conv;
  }

  private static function esc(string $s): string {
    return strtr(self::toWinAnsi($s), ['\\' => '\\\\', '(' => '\\(', ')' => '\\)', "\r" => '']);
  }
}
