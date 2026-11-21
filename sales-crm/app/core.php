<?php
/**
 * Queue24 Sales CRM — PHP edition (for Hostinger shared hosting).
 * Core: config, database, dates, helpers, sessions.
 * Same API + database layout as the Node edition.
 */
declare(strict_types=1);

if (!defined('CRM_ROOT')) define('CRM_ROOT', dirname(__DIR__)); // .../public_html/sales-crm

$GLOBALS['CFG'] = file_exists(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];

function cfg(string $key, $default = null)
{
    $c = $GLOBALS['CFG'];
    return (array_key_exists($key, $c) && $c[$key] !== '' && $c[$key] !== null) ? $c[$key] : $default;
}

date_default_timezone_set((string) cfg('timezone', 'Asia/Kolkata'));

// ------------------------------------------------------------------ errors / responses
class HttpError extends Exception
{
    public int $status;
    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}
function bad(string $msg): HttpError { return new HttpError(400, $msg); }

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
function num_in($v): ?float
{
    if ($v === null || $v === '' || is_array($v) || !is_numeric($v)) return null;
    return (float) $v;
}
function qparam(string $k, $default = null) { return isset($_GET[$k]) && !is_array($_GET[$k]) ? $_GET[$k] : $default; }

const OUTCOMES = ['interested', 'follow_up', 'demo_scheduled', 'onboarded', 'not_interested', 'closed'];
const LEAVE_TYPES = ['casual', 'sick', 'emergency', 'other'];
const PHONE_RE = '/^[+]?[\d\s-]{7,16}$/';
const EMAIL_RE = '/^[^@\s]+@[^@\s]+\.[^@\s]+$/';

// ------------------------------------------------------------------ paths
function base_path(): string
{
    static $b = null;
    if ($b !== null) return $b;
    $conf = cfg('base_path');
    if ($conf !== null) return $b = rtrim('/' . trim((string) $conf, '/'), '/');
    $script = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/index.php');
    $dir = dirname($script);
    if (basename($dir) === 'api') $dir = dirname($dir);
    return $b = rtrim($dir, '/');
}

function data_dir(): string
{
    static $d = null;
    if ($d !== null) return $d;
    $cands = [];
    if (getenv('CRM_DATA_DIR')) $cands[] = (string) getenv('CRM_DATA_DIR'); // local testing only
    if (cfg('data_dir')) $cands[] = (string) cfg('data_dir');
    $cands[] = dirname(CRM_ROOT, 2) . '/queue24-crm-data'; // outside public_html (preferred)
    $cands[] = CRM_ROOT . '/data';                          // fallback inside, protected by .htaccess
    foreach ($cands as $c) {
        $c = rtrim($c, '/');
        if ((is_dir($c) || @mkdir($c, 0750, true)) && is_writable($c)) {
            @mkdir($c . '/uploads', 0750, true);
            if (strpos($c, CRM_ROOT) === 0 && !file_exists($c . '/.htaccess')) {
                @file_put_contents($c . '/.htaccess', "Require all denied\nDeny from all\n");
            }
            return $d = $c;
        }
    }
    throw new RuntimeException('No writable data folder found for the CRM.');
}

