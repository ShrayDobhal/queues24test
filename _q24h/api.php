<?php
/**
 * API entry shared by /blood-test/api (scope=patient) and /lab-partners/api (scope=partner).
 * The admin API is reached through the Sales CRM (see admin.php), never directly.
 */
declare(strict_types=1);

namespace Q24H;

require_once __DIR__ . '/core.php';
require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/domain.php';

function run_api(string $scope): void
{
    ini_set('display_errors', '0');
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $prefix = app_base($scope) . '/api';
    $path = '/' . ltrim(rawurldecode(strpos($uri, $prefix) === 0 ? substr($uri, strlen($prefix)) : '/'), '/');
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    try {
        db();
        process_timeouts();
        require_once __DIR__ . ($scope === 'partner' ? '/routes_partner.php' : '/routes_patient.php');
        $scope === 'partner' ? partner_routes($method, $path) : patient_routes($method, $path);
    } catch (HttpError $e) {
        json_out(['error' => $e->getMessage()], $e->status);
    } catch (\Throwable $e) {
        error_log("[q24h api] $method $path: " . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (!headers_sent()) json_out(['error' => 'Something went wrong on the server. Please try again.'], 500);
    }
}

/** Tiny matcher: route('GET', '/orders/(\d+)') → captured groups or null. */
function route_match(string $method, string $path, string $verb, string $pattern): ?array
{
    if ($method !== $verb) return null;
    return preg_match('#^' . $pattern . '$#', $path, $m) ? array_slice($m, 1) : null;
}
