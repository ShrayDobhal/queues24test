<?php
/**
 * Queue24 Sales CRM — API front controller.
 * /sales-crm/api/<path> is rewritten here by ../.htaccess
 */
declare(strict_types=1);

define('CRM_ROOT', dirname(__DIR__));
require CRM_ROOT . '/app/core.php';
require CRM_ROOT . '/app/tracker.php';
require CRM_ROOT . '/app/storage.php';
require CRM_ROOT . '/app/alerts.php';
require CRM_ROOT . '/app/routes.php';

ini_set('display_errors', '0');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

// Work out the API path: everything after "<base>/api"
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$prefix = base_path() . '/api';
$path = strpos($uri, $prefix) === 0 ? substr($uri, strlen($prefix)) : ($_GET['__path'] ?? '/');
$path = '/' . ltrim(rawurldecode((string) $path), '/');
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method === 'POST' && isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) $method = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);

try {
    db();
    bootstrap_admin();
    auto_restore_due();
    route($method, $path);
} catch (HttpError $e) {
    json_out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[crm api] ' . $method . ' ' . $path . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $msg = (strpos($e->getMessage(), 'pdo_sqlite') !== false || strpos($e->getMessage(), 'data folder') !== false)
        ? 'Server setup problem: ' . $e->getMessage()
        : 'Something went wrong on the server. Please try again.';
    if (!headers_sent()) json_out(['error' => $msg], 500);
}

// Background inactivity check (at most every 30 min) after the response is sent.
if (function_exists('litespeed_finish_request')) litespeed_finish_request();
elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
try { if (strpos($path, '/files/') !== 0) maybe_scan(); } catch (Throwable $e) { error_log('[crm scan] ' . $e->getMessage()); }
