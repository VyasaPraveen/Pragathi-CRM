<?php
// ============================================================================
// Company settings (single document) — replaces the Firestore company/settings
// doc used for workflow-gating toggle etc.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

function handle_settings(string $method): void {
  $claims = require_auth();

  if ($method === 'GET') {
    $st = db()->prepare("SELECT data FROM company_settings WHERE id = 'settings' LIMIT 1");
    $st->execute();
    $row = $st->fetch();
    json_out($row && $row['data'] ? json_decode($row['data'], true) : new stdClass());
  }

  if ($method === 'PUT' || $method === 'PATCH') {
    $patch = body();
    // Req 3 (4-Nov): the About page text may also be edited by the Operation
    // Manager and Management; everything else in the settings stays Admin+.
    $aboutOnly = $patch && count(array_diff(array_keys($patch), ['about'])) === 0;
    $r = normalize_role($claims['role'] ?? '');
    if (!has_access($claims['role'] ?? '', 'admin') && !($aboutOnly && in_array($r, ['operation_manager', 'management'], true))) fail(403, 'Admins only');
    $st = db()->prepare("SELECT data FROM company_settings WHERE id = 'settings' LIMIT 1");
    $st->execute();
    $row = $st->fetch();
    $cur = $row && $row['data'] ? json_decode($row['data'], true) : [];
    if (!is_array($cur)) $cur = [];
    $merged = array_merge($cur, $patch);
    db()->prepare("INSERT INTO company_settings (id, data, updated_at) VALUES ('settings', ?, UTC_TIMESTAMP())
                   ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = UTC_TIMESTAMP()")
       ->execute([json_encode($merged, JSON_UNESCAPED_UNICODE)]);
    json_out($merged);
  }

  fail(405, 'Method not allowed');
}
