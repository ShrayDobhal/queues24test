<?php
/**
 * Inactivity alerts + email. When an employee reaches `redThreshold` red marks in a
 * month an alert is stored (admin panel) and a report is emailed to the admin(s),
 * via SMTP if configured, otherwise PHP mail() (works on Hostinger out of the box).
 */
declare(strict_types=1);

function mail_method(): string
{
    $m = (string) cfg('mail_method', '');
    if ($m === 'off') return 'off';
    if (cfg('smtp_host') && cfg('smtp_user')) return 'smtp';
    if ($m === 'smtp') return 'off'; // smtp requested but not configured
    return function_exists('mail') ? 'mail' : 'off';
}
function email_enabled(): bool { return mail_method() !== 'off'; }

function alert_recipients(): array
{
    $s = get_settings();
    $raw = implode(',', array_filter([(string) ($s['alertEmails'] ?? ''), (string) cfg('alert_email_to', '')]));
    $list = array_values(array_filter(array_map('trim', preg_split('/[,;\s]+/', $raw) ?: []), fn($e) => (bool) preg_match(EMAIL_RE, $e)));
    if (!$list) {
        foreach (q("SELECT email FROM users WHERE role = 'admin' AND active = 1") as $r) if (preg_match(EMAIL_RE, $r['email'])) $list[] = $r['email'];
    }
    return array_values(array_unique($list));
}

function mail_from(): string
{
    $from = (string) cfg('smtp_from', '');
    if ($from) return $from;
    if (cfg('smtp_user')) return 'Queue24 CRM <' . cfg('smtp_user') . '>';
    $host = preg_replace('/^www\./', '', strtolower($_SERVER['HTTP_HOST'] ?? 'queue24.com'));
    return "Queue24 CRM <noreply@$host>";
}

function from_address(string $from): string { return preg_match('/<([^>]+)>/', $from, $m) ? $m[1] : trim($from); }

function build_mime(string $subject, string $html, string $text, string $from, array $to): array
{
    $boundary = 'q24_' . bin2hex(random_bytes(8));
    $headers = [
        'From: ' . $from, 'Reply-To: ' . from_address($from), 'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"', 'X-Mailer: Queue24-CRM',
    ];
    $bodyStr = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
        . "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html))
        . "--$boundary--\r\n";
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    return [$encSubject, $headers, $bodyStr];
}