// ------------------------------------------------------------------ database
function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!extension_loaded('pdo_sqlite')) throw new RuntimeException('The PHP extension pdo_sqlite is not enabled (hPanel → Advanced → PHP Configuration → Extensions).');
    $pdo = new PDO('sqlite:' . data_dir() . '/crm.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('admin','employee')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT, designation TEXT, territory TEXT,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  joined_on TEXT NOT NULL,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visit_date TEXT NOT NULL, clinic_name TEXT NOT NULL, address TEXT NOT NULL,
  contact_person TEXT, contact_phone TEXT, outcome TEXT, notes TEXT,
  lat REAL, lng REAL, accuracy REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS visits_emp_date ON visits(employee_id, visit_date);
CREATE INDEX IF NOT EXISTS visits_date ON visits(visit_date);
CREATE TABLE IF NOT EXISTS visit_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  file TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  storage TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX IF NOT EXISTS visit_photos_visit ON visit_photos(visit_id);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  lat REAL, lng REAL,
  UNIQUE (employee_id, date)
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'casual',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  admin_note TEXT,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS leave_requests_emp ON leave_requests(employee_id);
CREATE TABLE IF NOT EXISTS leave_days (
  request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (request_id, date)
);
CREATE INDEX IF NOT EXISTS leave_days_date ON leave_days(date);
CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS excused_days (
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (employee_id, date)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, red_count INTEGER NOT NULL, red_dates TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending', email_error TEXT, emailed_at TEXT, read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (employee_id, month)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, first_at INTEGER NOT NULL, count INTEGER NOT NULL);
SQL);
    $cols = array_column($pdo->query('PRAGMA table_info(visit_photos)')->fetchAll(), 'name');
    if (!in_array('storage', $cols, true)) $pdo->exec("ALTER TABLE visit_photos ADD COLUMN storage TEXT NOT NULL DEFAULT 'local'");
    $ucols = array_column($pdo->query('PRAGMA table_info(users)')->fetchAll(), 'name');
    foreach (['password_enc', 'suspended_from', 'suspended_until', 'removed_at'] as $c) {
        if (!in_array($c, $ucols, true)) $pdo->exec("ALTER TABLE users ADD COLUMN $c TEXT");
    }
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
function run(string $sql, array $args = []): int
{
    $st = db()->prepare($sql);
    $st->execute(array_values($args));
    return (int) db()->lastInsertId();
}
function placeholders(array $list): string { return implode(',', array_fill(0, max(1, count($list)), '?')); }
function now_iso(): string { return (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'); }

// ------------------------------------------------------------------ dates (company timezone)
function today(): string { return date('Y-m-d'); }
function current_month(): string { return date('Y-m'); }
function time_of(?string $iso): ?string
{
    if (!$iso) return null;
    return (new DateTime($iso))->setTimezone(new DateTimeZone(date_default_timezone_get()))->format('H:i');
}
function is_valid_date($s): bool
{
    if (!is_string($s) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m)) return false;
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}
function is_valid_month($s): bool
{
    return is_string($s) && preg_match('/^\d{4}-(\d{2})$/', $s, $m) && (int) $m[1] >= 1 && (int) $m[1] <= 12;
}
function utc_day(string $d): DateTimeImmutable { return new DateTimeImmutable($d . ' 00:00:00', new DateTimeZone('UTC')); }
function weekday(string $d): int { return (int) utc_day($d)->format('w'); }
function add_days(string $d, int $n): string { return utc_day($d)->modify(($n >= 0 ? '+' : '') . $n . ' day')->format('Y-m-d'); }
function month_days(string $month): array
{
    $count = (int) utc_day($month . '-01')->format('t');
    $out = [];
    for ($i = 1; $i <= $count; $i++) $out[] = $month . '-' . str_pad((string) $i, 2, '0', STR_PAD_LEFT);
    return $out;
}
function prev_month(string $month): string { return utc_day($month . '-01')->modify('-1 month')->format('Y-m'); }
function month_label(string $month): string { return utc_day($month . '-01')->format('F Y'); }
function pretty_date(string $d): string { return utc_day($d)->format('D, j M'); }
function month_param(): string { $m = qparam('month'); return is_valid_month($m) ? $m : current_month(); }

// ------------------------------------------------------------------ settings
const DEFAULT_SETTINGS = ['weeklyOff' => [0], 'redThreshold' => 5, 'alertEmails' => '', 'companyName' => 'Queue24'];

function get_settings(): array
{
    $out = DEFAULT_SETTINGS;
    foreach (q('SELECT key, value FROM settings') as $r) {
        if (!array_key_exists($r['key'], DEFAULT_SETTINGS)) continue;
        $v = json_decode($r['value'], true);
        if ($v !== null || $r['value'] === 'null') $out[$r['key']] = $v;
    }
    $out['weeklyOff'] = array_values(array_map('intval', (array) $out['weeklyOff']));
    $out['redThreshold'] = (int) $out['redThreshold'];
    return $out;
}
function save_settings(array $patch): array
{
    foreach ($patch as $k => $v) {
        if (!array_key_exists($k, DEFAULT_SETTINGS)) continue;
        run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$k, json_encode($v)]);
    }
    return get_settings();
}

// ------------------------------------------------------------------ auth / sessions
const SESSION_COOKIE = 'q24crm_session';

