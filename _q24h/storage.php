<?php
/**
 * Medical file storage (prescriptions, reports, chat attachments).
 * Bunny Storage under the "health/" prefix (separate from CRM photos), private:
 * files are only ever reached through an access-checked API endpoint that issues
 * a 10-minute signed link. Falls back to the private data folder.
 */
declare(strict_types=1);

namespace Q24H;

use RuntimeException;

const FILE_TYPES = [
    'image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp',
    'image/heic' => '.heic', 'image/heif' => '.heif', 'application/pdf' => '.pdf',
];

function bunny(): array
{
    return [
        'zone' => trim((string) cfg('bunny_storage_zone', '')),
        'host' => preg_replace('#^https?://|/+$#', '', trim((string) cfg('bunny_storage_host', 'storage.bunnycdn.com'))),
        'password' => trim((string) cfg('bunny_storage_password', '')),
        'cdn' => preg_replace('#^https?://|/+$#', '', trim((string) cfg('bunny_cdn_host', ''))),
        'token' => trim((string) cfg('bunny_token_key', '')),
        'prefix' => trim((string) cfg('bunny_path_prefix', 'health'), '/'),
    ];
}
function bunny_enabled(): bool { $b = bunny(); return $b['zone'] && $b['password'] && $b['cdn'] && function_exists('curl_multi_init'); }
function remote_key(string $key): string { return bunny()['prefix'] . '/' . $key; }
function storage_url(string $remote): string
{
    $b = bunny();
    return 'https://' . $b['host'] . '/' . rawurlencode($b['zone']) . '/' . implode('/', array_map('rawurlencode', explode('/', $remote)));
}

/** Normalise $_FILES[$field] for name="files[]" and name="files". */
function uploaded(string $field = 'files'): array
{
    $f = $_FILES[$field] ?? null;
    if (!$f) return [];
    $out = [];
    if (is_array($f['name'])) {
        foreach ($f['name'] as $i => $n) $out[] = ['name' => $n, 'tmp_name' => $f['tmp_name'][$i], 'error' => $f['error'][$i], 'size' => $f['size'][$i]];
    } else {
        $out[] = $f;
    }
    return array_values(array_filter($out, fn($x) => $x['error'] !== UPLOAD_ERR_NO_FILE));
}

/** Validate uploads (type sniffed from content, size, count). Returns [[tmp, mime, size, name], ...]. */
function validate_uploads(array $files, int $maxFiles = 5): array
{
    $maxMb = (int) cfg('max_upload_mb', 10);
    if (count($files) > $maxFiles) throw bad("You can attach up to $maxFiles files at a time.");
    $out = [];
    foreach ($files as $f) {
        if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $f['size'] > $maxMb * 1048576) throw bad("Each file must be under {$maxMb} MB.");
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw bad('A file failed to upload. Please try again.');
        $mime = function_exists('finfo_open') ? (string) finfo_file(finfo_open(FILEINFO_MIME_TYPE), $f['tmp_name']) : '';
        if (!$mime || $mime === 'application/octet-stream') {
            $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
            $mime = ['heic' => 'image/heic', 'heif' => 'image/heif'][$ext] ?? $mime;
        }
        if (!isset(FILE_TYPES[$mime])) throw bad('Only photos (JPG, PNG, WEBP, HEIC) and PDF files can be uploaded.');
        $out[] = [$f['tmp_name'], $mime, (int) $f['size'], mb_substr(basename((string) $f['name']), 0, 120)];
    }
    return $out;
}

/**
 * Store validated uploads for an order. Moves into the private folder, then uploads
 * to Bunny in parallel; anything Bunny rejects stays local (never lose a prescription).
 * Returns file row ids. Must be called OUTSIDE a DB transaction (network I/O).
 */
function store_files(int $orderId, string $purpose, string $uploaderType, ?int $uploaderId, array $checked): array
{
    if (!$checked) return [];
    $month = date('Y-m');
    $dir = data_dir() . "/files/$month";
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $items = [];
    foreach ($checked as [$tmp, $mime, $size, $name]) {
        $key = "$month/" . bin2hex(random_bytes(16)) . FILE_TYPES[$mime];
        $local = data_dir() . "/files/$key";
        if (!(is_uploaded_file($tmp) ? move_uploaded_file($tmp, $local) : rename($tmp, $local))) {
            foreach ($items as $it) @unlink($it['local']);
            throw new RuntimeException('Could not save the uploaded file.');
        }
        $items[] = ['key' => $key, 'local' => $local, 'mime' => $mime, 'size' => $size, 'name' => $name, 'sha' => hash_file('sha256', $local), 'storage' => 'local'];
    }
    if (bunny_enabled()) {
        $mh = curl_multi_init();
        $hs = [];
        foreach ($items as $i => $it) {
            $body = (string) file_get_contents($it['local']);
            $ch = curl_init(storage_url(remote_key($it['key'])));
            curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => 'PUT', CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_HTTPHEADER => ['AccessKey: ' . bunny()['password'], 'Content-Type: ' . $it['mime'], 'Checksum: ' . strtoupper($it['sha'])]]);
            curl_multi_add_handle($mh, $ch);
            $hs[$i] = $ch;
        }
        do { $st = curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 1.0); } while ($running && $st === CURLM_OK);
        foreach ($hs as $i => $ch) {
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($code === 201 || $code === 200) { @unlink($items[$i]['local']); $items[$i]['storage'] = 'bunny'; }
            else error_log("[q24h storage] Bunny upload failed ($code), kept local: " . $items[$i]['key']);
            curl_multi_remove_handle($mh, $ch);
        }
        curl_multi_close($mh);
    }
    $ids = [];
    foreach ($items as $it) {
        $ids[] = run('INSERT INTO files (order_id, purpose, uploader_type, uploader_id, storage, key, mime, size, name, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$orderId, $purpose, $uploaderType, $uploaderId, $it['storage'], $it['key'], $it['mime'], $it['size'], $it['name'], $it['sha']]);
    }
    return $ids;
}

/** Send the file (after the caller has checked access). */
function send_file(array $f): void
{
    if ($f['storage'] === 'bunny' && bunny_enabled()) {
        $b = bunny();
        $path = '/' . remote_key($f['key']);
        $urlPath = implode('/', array_map('rawurlencode', explode('/', $path)));
        $exp = time() + 600;
        $url = 'https://' . $b['cdn'] . $urlPath . ($b['token'] ? '?token=' . b64url(hash('sha256', $b['token'] . $path . $exp, true)) . '&expires=' . $exp : '');
        header('Cache-Control: private, no-store');
        header('Location: ' . $url, true, 302);
        return;
    }
    $full = data_dir() . '/files/' . $f['key'];
    if (!is_file($full)) throw not_found('File not found');
    header('Content-Type: ' . $f['mime']);
    header('Content-Length: ' . filesize($full));
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $f['name'] ?: basename($full)) . '"');
    header('Cache-Control: private, no-store');
    readfile($full);
}

function delete_stored(array $f): void
{
    if ($f['storage'] === 'bunny' && bunny_enabled()) bunny_request_delete(remote_key($f['key']));
    else @unlink(data_dir() . '/files/' . $f['key']);
}
function bunny_request_delete(string $remote): void
{
    $ch = curl_init(storage_url($remote));
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => 'DELETE', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => ['AccessKey: ' . bunny()['password']]]);
    curl_exec($ch);
}
