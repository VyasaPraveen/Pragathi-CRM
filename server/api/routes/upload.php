<?php
// ============================================================================
// File upload — replaces Firebase Storage. Saves under crm/uploads and returns
// a public URL. Validates size and type.
// ============================================================================

if (!defined('PPS_API')) { http_response_code(404); exit; }

function handle_upload(string $method): void {
  require_auth();
  if ($method !== 'POST') fail(405, 'Method not allowed');
  if (empty($_FILES['file'])) fail(400, 'No file uploaded');

  $f = $_FILES['file'];
  if ($f['error'] !== UPLOAD_ERR_OK) fail(400, 'Upload failed (code ' . $f['error'] . ')');
  if ($f['size'] > 10 * 1024 * 1024) fail(413, 'File too large (max 10MB)');

  $allowed = [
    'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
    'image/gif' => 'gif', 'application/pdf' => 'pdf',
    'application/msword' => 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
  ];
  $finfo = new finfo(FILEINFO_MIME_TYPE);
  $mime = $finfo->file($f['tmp_name']);
  if (!isset($allowed[$mime])) fail(415, 'Unsupported file type');
  $ext = $allowed[$mime];

  $dir = cfg()['upload_dir'];
  $sub = $_POST['folder'] ?? 'files';
  $sub = preg_replace('/[^a-z0-9_-]/i', '', (string)$sub) ?: 'files';
  $target = $dir . '/' . $sub;
  if (!is_dir($target) && !mkdir($target, 0755, true) && !is_dir($target)) fail(500, 'Cannot create upload dir');

  $name = bin2hex(random_bytes(8)) . '_' . time() . '.' . $ext;
  $dest = $target . '/' . $name;
  if (!move_uploaded_file($f['tmp_name'], $dest)) fail(500, 'Could not save file');

  $url = rtrim(cfg()['upload_url_base'], '/') . '/' . $sub . '/' . $name;
  json_out(['url' => $url, 'name' => $name]);
}