function b64url(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64url_dec(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/')); }

function jwt_secret(): string
{
    $s = (string) cfg('jwt_secret', '');
    if (strlen($s) >= 16) return $s;
    $file = data_dir() . '/.jwt-secret';
    if (is_file($file)) return trim((string) file_get_contents($file));
    $s = bin2hex(random_bytes(48));
    file_put_contents($file, $s);
    @chmod($file, 0600);
    return $s;
}
function jwt_sign(array $payload): string
{
    $h = b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $p = b64url(json_encode($payload));
    return "$h.$p." . b64url(hash_hmac('sha256', "$h.$p", jwt_secret(), true));
}
function jwt_verify(string $token): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$h, $p, $s] = $parts;
    if (!hash_equals(b64url(hash_hmac('sha256', "$h.$p", jwt_secret(), true)), $s)) return null;
    $data = json_decode(b64url_dec($p), true);
    if (!is_array($data) || ($data['exp'] ?? 0) < time()) return null;
    return $data;
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443);
}
function session_days(): int { return (int) cfg('session_days', 30); }

function issue_session(array $user): void
{
    $now = time();
    $token = jwt_sign(['uid' => (int) $user['id'], 'role' => $user['role'], 'v' => (int) $user['token_version'], 'iat' => $now, 'exp' => $now + session_days() * 86400]);
    setcookie(SESSION_COOKIE, $token, ['expires' => $now + session_days() * 86400, 'path' => (base_path() ?: '/'), 'httponly' => true, 'secure' => is_https(), 'samesite' => 'Lax']);
}
function clear_session(): void
{
    setcookie(SESSION_COOKIE, '', ['expires' => time() - 3600, 'path' => (base_path() ?: '/'), 'httponly' => true, 'secure' => is_https(), 'samesite' => 'Lax']);
}

function current_user(): ?array
{
    static $loaded = false, $user = null;
    if ($loaded) return $user;
    $loaded = true;
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!$token) return null;
    $p = jwt_verify($token);
    if (!$p) return null;
    $u = q1('SELECT * FROM users WHERE id = ?', [(int) ($p['uid'] ?? 0)]);
    if ($u && (int) $u['active'] === 1 && (int) $u['token_version'] === (int) ($p['v'] ?? -1) && $u['role'] === ($p['role'] ?? '')) $user = $u;
    return $user;
}
function require_auth(): array
{
    $u = current_user();
    if (!$u) throw new HttpError(401, 'Please sign in to continue.');
    return $u;
}
function require_role(string $role): array
{
    $u = require_auth();
    if ($u['role'] !== $role) throw new HttpError(403, $role === 'admin' ? 'Admin access required.' : 'This section is for sales employees.');
    return $u;
}

function public_user(?array $u): ?array
{
    if (!$u) return null;
    return [
        'id' => (int) $u['id'], 'role' => $u['role'], 'name' => $u['name'], 'email' => $u['email'], 'phone' => $u['phone'] ?? '' ?: '',
        'designation' => $u['designation'] ?? '' ?: '', 'territory' => $u['territory'] ?? '' ?: '', 'active' => (bool) $u['active'],
        'joinedOn' => $u['joined_on'], 'lastLoginAt' => $u['last_login_at'], 'createdAt' => $u['created_at'],
        'status' => access_status($u), 'suspendedFrom' => $u['suspended_from'] ?? null, 'suspendedUntil' => $u['suspended_until'] ?? null,
        'removedAt' => $u['removed_at'] ?? null, 'passwordStored' => !empty($u['password_enc']),
    ];
}

/** 'active' | 'paused' (temporary, optional end date) | 'removed' (permanent) */
function access_status(array $u): string
{
    if (!empty($u['removed_at'])) return 'removed';
    return (int) $u['active'] === 1 ? 'active' : 'paused';
}

