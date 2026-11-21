<?php
/** Serves the app shell with the correct base path (folder name). Hidden page: not indexed. */
$base = rtrim(dirname(str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/');
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($base !== '' && rtrim($uriPath, '/') === $base && substr($uriPath, -1) !== '/') { header('Location: ' . $base . '/', true, 301); exit; }
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
echo str_replace('{{BASE}}', htmlspecialchars($base, ENT_QUOTES), (string) file_get_contents(__DIR__ . '/app.html'));
