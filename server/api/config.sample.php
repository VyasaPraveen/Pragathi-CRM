<?php
// ============================================================================
// Pragathi CRM API — configuration TEMPLATE.
// Copy to config.php on the server and fill in real values. config.php is
// git-ignored and must live OUTSIDE version control (contains secrets).
// ============================================================================

return [
  // ── MySQL (from Hostinger hPanel → Databases) ──
  'db' => [
    'host'    => 'localhost',
    'name'    => 'REPLACE_DB_NAME',
    'user'    => 'REPLACE_DB_USER',
    'pass'    => 'REPLACE_DB_PASSWORD',
    'charset' => 'utf8mb4',
  ],

  // ── Auth ──
  // A long random string. Generate once, keep secret. Changing it logs everyone out.
  'jwt_secret'   => 'REPLACE_WITH_LONG_RANDOM_SECRET',
  'jwt_ttl_days' => 30,

  // ── File uploads ── (served from the same crm origin)
  'upload_dir'      => __DIR__ . '/../uploads',   // filesystem path (crm/uploads)
  'upload_url_base' => '/uploads',                 // public URL prefix

  // ── CORS ── allowed origins (same-origin needs none; list others if used)
  'allowed_origins' => [
    'https://crm.pragathipowersolutions.com',
    'https://pragathipowersolutions.com',
  ],

  // ── FCM push (Firebase kept ONLY for Cloud Messaging — Spark plan) ──
  // Path to the Firebase service-account JSON (upload outside webroot).
  'fcm' => [
    'enabled'              => false, // flip to true once the key is uploaded
    'project_id'           => 'pps-crm-new',
    'service_account_path' => __DIR__ . '/../secrets/firebase-service-account.json',
  ],
];
