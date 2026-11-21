<?php
/** Queue24 Sales CRM — serves the app shell with the correct base path. */
declare(strict_types=1);
define('CRM_ROOT', __DIR__);
$cfg = file_exists(__DIR__ . '/app/config.php') ? require __DIR__ . '/app/config.php' : [];
$base = isset($cfg['base_path']) && $cfg['base_path'] !== '' ? rtrim('/' . trim($cfg['base_path'], '/'), '/') : rtrim(dirname(str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/');

// "/sales-crm" → "/sales-crm/" so relative asset paths resolve
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($base !== '' && rtrim($uriPath, '/') === $base && substr($uriPath, -1) !== '/') {
    header('Location: ' . $base . '/', true, 301);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
echo str_replace('{{BASE}}', htmlspecialchars($base, ENT_QUOTES), (string) file_get_contents(__DIR__ . '/app/shell.html'));
