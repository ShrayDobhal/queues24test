<?php
/**
 * Order engine: routing to lab partners (primary → backup failover), status machine,
 * conversation, read tracking and serializers shared by patient / partner / admin.
 *
 * Status flow
 *   tests:         placed → assigned → scheduled → collected → processing → report_ready → completed
 *   prescription:  placed → assigned → in_review → quoted → scheduled → collected → … → completed
 *   any open state → cancelled;  no partner available → needs_attention (admin assigns)
 * Every transition is a conditional UPDATE inside BEGIN IMMEDIATE, so concurrent
 * actions (e.g. partner accepts while the offer times out) can never both win.
 */
declare(strict_types=1);

namespace Q24H;

const STATUS_LABELS = [
    'placed' => 'Placed', 'assigned' => 'Waiting for lab to accept', 'in_review' => 'Lab is reviewing prescription',
    'quoted' => 'Tests suggested by lab', 'scheduled' => 'Sample collection scheduled', 'collected' => 'Sample collected',
    'processing' => 'Testing in lab', 'report_ready' => 'Report ready', 'completed' => 'Completed', 'cancelled' => 'Cancelled',
    'needs_attention' => 'Needs attention',
];
const OPEN_STATUSES = ['placed', 'assigned', 'in_review', 'quoted', 'scheduled', 'collected', 'processing', 'report_ready', 'needs_attention'];
const PATIENT_CANCELLABLE = ['placed', 'assigned', 'in_review', 'quoted', 'scheduled', 'needs_attention'];
const REASSIGNABLE = ['placed', 'assigned', 'in_review', 'quoted', 'scheduled', 'needs_attention'];
const SLOT_WINDOWS = ['06-08' => '6–8 AM', '08-10' => '8–10 AM', '10-12' => '10 AM–12 PM', '12-14' => '12–2 PM', '14-16' => '2–4 PM', '16-18' => '4–6 PM'];
const GENDERS = ['male' => 'Male', 'female' => 'Female', 'other' => 'Other'];

function accept_timeout_min(): int { return max(5, (int) cfg('accept_timeout_minutes', 30)); }
function status_label(string $s, string $scope): string
{
    if ($scope === 'patient' && ($s === 'needs_attention' || $s === 'placed')) return 'Finding the best lab for you';
    if ($scope === 'patient' && $s === 'assigned') return 'Waiting for lab confirmation';
    if ($scope === 'partner' && $s === 'assigned') return 'New request: accept or reject';
    return STATUS_LABELS[$s] ?? $s;
}

// ------------------------------------------------------------------ areas
function areas_catalog(): array
{
    $areas = q('SELECT * FROM areas ORDER BY name');
    $states = [];
    foreach ($areas as $a) {
        if ($a['kind'] === 'state') $states[$a['state']]['other'] = (int) $a['id'];
        $states[$a['state']]['name'] = $a['state'];
    }
    foreach ($areas as $a) {
        if ($a['kind'] !== 'metro') continue;
        foreach (json_decode($a['cities'], true) as $c) {
            $states[$c['state']]['name'] = $c['state'];
            $states[$c['state']]['cities'][] = ['name' => $c['name'], 'areaId' => (int) $a['id'], 'metro' => $a['name']];
        }
    }
    ksort($states);
    return array_values(array_map(fn($s) => ['name' => $s['name'], 'cities' => $s['cities'] ?? [], 'otherAreaId' => $s['other'] ?? null], $states));
}

/** Resolve the service area: a metro city wins, otherwise the state's area. */
function resolve_area(string $state, string $city): array
{
    $state = trim($state); $city = trim($city);
    foreach (q("SELECT * FROM areas WHERE kind = 'metro'") as $a) {
        foreach (json_decode($a['cities'], true) as $c) {
            if (strcasecmp($c['name'], $city) === 0 && strcasecmp($c['state'], $state) === 0) return $a;
        }
    }
    $a = q1("SELECT * FROM areas WHERE kind = 'state' AND state = ? COLLATE NOCASE", [$state]);
    if (!$a) $a = q1("SELECT * FROM areas WHERE kind = 'metro' AND state = ? COLLATE NOCASE", [$state]); // e.g. Delhi
    if (!$a) throw bad('Sorry, we don\'t serve this location yet. Please pick your state from the list.');
    return $a;
}

