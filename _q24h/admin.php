<?php
/**
 * Admin API for the health module, mounted inside the Sales CRM at
 * /sales-crm/api/admin/health/... (the CRM checks the admin session first).
 * Runs in the CRM's PHP process but uses only Q24H\ functions and the health DB.
 */
declare(strict_types=1);

namespace Q24H;

require_once __DIR__ . '/core.php';
require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/domain.php';

/** Entry point called by the CRM. $admin = CRM admin row (id, name). Sends the response itself. */
function admin_entry(string $method, string $path, array $admin): void
{
    try {
        db();
        process_timeouts();
        admin_routes($method, '/' . ltrim($path, '/'), (int) $admin['id'], (string) $admin['name']);
    } catch (HttpError $e) {
        json_out(['error' => $e->getMessage()], $e->status);
    } catch (\Throwable $e) {
        error_log('[q24h admin] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (!headers_sent()) json_out(['error' => 'Lab partner module error: ' . $e->getMessage()], 500);
    }
}

function partner_admin_json(array $p, array $roles = [], array $stats = []): array
{
    return [
        'id' => (int) $p['id'], 'code' => $p['code'], 'name' => $p['name'], 'email' => $p['email'], 'phone' => $p['phone'] ?? '', 'contactPerson' => $p['contact_person'] ?? '',
        'city' => $p['city'] ?? '', 'state' => $p['state'] ?? '', 'address' => $p['address'] ?? '', 'active' => (bool) $p['active'], 'lastLoginAt' => $p['last_login_at'],
        'coverage' => $roles, 'stats' => $stats + ['open' => 0, 'completed' => 0, 'rejected' => 0, 'expired' => 0, 'accepted' => 0],
    ];
}

function admin_routes(string $method, string $path, int $adminId, string $adminName): void
{
    $b = fn() => body();
    $m = null;

    if (route_match_a($method, $path, 'GET', '/overview') !== null) {
        $t = today();
        $c = fn(string $where, array $args = []) => (int) q1("SELECT COUNT(*) AS n FROM orders WHERE $where", $args)['n'];
        $monthStart = date('Y-m-01');
        $kpis = [
            'ordersToday' => $c("created_at >= ?", [gmdate('Y-m-d\TH:i:s', strtotime($t . ' 00:00:00'))]),
            'open' => $c("status IN ('" . implode("','", OPEN_STATUSES) . "')"),
            'needsAttention' => $c("status = 'needs_attention'"),
            'awaitingAccept' => $c("status = 'assigned'"),
            'prescriptionsPending' => $c("kind = 'prescription' AND status IN ('assigned','in_review','needs_attention','placed')"),
            'collectionsToday' => $c("status = 'scheduled' AND slot_date = ?", [$t]),
            'reportsPending' => $c("status IN ('collected','processing')"),
            'completedMonth' => $c("status = 'completed' AND updated_at >= ?", [gmdate('Y-m-d\TH:i:s', strtotime($monthStart))]),
            'revenueMonth' => (int) q1("SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status = 'completed' AND updated_at >= ?", [gmdate('Y-m-d\TH:i:s', strtotime($monthStart))])['s'],
            'patients' => (int) q1('SELECT COUNT(*) AS n FROM patients')['n'],
            'partnersActive' => (int) q1('SELECT COUNT(*) AS n FROM partners WHERE active = 1')['n'],
        ];
        $byStatus = [];
        foreach (q('SELECT status, COUNT(*) AS n FROM orders GROUP BY status') as $r) $byStatus[$r['status']] = (int) $r['n'];
        $attention = summaries(q("SELECT * FROM orders WHERE status IN ('needs_attention','assigned') ORDER BY CASE status WHEN 'needs_attention' THEN 0 ELSE 1 END, id LIMIT 8"), 'admin');
        $recent = summaries(q('SELECT * FROM orders ORDER BY id DESC LIMIT 8'), 'admin');
        $topAreas = q('SELECT a.name, a.kind, COUNT(o.id) AS n FROM orders o JOIN areas a ON a.id = o.area_id GROUP BY a.id ORDER BY n DESC LIMIT 6');
        json_out(['kpis' => $kpis, 'byStatus' => (object) $byStatus, 'attention' => $attention, 'recent' => $recent,
            'topAreas' => array_map(fn($r) => ['name' => $r['name'], 'kind' => $r['kind'], 'orders' => (int) $r['n']], $topAreas), 'acceptTimeoutMin' => accept_timeout_min()]);
        return;
    }

    // ---- orders
    if (route_match_a($method, $path, 'GET', '/orders') !== null) {
        $w = []; $a = [];
        if (($s = qparam('status')) && (isset(STATUS_LABELS[$s]))) { $w[] = 'status = ?'; $a[] = $s; }
        if (qparam('status') === 'open') $w[] = "status IN ('" . implode("','", OPEN_STATUSES) . "')";
        if (in_array(qparam('kind'), ['tests', 'prescription'], true)) { $w[] = 'kind = ?'; $a[] = qparam('kind'); }
        if ($v = (int) qparam('area', 0)) { $w[] = 'area_id = ?'; $a[] = $v; }
        if ($v = (int) qparam('partner', 0)) { $w[] = 'partner_id = ?'; $a[] = $v; }
        if (($s = trim((string) qparam('q', ''))) !== '') {
            $like = '%' . mb_substr($s, 0, 60) . '%';
            $digits = preg_replace('/\D/', '', $s);
            $w[] = '(order_no LIKE ? OR member_name LIKE ? OR city LIKE ?' . ($digits !== '' ? ' OR contact_phone LIKE ?' : '') . ')';
            array_push($a, $like, $like, $like);
            if ($digits !== '') $a[] = "%$digits%";
        }
        $sql = $w ? ' WHERE ' . implode(' AND ', $w) : '';
        $limit = min(100, max(1, (int) qparam('limit', 40)));
        $offset = max(0, (int) qparam('offset', 0));
        json_out(['items' => summaries(q("SELECT * FROM orders$sql ORDER BY id DESC LIMIT $limit OFFSET $offset", $a), 'admin'),
            'total' => (int) q1("SELECT COUNT(*) AS n FROM orders$sql", $a)['n']]);
        return;
    }
    if ($m = route_match_a($method, $path, 'GET', '/orders/(\d+)')) { json_out(['order' => order_detail(load_order((int) $m[0]), 'admin', $adminId)]); return; }
    if ($m = route_match_a($method, $path, 'POST', '/orders/(\d+)/assign')) {
        admin_assign($adminId, (int) $m[0], (int) ($b()['partnerId'] ?? 0));
        json_out(['order' => order_detail(load_order((int) $m[0]), 'admin', $adminId)]);
        return;
    }
    if ($m = route_match_a($method, $path, 'POST', '/orders/(\d+)/cancel')) {
        cancel_order('admin', $adminId, (int) $m[0], str_in($b()['reason'] ?? '', 200));
        json_out(['order' => order_detail(load_order((int) $m[0]), 'admin', $adminId)]);
        return;
    }
    if ($m = route_match_a($method, $path, 'GET', '/orders/(\d+)/messages')) {
        $o = load_order((int) $m[0]);
        json_out(['items' => messages_for($o, 'admin', (int) qparam('after', 0)), 'status' => $o['status'], 'updatedAt' => $o['updated_at']]);
        return;
    }
    if ($m = route_match_a($method, $path, 'POST', '/orders/(\d+)/messages')) {
        $o = load_order((int) $m[0]);
        json_out(send_chat($o, 'admin', $adminId, 'Queue24 Support', (string) ($_POST['body'] ?? $b()['body'] ?? ''), validate_uploads(uploaded('files'))), 201);
        return;
    }
    if ($m = route_match_a($method, $path, 'GET', '/files/(\d+)')) { serve_order_file((int) $m[0], 'admin', $adminId); return; }

    // ---- partners
    if (route_match_a($method, $path, 'GET', '/partners') !== null) {
        $roles = [];
        foreach (q('SELECT c.partner_id, c.role, a.id AS area_id, a.name, a.kind FROM coverage c JOIN areas a ON a.id = c.area_id') as $r) {
            $roles[(int) $r['partner_id']][] = ['areaId' => (int) $r['area_id'], 'area' => $r['name'], 'kind' => $r['kind'], 'role' => $r['role']];
        }
        $stats = [];
        foreach (q("SELECT partner_id, SUM(status IN ('" . implode("','", OPEN_STATUSES) . "')) AS open, SUM(status = 'completed') AS completed FROM orders WHERE partner_id IS NOT NULL GROUP BY partner_id") as $r) {
            $stats[(int) $r['partner_id']] = ['open' => (int) $r['open'], 'completed' => (int) $r['completed']];
        }
        foreach (q("SELECT partner_id, SUM(status = 'rejected') AS rejected, SUM(status = 'expired') AS expired, SUM(status = 'accepted') AS accepted FROM assignments GROUP BY partner_id") as $r) {
            $stats[(int) $r['partner_id']] = ($stats[(int) $r['partner_id']] ?? []) + ['rejected' => (int) $r['rejected'], 'expired' => (int) $r['expired'], 'accepted' => (int) $r['accepted']];
        }
        json_out(['items' => array_map(fn($p) => partner_admin_json($p, $roles[(int) $p['id']] ?? [], $stats[(int) $p['id']] ?? []), q('SELECT * FROM partners ORDER BY state, name'))]);
        return;
    }
    if (route_match_a($method, $path, 'POST', '/partners') !== null) {
        $f = partner_fields($b(), false);
        $pw = generate_password();
        $code = strtoupper(substr(preg_replace('/[^A-Z]/i', '', $f['city'] ?: 'LAB'), 0, 3)) . '-' . random_int(100, 999);
        $id = run('INSERT INTO partners (code, name, contact_person, email, phone, city, state, address, password_hash, password_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$code, $f['name'], $f['contact_person'], $f['email'], $f['phone'], $f['city'], $f['state'], $f['address'], hash_pw($pw), enc_pw($pw)]);
        json_out(['partner' => partner_admin_json(q1('SELECT * FROM partners WHERE id = ?', [$id])), 'password' => $pw], 201);
        return;
    }
    if ($m = route_match_a($method, $path, 'PATCH', '/partners/(\d+)')) {
        $p = q1('SELECT * FROM partners WHERE id = ?', [(int) $m[0]]);
        if (!$p) throw not_found('Lab partner not found.');
        $f = partner_fields(['__self' => (int) $p['id']] + $b(), true);
        $sets = []; $args = [];
        foreach ($f as $k => $v) { $sets[] = "$k = ?"; $args[] = $v; }
        if (is_bool($b()['active'] ?? null)) { $sets[] = 'active = ?'; $args[] = $b()['active'] ? 1 : 0; if (!$b()['active']) $sets[] = 'token_version = token_version + 1'; }
        if ($sets) { $args[] = (int) $p['id']; run('UPDATE partners SET ' . implode(', ', $sets) . ' WHERE id = ?', $args); }
        json_out(['partner' => partner_admin_json(q1('SELECT * FROM partners WHERE id = ?', [(int) $p['id']]))]);
        return;
    }
    if ($m = route_match_a($method, $path, 'GET', '/partners/(\d+)/password')) {
        $p = q1('SELECT * FROM partners WHERE id = ?', [(int) $m[0]]);
        if (!$p) throw not_found('Lab partner not found.');
        $pw = dec_pw($p['password_enc']);
        json_out(['available' => $pw !== null, 'password' => $pw, 'email' => $p['email'], 'name' => $p['name'], 'message' => $pw === null ? 'Generate a new password to see it here.' : null]);
        return;
    }
    if ($m = route_match_a($method, $path, 'POST', '/partners/(\d+)/reset-password')) {
        $pw = generate_password();
        if (affected('UPDATE partners SET password_hash = ?, password_enc = ?, token_version = token_version + 1 WHERE id = ?', [hash_pw($pw), enc_pw($pw), (int) $m[0]]) !== 1) throw not_found('Lab partner not found.');
        json_out(['password' => $pw]);
        return;
    }

    // ---- areas & coverage
    if (route_match_a($method, $path, 'GET', '/areas') !== null) {
        $cov = [];
        foreach (q('SELECT c.area_id, c.role, p.id, p.name, p.active FROM coverage c JOIN partners p ON p.id = c.partner_id') as $r) {
            $cov[(int) $r['area_id']][$r['role']] = ['id' => (int) $r['id'], 'name' => $r['name'], 'active' => (bool) $r['active']];
        }
        $open = [];
        foreach (q("SELECT area_id, COUNT(*) AS n FROM orders WHERE status IN ('" . implode("','", OPEN_STATUSES) . "') GROUP BY area_id") as $r) $open[(int) $r['area_id']] = (int) $r['n'];
        json_out(['items' => array_map(fn($a) => ['id' => (int) $a['id'], 'name' => $a['name'], 'state' => $a['state'], 'kind' => $a['kind'],
            'cities' => array_column(json_decode($a['cities'], true) ?: [], 'name'), 'primary' => $cov[(int) $a['id']]['primary'] ?? null, 'backup' => $cov[(int) $a['id']]['backup'] ?? null,
            'openOrders' => $open[(int) $a['id']] ?? 0], q("SELECT * FROM areas ORDER BY CASE kind WHEN 'metro' THEN 0 ELSE 1 END, name"))]);
        return;
    }
    if ($m = route_match_a($method, $path, 'PUT', '/areas/(\d+)/coverage')) {
        $area = q1('SELECT * FROM areas WHERE id = ?', [(int) $m[0]]);
        if (!$area) throw not_found('Area not found.');
        $primary = (int) ($b()['primary'] ?? 0);
        $backup = (int) ($b()['backup'] ?? 0);
        if (!$primary || !q1('SELECT 1 FROM partners WHERE id = ?', [$primary])) throw bad('Pick a primary lab partner.');
        if ($backup && ($backup === $primary || !q1('SELECT 1 FROM partners WHERE id = ?', [$backup]))) throw bad('The backup must be a different lab partner.');
        tx(function () use ($area, $primary, $backup) {
            run('DELETE FROM coverage WHERE area_id = ?', [(int) $area['id']]);
            run('INSERT INTO coverage (area_id, role, partner_id) VALUES (?, ?, ?)', [(int) $area['id'], 'primary', $primary]);
            if ($backup) run('INSERT INTO coverage (area_id, role, partner_id) VALUES (?, ?, ?)', [(int) $area['id'], 'backup', $backup]);
        });
        json_out(['ok' => true]);
        return;
    }

    // ---- test catalog
    if (route_match_a($method, $path, 'GET', '/tests') !== null) { json_out(['items' => catalog_tests(true)]); return; }
    if ($m = route_match_a($method, $path, 'PATCH', '/tests/(\d+)')) {
        $t = q1('SELECT * FROM tests WHERE id = ?', [(int) $m[0]]);
        if (!$t) throw not_found('Test not found.');
        $price = array_key_exists('price', $b()) ? int_in($b()['price']) : (int) $t['price'];
        $mrp = array_key_exists('mrp', $b()) ? int_in($b()['mrp']) : (int) $t['mrp'];
        if ($price === null || $price < 1 || $price > 100000) throw bad('Enter a valid price.');
        if ($mrp === null || $mrp < $price) throw bad('MRP must be at least the selling price.');
        $active = is_bool($b()['active'] ?? null) ? ($b()['active'] ? 1 : 0) : (int) $t['active'];
        $popular = is_bool($b()['popular'] ?? null) ? ($b()['popular'] ? 1 : 0) : (int) $t['popular'];
        run('UPDATE tests SET price = ?, mrp = ?, active = ?, popular = ? WHERE id = ?', [$price, $mrp, $active, $popular, (int) $t['id']]);
        json_out(['ok' => true]);
        return;
    }

    throw not_found();
}

function partner_fields(array $b, bool $partial): array
{
    $out = [];
    $has = fn($k) => !$partial || array_key_exists($k, $b);
    if ($has('name')) { $out['name'] = str_in($b['name'] ?? '', 120); if (mb_strlen($out['name']) < 3) throw bad('Enter the lab name.'); }
    if ($has('email')) {
        $out['email'] = strtolower(str_in($b['email'] ?? '', 120));
        if (!preg_match(EMAIL_RE, $out['email'])) throw bad('Enter a valid email (used as the login ID).');
        $dupe = q1('SELECT id FROM partners WHERE email = ? AND id <> ?', [$out['email'], (int) ($b['__self'] ?? 0)]);
        if ($dupe) throw bad('Another lab already uses this email.');
    }
    if ($has('phone')) { $ph = str_in($b['phone'] ?? '', 20); $out['phone'] = $ph === '' ? null : norm_phone($ph); if ($ph !== '' && !$out['phone']) throw bad('Enter a valid 10-digit mobile number.'); }
    if ($has('contactPerson')) $out['contact_person'] = str_in($b['contactPerson'] ?? '', 80) ?: null;
    if ($has('city')) $out['city'] = str_in($b['city'] ?? '', 60) ?: null;
    if ($has('state')) $out['state'] = str_in($b['state'] ?? '', 60) ?: null;
    if ($has('address')) $out['address'] = str_in($b['address'] ?? '', 300) ?: null;
    return $out;
}

function route_match_a(string $method, string $path, string $verb, string $pattern): ?array
{
    if ($method !== $verb) return null;
    return preg_match('#^' . $pattern . '$#', $path, $m) ? array_slice($m, 1) : null;
}