/** Minimal SMTP client (SSL on 465 or STARTTLS on 587) with AUTH LOGIN. */
function smtp_send(array $to, string $subject, string $html, string $text): void
{
    $host = (string) cfg('smtp_host');
    $port = (int) cfg('smtp_port', 465);
    $secure = $port === 465;
    $from = mail_from();
    [$encSubject, $headers, $bodyStr] = build_mime($subject, $html, $text, $from, $to);
    $fp = @stream_socket_client(($secure ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 20);
    if (!$fp) throw new RuntimeException("SMTP connect failed: $errstr");
    stream_set_timeout($fp, 20);
    $read = function () use ($fp) { $data = ''; while (($line = fgets($fp, 515)) !== false) { $data .= $line; if (strlen($line) < 4 || $line[3] === ' ') break; } return $data; };
    $cmd = function (string $c, array $ok) use ($fp, $read) {
        if ($c !== '') fwrite($fp, $c . "\r\n");
        $r = $read();
        if (!in_array((int) substr($r, 0, 3), $ok, true)) throw new RuntimeException('SMTP error: ' . trim($r));
        return $r;
    };
    $ehloHost = preg_replace('/[^a-z0-9.-]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost') ?: 'localhost';
    $cmd('', [220]);
    $cmd("EHLO $ehloHost", [250]);
    if (!$secure) {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('SMTP STARTTLS failed');
        $cmd("EHLO $ehloHost", [250]);
    }
    $cmd('AUTH LOGIN', [334]);
    $cmd(base64_encode((string) cfg('smtp_user')), [334]);
    $cmd(base64_encode((string) cfg('smtp_pass')), [235]);
    $cmd('MAIL FROM:<' . from_address($from) . '>', [250]);
    foreach ($to as $rcpt) $cmd("RCPT TO:<$rcpt>", [250, 251]);
    $cmd('DATA', [354]);
    $msg = implode("\r\n", array_merge(['To: ' . implode(', ', $to), 'Subject: ' . $encSubject, 'Date: ' . date('r')], $headers)) . "\r\n\r\n" . $bodyStr;
    $msg = preg_replace('/^\./m', '..', $msg);
    $cmd($msg . "\r\n.", [250]);
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
}

function send_mail(array $to, string $subject, string $html, string $text): void
{
    $method = mail_method();
    if ($method === 'smtp') { smtp_send($to, $subject, $html, $text); return; }
    if ($method === 'mail') {
        $from = mail_from();
        [$encSubject, $headers, $bodyStr] = build_mime($subject, $html, $text, $from, $to);
        $ok = @mail(implode(', ', $to), $encSubject, $bodyStr, implode("\r\n", $headers), '-f' . from_address($from));
        if (!$ok) throw new RuntimeException('PHP mail() failed');
        return;
    }
    throw new RuntimeException('Email delivery is not configured');
}

function public_url(): string
{
    $u = rtrim((string) cfg('public_url', ''), '/');
    if ($u) return $u;
    return (is_https() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

function alert_email_content(array $alert, array $emp, array $s, int $threshold): array
{
    $e = fn($x) => htmlspecialchars((string) $x, ENT_QUOTES, 'UTF-8');
    $monthName = month_label($alert['month']);
    $link = public_url() . base_path() . '/#/admin/employees/' . $emp['id'] . '?month=' . $alert['month'];
    $red = implode('', array_map(fn($d) => '<li>' . $e(pretty_date($d)) . '</li>', $s['redDates']));
    $role = $e($emp['designation'] ?: 'Sales') . ($emp['territory'] ? ', ' . $e($emp['territory']) : '');
    $html = <<<HTML
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#14231c">
  <div style="background:#1a8f5f;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">
    <div style="font-size:12px;letter-spacing:1.5px;font-weight:bold;opacity:.85">QUEUE24 SALES CRM</div>
    <div style="font-size:20px;font-weight:bold;margin-top:6px">Inactivity report: {$e($emp['name'])}</div>
  </div>
  <div style="border:1px solid #e3ebe7;border-top:0;padding:20px 22px;border-radius:0 0 12px 12px">
    <p><b>{$e($emp['name'])}</b> ($role) has <b style="color:#d23b3b">{$s['redCount']} red marks</b> in {$e($monthName)}: working days with no daily report submitted.</p>
    <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#5b6b63">Clinic updates this month</td><td style="text-align:right"><b>{$s['updates']}</b></td></tr>
      <tr><td style="padding:6px 0;color:#5b6b63">Days present (attendance)</td><td style="text-align:right"><b>{$s['presentDays']}</b></td></tr>
      <tr><td style="padding:6px 0;color:#5b6b63">Approved leave days</td><td style="text-align:right"><b>{$s['leaveDays']}</b></td></tr>
      <tr><td style="padding:6px 0;color:#5b6b63">Absent without leave</td><td style="text-align:right"><b>{$s['absentDays']}</b></td></tr>
    </table>
    <div style="font-weight:bold;margin-top:8px">Days without a report</div>
    <ul style="margin:6px 0 16px 18px;padding:0;color:#d23b3b">$red</ul>
    <a href="{$e($link)}" style="display:inline-block;background:#1a8f5f;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Open full report</a>
    <p style="font-size:12px;color:#8a9a92;margin-top:20px">You get this automatically when an employee reaches $threshold red marks in a month.</p>
  </div>
</div>
HTML;
    $text = "{$emp['name']} has {$s['redCount']} red marks in $monthName (no daily report on: " . implode(', ', $s['redDates']) . ").\nFull report: $link";
    return ["[Queue24 CRM] {$emp['name']} marked inactive: {$s['redCount']} red marks in $monthName", $html, $text];
}

function send_alert_email(int $alertId): array
{
    $alert = q1('SELECT * FROM alerts WHERE id = ?', [$alertId]);
    if (!$alert) return ['ok' => false, 'error' => 'Alert not found'];
    $emp = q1('SELECT * FROM users WHERE id = ?', [(int) $alert['employee_id']]);
    $to = alert_recipients();
    if (!email_enabled() || !$to) {
        $why = !email_enabled() ? 'Email delivery is not configured' : 'No admin email address configured';
        run("UPDATE alerts SET email_status = 'skipped', email_error = ? WHERE id = ?", [$why, $alertId]);
        return ['ok' => false, 'error' => $why];
    }
    $month = employee_month($emp, $alert['month']);
    [$subject, $html, $text] = alert_email_content($alert, $emp, $month['summary'], (int) get_settings()['redThreshold']);
    try {
        send_mail($to, $subject, $html, $text);
        run("UPDATE alerts SET email_status = 'sent', email_error = NULL, emailed_at = ? WHERE id = ?", [now_iso(), $alertId]);
        return ['ok' => true, 'to' => $to];
    } catch (Throwable $e) {
        run("UPDATE alerts SET email_status = 'failed', email_error = ? WHERE id = ?", [substr($e->getMessage(), 0, 300), $alertId]);
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/** Raise alerts for current + previous month (unique per employee/month). */
function run_inactivity_scan(): int
{
    $threshold = max(1, (int) get_settings()['redThreshold']);
    $cur = current_month();
    $created = [];
    foreach ([prev_month($cur), $cur] as $month) {
        foreach (all_employees_month($month, false) as $row) {
            $emp = $row['employee'];
            $s = $row['summary'];
            if ($s['redCount'] < $threshold) continue;
            $ex = q1('SELECT * FROM alerts WHERE employee_id = ? AND month = ?', [(int) $emp['id'], $month]);
            if ($ex) {
                if ((int) $ex['red_count'] !== $s['redCount']) run('UPDATE alerts SET red_count = ?, red_dates = ? WHERE id = ?', [$s['redCount'], json_encode($s['redDates']), (int) $ex['id']]);
                continue;
            }
            $created[] = run('INSERT INTO alerts (employee_id, month, red_count, red_dates) VALUES (?, ?, ?, ?)', [(int) $emp['id'], $month, $s['redCount'], json_encode($s['redDates'])]);
        }
    }
    foreach ($created as $id) send_alert_email($id);
    save_scan_time();
    return count($created);
}

function save_scan_time(): void { run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['lastScanAt', (string) time()]); }

/** Called after responses: runs the scan at most every 30 minutes (no cron needed). */
function maybe_scan(): void
{
    $r = q1("SELECT value FROM settings WHERE key = 'lastScanAt'");
    if ($r && time() - (int) $r['value'] < 1800) return;
    save_scan_time();
    try { run_inactivity_scan(); } catch (Throwable $e) { error_log('[crm alerts] scan failed: ' . $e->getMessage()); }
}
