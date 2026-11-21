<?php
/**
 * API routes (port of server/routes.js). Same paths and JSON shapes.
 */
declare(strict_types=1);

const VISIT_SELECT = 'SELECT v.*, u.name AS employee_name FROM visits v JOIN users u ON u.id = v.employee_id';

function serialize_visits(array $rows): array
{
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int) $r['id'], $rows);
    $by = [];
    foreach (q('SELECT visit_id, file, storage FROM visit_photos WHERE visit_id IN (' . placeholders($ids) . ') ORDER BY position', $ids) as $p) {
        $by[(int) $p['visit_id']][] = photo_url($p['file'], $p['storage']);
    }
    return array_map(fn($r) => [
        'id' => (int) $r['id'], 'employeeId' => (int) $r['employee_id'], 'employeeName' => $r['employee_name'],
        'date' => $r['visit_date'], 'time' => time_of($r['created_at']), 'createdAt' => $r['created_at'],
        'clinicName' => $r['clinic_name'], 'address' => $r['address'], 'contactPerson' => $r['contact_person'] ?? '' ?: '',
        'contactPhone' => $r['contact_phone'] ?? '' ?: '', 'outcome' => $r['outcome'] ?? '' ?: '', 'notes' => $r['notes'] ?? '' ?: '',
        'lat' => $r['lat'] !== null ? (float) $r['lat'] : null, 'lng' => $r['lng'] !== null ? (float) $r['lng'] : null,
        'accuracy' => $r['accuracy'] !== null ? (float) $r['accuracy'] : null, 'photos' => $by[(int) $r['id']] ?? [],
    ], $rows);
}

function leave_requests_for(string $where, array $args): array
{
    $rows = q("SELECT r.*, u.name AS employee_name, du.name AS decided_by_name FROM leave_requests r
        JOIN users u ON u.id = r.employee_id LEFT JOIN users du ON du.id = r.decided_by WHERE $where ORDER BY r.created_at DESC, r.id DESC", $args);
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int) $r['id'], $rows);
    $dates = [];
    foreach (q('SELECT request_id, date FROM leave_days WHERE request_id IN (' . placeholders($ids) . ') ORDER BY date', $ids) as $d) $dates[(int) $d['request_id']][] = $d['date'];
    return array_map(fn($r) => [
        'id' => (int) $r['id'], 'employeeId' => (int) $r['employee_id'], 'employeeName' => $r['employee_name'], 'type' => $r['leave_type'],
        'reason' => $r['reason'], 'status' => $r['status'], 'adminNote' => $r['admin_note'] ?? '' ?: '', 'decidedBy' => $r['decided_by_name'] ?? '' ?: '',
        'decidedAt' => $r['decided_at'], 'createdAt' => $r['created_at'], 'dates' => $dates[(int) $r['id']] ?? [],
    ], $rows);
}

function today_context(array $emp): array
{
    $t = today();
    $settings = get_settings();
    $holiday = q1('SELECT name FROM holidays WHERE date = ?', [$t]);
    $leave = q1("SELECT r.status FROM leave_days d JOIN leave_requests r ON r.id = d.request_id WHERE r.employee_id = ? AND d.date = ? AND r.status IN ('approved','pending') ORDER BY r.status = 'approved' DESC", [(int) $emp['id'], $t]);
    $att = q1('SELECT marked_at FROM attendance WHERE employee_id = ? AND date = ?', [(int) $emp['id'], $t]);
    $updates = (int) q1('SELECT COUNT(*) AS n FROM visits WHERE employee_id = ? AND visit_date = ?', [(int) $emp['id'], $t])['n'];
    return [
        'date' => $t, 'weekOff' => in_array(weekday($t), $settings['weeklyOff'], true), 'holiday' => $holiday['name'] ?? null,
        'leaveStatus' => $leave['status'] ?? null, 'attendanceMarkedAt' => $att['marked_at'] ?? null,
        'attendanceTime' => isset($att['marked_at']) ? time_of($att['marked_at']) : null, 'updates' => $updates,
    ];
}

function serialize_alert(array $a): array
{
    return [
        'id' => (int) $a['id'], 'employeeId' => (int) $a['employee_id'], 'employeeName' => $a['employee_name'], 'month' => $a['month'],
        'monthLabel' => month_label($a['month']), 'redCount' => (int) $a['red_count'], 'redDates' => json_decode($a['red_dates'] ?: '[]', true) ?: [],
        'emailStatus' => $a['email_status'], 'emailError' => $a['email_error'], 'emailedAt' => $a['emailed_at'], 'readAt' => $a['read_at'], 'createdAt' => $a['created_at'],
    ];
}

function find_account($id, ?string $role = null): array
{
    $u = q1('SELECT * FROM users WHERE id = ?', [(int) $id]);
    if (!$u || ($role && $u['role'] !== $role)) throw new HttpError(404, 'Account not found.');
    return $u;
}

