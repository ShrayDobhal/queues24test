<?php
/**
 * Queue24 Health (blood tests + lab partners) — core.
 * Completely separate from the Sales CRM: own namespace, own database file,
 * own data folder, own sessions. The CRM database is never opened here.
 */
declare(strict_types=1);

namespace Q24H;

use PDO;
use DateTime;
use DateTimeZone;
use DateTimeImmutable;
use RuntimeException;
use Throwable;

if (!defined('Q24H_ROOT')) define('Q24H_ROOT', __DIR__);

$GLOBALS['Q24H_CFG'] = is_file(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];

function cfg(string $key, $default = null)
{
    $c = $GLOBALS['Q24H_CFG'];
    return (array_key_exists($key, $c) && $c[$key] !== '' && $c[$key] !== null) ? $c[$key] : $default;
}

date_default_timezone_set((string) cfg('timezone', 'Asia/Kolkata'));

// ------------------------------------------------------------------ errors / responses
class HttpError extends \Exception
{
    public int $status;
    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}
function bad(string $msg): HttpError { return new HttpError(400, $msg); }
function not_found(string $msg = 'Not found'): HttpError { return new HttpError(404, $msg); }

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

function body(): array
{
    static $b = null;
    if ($b !== null) return $b;
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $b = $raw ? json_decode($raw, true) : [];
        if (!is_array($b)) throw bad('Invalid request body.');
    } else {
        $b = $_POST ?: [];
    }
    return $b;
}
function str_in($v, int $max = 500): string
{
    if ($v === null || is_array($v)) return '';
    return mb_substr(trim((string) $v), 0, $max);
}
function int_in($v): ?int
{
    if ($v === null || $v === '' || is_array($v) || !is_numeric($v)) return null;
    return (int) $v;
}
function qparam(string $k, $default = null) { return isset($_GET[$k]) && !is_array($_GET[$k]) ? $_GET[$k] : $default; }

const EMAIL_RE = '/^[^@\s]+@[^@\s]+\.[^@\s]+$/';

// ------------------------------------------------------------------ paths & URLs (each app lives in its own folder)
function app_base(string $scope): string
{
    return [
        'patient' => (string) cfg('bt_base', '/blood-test'),
        'partner' => (string) cfg('lp_base', '/lab-partners'),
        'admin' => (string) cfg('crm_base', '/sales-crm') . '/api/admin/health',
    ][$scope];
}
function file_url(int $id, string $scope): string
{
    return $scope === 'admin' ? app_base('admin') . "/files/$id" : app_base($scope) . "/api/files/$id";
}

function data_dir(): string
{
    static $d = null;
    if ($d !== null) return $d;
    $cands = [];
    if (getenv('Q24H_DATA_DIR')) $cands[] = (string) getenv('Q24H_DATA_DIR'); // local testing only
    if (cfg('data_dir')) $cands[] = (string) cfg('data_dir');
    $cands[] = dirname(Q24H_ROOT, 2) . '/queue24-health-data'; // next to public_html (outside the web root)
    $cands[] = Q24H_ROOT . '/data';                              // fallback, blocked by .htaccess
    foreach ($cands as $c) {
        $c = rtrim($c, '/');
        if ((is_dir($c) || @mkdir($c, 0750, true)) && is_writable($c)) {
            @mkdir($c . '/files', 0750, true);
            if (strpos($c, Q24H_ROOT) === 0 && !is_file($c . '/.htaccess')) @file_put_contents($c . '/.htaccess', "Require all denied\nDeny from all\n");
            return $d = $c;
        }
    }
    throw new RuntimeException('No writable data folder found for the health module.');
}