// ------------------------------------------------------------------ validation helpers
function validate_location(array $b): array
{
    $state = str_in($b['state'] ?? '', 60);
    $city = str_in($b['city'] ?? '', 60);
    if ($state === '') throw bad('Select your state.');
    if (mb_strlen($city) < 2) throw bad('Enter your city.');
    $area = resolve_area($state, $city);
    return ['state' => $state, 'city' => $city, 'area' => $area];
}
function validate_booking(array $b, array $patient): array
{
    $pincode = str_in($b['pincode'] ?? '', 6);
    $address = str_in($b['address'] ?? '', 300);
    $m = is_array($b['member'] ?? null) ? $b['member'] : [];
    $name = str_in($m['name'] ?? '', 80);
    $age = int_in($m['age'] ?? null);
    $gender = str_in($m['gender'] ?? '', 10);
    $date = (string) ($b['slotDate'] ?? '');
    $win = (string) ($b['slotWindow'] ?? '');
    if (!preg_match('/^[1-9]\d{5}$/', $pincode)) throw bad('Enter a valid 6-digit pincode.');
    if (mb_strlen($address) < 10) throw bad('Enter the full address for sample collection (house no., street, area).');
    if (mb_strlen($name) < 2) throw bad('Enter the patient\'s full name.');
    if ($age === null || $age < 1 || $age > 120) throw bad('Enter the patient\'s age.');
    if (!isset(GENDERS[$gender])) throw bad('Select gender.');
    if (!is_valid_date($date) || $date < today() || $date > add_days(today(), 6)) throw bad('Pick a collection date within the next 7 days.');
    if (!isset(SLOT_WINDOWS[$win])) throw bad('Pick a collection time slot.');
    if ($date === today() && (int) substr($win, 0, 2) < (int) date('G') + 2) throw bad('That time slot has passed for today. Please pick a later slot or another day.');
    $alt = str_in($b['contactPhone'] ?? '', 20);
    $contact = $alt !== '' ? norm_phone($alt) : $patient['phone'];
    if ($contact === null) throw bad('Enter a valid 10-digit mobile number for the collection team.');
    return ['pincode' => $pincode, 'address' => $address, 'member_name' => $name, 'member_age' => $age, 'member_gender' => $gender,
        'slot_date' => $date, 'slot_window' => $win, 'contact_phone' => $contact];
}
function load_tests(array $ids): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($x) => $x > 0)));
    if (!$ids) throw bad('Add at least one test.');
    if (count($ids) > 25) throw bad('Too many tests in one order.');
    $rows = q('SELECT * FROM tests WHERE active = 1 AND id IN (' . placeholders($ids) . ')', $ids);
    if (count($rows) !== count($ids)) throw bad('One of the tests is no longer available. Please refresh and try again.');
    return $rows;
}
function client_ref($v): string
{
    $r = str_in($v, 64);
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $r)) throw bad('Missing request id. Please refresh and try again.');
    return $r;
}

