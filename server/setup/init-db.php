<?php
// One-time DB initialiser. Uploaded next to the API, run once via SSH, then
// deleted. Reads config.php via lib.php and applies schema.sql idempotently.
require __DIR__ . '/lib.php';

$file = __DIR__ . '/schema.sql';
if (!file_exists($file)) { fwrite(STDERR, "schema.sql not found\n"); exit(1); }

$sql = file_get_contents($file);
// strip full-line comments
$sql = preg_replace('/^\s*--.*$/m', '', $sql);
$stmts = array_filter(array_map('trim', explode(';', $sql)), fn($s) => $s !== '');

$pdo = db();
$done = 0;
foreach ($stmts as $s) { $pdo->exec($s); $done++; }
echo "OK: executed $done statements\n";
$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
echo 'Tables (' . count($tables) . '): ' . implode(', ', $tables) . "\n";
$users = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
echo "users rows: $users\n";