// ------------------------------------------------------------------ database (own file: health.sqlite)
function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!extension_loaded('pdo_sqlite')) throw new RuntimeException('The PHP extension pdo_sqlite is not enabled.');
    $pdo = new PDO('sqlite:' . data_dir() . '/health.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;');
    require_once __DIR__ . '/schema.php';
    migrate($pdo);
    return $pdo;
}
function q(string $sql, array $args = []): array
{
    $st = db()->prepare($sql);
    $st->execute(array_values($args));
    return $st->fetchAll();
}
function q1(string $sql, array $args = []): ?array
{
    $st = db()->prepare($sql);
    $st->execute(array_values($args));
    $r = $st->fetch();
    return $r === false ? null : $r;
}
/** Execute and return lastInsertId (for INSERT) — use affected() for conditional updates. */
function run(string $sql, array $args = []): int
{
    $st = db()->prepare($sql);
    $st->execute(array_values($args));
    return (int) db()->lastInsertId();
}
/** Execute and return number of affected rows (used for race-safe conditional updates). */
function affected(string $sql, array $args = []): int
{
    $st = db()->prepare($sql);
    $st->execute(array_values($args));
    return $st->rowCount();
}
function tx(callable $fn)
{
    $pdo = db();
    if ($pdo->inTransaction()) return $fn();
    $pdo->exec('BEGIN IMMEDIATE'); // take the write lock up-front: no lost updates between readers
    try {
        $r = $fn();
        $pdo->exec('COMMIT');
        return $r;
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}
function placeholders(array $list): string { return implode(',', array_fill(0, max(1, count($list)), '?')); }
function now_iso(): string { return (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'); }
function today(): string { return date('Y-m-d'); }
function is_valid_date($s): bool
{
    return is_string($s) && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}
function add_days(string $d, int $n): string { return (new DateTimeImmutable($d . ' 00:00:00'))->modify(($n >= 0 ? '+' : '') . $n . ' day')->format('Y-m-d'); }

// ------------------------------------------------------------------ settings stored in DB (meta)
function meta_get(string $k, $default = null)
{
    $r = q1('SELECT value FROM meta WHERE key = ?', [$k]);
    return $r ? json_decode($r['value'], true) : $default;
}
function meta_set(string $k, $v): void
{
    run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$k, json_encode($v)]);
}

// ------------------------------------------------------------------ sessions (separate cookie per app)
function b64url(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64url_dec(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/')); }
function secret(): string
{
    $s = (string) cfg('secret', '');
    if (strlen($s) >= 16) return $s;
    $file = data_dir() . '/.secret';
    if (is_file($file)) return trim((string) file_get_contents($file));
    $s = bin2hex(random_bytes(48));
    file_put_contents($file, $s);
    @chmod($file, 0600);
    return $s;
}
function sign(array $payload): string
{
    $p = b64url(json_encode($payload));
    return $p . '.' . b64url(hash_hmac('sha256', $p, secret(), true));
}
function verify(string $token): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 2 || !hash_equals(b64url(hash_hmac('sha256', $parts[0], secret(), true)), $parts[1])) return null;
    $d = json_decode(b64url_dec($parts[0]), true);
    return is_array($d) && ($d['exp'] ?? 0) >= time() ? $d : null;
}
function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function cookie_name(string $scope): string { return $scope === 'partner' ? 'q24lp_session' : 'q24bt_session'; }
function issue_session(string $scope, int $id, int $version): void
{
    $days = $scope === 'partner' ? 30 : 60;
    $token = sign(['s' => $scope, 'id' => $id, 'v' => $version, 'exp' => time() + $days * 86400]);
    setcookie(cookie_name($scope), $token, ['expires' => time() + $days * 86400, 'path' => app_base($scope), 'httponly' => true, 'secure' => is_https(), 'samesite' => 'Lax']);
}
function clear_session(string $scope): void
{
    setcookie(cookie_name($scope), '', ['expires' => time() - 3600, 'path' => app_base($scope), 'httponly' => true, 'secure' => is_https(), 'samesite' => 'Lax']);
}
function session_payload(string $scope): ?array
{
    $t = $_COOKIE[cookie_name($scope)] ?? '';
    $p = $t ? verify($t) : null;
    return $p && ($p['s'] ?? '') === $scope ? $p : null;
}

// ------------------------------------------------------------------ password vault (admin can view partner passwords)
function hash_pw(string $pw): string { return password_hash($pw, PASSWORD_BCRYPT, ['cost' => 10]); }
function vault_key(): string { return hash('sha256', secret() . '|q24h-vault', true); }
function enc_pw(string $pw): ?string
{
    if (!function_exists('openssl_encrypt')) return null;
    $iv = random_bytes(12); $tag = '';
    $ct = openssl_encrypt($pw, 'aes-256-gcm', vault_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return $ct === false ? null : 'v1:' . base64_encode($iv . $tag . $ct);
}
function dec_pw(?string $blob): ?string
{
    if (!$blob || strpos($blob, 'v1:') !== 0) return null;
    $raw = base64_decode(substr($blob, 3), true);
    if ($raw === false || strlen($raw) < 29) return null;
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', vault_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $pt === false ? null : $pt;
}
function generate_password(): string
{
    $w = ['Kite', 'Mango', 'River', 'Tiger', 'Lotus', 'Cedar', 'Pearl', 'Comet', 'Maple', 'Falcon', 'Ember', 'Orbit', 'Coral', 'Delta', 'Jade', 'Nova'];
    return $w[random_int(0, 15)] . '-' . random_int(1000, 9999) . '-' . $w[random_int(0, 15)];
}

// ------------------------------------------------------------------ rate limiting (DB backed, works across PHP workers)
function rate_hit(string $bucket, int $max, int $windowSec): void
{
    $k = hash('sha256', $bucket);
    $now = time();
    $r = q1('SELECT * FROM rate_limits WHERE key = ?', [$k]);
    if (!$r || $now - (int) $r['window_start'] > $windowSec) { run('INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)', [$k, $now]); return; }
    if ((int) $r['count'] >= $max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    run('UPDATE rate_limits SET count = count + 1 WHERE key = ?', [$k]);
}
function client_ip(): string { return (string) ($_SERVER['REMOTE_ADDR'] ?? ''); }

// ------------------------------------------------------------------ phone helpers (India)
function norm_phone(string $p): ?string
{
    $d = preg_replace('/\D/', '', $p);
    if (strlen($d) === 12 && strpos($d, '91') === 0) $d = substr($d, 2);
    if (strlen($d) === 11 && $d[0] === '0') $d = substr($d, 1);
    return preg_match('/^[6-9]\d{9}$/', $d) ? $d : null;
}
function mask_phone(?string $p): string { return $p ? substr($p, 0, 2) . 'XXXXXX' . substr($p, -2) : ''; }
function fmt_phone(?string $p): string { return $p ? '+91 ' . substr($p, 0, 5) . ' ' . substr($p, 5) : ''; }
