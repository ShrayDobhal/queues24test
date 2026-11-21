<?php
/** Lab partner API: /lab-partners/api/... */
declare(strict_types=1);

namespace Q24H;

function current_partner(): ?array
{
    static $done = false, $p = null;
    if ($done) return $p;
    $done = true;
    $s = session_payload('partner');
    if (!$s) return null;
    $u = q1('SELECT * FROM partners WHERE id = ?', [(int) $s['id']]);
    return $p = ($u && (int) $u['active'] === 1 && (int) $u['token_version'] === (int) $s['v']) ? $u : null;
}
function require_partner(): array
{
    $p = current_partner();
    if (!$p) throw new HttpError(401, 'Please sign in to continue.');
    return $p;
}
function partner_json(array $p): array
{
    $areas = q("SELECT a.name, a.kind, c.role FROM coverage c JOIN areas a ON a.id = c.area_id WHERE c.partner_id = ? ORDER BY a.name", [(int) $p['id']]);
    return ['id' => (int) $p['id'], 'code' => $p['code'], 'name' => $p['name'], 'email' => $p['email'], 'phone' => $p['phone'] ?? '', 'city' => $p['city'], 'state' => $p['state'],
        'contactPerson' => $p['contact_person'] ?? '', 'areas' => array_map(fn($a) => ['name' => $a['name'], 'kind' => $a['kind'], 'role' => $a['role']], $areas)];
}

const PARTNER_BUCKETS = [
    'new' => "status = 'assigned'",
    'active' => "status IN ('in_review','quoted','scheduled','collected','processing','report_ready')",
    'done' => "status IN ('completed','cancelled')",
];