function validate_profile(array $b, bool $partial = false): array
{
    $out = [];
    if (!$partial || array_key_exists('name', $b)) { $out['name'] = str_in($b['name'] ?? '', 80); if (mb_strlen($out['name']) < 2) throw bad('Enter the full name.'); }
    if (!$partial || array_key_exists('email', $b)) { $out['email'] = strtolower(str_in($b['email'] ?? '', 120)); if (!preg_match(EMAIL_RE, $out['email'])) throw bad('Enter a valid email address (used as the login ID).'); }
    if (!$partial || array_key_exists('phone', $b)) { $out['phone'] = str_in($b['phone'] ?? '', 20); if ($out['phone'] !== '' && !preg_match(PHONE_RE, $out['phone'])) throw bad('Enter a valid phone number.'); }
    if (!$partial || array_key_exists('designation', $b)) $out['designation'] = str_in($b['designation'] ?? '', 80);
    if (!$partial || array_key_exists('territory', $b)) $out['territory'] = str_in($b['territory'] ?? '', 120);
    if (isset($b['joinedOn']) && $b['joinedOn'] !== '') { if (!is_valid_date($b['joinedOn'])) throw bad('Invalid joining date.'); $out['joined_on'] = $b['joinedOn']; }
    return $out;
}
function assert_unique(array $f, int $exceptId = 0): void
{
    if (!empty($f['email']) && q1('SELECT 1 FROM users WHERE email = ? AND id <> ?', [$f['email'], $exceptId])) throw bad('Another account already uses this email.');
    if (!empty($f['phone']) && q1('SELECT 1 FROM users WHERE phone = ? AND id <> ?', [$f['phone'], $exceptId])) throw bad('Another account already uses this phone number.');
}
function create_account(string $role, array $b): array
{
    $f = validate_profile($b);
    assert_unique($f);
    $pw = !empty($b['password']) ? (string) $b['password'] : generate_password();
    if ($e = validate_pw($pw)) throw bad($e);
    $id = run('INSERT INTO users (role, name, email, phone, designation, territory, password_hash, password_enc, joined_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$role, $f['name'], $f['email'], $f['phone'] ?: null, $f['designation'] ?: null, $f['territory'] ?: null, hash_pw($pw), enc_pw($pw), $f['joined_on'] ?? today()]);
    return ['user' => public_user(q1('SELECT * FROM users WHERE id = ?', [$id])), 'password' => $pw];
}

function visit_filters(): array
{
    $w = []; $a = [];
    if ($e = qparam('employeeId')) { $w[] = 'v.employee_id = ?'; $a[] = (int) $e; }
    if (is_valid_date(qparam('from'))) { $w[] = 'v.visit_date >= ?'; $a[] = qparam('from'); }
    if (is_valid_date(qparam('to'))) { $w[] = 'v.visit_date <= ?'; $a[] = qparam('to'); }
    if (($o = qparam('outcome')) && in_array($o, OUTCOMES, true)) { $w[] = 'v.outcome = ?'; $a[] = $o; }
    if (($s = qparam('q')) !== null && trim($s) !== '') {
        $like = '%' . mb_substr(trim($s), 0, 80) . '%';
        $w[] = '(v.clinic_name LIKE ? OR v.address LIKE ? OR v.contact_person LIKE ? OR v.contact_phone LIKE ? OR u.name LIKE ?)';
        array_push($a, $like, $like, $like, $like, $like);
    }
    return [$w ? ' WHERE ' . implode(' AND ', $w) : '', $a];
}

/** Normalise $_FILES['photos'] (works for name="photos[]" and name="photos"). */
function uploaded_photos(): array
{
    $f = $_FILES['photos'] ?? null;
    if (!$f) return [];
    $out = [];
    if (is_array($f['name'])) {
        foreach ($f['name'] as $i => $n) $out[] = ['name' => $n, 'tmp_name' => $f['tmp_name'][$i], 'error' => $f['error'][$i], 'size' => $f['size'][$i]];
    } else {
        $out[] = $f;
    }
    return array_values(array_filter($out, fn($x) => $x['error'] !== UPLOAD_ERR_NO_FILE));
}

// ============================================================ dispatcher
function route(string $method, string $path): void
{
    $m = [];
    $is = function (string $verb, string $pattern) use ($method, $path, &$m): bool {
        if ($verb !== $method) return false;
        return (bool) preg_match('#^' . $pattern . '$#', $path, $m);
    };
    $b = fn() => body();

    // ---------------------------------------------------------------- auth
    if ($is('POST', '/auth/login')) {
        $identifier = strtolower(str_in($b()['identifier'] ?? '', 120));
        $password = (string) ($b()['password'] ?? '');
        $role = ($b()['role'] ?? '') === 'admin' ? 'admin' : 'employee';
        if (!$identifier || $password === '') throw bad('Enter your email / phone and password.');
        if (is_throttled($identifier)) throw new HttpError(429, 'Too many failed attempts. Please wait 15 minutes and try again.');
        $digits = preg_replace('/\D/', '', $identifier);
        $user = q1('SELECT * FROM users WHERE email = ?', [$identifier]);
        if (!$user && strlen($digits) >= 7) {
            $user = q1("SELECT * FROM users WHERE replace(replace(replace(phone,' ',''),'-',''),'+','') LIKE ?", ['%' . substr($digits, -10)]);
        }
        if (!$user || !check_pw($password, $user['password_hash'])) { record_failure($identifier); throw new HttpError(401, 'Incorrect email/phone or password.'); }
        if ($user['role'] !== $role) throw new HttpError(403, $user['role'] === 'admin' ? 'This is an admin account. Switch to the Admin tab to sign in.' : 'This is an employee account. Switch to the Employee tab to sign in.');
        if (!empty($user['removed_at'])) throw new HttpError(403, 'Your access to the CRM has been removed. Please contact your admin.');
        if (!(int) $user['active'] && !empty($user['suspended_until']) && $user['suspended_until'] <= today()) { restore_access($user); $user = q1('SELECT * FROM users WHERE id = ?', [(int) $user['id']]); }
        if (!(int) $user['active']) throw new HttpError(403, !empty($user['suspended_until'])
            ? 'Your access is paused until ' . pretty_date($user['suspended_until']) . '. Please contact your admin.'
            : 'Your access is paused. Please contact your admin.');
        clear_failures($identifier);
        run('UPDATE users SET last_login_at = ? WHERE id = ?', [now_iso(), (int) $user['id']]);
        issue_session($user);
        json_out(['user' => public_user($user)]);
        return;
    }
    if ($is('POST', '/auth/logout')) { clear_session(); json_out(['ok' => true]); return; }
    if ($is('GET', '/auth/me')) { json_out(['user' => public_user(current_user()), 'today' => today()]); return; }
    if ($is('POST', '/auth/change-password')) {
        $u = require_auth();
        if (!check_pw((string) ($b()['current'] ?? ''), $u['password_hash'])) throw bad('Your current password is incorrect.');
        $next = (string) ($b()['next'] ?? '');
        if ($e = validate_pw($next)) throw bad($e);
        run("UPDATE users SET password_hash = ?, password_enc = ?, token_version = token_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [hash_pw($next), enc_pw($next), (int) $u['id']]);
        issue_session(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]));
        json_out(['ok' => true]);
        return;
    }

    // ---------------------------------------------------------------- local photo files
    if ($is('GET', '/files/(\d{4}-\d{2})/([a-f0-9]{24}\.(?:jpg|png|webp|heic|heif))')) {
        $u = require_auth();
        $file = $m[1] . '/' . $m[2];
        if ($u['role'] !== 'admin' && !q1("SELECT 1 FROM visit_photos p JOIN visits v ON v.id = p.visit_id WHERE p.file = ? AND p.storage = 'local' AND v.employee_id = ?", [$file, (int) $u['id']])) throw new HttpError(404, 'Not found');
        $full = data_dir() . '/uploads/' . $file;
        if (!is_file($full)) throw new HttpError(404, 'Not found');
        $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'heic' => 'image/heic', 'heif' => 'image/heif'];
        header('Content-Type: ' . ($types[pathinfo($full, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
        header('Content-Length: ' . filesize($full));
        header('Cache-Control: private, max-age=604800, immutable');
        readfile($full);
        return;
    }

    // ---------------------------------------------------------------- employee
    if (strpos($path, '/me/') === 0) {
        $u = require_role('employee');
        $uid = (int) $u['id'];
        if ($is('GET', '/me/dashboard')) {
            $month = current_month();
            $tr = employee_month($u, $month);
            json_out([
                'user' => public_user($u), 'today' => today_context($u), 'month' => $month, 'monthLabel' => month_label($month),
                'summary' => $tr['summary'], 'recent' => serialize_visits(q(VISIT_SELECT . ' WHERE v.employee_id = ? ORDER BY v.created_at DESC LIMIT 6', [$uid])),
                'pendingLeaves' => (int) q1("SELECT COUNT(*) AS n FROM leave_requests WHERE employee_id = ? AND status = 'pending'", [$uid])['n'],
                'totals' => array_map('intval', q1('SELECT COUNT(*) AS visits, COUNT(DISTINCT lower(clinic_name)) AS clinics FROM visits WHERE employee_id = ?', [$uid])),
                'redThreshold' => get_settings()['redThreshold'],
            ]);
            return;
        }
        if ($is('POST', '/me/attendance')) {
            $ctx = today_context($u);
            if ($ctx['attendanceMarkedAt']) { json_out(['ok' => true, 'already' => true, 'today' => $ctx]); return; }
            if ($ctx['leaveStatus'] === 'approved') throw bad('You are on approved leave today. Cancel the leave with your admin to mark attendance.');
            run('INSERT OR IGNORE INTO attendance (employee_id, date, lat, lng) VALUES (?, ?, ?, ?)', [$uid, $ctx['date'], num_in($b()['lat'] ?? null), num_in($b()['lng'] ?? null)]);
            json_out(['ok' => true, 'today' => today_context($u)]);
            return;
        }
        if ($is('GET', '/me/calendar')) {
            $month = month_param();
            $tr = employee_month($u, $month);
            json_out($tr + ['monthLabel' => month_label($month), 'today' => today(), 'weeklyOff' => get_settings()['weeklyOff']]);
            return;
        }
        if ($is('GET', '/me/updates')) {
            $limit = min((int) (qparam('limit') ?: 20), 100);
            $offset = max((int) (qparam('offset') ?: 0), 0);
            json_out([
                'items' => serialize_visits(q(VISIT_SELECT . ' WHERE v.employee_id = ? ORDER BY v.created_at DESC LIMIT ? OFFSET ?', [$uid, $limit, $offset])),
                'total' => (int) q1('SELECT COUNT(*) AS n FROM visits WHERE employee_id = ?', [$uid])['n'],
            ]);
            return;
        }
        if ($is('POST', '/me/updates')) {
            $maxMb = (int) cfg('max_upload_mb', 10);
            if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) throw bad("The photos are too large to upload. Each photo must be under {$maxMb} MB.");
            $files = uploaded_photos();
            $bb = $_POST;
            $clinic = str_in($bb['clinicName'] ?? '', 120);
            $address = str_in($bb['address'] ?? '', 500);
            $person = str_in($bb['contactPerson'] ?? '', 80);
            $phone = str_in($bb['contactPhone'] ?? '', 20);
            $outcome = str_in($bb['outcome'] ?? '', 30);
            $notes = str_in($bb['notes'] ?? '', 1000);
            if (!$files) throw bad('Please add at least one photo of the clinic.');
            if (count($files) > 4) throw bad('You can attach up to 4 photos.');
            $types = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp', 'image/heic' => '.heic', 'image/heif' => '.heif'];
            $checked = [];
            foreach ($files as $f) {
                if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || $f['size'] > $maxMb * 1048576) throw bad("Each photo must be under {$maxMb} MB.");
                if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw bad('A photo failed to upload. Please try again.');
                $mime = function_exists('finfo_open') ? (string) finfo_file(finfo_open(FILEINFO_MIME_TYPE), $f['tmp_name']) : '';
                if (!$mime || $mime === 'application/octet-stream') {
                    $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
                    $mime = ['heic' => 'image/heic', 'heif' => 'image/heif'][$ext] ?? $mime;
                }
                if (!isset($types[$mime])) throw bad('Only image files (JPG, PNG, WEBP, HEIC) can be uploaded.');
                $checked[] = [$f['tmp_name'], $types[$mime], $mime];
            }
            if (mb_strlen($clinic) < 2) throw bad('Enter the clinic name.');
            if (mb_strlen($address) < 5) throw bad('Enter the full clinic address.');
            if ($phone !== '' && !preg_match(PHONE_RE, $phone)) throw bad('Enter a valid phone number (or leave it empty).');
            if ($outcome !== '' && !in_array($outcome, OUTCOMES, true)) throw bad('Invalid visit outcome.');
            $lat = num_in($bb['lat'] ?? null); $lng = num_in($bb['lng'] ?? null); $acc = num_in($bb['accuracy'] ?? null);
            $geo = $lat !== null && $lng !== null && abs($lat) <= 90 && abs($lng) <= 180;

            $saved = save_photos($checked);
            $pdo = db();
            try {
                $pdo->beginTransaction();
                $id = run('INSERT INTO visits (employee_id, visit_date, clinic_name, address, contact_person, contact_phone, outcome, notes, lat, lng, accuracy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$uid, today(), $clinic, $address, $person ?: null, $phone ?: null, $outcome ?: null, $notes ?: null, $geo ? $lat : null, $geo ? $lng : null, $geo ? $acc : null]);
                foreach ($saved as $i => $ph) run('INSERT INTO visit_photos (visit_id, file, position, storage) VALUES (?, ?, ?, ?)', [$id, $ph['key'], $i, $ph['storage']]);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                foreach ($saved as $ph) delete_photo($ph['key'], $ph['storage']);
                throw $e;
            }
            json_out(['visit' => serialize_visits(q(VISIT_SELECT . ' WHERE v.id = ?', [$id]))[0], 'today' => today_context($u)], 201);
            return;
        }
        if ($is('GET', '/me/leaves')) { json_out(['items' => leave_requests_for('r.employee_id = ?', [$uid])]); return; }
        if ($is('POST', '/me/leaves')) {
            $reason = str_in($b()['reason'] ?? '', 500);
            $type = in_array($b()['type'] ?? '', LEAVE_TYPES, true) ? $b()['type'] : 'casual';
            $t = today();
            $settings = get_settings();
            $dates = is_array($b()['dates'] ?? null) ? array_values(array_unique(array_map('strval', $b()['dates']))) : [];
            if (!$dates) throw bad('Select at least one date on the calendar.');
            if (count($dates) > 31) throw bad('You can apply for at most 31 days in one request.');
            foreach ($dates as $d) if (!is_valid_date($d)) throw bad('One of the selected dates is invalid.');
            foreach ($dates as $d) if ($d < $t) throw bad('Leave can only be applied for today or future dates.');
            if (mb_strlen($reason) < 3) throw bad('Please write a reason for your leave.');
            $hol = array_column(q('SELECT date FROM holidays WHERE date IN (' . placeholders($dates) . ')', $dates), 'date');
            $dates = array_values(array_filter($dates, fn($d) => !in_array($d, $hol, true) && !in_array(weekday($d), $settings['weeklyOff'], true)));
            sort($dates);
            if (!$dates) throw bad('The selected dates are all holidays or weekly offs — no leave needed.');
            $clash = q("SELECT d.date FROM leave_days d JOIN leave_requests r ON r.id = d.request_id WHERE r.employee_id = ? AND r.status IN ('pending','approved') AND d.date IN (" . placeholders($dates) . ')', array_merge([$uid], $dates));
            if ($clash) throw bad('You already have a leave request for ' . implode(', ', array_map(fn($c) => pretty_date($c['date']), $clash)) . '.');
            $pdo = db();
            $pdo->beginTransaction();
            $id = run('INSERT INTO leave_requests (employee_id, leave_type, reason) VALUES (?, ?, ?)', [$uid, $type, $reason]);
            foreach ($dates as $d) run('INSERT INTO leave_days (request_id, date) VALUES (?, ?)', [$id, $d]);
            $pdo->commit();
            json_out(['request' => leave_requests_for('r.id = ?', [$id])[0]], 201);
            return;
        }
        if ($is('DELETE', '/me/leaves/(\d+)')) {
            $r = q1('SELECT * FROM leave_requests WHERE id = ? AND employee_id = ?', [(int) $m[1], $uid]);
            if (!$r) throw new HttpError(404, 'Leave request not found.');
            if ($r['status'] !== 'pending') throw bad('Only pending requests can be cancelled. Contact your admin for approved leaves.');
            run("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?", [(int) $r['id']]);
            json_out(['ok' => true]);
            return;
        }
        throw new HttpError(404, 'Not found');
    }

    // ---------------------------------------------------------------- admin
    // ---------------------------------------------------------------- lab partners module (separate DB, optional)
    if ($path === '/admin/health' || strpos($path, '/admin/health/') === 0) {
        $me = require_role('admin');
        $bridge = dirname(CRM_ROOT) . '/_q24h/admin.php';
        if (!is_file($bridge)) throw new HttpError(404, 'The lab partners module is not installed.');
        require_once $bridge;
        \Q24H\admin_entry($method, substr($path, strlen('/admin/health')) ?: '/', $me);
        return;
    }

    if (strpos($path, '/admin/') === 0) {
        $me = require_role('admin');
        if ($is('GET', '/admin/dashboard')) {
            try { run_inactivity_scan(); } catch (Throwable $e) { error_log('[crm] scan: ' . $e->getMessage()); }
            $t = today();
            $month = current_month();
            $rows = all_employees_month($month, false);
            $team = [];
            foreach ($rows as $row) {
                $e = $row['employee'];
                $day = null;
                foreach ($row['days'] as $d) if ($d['date'] === $t) { $day = $d; break; }
                $team[] = [
                    'id' => (int) $e['id'], 'name' => $e['name'], 'designation' => $e['designation'] ?? '' ?: '', 'territory' => $e['territory'] ?? '' ?: '',
                    'present' => $day['present'], 'markedTime' => $day['markedTime'], 'updatesToday' => $day['updates'],
                    'onLeave' => (bool) ($day['leave'] && $day['leave']['status'] === 'approved'), 'status' => $day['status'],
                    'redCount' => $row['summary']['redCount'], 'updatesMonth' => $row['summary']['updates'],
                ];
            }
            $last14 = [];
            for ($i = 13; $i >= 0; $i--) $last14[] = add_days($t, -$i);
            $perDay = [];
            foreach (q('SELECT visit_date, COUNT(*) AS n FROM visits WHERE visit_date >= ? GROUP BY visit_date', [$last14[0]]) as $r) $perDay[$r['visit_date']] = (int) $r['n'];
            $pending = leave_requests_for("r.status = 'pending'", []);
            $open = array_map('serialize_alert', q('SELECT a.*, u.name AS employee_name FROM alerts a JOIN users u ON u.id = a.employee_id WHERE a.read_at IS NULL ORDER BY a.created_at DESC'));
            json_out([
                'today' => $t, 'month' => $month, 'monthLabel' => month_label($month),
                'kpis' => [
                    'activeEmployees' => count($team),
                    'presentToday' => count(array_filter($team, fn($x) => $x['present'])),
                    'reportedToday' => count(array_filter($team, fn($x) => $x['updatesToday'] > 0)),
                    'updatesToday' => array_sum(array_column($team, 'updatesToday')),
                    'onLeaveToday' => count(array_filter($team, fn($x) => $x['onLeave'])),
                    'updatesMonth' => array_sum(array_map(fn($r) => $r['summary']['updates'], $rows)),
                    'pendingLeaves' => count($pending), 'openAlerts' => count($open),
                ],
                'team' => $team, 'chart' => array_map(fn($d) => ['date' => $d, 'count' => $perDay[$d] ?? 0], $last14),
                'recent' => serialize_visits(q(VISIT_SELECT . ' ORDER BY v.created_at DESC LIMIT 8')), 'pendingLeaves' => array_slice($pending, 0, 5),
                'alerts' => $open, 'redThreshold' => get_settings()['redThreshold'],
            ]);
            return;
        }
        if ($is('GET', '/admin/employees')) {
            $month = month_param();
            $t = today();
            $totals = [];
            foreach (q('SELECT employee_id, COUNT(*) AS n, MAX(created_at) AS last FROM visits GROUP BY employee_id') as $r) $totals[(int) $r['employee_id']] = $r;
            $items = [];
            foreach (all_employees_month($month) as $row) {
                $e = $row['employee'];
                $today = null;
                foreach ($row['days'] as $d) if ($d['date'] === $t) { $today = $d; break; }
                $tot = $totals[(int) $e['id']] ?? null;
                $items[] = public_user($e) + [
                    'summary' => $row['summary'],
                    'today' => $today ? ['status' => $today['status'], 'present' => $today['present'], 'markedTime' => $today['markedTime'], 'updates' => $today['updates'], 'onLeave' => (bool) ($today['leave'] && $today['leave']['status'] === 'approved')] : null,
                    'totalUpdates' => $tot ? (int) $tot['n'] : 0, 'lastUpdateAt' => $tot['last'] ?? null,
                ];
            }
            json_out(['month' => $month, 'monthLabel' => month_label($month), 'redThreshold' => get_settings()['redThreshold'], 'items' => $items]);
            return;
        }
        if ($is('POST', '/admin/employees')) { json_out(create_account('employee', $b()), 201); return; }
        if ($is('GET', '/admin/employees/(\d+)/report')) {
            $e = find_account($m[1], 'employee');
            $month = month_param();
            $tr = employee_month($e, $month);
            $first = $tr['days'][0]['date'];
            $last = $tr['days'][count($tr['days']) - 1]['date'];
            $eid = (int) $e['id'];
            $totals = q1('SELECT COUNT(*) AS visits, COUNT(DISTINCT lower(clinic_name)) AS clinics, MIN(visit_date) AS first, MAX(created_at) AS last FROM visits WHERE employee_id = ?', [$eid]);
            $totals['visits'] = (int) $totals['visits']; $totals['clinics'] = (int) $totals['clinics'];
            json_out([
                'employee' => public_user($e), 'month' => $month, 'monthLabel' => month_label($month), 'today' => today(), 'weeklyOff' => get_settings()['weeklyOff'],
                'redThreshold' => get_settings()['redThreshold'], 'days' => $tr['days'], 'summary' => $tr['summary'],
                'visits' => serialize_visits(q(VISIT_SELECT . ' WHERE v.employee_id = ? AND v.visit_date BETWEEN ? AND ? ORDER BY v.created_at DESC', [$eid, $first, $last])),
                'totals' => $totals,
                'outcomes' => array_map(fn($r) => ['outcome' => $r['outcome'], 'n' => (int) $r['n']], q('SELECT outcome, COUNT(*) AS n FROM visits WHERE employee_id = ? AND visit_date BETWEEN ? AND ? GROUP BY outcome', [$eid, $first, $last])),
                'leaves' => leave_requests_for('r.employee_id = ?', [$eid]),
                'alerts' => array_map('serialize_alert', q('SELECT a.*, u.name AS employee_name FROM alerts a JOIN users u ON u.id = a.employee_id WHERE a.employee_id = ? ORDER BY month DESC', [$eid])),
            ]);
            return;
        }
        if ($is('PATCH', '/admin/employees/(\d+)')) {
            $u = find_account($m[1]);
            $bb = $b();
            if ((int) $u['id'] === (int) $me['id'] && ($bb['active'] ?? null) === false) throw bad('You cannot deactivate your own account.');
            $f = validate_profile($bb, true);
            assert_unique($f, (int) $u['id']);
            $sets = []; $args = [];
            foreach ($f as $k => $v) { $sets[] = "$k = ?"; $args[] = $v === '' ? null : $v; }
            if ($sets) { $args[] = (int) $u['id']; run('UPDATE users SET ' . implode(', ', $sets) . ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", $args); }
            if (($bb['active'] ?? null) === true && !(int) $u['active']) restore_access(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]), (int) $me['id']);
            if (($bb['active'] ?? null) === false && (int) $u['active']) run("UPDATE users SET active = 0, suspended_from = ?, suspended_until = NULL, token_version = token_version + 1 WHERE id = ?", [today(), (int) $u['id']]);
            json_out(['user' => public_user(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]))]);
            return;
        }
        if ($is('POST', '/admin/employees/(\d+)/reset-password')) {
            $u = find_account($m[1]);
            $pw = !empty($b()['password']) ? (string) $b()['password'] : generate_password();
            if ($e = validate_pw($pw)) throw bad($e);
            run("UPDATE users SET password_hash = ?, password_enc = ?, token_version = token_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [hash_pw($pw), enc_pw($pw), (int) $u['id']]);
            if ((int) $u['id'] === (int) $me['id']) issue_session(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]));
            json_out(['password' => $pw]);
            return;
        }
        if ($is('DELETE', '/admin/employees/(\d+)')) {
            $u = find_account($m[1]);
            if ((int) $u['id'] === (int) $me['id']) throw bad('You cannot delete your own account.');
            if ($u['role'] === 'admin' && (int) q1("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")['n'] <= 1) throw bad('At least one admin account must remain.');
            $files = q('SELECT p.file, p.storage FROM visit_photos p JOIN visits v ON v.id = p.visit_id WHERE v.employee_id = ?', [(int) $u['id']]);
            run('DELETE FROM users WHERE id = ?', [(int) $u['id']]);
            foreach ($files as $f) delete_photo($f['file'], $f['storage']);
            json_out(['ok' => true]);
            return;
        }
        if ($is('GET', '/admin/employees/(\d+)/password')) {
            $u = find_account($m[1]);
            $pw = dec_pw($u['password_enc'] ?? null);
            json_out(['available' => $pw !== null, 'password' => $pw, 'email' => $u['email'], 'name' => $u['name'],
                'message' => $pw === null ? 'This password was set before password viewing was enabled. Generate a new one to see it here.' : null]);
            return;
        }
        if ($is('POST', '/admin/employees/(\d+)/pause')) {
            $u = find_account($m[1]);
            if ((int) $u['id'] === (int) $me['id']) throw bad('You cannot pause your own account.');
            if (!empty($u['removed_at'])) throw bad('This account was removed permanently.');
            $until = $b()['until'] ?? null;
            if ($until !== null && $until !== '') {
                if (!is_valid_date($until) || $until <= today()) throw bad('Pick a future date to restore access automatically.');
            } else { $until = null; }
            run("UPDATE users SET active = 0, suspended_from = COALESCE(CASE WHEN active = 0 THEN suspended_from END, ?), suspended_until = ?, token_version = token_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
                [today(), $until, (int) $u['id']]);
            json_out(['user' => public_user(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]))]);
            return;
        }
        if ($is('POST', '/admin/employees/(\d+)/restore')) {
            $u = find_account($m[1]);
            restore_access($u, (int) $me['id']);
            json_out(['user' => public_user(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]))]);
            return;
        }
        if ($is('POST', '/admin/employees/(\d+)/remove')) {
            $u = find_account($m[1]);
            if ((int) $u['id'] === (int) $me['id']) throw bad('You cannot remove your own account.');
            if ($u['role'] === 'admin' && (int) q1("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND removed_at IS NULL")['n'] <= 1) throw bad('At least one admin account must remain.');
            run("UPDATE users SET active = 0, removed_at = ?, suspended_until = NULL, password_enc = NULL, token_version = token_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [now_iso(), (int) $u['id']]);
            json_out(['user' => public_user(q1('SELECT * FROM users WHERE id = ?', [(int) $u['id']]))]);
            return;
        }
        if ($is('POST', '/admin/employees/(\d+)/excuse')) {
            $u = find_account($m[1], 'employee');
            $date = (string) ($b()['date'] ?? '');
            if (!is_valid_date($date) || $date >= today()) throw bad('Only past days can be excused.');
            run('INSERT INTO excused_days (employee_id, date, note, created_by) VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, date) DO UPDATE SET note = excluded.note',
                [(int) $u['id'], $date, str_in($b()['note'] ?? '', 200) ?: null, (int) $me['id']]);
            json_out(['ok' => true]);
            return;
        }
        if ($is('DELETE', '/admin/employees/(\d+)/excuse/(\d{4}-\d{2}-\d{2})')) {
            $u = find_account($m[1], 'employee');
            run('DELETE FROM excused_days WHERE employee_id = ? AND date = ?', [(int) $u['id'], $m[2]]);
            json_out(['ok' => true]);
            return;
        }
        if ($is('GET', '/admin/admins')) { json_out(['items' => array_map('public_user', q("SELECT * FROM users WHERE role = 'admin' ORDER BY name COLLATE NOCASE"))]); return; }
        if ($is('POST', '/admin/admins')) { json_out(create_account('admin', $b()), 201); return; }
        if ($is('GET', '/admin/updates')) {
            [$sql, $args] = visit_filters();
            $limit = min((int) (qparam('limit') ?: 24), 100);
            $offset = max((int) (qparam('offset') ?: 0), 0);
            json_out([
                'items' => serialize_visits(q(VISIT_SELECT . "$sql ORDER BY v.created_at DESC LIMIT ? OFFSET ?", array_merge($args, [$limit, $offset]))),
                'total' => (int) q1("SELECT COUNT(*) AS n FROM visits v JOIN users u ON u.id = v.employee_id$sql", $args)['n'],
            ]);
            return;
        }
        if ($is('GET', '/admin/updates\.csv')) {
            [$sql, $args] = visit_filters();
            $rows = serialize_visits(q(VISIT_SELECT . "$sql ORDER BY v.created_at DESC LIMIT 20000", $args));
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="queue24-clinic-updates-' . today() . '.csv"');
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['Date', 'Time', 'Employee', 'Clinic', 'Address', 'Contact person', 'Contact phone', 'Outcome', 'Notes', 'Latitude', 'Longitude', 'Map link', 'Photos'], ',', '"', '');
            foreach ($rows as $r) {
                fputcsv($out, [$r['date'], $r['time'], $r['employeeName'], $r['clinicName'], $r['address'], $r['contactPerson'], $r['contactPhone'], $r['outcome'], $r['notes'],
                    $r['lat'] ?? '', $r['lng'] ?? '', $r['lat'] !== null ? "https://www.google.com/maps?q={$r['lat']},{$r['lng']}" : '', count($r['photos'])], ',', '"', '');
            }
            fclose($out);
            return;
        }
        if ($is('GET', '/admin/leaves')) {
            $st = in_array(qparam('status'), ['pending', 'approved', 'rejected', 'cancelled'], true) ? qparam('status') : null;
            $counts = [];
            foreach (q('SELECT status, COUNT(*) AS n FROM leave_requests GROUP BY status') as $r) $counts[$r['status']] = (int) $r['n'];
            json_out(['items' => $st ? leave_requests_for('r.status = ?', [$st]) : leave_requests_for('1 = 1', []), 'counts' => (object) $counts]);
            return;
        }
        if ($is('POST', '/admin/leaves/(\d+)/decision')) {
            $r = q1('SELECT * FROM leave_requests WHERE id = ?', [(int) $m[1]]);
            if (!$r) throw new HttpError(404, 'Leave request not found.');
            $st = $b()['status'] ?? '';
            if (!in_array($st, ['approved', 'rejected'], true)) throw bad('Choose approve or reject.');
            if ($r['status'] === 'cancelled') throw bad('This request was cancelled by the employee.');
            run('UPDATE leave_requests SET status = ?, admin_note = ?, decided_by = ?, decided_at = ? WHERE id = ?', [$st, str_in($b()['note'] ?? '', 300) ?: null, (int) $me['id'], now_iso(), (int) $r['id']]);
            json_out(['request' => leave_requests_for('r.id = ?', [(int) $r['id']])[0]]);
            return;
        }
        if ($is('GET', '/admin/attendance')) {
            $month = month_param();
            $settings = get_settings();
            $hol = [];
            foreach (q('SELECT date, name FROM holidays WHERE date LIKE ?', [$month . '%']) as $h) $hol[$h['date']] = $h['name'];
            json_out([
                'month' => $month, 'monthLabel' => month_label($month), 'today' => today(),
                'days' => array_map(fn($d) => ['date' => $d, 'weekday' => weekday($d), 'weekOff' => in_array(weekday($d), $settings['weeklyOff'], true), 'holiday' => $hol[$d] ?? null], month_days($month)),
                'rows' => array_map(fn($row) => [
                    'employee' => public_user($row['employee']), 'summary' => $row['summary'],
                    'cells' => array_map(fn($d) => ['status' => $d['status'], 'present' => $d['present'], 'markedTime' => $d['markedTime'], 'leave' => $d['leave']['status'] ?? null, 'updates' => $d['updates']], $row['days']),
                ], all_employees_month($month)),
            ]);
            return;
        }
        if ($is('GET', '/admin/alerts')) {
            try { run_inactivity_scan(); } catch (Throwable $e) { error_log('[crm] scan: ' . $e->getMessage()); }
            json_out([
                'items' => array_map('serialize_alert', q('SELECT a.*, u.name AS employee_name FROM alerts a JOIN users u ON u.id = a.employee_id ORDER BY a.read_at IS NOT NULL, a.created_at DESC')),
                'smtpConfigured' => email_enabled(), 'recipients' => alert_recipients(),
            ]);
            return;
        }
        if ($is('POST', '/admin/alerts/(\d+)/read')) { run('UPDATE alerts SET read_at = COALESCE(read_at, ?) WHERE id = ?', [now_iso(), (int) $m[1]]); json_out(['ok' => true]); return; }
        if ($is('POST', '/admin/alerts/(\d+)/email')) {
            $r = send_alert_email((int) $m[1]);
            if (!$r['ok']) throw bad('Email not sent: ' . $r['error']);
            json_out($r);
            return;
        }
        if ($is('GET', '/admin/settings')) {
            json_out(['settings' => get_settings(), 'smtpConfigured' => email_enabled(), 'recipients' => alert_recipients(), 'photoStorage' => storage_describe()]);
            return;
        }
        if ($is('PUT', '/admin/settings')) {
            $bb = $b();
            $patch = [];
            if (isset($bb['weeklyOff']) && is_array($bb['weeklyOff'])) $patch['weeklyOff'] = array_values(array_unique(array_filter(array_map('intval', $bb['weeklyOff']), fn($n) => $n >= 0 && $n <= 6)));
            if (array_key_exists('redThreshold', $bb)) {
                $n = filter_var($bb['redThreshold'], FILTER_VALIDATE_INT);
                if ($n === false || $n < 1 || $n > 31) throw bad('Red mark limit must be between 1 and 31.');
                $patch['redThreshold'] = $n;
            }
            if (array_key_exists('alertEmails', $bb)) {
                $list = array_values(array_filter(array_map('trim', preg_split('/[,;\s]+/', (string) $bb['alertEmails']) ?: [])));
                foreach ($list as $em) if (!preg_match(EMAIL_RE, $em)) throw bad('One of the alert email addresses is invalid.');
                $patch['alertEmails'] = implode(', ', $list);
            }
            json_out(['settings' => save_settings($patch), 'smtpConfigured' => email_enabled(), 'recipients' => alert_recipients()]);
            return;
        }
        if ($is('GET', '/admin/holidays')) { json_out(['items' => q('SELECT date, name FROM holidays ORDER BY date')]); return; }
        if ($is('POST', '/admin/holidays')) {
            $date = (string) ($b()['date'] ?? ''); $name = str_in($b()['name'] ?? '', 80);
            if (!is_valid_date($date)) throw bad('Pick a valid date.');
            if (mb_strlen($name) < 2) throw bad('Enter the holiday name.');
            run('INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name', [$date, $name]);
            json_out(['ok' => true], 201);
            return;
        }
        if ($is('DELETE', '/admin/holidays/(\d{4}-\d{2}-\d{2})')) { run('DELETE FROM holidays WHERE date = ?', [$m[1]]); json_out(['ok' => true]); return; }
        throw new HttpError(404, 'Not found');
    }

    // ---------------------------------------------------------------- optional cron hook: /api/cron?key=...
    if ($is('GET', '/cron')) {
        $key = (string) cfg('cron_key', '');
        if (!$key || !hash_equals($key, (string) qparam('key', ''))) throw new HttpError(404, 'Not found');
        json_out(['ok' => true, 'alertsRaised' => run_inactivity_scan()]);
        return;
    }
    if ($is('GET', '/health')) { json_out(['ok' => true, 'php' => PHP_VERSION, 'storage' => storage_describe()['provider'], 'email' => mail_method()]); return; }

    throw new HttpError(404, 'Not found');
}
