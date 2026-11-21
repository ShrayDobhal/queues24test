<?php
/** Patient API: /blood-test/api/... */
declare(strict_types=1);

namespace Q24H;

function current_patient(): ?array
{
    static $done = false, $p = null;
    if ($done) return $p;
    $done = true;
    $s = session_payload('patient');
    if (!$s) return null;
    $u = q1('SELECT * FROM patients WHERE id = ?', [(int) $s['id']]);
    return $p = ($u && (int) $u['token_version'] === (int) $s['v']) ? $u : null;
}
function require_patient(): array
{
    $p = current_patient();
    if (!$p) throw new HttpError(401, 'Please verify your mobile number to continue.');
    return $p;
}
function patient_json(array $p): array { return ['id' => (int) $p['id'], 'name' => $p['name'], 'phone' => fmt_phone($p['phone']), 'email' => $p['email'] ?? '']; }

function patient_routes(string $method, string $path): void
{
    $b = fn() => body();

    // ---- public catalog (cache-friendly)
    if (route_match($method, $path, 'GET', '/catalog') !== null) {
        header('Cache-Control: no-cache');
        json_out(['tests' => catalog_tests(), 'areas' => areas_catalog(), 'slots' => SLOT_WINDOWS, 'genders' => GENDERS,
            'otpTestMode' => (string) cfg('otp_mode', 'test') === 'test', 'acceptTimeoutMin' => accept_timeout_min()]);
        return;
    }

    // ---- auth: mobile + OTP
    if (route_match($method, $path, 'POST', '/auth/otp') !== null) {
        $phone = norm_phone(str_in($b()['phone'] ?? '', 20));
        if (!$phone) throw bad('Enter a valid 10-digit Indian mobile number.');
        rate_hit("otp|$phone", 5, 900);
        rate_hit('otp-ip|' . client_ip(), 20, 900);
        $code = (string) random_int(100000, 999999);
        run('INSERT OR REPLACE INTO otps (phone, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)', [$phone, password_hash($code, PASSWORD_BCRYPT, ['cost' => 8]), time() + 600]);
        $exists = (bool) q1('SELECT 1 FROM patients WHERE phone = ?', [$phone]);
        $out = ['sent' => true, 'phone' => fmt_phone($phone), 'isNew' => !$exists];
        if ((string) cfg('otp_mode', 'test') === 'test') $out['testCode'] = $code; // no SMS gateway yet: shown on screen
        json_out($out);
        return;
    }
    if (route_match($method, $path, 'POST', '/auth/verify') !== null) {
        $phone = norm_phone(str_in($b()['phone'] ?? '', 20));
        $code = preg_replace('/\D/', '', (string) ($b()['code'] ?? ''));
        if (!$phone || strlen($code) !== 6) throw bad('Enter the 6-digit code.');
        $o = q1('SELECT * FROM otps WHERE phone = ?', [$phone]);
        if (!$o || (int) $o['expires_at'] < time()) throw bad('The code expired. Please request a new one.');
        if ((int) $o['attempts'] >= 5) throw new HttpError(429, 'Too many wrong attempts. Please request a new code.');
        if (!password_verify($code, $o['code_hash'])) { run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', [$phone]); throw bad('Incorrect code. Please try again.'); }
        run('DELETE FROM otps WHERE phone = ?', [$phone]);
        $p = q1('SELECT * FROM patients WHERE phone = ?', [$phone]);
        if (!$p) {
            $name = str_in($b()['name'] ?? '', 80);
            if (mb_strlen($name) < 2) throw bad('Enter your full name.');
            $id = run('INSERT INTO patients (phone, name) VALUES (?, ?)', [$phone, $name]);
            $p = q1('SELECT * FROM patients WHERE id = ?', [$id]);
        }
        run('UPDATE patients SET last_login_at = ? WHERE id = ?', [now_iso(), (int) $p['id']]);
        issue_session('patient', (int) $p['id'], (int) $p['token_version']);
        json_out(['user' => patient_json($p)]);
        return;
    }
    if (route_match($method, $path, 'POST', '/auth/logout') !== null) { clear_session('patient'); json_out(['ok' => true]); return; }
    if (route_match($method, $path, 'GET', '/auth/me') !== null) { $p = current_patient(); json_out(['user' => $p ? patient_json($p) : null]); return; }

    // ---- everything below needs a verified patient
    $pt = require_patient();
    $pid = (int) $pt['id'];

    if (route_match($method, $path, 'PATCH', '/me') !== null) {
        $name = str_in($b()['name'] ?? $pt['name'], 80);
        $email = str_in($b()['email'] ?? '', 120);
        if (mb_strlen($name) < 2) throw bad('Enter your full name.');
        if ($email !== '' && !preg_match(EMAIL_RE, $email)) throw bad('Enter a valid email or leave it empty.');
        run('UPDATE patients SET name = ?, email = ? WHERE id = ?', [$name, $email ?: null, $pid]);
        json_out(['user' => patient_json(q1('SELECT * FROM patients WHERE id = ?', [$pid]))]);
        return;
    }
    if (route_match($method, $path, 'GET', '/orders') !== null) {
        json_out(['items' => summaries(q('SELECT * FROM orders WHERE patient_id = ? ORDER BY id DESC LIMIT 100', [$pid]), 'patient')]);
        return;
    }
    if (route_match($method, $path, 'POST', '/orders') !== null) {
        $id = create_tests_order($pt, $b());
        json_out(['order' => order_detail(load_order($id), 'patient', $pid)], 201);
        return;
    }
    if (route_match($method, $path, 'POST', '/prescriptions') !== null) {
        if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) throw bad('The files are too large to upload.');
        rate_hit("rx|$pid", 10, 3600);
        $id = create_rx_order($pt, $_POST, validate_uploads(uploaded('files')));
        json_out(['order' => order_detail(load_order($id), 'patient', $pid)], 201);
        return;
    }
    if ($m = route_match($method, $path, 'GET', '/orders/(\d+)')) {
        $o = load_order((int) $m[0]); assert_access($o, 'patient', $pid);
        json_out(['order' => order_detail($o, 'patient', $pid)]);
        return;
    }
    if ($m = route_match($method, $path, 'POST', '/orders/(\d+)/cancel')) {
        cancel_order('patient', $pid, (int) $m[0], str_in($b()['reason'] ?? '', 200));
        json_out(['order' => order_detail(load_order((int) $m[0]), 'patient', $pid)]);
        return;
    }
    if ($m = route_match($method, $path, 'POST', '/orders/(\d+)/confirm')) {
        patient_confirm($pt, (int) $m[0], $b());
        json_out(['order' => order_detail(load_order((int) $m[0]), 'patient', $pid)]);
        return;
    }
    if ($m = route_match($method, $path, 'GET', '/orders/(\d+)/messages')) {
        $o = load_order((int) $m[0]); assert_access($o, 'patient', $pid);
        json_out(['items' => messages_for($o, 'patient', (int) qparam('after', 0)), 'status' => $o['status'], 'updatedAt' => $o['updated_at']]);
        return;
    }
    if ($m = route_match($method, $path, 'POST', '/orders/(\d+)/messages')) {
        $o = load_order((int) $m[0]); assert_access($o, 'patient', $pid);
        json_out(send_chat($o, 'patient', $pid, $pt['name'], (string) ($_POST['body'] ?? $b()['body'] ?? ''), validate_uploads(uploaded('files'))), 201);
        return;
    }
    if ($m = route_match($method, $path, 'GET', '/files/(\d+)')) { serve_order_file((int) $m[0], 'patient', $pid); return; }

    throw not_found();
}