// ------------------------------------------------------------------ events & messages
function add_event(int $orderId, string $actorType, ?int $actorId, string $action, ?string $from, ?string $to, ?string $note = null): void
{
    run('INSERT INTO events (order_id, actor_type, actor_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [$orderId, $actorType, $actorId, $action, $from, $to, $note]);
}
function touch_order(int $orderId): void { run('UPDATE orders SET updated_at = ? WHERE id = ?', [now_iso(), $orderId]); }
function post_message(int $orderId, string $senderType, ?int $senderId, ?string $senderName, string $kind, ?string $body, array $fileIds = [], ?array $meta = null): int
{
    $id = run('INSERT INTO messages (order_id, sender_type, sender_id, sender_name, kind, body, file_ids, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$orderId, $senderType, $senderId, $senderName, $kind, $body, json_encode(array_values($fileIds)), $meta ? json_encode($meta) : null]);
    if ($senderType !== 'system') mark_read($orderId, $senderType, $id);
    touch_order($orderId);
    return $id;
}
function system_msg(int $orderId, string $text): void { post_message($orderId, 'system', null, 'Queue24', 'system', $text); }
function mark_read(int $orderId, string $party, int $messageId): void
{
    run('INSERT INTO reads (order_id, party, last_message_id) VALUES (?, ?, ?) ON CONFLICT(order_id, party) DO UPDATE SET last_message_id = MAX(last_message_id, excluded.last_message_id)', [$orderId, $party, $messageId]);
}

// ------------------------------------------------------------------ routing / failover
function partner_name(?int $id): string { $p = $id ? q1('SELECT name FROM partners WHERE id = ?', [$id]) : null; return $p['name'] ?? 'lab'; }

/** Offer the order to the next available partner of its area. Call inside tx(). */
function offer_next(int $orderId, string $actorType = 'system', ?int $actorId = null): ?int
{
    $o = q1('SELECT * FROM orders WHERE id = ?', [$orderId]);
    if (!$o || in_array($o['status'], ['completed', 'cancelled'], true)) return null;
    $tried = array_map('intval', array_column(q("SELECT DISTINCT partner_id FROM assignments WHERE order_id = ? AND status IN ('rejected','expired','revoked')", [$orderId]), 'partner_id'));
    $cands = q("SELECT c.role, p.id, p.name FROM coverage c JOIN partners p ON p.id = c.partner_id WHERE c.area_id = ? AND p.active = 1 ORDER BY CASE c.role WHEN 'primary' THEN 0 ELSE 1 END", [(int) $o['area_id']]);
    foreach ($cands as $c) {
        if (in_array((int) $c['id'], $tried, true)) continue;
        run('INSERT INTO assignments (order_id, partner_id, role, status, expires_at) VALUES (?, ?, ?, ?, ?)', [$orderId, (int) $c['id'], $c['role'], 'offered', time() + accept_timeout_min() * 60]);
        run("UPDATE orders SET partner_id = ?, partner_role = ?, status = 'assigned', updated_at = ? WHERE id = ?", [(int) $c['id'], $c['role'], now_iso(), $orderId]);
        add_event($orderId, $actorType, $actorId, 'offered', $o['status'], 'assigned', "Sent to {$c['name']} ({$c['role']})");
        return (int) $c['id'];
    }
    run("UPDATE orders SET partner_id = NULL, partner_role = NULL, status = 'needs_attention', updated_at = ? WHERE id = ?", [now_iso(), $orderId]);
    add_event($orderId, 'system', null, 'unassigned', $o['status'], 'needs_attention', 'No lab partner available. Admin needs to assign one.');
    return null;
}

/** Expire offers that weren't accepted in time and fail over to the backup. Cheap (indexed); runs on every request. */
function process_timeouts(): void
{
    foreach (q("SELECT id, order_id, partner_id FROM assignments WHERE status = 'offered' AND expires_at < ? LIMIT 25", [time()]) as $a) {
        tx(function () use ($a) {
            if (affected("UPDATE assignments SET status = 'expired', responded_at = ? WHERE id = ? AND status = 'offered'", [now_iso(), (int) $a['id']]) !== 1) return;
            add_event((int) $a['order_id'], 'system', null, 'expired', 'assigned', null, partner_name((int) $a['partner_id']) . ' did not respond in ' . accept_timeout_min() . ' min');
            offer_next((int) $a['order_id']);
        });
    }
}

// ------------------------------------------------------------------ creating orders
function set_order_no(int $id, string $kind): string
{
    $no = ($kind === 'prescription' ? 'RX' : 'BT') . date('ymd') . '-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT);
    run('UPDATE orders SET order_no = ? WHERE id = ?', [$no, $id]);
    return $no;
}
function existing_by_ref(int $patientId, string $ref): ?int
{
    $r = q1('SELECT id FROM orders WHERE patient_id = ? AND client_ref = ?', [$patientId, $ref]);
    return $r ? (int) $r['id'] : null;
}

function create_tests_order(array $patient, array $b): int
{
    $ref = client_ref($b['clientRef'] ?? '');
    if ($id = existing_by_ref((int) $patient['id'], $ref)) return $id; // idempotent retry
    $loc = validate_location($b);
    $bk = validate_booking($b, $patient);
    $tests = load_tests(is_array($b['items'] ?? null) ? $b['items'] : []);
    $mrp = array_sum(array_column($tests, 'mrp'));
    $total = array_sum(array_column($tests, 'price'));
    return tx(function () use ($patient, $b, $ref, $loc, $bk, $tests, $mrp, $total) {
        if ($id = existing_by_ref((int) $patient['id'], $ref)) return $id;
        $id = run('INSERT INTO orders (patient_id, kind, status, area_id, city, state, pincode, address, member_name, member_age, member_gender, contact_phone, slot_date, slot_window, subtotal, discount, total, client_ref, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(int) $patient['id'], 'tests', 'placed', (int) $loc['area']['id'], $loc['city'], $loc['state'], $bk['pincode'], $bk['address'], $bk['member_name'], $bk['member_age'], $bk['member_gender'],
                $bk['contact_phone'], $bk['slot_date'], $bk['slot_window'], $mrp, $mrp - $total, $total, $ref, str_in($b['note'] ?? '', 500) ?: null]);
        $ins = db()->prepare('INSERT INTO order_items (order_id, test_id, name, price, mrp) VALUES (?, ?, ?, ?, ?)');
        foreach ($tests as $t) $ins->execute([$id, (int) $t['id'], $t['name'], (int) $t['price'], (int) $t['mrp']]);
        $no = set_order_no($id, 'tests');
        add_event($id, 'patient', (int) $patient['id'], 'placed', null, 'placed', count($tests) . ' test(s), ₹' . $total);
        system_msg($id, "Order $no placed. We're assigning a certified partner lab near you. Collection: " . date('D, j M', strtotime($bk['slot_date'])) . ', ' . SLOT_WINDOWS[$bk['slot_window']] . '.');
        offer_next($id);
        return $id;
    });
}

/** Prescription request: files are stored first (network I/O outside the lock), then routed. */
function create_rx_order(array $patient, array $b, array $checkedFiles): int
{
    $ref = client_ref($b['clientRef'] ?? '');
    if ($id = existing_by_ref((int) $patient['id'], $ref)) return $id;
    $loc = validate_location($b);
    if (!$checkedFiles) throw bad('Attach a photo or PDF of your prescription.');
    $note = str_in($b['note'] ?? '', 1000);
    $id = tx(function () use ($patient, $ref, $loc, $note) {
        if ($id = existing_by_ref((int) $patient['id'], $ref)) return -$id; // negative = already existed
        $id = run('INSERT INTO orders (patient_id, kind, status, area_id, city, state, member_name, contact_phone, client_ref, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(int) $patient['id'], 'prescription', 'placed', (int) $loc['area']['id'], $loc['city'], $loc['state'], $patient['name'], $patient['phone'], $ref, $note ?: null]);
        set_order_no($id, 'prescription');
        return $id;
    });
    if ($id < 0) return -$id;
    try {
        $fileIds = store_files($id, 'prescription', 'patient', (int) $patient['id'], $checkedFiles);
    } catch (\Throwable $e) {
        run('DELETE FROM orders WHERE id = ?', [$id]);
        throw $e;
    }
    tx(function () use ($id, $patient, $fileIds, $note) {
        post_message($id, 'patient', (int) $patient['id'], $patient['name'], 'file', $note !== '' ? $note : 'Prescription uploaded', $fileIds);
        add_event($id, 'patient', (int) $patient['id'], 'placed', null, 'placed', count($fileIds) . ' prescription file(s)');
        system_msg($id, 'Prescription received. A partner lab will review it and suggest the tests with prices here in this chat.');
        offer_next($id);
    });
    return $id;
}

// ------------------------------------------------------------------ transitions
function load_order(int $id): array
{
    $o = q1('SELECT * FROM orders WHERE id = ?', [$id]);
    if (!$o) throw not_found('Order not found.');
    return $o;
}
function assert_access(array $o, string $scope, int $viewerId): void
{
    $ok = $scope === 'admin' || ($scope === 'patient' && (int) $o['patient_id'] === $viewerId) || ($scope === 'partner' && (int) $o['partner_id'] === $viewerId);
    if (!$ok) throw not_found('Order not found.');
}
function change_status(int $id, string $from, string $to, ?int $partnerId = null): bool
{
    $sql = 'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?' . ($partnerId ? ' AND partner_id = ?' : '');
    $args = [$to, now_iso(), $id, $from];
    if ($partnerId) $args[] = $partnerId;
    return affected($sql, $args) === 1;
}

function partner_accept(array $p, int $id): void
{
    tx(function () use ($p, $id) {
        $o = load_order($id);
        if ((int) $o['partner_id'] !== (int) $p['id'] || $o['status'] !== 'assigned') throw bad('This request is no longer available to you.');
        if (affected("UPDATE assignments SET status = 'accepted', responded_at = ? WHERE order_id = ? AND partner_id = ? AND status = 'offered' AND expires_at >= ?", [now_iso(), $id, (int) $p['id'], time()]) !== 1) {
            throw bad('This request expired and was passed to another lab.');
        }
        $to = $o['kind'] === 'prescription' ? 'in_review' : 'scheduled';
        change_status($id, 'assigned', $to, (int) $p['id']);
        add_event($id, 'partner', (int) $p['id'], 'accepted', 'assigned', $to, $p['name']);
        system_msg($id, $o['kind'] === 'prescription'
            ? "{$p['name']} is reviewing your prescription and will reply here shortly."
            : "{$p['name']} confirmed your order. Our phlebotomist will visit on " . date('D, j M', strtotime((string) $o['slot_date'])) . ', ' . (SLOT_WINDOWS[$o['slot_window']] ?? '') . '.');
    });
}
function partner_reject(array $p, int $id, string $reason): void
{
    if (mb_strlen($reason) < 3) throw bad('Please give a short reason.');
    tx(function () use ($p, $id, $reason) {
        $o = load_order($id);
        if ((int) $o['partner_id'] !== (int) $p['id'] || $o['status'] !== 'assigned') throw bad('This request is no longer available to you.');
        if (affected("UPDATE assignments SET status = 'rejected', reason = ?, responded_at = ? WHERE order_id = ? AND partner_id = ? AND status = 'offered'", [$reason, now_iso(), $id, (int) $p['id']]) !== 1) throw bad('This request is no longer available to you.');
        add_event($id, 'partner', (int) $p['id'], 'rejected', 'assigned', null, $reason);
        offer_next($id, 'partner', (int) $p['id']);
    });
}
function partner_quote(array $p, int $id, array $testIds, string $note): void
{
    $tests = load_tests($testIds);
    tx(function () use ($p, $id, $tests, $note) {
        $o = load_order($id);
        if ((int) $o['partner_id'] !== (int) $p['id'] || $o['kind'] !== 'prescription' || !in_array($o['status'], ['in_review', 'quoted'], true)) throw bad('You can suggest tests only while reviewing a prescription.');
        $mrp = array_sum(array_column($tests, 'mrp')); $total = array_sum(array_column($tests, 'price'));
        run('DELETE FROM order_items WHERE order_id = ?', [$id]);
        $ins = db()->prepare('INSERT INTO order_items (order_id, test_id, name, price, mrp) VALUES (?, ?, ?, ?, ?)');
        foreach ($tests as $t) $ins->execute([$id, (int) $t['id'], $t['name'], (int) $t['price'], (int) $t['mrp']]);
        run("UPDATE orders SET subtotal = ?, discount = ?, total = ?, status = 'quoted', updated_at = ? WHERE id = ?", [$mrp, $mrp - $total, $total, now_iso(), $id]);
        $items = array_map(fn($t) => ['name' => $t['name'], 'price' => (int) $t['price'], 'mrp' => (int) $t['mrp']], $tests);
        post_message($id, 'partner', (int) $p['id'], $p['name'], 'quote', $note !== '' ? $note : 'Based on your prescription, these are the tests you need.', [], ['items' => $items, 'total' => $total, 'mrp' => $mrp]);
        add_event($id, 'partner', (int) $p['id'], 'quoted', $o['status'], 'quoted', count($tests) . ' test(s), ₹' . $total);
    });
}
function patient_confirm(array $pt, int $id, array $b): void
{
    $bk = validate_booking($b, $pt);
    tx(function () use ($pt, $id, $bk) {
        $o = load_order($id);
        assert_access($o, 'patient', (int) $pt['id']);
        if ($o['status'] !== 'quoted') throw bad('There is no suggested test list to confirm right now.');
        if (affected("UPDATE orders SET pincode = ?, address = ?, member_name = ?, member_age = ?, member_gender = ?, contact_phone = ?, slot_date = ?, slot_window = ?, status = 'scheduled', updated_at = ? WHERE id = ? AND status = 'quoted'",
            [$bk['pincode'], $bk['address'], $bk['member_name'], $bk['member_age'], $bk['member_gender'], $bk['contact_phone'], $bk['slot_date'], $bk['slot_window'], now_iso(), $id]) !== 1) throw bad('Please refresh and try again.');
        add_event($id, 'patient', (int) $pt['id'], 'confirmed', 'quoted', 'scheduled', '₹' . $o['total']);
        system_msg($id, 'Booking confirmed. Sample collection on ' . date('D, j M', strtotime($bk['slot_date'])) . ', ' . SLOT_WINDOWS[$bk['slot_window']] . '. Pay ₹' . $o['total'] . ' at collection.');
    });
}
const PARTNER_STEPS = ['collected' => 'scheduled', 'processing' => 'collected', 'completed' => 'report_ready'];
function partner_advance(array $p, int $id, string $to): void
{
    if (!isset(PARTNER_STEPS[$to])) throw bad('Invalid status.');
    tx(function () use ($p, $id, $to) {
        $o = load_order($id);
        $from = PARTNER_STEPS[$to];
        if ((int) $o['partner_id'] !== (int) $p['id'] || !change_status($id, $from, $to, (int) $p['id'])) throw bad('This order isn\'t at that step. Please refresh.');
        add_event($id, 'partner', (int) $p['id'], $to, $from, $to, null);
        $msg = ['collected' => 'Sample collected. It\'s on its way to the lab.', 'processing' => 'Your sample is being tested in the lab.', 'completed' => 'Order completed. Thank you for choosing Queue24!'][$to];
        system_msg($id, $msg);
    });
}
function partner_report(array $p, int $id, array $checked): void
{
    $o = load_order($id);
    if ((int) $o['partner_id'] !== (int) $p['id'] || !in_array($o['status'], ['collected', 'processing', 'report_ready'], true)) throw bad('Reports can be uploaded after the sample is collected.');
    if (!$checked) throw bad('Attach the report (PDF or photo).');
    $fileIds = store_files($id, 'report', 'partner', (int) $p['id'], $checked);
    tx(function () use ($p, $id, $fileIds) {
        $o = load_order($id);
        if ($o['status'] !== 'report_ready') {
            affected("UPDATE orders SET status = 'report_ready', updated_at = ? WHERE id = ? AND status IN ('collected','processing')", [now_iso(), $id]);
            add_event($id, 'partner', (int) $p['id'], 'report', $o['status'], 'report_ready', count($fileIds) . ' file(s)');
        }
        post_message($id, 'partner', (int) $p['id'], $p['name'], 'file', 'Your report is ready.', $fileIds, ['report' => true]);
    });
}
function cancel_order(string $scope, int $actorId, int $id, string $reason): void
{
    tx(function () use ($scope, $actorId, $id, $reason) {
        $o = load_order($id);
        assert_access($o, $scope, $actorId);
        $allowed = $scope === 'admin' ? OPEN_STATUSES : PATIENT_CANCELLABLE;
        if (!in_array($o['status'], $allowed, true)) throw bad('This order can\'t be cancelled at this stage.');
        if (!change_status($id, $o['status'], 'cancelled')) throw bad('Please refresh and try again.');
        run('UPDATE orders SET cancel_reason = ? WHERE id = ?', [$reason ?: null, $id]);
        run("UPDATE assignments SET status = 'revoked', reason = 'order cancelled', responded_at = ? WHERE order_id = ? AND status IN ('offered','accepted')", [now_iso(), $id]);
        add_event($id, $scope, $actorId, 'cancelled', $o['status'], 'cancelled', $reason ?: null);
        system_msg($id, 'Order cancelled' . ($scope === 'admin' ? ' by Queue24 support' : '') . ($reason ? ": $reason" : '.'));
    });
}
function admin_assign(int $adminId, int $id, int $partnerId): void
{
    tx(function () use ($adminId, $id, $partnerId) {
        $o = load_order($id);
        $p = q1('SELECT * FROM partners WHERE id = ? AND active = 1', [$partnerId]);
        if (!$p) throw bad('Pick an active lab partner.');
        if (!in_array($o['status'], REASSIGNABLE, true)) throw bad('This order is past the stage where it can be reassigned.');
        run("UPDATE assignments SET status = 'revoked', reason = 'reassigned by admin', responded_at = ? WHERE order_id = ? AND status IN ('offered','accepted')", [now_iso(), $id]);
        run('INSERT INTO assignments (order_id, partner_id, role, status, expires_at) VALUES (?, ?, ?, ?, ?)', [$id, $partnerId, 'manual', 'offered', time() + accept_timeout_min() * 60]);
        run("UPDATE orders SET partner_id = ?, partner_role = 'manual', status = 'assigned', updated_at = ? WHERE id = ?", [$partnerId, now_iso(), $id]);
        add_event($id, 'admin', $adminId, 'offered', $o['status'], 'assigned', "Assigned by admin to {$p['name']}");
    });
}

// ------------------------------------------------------------------ chat
function send_chat(array $o, string $scope, int $senderId, string $senderName, string $body, array $checked): array
{
    if ($o['status'] === 'cancelled') throw bad('This order was cancelled.');
    if ($scope === 'partner' && $o['status'] === 'assigned') throw bad('Accept the request first to chat with the patient.');
    $body = mb_substr(trim($body), 0, 2000);
    if ($body === '' && !$checked) throw bad('Type a message or attach a file.');
    if ($scope === 'patient') rate_hit("msg|patient|$senderId", 60, 600);
    $purpose = ($scope === 'patient' && $o['kind'] === 'prescription') ? 'prescription' : 'chat';
    $fileIds = $checked ? store_files((int) $o['id'], $purpose, $scope, $senderId, $checked) : [];
    return tx(fn() => ['id' => post_message((int) $o['id'], $scope, $senderId, $senderName, $fileIds ? 'file' : 'text', $body !== '' ? $body : null, $fileIds)]);
}
function messages_for(array $o, string $scope, int $after): array
{
    $rows = q('SELECT * FROM messages WHERE order_id = ? AND id > ? ORDER BY id LIMIT 300', [(int) $o['id'], $after]);
    $fileIds = [];
    foreach ($rows as $r) foreach (json_decode($r['file_ids'], true) ?: [] as $f) $fileIds[] = (int) $f;
    $files = $fileIds ? files_by_id($fileIds, $scope) : [];
    if ($rows) mark_read((int) $o['id'], $scope, (int) end($rows)['id']);
    return array_map(fn($r) => [
        'id' => (int) $r['id'], 'from' => $r['sender_type'], 'name' => $r['sender_name'], 'kind' => $r['kind'], 'body' => $r['body'],
        'files' => array_values(array_filter(array_map(fn($f) => $files[(int) $f] ?? null, json_decode($r['file_ids'], true) ?: []))),
        'meta' => $r['meta'] ? json_decode($r['meta'], true) : null, 'at' => $r['created_at'],
    ], $rows);
}
function files_by_id(array $ids, string $scope): array
{
    $out = [];
    foreach (q('SELECT * FROM files WHERE id IN (' . placeholders($ids) . ')', $ids) as $f) $out[(int) $f['id']] = file_json($f, $scope);
    return $out;
}
function file_json(array $f, string $scope): array
{
    return ['id' => (int) $f['id'], 'name' => $f['name'] ?: 'file', 'mime' => $f['mime'], 'size' => (int) $f['size'], 'purpose' => $f['purpose'], 'url' => file_url((int) $f['id'], $scope), 'at' => $f['created_at']];
}
function serve_order_file(int $fileId, string $scope, int $viewerId): void
{
    $f = q1('SELECT * FROM files WHERE id = ?', [$fileId]);
    if (!$f) throw not_found('File not found');
    $o = load_order((int) $f['order_id']);
    assert_access($o, $scope, $viewerId);
    send_file($f);
}

// ------------------------------------------------------------------ serializers
function party_of(string $scope): string { return $scope; }

/** Enrich a page of order rows in a fixed number of queries (no N+1). */
function summaries(array $rows, string $scope): array
{
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int) $r['id'], $rows);
    $ph = placeholders($ids);
    $items = [];
    foreach (q("SELECT order_id, name FROM order_items WHERE order_id IN ($ph) ORDER BY id", $ids) as $i) $items[(int) $i['order_id']][] = $i['name'];
    $unread = [];
    foreach (q("SELECT m.order_id, COUNT(*) AS n FROM messages m LEFT JOIN reads r ON r.order_id = m.order_id AND r.party = ?
                WHERE m.order_id IN ($ph) AND m.sender_type NOT IN (?, 'system') AND m.id > COALESCE(r.last_message_id, 0) GROUP BY m.order_id", array_merge([$scope], $ids, [$scope])) as $u) $unread[(int) $u['order_id']] = (int) $u['n'];
    // reorder args: party first, then ids, then sender exclusion
    $last = [];
    foreach (q("SELECT m.order_id, m.sender_type, m.kind, m.body, m.created_at FROM messages m JOIN (SELECT order_id, MAX(id) AS mid FROM messages WHERE order_id IN ($ph) GROUP BY order_id) x ON x.mid = m.id", $ids) as $m) $last[(int) $m['order_id']] = $m;
    $offers = [];
    foreach (q("SELECT order_id, expires_at FROM assignments WHERE status = 'offered' AND order_id IN ($ph)", $ids) as $a) $offers[(int) $a['order_id']] = (int) $a['expires_at'];
    $partners = [];
    $pids = array_values(array_unique(array_filter(array_map(fn($r) => (int) $r['partner_id'], $rows))));
    if ($pids) foreach (q('SELECT id, name, city FROM partners WHERE id IN (' . placeholders($pids) . ')', $pids) as $p) $partners[(int) $p['id']] = $p;
    $areas = [];
    foreach (q('SELECT id, name, kind FROM areas') as $a) $areas[(int) $a['id']] = $a;
    return array_map(function ($r) use ($items, $unread, $last, $offers, $partners, $areas, $scope) {
        $id = (int) $r['id'];
        $hidePrivate = $scope === 'partner' && $r['status'] === 'assigned';
        $lm = $last[$id] ?? null;
        $p = $partners[(int) $r['partner_id']] ?? null;
        return [
            'id' => $id, 'orderNo' => $r['order_no'], 'kind' => $r['kind'], 'status' => $r['status'], 'statusLabel' => status_label($r['status'], $scope),
            'patientName' => $r['member_name'], 'age' => $r['member_age'] !== null ? (int) $r['member_age'] : null, 'gender' => $r['member_gender'],
            'city' => $r['city'], 'state' => $r['state'], 'pincode' => $r['pincode'], 'area' => $areas[(int) $r['area_id']]['name'] ?? '',
            'areaKind' => $areas[(int) $r['area_id']]['kind'] ?? '',
            'slotDate' => $r['slot_date'], 'slotWindow' => $r['slot_window'], 'slotLabel' => $r['slot_window'] ? (SLOT_WINDOWS[$r['slot_window']] ?? '') : null,
            'items' => $items[$id] ?? [], 'total' => (int) $r['total'], 'mrp' => (int) $r['subtotal'],
            'partner' => $p ? ['id' => (int) $p['id'], 'name' => $p['name'], 'city' => $p['city'], 'role' => $scope === 'patient' ? null : $r['partner_role']] : null,
            'phone' => $scope === 'admin' ? fmt_phone($r['contact_phone']) : ($hidePrivate ? mask_phone($r['contact_phone']) : fmt_phone($r['contact_phone'])),
            'unread' => $unread[$id] ?? 0,
            'lastMessage' => $lm ? ['from' => $lm['sender_type'], 'text' => $lm['kind'] === 'quote' ? 'Suggested tests & price' : ($lm['body'] ?: 'Attachment'), 'at' => $lm['created_at']] : null,
            'offerExpiresAt' => isset($offers[$id]) ? gmdate('Y-m-d\TH:i:s\Z', $offers[$id]) : null,
            'createdAt' => $r['created_at'], 'updatedAt' => $r['updated_at'],
        ];
    }, $rows);
}

function order_detail(array $o, string $scope, int $viewerId): array
{
    $s = summaries([$o], $scope)[0];
    $id = (int) $o['id'];
    $hidePrivate = $scope === 'partner' && $o['status'] === 'assigned';
    $s['address'] = $hidePrivate ? null : $o['address'];
    $s['note'] = $o['note'];
    $s['cancelReason'] = $o['cancel_reason'];
    $s['discount'] = (int) $o['discount'];
    $s['lines'] = array_map(fn($i) => ['name' => $i['name'], 'price' => (int) $i['price'], 'mrp' => (int) $i['mrp']], q('SELECT name, price, mrp FROM order_items WHERE order_id = ? ORDER BY id', [$id]));
    $files = q('SELECT * FROM files WHERE order_id = ? ORDER BY id', [$id]);
    $s['prescriptions'] = array_values(array_map(fn($f) => file_json($f, $scope), array_filter($files, fn($f) => $f['purpose'] === 'prescription')));
    $s['reports'] = array_values(array_map(fn($f) => file_json($f, $scope), array_filter($files, fn($f) => $f['purpose'] === 'report')));
    $internal = ['offered', 'expired', 'rejected', 'unassigned'];
    $ev = q('SELECT * FROM events WHERE order_id = ? ORDER BY id', [$id]);
    if ($scope === 'patient') $ev = array_values(array_filter($ev, fn($e) => !in_array($e['action'], $internal, true)));
    if ($scope === 'partner') $ev = array_values(array_filter($ev, fn($e) => !in_array($e['action'], ['expired', 'unassigned'], true) && !($e['action'] === 'rejected' && (int) $e['actor_id'] !== $viewerId)));
    $s['timeline'] = array_map(fn($e) => ['action' => $e['action'], 'by' => $e['actor_type'], 'to' => $e['to_status'], 'note' => $scope === 'patient' && $e['action'] === 'accepted' ? null : $e['note'], 'at' => $e['created_at']], $ev);
    if ($scope === 'admin') {
        $s['assignments'] = array_map(fn($a) => ['partner' => $a['pname'], 'partnerId' => (int) $a['partner_id'], 'role' => $a['role'], 'status' => $a['status'], 'reason' => $a['reason'], 'at' => $a['offered_at'], 'respondedAt' => $a['responded_at']],
            q('SELECT a.*, p.name AS pname FROM assignments a JOIN partners p ON p.id = a.partner_id WHERE a.order_id = ? ORDER BY a.id', [$id]));
        $pt = q1('SELECT name, phone, created_at FROM patients WHERE id = ?', [(int) $o['patient_id']]);
        $s['account'] = $pt ? ['name' => $pt['name'], 'phone' => fmt_phone($pt['phone']), 'since' => $pt['created_at']] : null;
    }
    $s['actions'] = actions_for($o, $scope);
    return $s;
}

function actions_for(array $o, string $scope): array
{
    $st = $o['status']; $a = [];
    if ($scope === 'patient') {
        if (in_array($st, PATIENT_CANCELLABLE, true)) $a[] = 'cancel';
        if ($st === 'quoted') $a[] = 'confirm';
        if ($st !== 'cancelled') $a[] = 'chat';
    } elseif ($scope === 'partner') {
        if ($st === 'assigned') { $a[] = 'accept'; $a[] = 'reject'; }
        if ($o['kind'] === 'prescription' && in_array($st, ['in_review', 'quoted'], true)) $a[] = 'quote';
        if ($st === 'scheduled') $a[] = 'collected';
        if ($st === 'collected') $a[] = 'processing';
        if (in_array($st, ['collected', 'processing', 'report_ready'], true)) $a[] = 'report';
        if ($st === 'report_ready') $a[] = 'completed';
        if (!in_array($st, ['assigned', 'cancelled'], true)) $a[] = 'chat';
    } else {
        if (in_array($st, REASSIGNABLE, true)) $a[] = 'assign';
        if (in_array($st, OPEN_STATUSES, true)) $a[] = 'cancel';
        if ($st !== 'cancelled') $a[] = 'chat';
    }
    return $a;
}

function catalog_tests(bool $includeInactive = false): array
{
    $rows = q('SELECT * FROM tests ' . ($includeInactive ? '' : 'WHERE active = 1 ') . 'ORDER BY kind DESC, sort, name');
    $names = array_column(q('SELECT code, name FROM tests'), 'name', 'code');
    return array_map(fn($t) => [
        'id' => (int) $t['id'], 'code' => $t['code'], 'name' => $t['name'], 'kind' => $t['kind'], 'category' => $t['category'], 'description' => $t['description'],
        'sample' => $t['sample_type'], 'fastingHours' => (int) $t['fasting_hours'], 'reportHours' => (int) $t['tat_hours'], 'parameters' => (int) $t['parameters'],
        'includes' => array_values(array_map(fn($c) => $names[$c] ?? $c, json_decode($t['includes'], true) ?: [])),
        'price' => (int) $t['price'], 'mrp' => (int) $t['mrp'], 'popular' => (bool) $t['popular'], 'active' => (bool) $t['active'],
    ], $rows);
}
