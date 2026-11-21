<?php
/**
 * Photo storage: Bunny.net Storage + token-protected Pull Zone when configured,
 * otherwise the server's private data folder. Each photo row records where it lives.
 */
declare(strict_types=1);

function bunny(): array
{
    return [
        'zone' => trim((string) cfg('bunny_storage_zone', '')),
        'host' => preg_replace('#^https?://|/+$#', '', trim((string) cfg('bunny_storage_host', 'storage.bunnycdn.com'))),
        'password' => trim((string) cfg('bunny_storage_password', '')),
        'cdn' => preg_replace('#^https?://|/+$#', '', trim((string) cfg('bunny_cdn_host', ''))),
        'token' => trim((string) cfg('bunny_token_key', '')),
        'ttl' => max(1, (int) cfg('bunny_url_ttl_hours', 6)),
        'prefix' => trim((string) cfg('bunny_path_prefix', 'crm'), '/'),
    ];
}
function bunny_enabled(): bool { $b = bunny(); return $b['zone'] && $b['password'] && $b['cdn'] && function_exists('curl_init'); }
function bunny_remote_key(string $key): string { $p = bunny()['prefix']; return ($p ? "$p/" : '') . "visits/$key"; }
function bunny_storage_url(string $remote): string
{
    $b = bunny();
    return 'https://' . $b['host'] . '/' . rawurlencode($b['zone']) . '/' . implode('/', array_map('rawurlencode', explode('/', $remote)));
}

function bunny_request(string $method, string $remote, ?string $body = null, string $contentType = 'application/octet-stream'): array
{
    $ch = curl_init(bunny_storage_url($remote));
    $headers = ['AccessKey: ' . bunny()['password']];
    if ($body !== null) {
        $headers[] = 'Content-Type: ' . $contentType;
        $headers[] = 'Checksum: ' . strtoupper(hash('sha256', $body));
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 15]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    return [$code, $resp === false ? $err : (string) $resp];
}

function bunny_upload_file(string $localPath, string $key, string $mime): void
{
    [$code, $resp] = bunny_request('PUT', bunny_remote_key($key), (string) file_get_contents($localPath), $mime);
    if ($code !== 201 && $code !== 200) throw new RuntimeException("Bunny upload failed ($code): " . substr($resp, 0, 200));
}

/**
 * Store several uploaded photos at once. $items = [[tmpPath, ext, mime], ...].
 * Files are moved into the private data folder, then sent to Bunny IN PARALLEL (curl_multi);
 * any file Bunny doesn't accept simply stays on local disk so the report is never lost.
 */
function save_photos(array $items): array
{
    $month = current_month();
    $dir = data_dir() . "/uploads/$month";
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $out = [];
    foreach ($items as [$tmp, $ext, $mime]) {
        $name = bin2hex(random_bytes(12)) . $ext;
        $local = "$dir/$name";
        if (!(is_uploaded_file($tmp) ? move_uploaded_file($tmp, $local) : rename($tmp, $local))) {
            foreach ($out as $o) @unlink($o['local']);
            throw new RuntimeException('Could not save the uploaded photo.');
        }
        $out[] = ['key' => "$month/$name", 'storage' => 'local', 'local' => $local, 'mime' => $mime];
    }
    if (bunny_enabled() && function_exists('curl_multi_init')) {
        $mh = curl_multi_init();
        $handles = [];
        foreach ($out as $i => $o) {
            $body = (string) file_get_contents($o['local']);
            $ch = curl_init(bunny_storage_url(bunny_remote_key($o['key'])));
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => 'PUT', CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_HTTPHEADER => ['AccessKey: ' . bunny()['password'], 'Content-Type: ' . $o['mime'], 'Checksum: ' . strtoupper(hash('sha256', $body))],
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$i] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) curl_multi_select($mh, 1.0);
        } while ($running && $status === CURLM_OK);
        foreach ($handles as $i => $ch) {
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($code === 201 || $code === 200) { @unlink($out[$i]['local']); $out[$i]['storage'] = 'bunny'; }
            else error_log("[crm storage] Bunny upload failed ($code " . curl_error($ch) . '), keeping local copy: ' . $out[$i]['key']);
            curl_multi_remove_handle($mh, $ch);
        }
        curl_multi_close($mh);
    }
    return array_map(fn($o) => ['key' => $o['key'], 'storage' => $o['storage']], $out);
}

/** Store an uploaded photo. Returns ['key' => 'YYYY-MM/name.ext', 'storage' => 'bunny'|'local']. */
function save_photo(string $tmpPath, string $ext, string $mime): array
{
    $month = current_month();
    $name = bin2hex(random_bytes(12)) . $ext;
    $key = "$month/$name";
    $dir = data_dir() . "/uploads/$month";
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $local = "$dir/$name";
    if (!(is_uploaded_file($tmpPath) ? move_uploaded_file($tmpPath, $local) : rename($tmpPath, $local))) throw new RuntimeException('Could not save the uploaded photo.');
    if (bunny_enabled()) {
        try {
            bunny_upload_file($local, $key, $mime);
            @unlink($local);
            return ['key' => $key, 'storage' => 'bunny'];
        } catch (Throwable $e) {
            error_log('[crm storage] Bunny upload failed, keeping local copy: ' . $e->getMessage());
        }
    }
    return ['key' => $key, 'storage' => 'local'];
}

function delete_photo(string $key, string $storage): void
{
    if ($storage === 'bunny') {
        if (bunny_enabled()) {
            [$code] = bunny_request('DELETE', bunny_remote_key($key));
            if ($code !== 200 && $code !== 404) error_log("[crm storage] Bunny delete failed ($code) $key");
        }
    } else {
        @unlink(data_dir() . '/uploads/' . $key);
    }
}

function photo_url(string $key, string $storage): string
{
    if ($storage !== 'bunny') return base_path() . '/api/files/' . $key;
    $b = bunny();
    $path = '/' . bunny_remote_key($key);
    $urlPath = implode('/', array_map('rawurlencode', explode('/', $path)));
    if (!$b['token']) return 'https://' . $b['cdn'] . $urlPath;
    $expires = (int) (ceil(time() / 3600) * 3600 + $b['ttl'] * 3600); // rounded → stable, cacheable URLs
    $token = b64url(hash('sha256', $b['token'] . $path . $expires, true));
    return 'https://' . $b['cdn'] . $urlPath . '?token=' . $token . '&expires=' . $expires;
}

function storage_describe(): array
{
    if (!bunny_enabled()) return ['provider' => 'local'];
    $b = bunny();
    return ['provider' => 'bunny', 'zone' => $b['zone'], 'cdn' => $b['cdn'], 'protected' => (bool) $b['token']];
}