// ------------------------------------------------------------------ password vault (admin can view employee passwords)
function vault_key(): string { return hash('sha256', jwt_secret() . '|q24-password-vault', true); }
function enc_pw(string $pw): ?string
{
    if (!function_exists('openssl_encrypt')) return null;
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($pw, 'aes-256-gcm', vault_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return $ct === false ? null : 'v1:' . base64_encode($iv . $tag . $ct);
}
function dec_pw(?string $blob): ?string
{
    if (!$blob || strpos($blob, 'v1:') !== 0 || !function_exists('openssl_decrypt')) return null;
    $raw = base64_decode(substr($blob, 3), true);
    if ($raw === false || strlen($raw) < 29) return null;
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', vault_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $pt === false ? null : $pt;
}

/** Restore an account whose pause has ended (or on admin request). Paused working days are excused (no red marks). */
function restore_access(array $u, ?int $byAdmin = null): void
{
    if (!empty($u['removed_at'])) throw bad('This account was removed permanently and cannot be restored.');
    if ($u['role'] === 'employee' && !empty($u['suspended_from'])) {
        $d = $u['suspended_from'];
        $end = today();
        $guard = 0;
        while ($d < $end && $guard++ < 400) {
            run("INSERT OR IGNORE INTO excused_days (employee_id, date, note, created_by) VALUES (?, ?, 'Access paused', ?)", [(int) $u['id'], $d, $byAdmin]);
            $d = add_days($d, 1);
        }
    }
    run("UPDATE users SET active = 1, suspended_from = NULL, suspended_until = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [(int) $u['id']]);
}

/** Auto-restore paused accounts whose end date has arrived. */
function auto_restore_due(): void
{
    foreach (q("SELECT * FROM users WHERE active = 0 AND removed_at IS NULL AND suspended_until IS NOT NULL AND suspended_until <= ?", [today()]) as $u) restore_access($u);
}

function hash_pw(string $pw): string { return password_hash($pw, PASSWORD_BCRYPT, ['cost' => 10]); }
function check_pw(string $pw, string $hash): bool { return password_verify($pw, $hash); }
function validate_pw($pw): ?string
{
    if (!is_string($pw) || strlen($pw) < 8) return 'Password must be at least 8 characters.';
    if (strlen($pw) > 128) return 'Password is too long.';
    return null;
}
function generate_password(): string
{
    $w = ['Kite', 'Mango', 'River', 'Tiger', 'Lotus', 'Cedar', 'Pearl', 'Comet', 'Maple', 'Falcon', 'Ember', 'Orbit',
        'Coral', 'Delta', 'Jade', 'Nova', 'Raven', 'Sable', 'Topaz', 'Willow', 'Zephyr', 'Amber', 'Bison', 'Cobra'];
    $a = $w[random_int(0, count($w) - 1)];
    do { $b = $w[random_int(0, count($w) - 1)]; } while ($b === $a);
    return $a . '-' . random_int(1000, 9999) . '-' . $b;
}

// login throttle: 8 failures per IP+identifier per 15 minutes
function throttle_key(string $id): string { return hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . strtolower($id)); }
function is_throttled(string $id): bool
{
    $r = q1('SELECT * FROM login_attempts WHERE key = ?', [throttle_key($id)]);
    if (!$r) return false;
    if (time() - (int) $r['first_at'] > 900) { run('DELETE FROM login_attempts WHERE key = ?', [throttle_key($id)]); return false; }
    return (int) $r['count'] >= 8;
}
function record_failure(string $id): void
{
    $k = throttle_key($id);
    $r = q1('SELECT * FROM login_attempts WHERE key = ?', [$k]);
    if (!$r || time() - (int) $r['first_at'] > 900) run('INSERT OR REPLACE INTO login_attempts (key, first_at, count) VALUES (?, ?, 1)', [$k, time()]);
    else run('UPDATE login_attempts SET count = count + 1 WHERE key = ?', [$k]);
}
function clear_failures(string $id): void { run('DELETE FROM login_attempts WHERE key = ?', [throttle_key($id)]); }

// ------------------------------------------------------------------ first admin from config
function bootstrap_admin(): void
{
    $n = (int) q1("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")['n'];
    if ($n > 0) return;
    $email = strtolower(trim((string) cfg('admin_email', '')));
    $pw = (string) cfg('admin_password', '');
    if (!$email || validate_pw($pw) !== null) return;
    run("INSERT INTO users (role, name, email, password_hash, password_enc, joined_on) VALUES ('admin', ?, ?, ?, ?, ?)", [(string) cfg('admin_name', 'Admin'), $email, hash_pw($pw), enc_pw($pw), today()]);
}
