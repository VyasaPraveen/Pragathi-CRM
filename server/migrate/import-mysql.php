<?php
// ============================================================================
// Migration step 2 — import exported Firestore JSON into MySQL.
// Run on the server (has DB access):  php import-mysql.php <export-dir>
// Idempotent (INSERT ... ON DUPLICATE KEY UPDATE). Skips users.json — logins
// are recreated fresh in the new system. Imports _settings.json → company_settings.
// ============================================================================

require __DIR__ . '/../api/lib.php';  // db(), collection_table()

$dir = rtrim($argv[1] ?? (__DIR__ . '/export'), '/');
if (!is_dir($dir)) { fwrite(STDERR, "export dir not found: $dir\n"); exit(1); }

function to_dt($v) {
  if (!$v) return gmdate('Y-m-d H:i:s');
  $t = strtotime($v);
  return $t ? gmdate('Y-m-d H:i:s', $t) : gmdate('Y-m-d H:i:s');
}

$pdo = db();
$grand = 0;

foreach (glob($dir . '/*.json') as $file) {
  $base = basename($file, '.json');
  if ($base === 'users' || $base === '_settings') continue;
  $table = collection_table($base);
  if (!$table) { echo "skip (no table): $base\n"; continue; }

  $docs = json_decode(file_get_contents($file), true);
  if (!is_array($docs)) { echo "skip (bad json): $base\n"; continue; }

  $stmt = $pdo->prepare("INSERT INTO `$table` (id, data, created_at, updated_at, created_by) VALUES (?,?,?,?,?)
                         ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)");
  $n = 0;
  foreach ($docs as $doc) {
    $id = $doc['id'] ?? gen_id();
    $created = to_dt($doc['createdAt'] ?? null);
    $updated = to_dt($doc['updatedAt'] ?? ($doc['createdAt'] ?? null));
    $by = $doc['createdBy'] ?? null;
    $data = $doc;
    unset($data['id']);
    $stmt->execute([$id, json_encode($data, JSON_UNESCAPED_UNICODE), $created, $updated, $by]);
    $n++;
  }
  echo "$base -> $table: $n\n";
  $grand += $n;
}

// company/settings
$sf = $dir . '/_settings.json';
if (file_exists($sf)) {
  $s = json_decode(file_get_contents($sf), true);
  if (is_array($s)) {
    $pdo->prepare("INSERT INTO company_settings (id, data, updated_at) VALUES ('settings', ?, UTC_TIMESTAMP())
                   ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=UTC_TIMESTAMP()")
       ->execute([json_encode($s, JSON_UNESCAPED_UNICODE)]);
    echo "settings imported\n";
  }
}

echo "\nDone. $grand documents imported.\n";