function partner_routes(string $method, string $path): void
{
    $b = fn() => body();

    if (route_match($method, $path, 'POST', '/auth/login') !== null) {
        $id = strtolower(str_in($b()['identifier'] ?? '', 120));
        $pw = (string) ($b()['password'] ?? '');
        if ($id === '' || $pw === '') throw bad('Enter your login ID and password.');
        rate_hit("plogin|$id|" . client_ip(), 8, 900);
        $digits = norm_phone($id);
        $p = q1('SELECT * FROM partners WHERE email = ? OR (? IS NOT NULL AND phone = ?) OR code = ? COLLATE NOCASE', [$id, $digits, $digits, $id]);
        if (!$p || !password_verify($pw, $p['password_hash'])) throw new HttpError(401, 'Incorrect login ID or password.');
        if (!(int) $p['active']) throw new HttpError(403, 'This lab account is inactive. Please contact Queue24.');
        run('UPDATE partners SET last_login_at = ? WHERE id = ?', [now_iso(), (int) $p['id']]);
        issue_session('partner', (int) $p['id'], (int) $p['token_version']);
        json_out(['user' => partner_json($p)]);
        return;
    }
    if (route_match($method, $path, 'POST', '/auth/logout') !== null) { clear_session('partner'); json_out(['ok' => true]); return; }
    if (route_match($method, $path, 'GET', '/auth/me') !== null) { $p = current_partner(); json_out(['user' => $p ? partner_json($p) : null]); return; }

    $p = require_partner();
    $me = (int) $p['id'];

    // Login details (lab code, email, password) are managed only by the Queue24 admin.
    if (route_match($method, $path, 'POST', '/auth/change-password') !== null) throw new HttpError(403, 'Your login is managed by Queue24. Please contact Queue24 to change it.');
    if (route_match($method, $path, 'GET', '/dashboard') !== null) {
        $counts = [];
        foreach (PARTNER_BUCKETS as $k => $where) $counts[$k] = (int) q1("SELECT COUNT(*) AS n FROM orders WHERE partner_id = ? AND $where", [$me])['n'];
        $counts['today'] = (int) q1("SELECT COUNT(*) AS n FROM orders WHERE partner_id = ? AND status = 'scheduled' AND slot_date = ?", [$me, today()])['n'];
        $counts['prescriptions'] = (int) q1("SELECT COUNT(*) AS n FROM orders WHERE partner_id = ? AND kind = 'prescription' AND status IN ('in_review','quoted')", [$me])['n'];
        $counts['reportsDue'] = (int) q1("SELECT COUNT(*) AS n FROM orders WHERE partner_id = ? AND status IN ('collected','processing')", [$me])['n'];
        $counts['unread'] = (int) q1("SELECT COUNT(*) AS n FROM messages m JOIN orders o ON o.id = m.order_id LEFT JOIN reads r ON r.order_id = m.order_id AND r.party = 'partner'
            WHERE o.partner_id = ? AND m.sender_type NOT IN ('partner','system') AND m.id > COALESCE(r.last_message_id, 0)", [$me])['n'];
        json_out(['counts' => $counts, 'user' => partner_json($p), 'acceptTimeoutMin' => accept_timeout_min()]);
        return;
    }
    if (route_match($method, $path, 'GET', '/orders') !== null) {
        $bucket = qparam('bucket', 'active');
        $where = PARTNER_BUCKETS[$bucket] ?? PARTNER_BUCKETS['active'];
        $kind = in_array(qparam('kind'), ['tests', 'prescription'], true) ? ' AND kind = ' . db()->quote(qparam('kind')) : '';
        $order = $bucket === 'done' ? 'updated_at DESC' : ($bucket === 'new' ? 'id ASC' : "CASE WHEN slot_date IS NULL THEN 1 ELSE 0 END, slot_date, slot_window, id");
        json_out(['items' => summaries(q("SELECT * FROM orders WHERE partner_id = ? AND $where$kind ORDER BY $order LIMIT 200", [$me]), 'partner')]);
        return;
    }
    if ($m = route_match($method, $path, 'GET', '/orders/(\d+)')) {
        $o = load_order((int) $m[0]); assert_access($o, 'partner', $me);
        json_out(['order' => order_detail($o, 'partner', $me)]);
        return;
    }
    if ($m = route_match($method, $path, 'POST', '/orders/(\d+)/(accept|reject|collected|processing|completed|quote)')) {
        $id = (int) $m[0];
        switch ($m[1]) {
            case 'accept': partner_accept($p, $id); break;
            case 'reject': partner_reject($p, $id, str_in($b()['reason'] ?? '', 200)); break;
            case 'quote': partner_quote($p, $id, is_array($b()['items'] ?? null) ? $b()['items'] : [], str_in($b()['note'] ?? '', 500)); break;
            default: partner_advance($p, $id, $m[1]);
        }
        $o = load_order($id);
        json_out(['order' => (int) $o['partner_id'] === $me ? order_detail($o, 'partner', $me) : null]);
        return;
    }
    if ($m = route_match($method, $path, 'POST', '/orders/(\d+)/report')) {
        partner_report($p, (int) $m[0], validate_uploads(uploaded('files')));
        json_out(['order' => order_detail(load_order((int) $m[0]), 'partner', $me)]);
        return;
    }
    if ($m = route_match($method, $path, 'GET', '/orders/(\d+)/messages')) {
        $o = load_order((int) $m[0]); assert_access($o, 'partner', $me);
        json_out(['items' => messages_for($o, 'partner', (int) qparam('after', 0)), 'status' => $o['status'], 'updatedAt' => $o['updated_at']]);
        return;
    }
    if ($m = route_match($method, $path, 'POST', '/orders/(\d+)/messages')) {
        $o = load_order((int) $m[0]); assert_access($o, 'partner', $me);
        json_out(send_chat($o, 'partner', $me, $p['name'], (string) ($_POST['body'] ?? $b()['body'] ?? ''), validate_uploads(uploaded('files'))), 201);
        return;
    }
    if (route_match($method, $path, 'GET', '/catalog') !== null) { json_out(['tests' => catalog_tests()]); return; }
    if ($m = route_match($method, $path, 'GET', '/files/(\d+)')) { serve_order_file((int) $m[0], 'partner', $me); return; }

    throw not_found();
}
