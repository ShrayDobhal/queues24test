<?php
/**
 * Day-by-day tracking engine (port of server/tracker.js).
 * Red mark = past working day with no clinic update, unless weekly off, holiday,
 * approved leave, before joining, or excused by admin. Today never gets one.
 */
declare(strict_types=1);

function load_month_data(string $month, ?array $ids): array
{
    $days = month_days($month);
    $first = $days[0];
    $last = $days[count($days) - 1];
    $filter = '';
    $args = [$first, $last];
    if ($ids) { $filter = ' AND employee_id IN (' . placeholders($ids) . ')'; $args = array_merge($args, $ids); }

    $key = fn($e, $d) => $e . '|' . $d;
    $maps = ['visits' => [], 'attendance' => [], 'leaves' => [], 'excused' => [], 'holidays' => []];
    foreach (q("SELECT employee_id, visit_date AS date, COUNT(*) AS n FROM visits WHERE visit_date BETWEEN ? AND ?$filter GROUP BY employee_id, visit_date", $args) as $r)
        $maps['visits'][$key($r['employee_id'], $r['date'])] = (int) $r['n'];
    foreach (q("SELECT employee_id, date, marked_at FROM attendance WHERE date BETWEEN ? AND ?$filter", $args) as $r)
        $maps['attendance'][$key($r['employee_id'], $r['date'])] = $r['marked_at'];
    $lf = str_replace('employee_id', 'r.employee_id', $filter);
    foreach (q("SELECT r.employee_id, d.date, r.id, r.status, r.reason, r.leave_type FROM leave_days d JOIN leave_requests r ON r.id = d.request_id
                WHERE d.date BETWEEN ? AND ? AND r.status IN ('pending','approved')$lf", $args) as $l) {
        $k = $key($l['employee_id'], $l['date']);
        $prev = $maps['leaves'][$k] ?? null;
        if (!$prev || ($prev['status'] !== 'approved' && $l['status'] === 'approved')) {
            $maps['leaves'][$k] = ['id' => (int) $l['id'], 'status' => $l['status'], 'reason' => $l['reason'], 'type' => $l['leave_type']];
        }
    }
    foreach (q("SELECT employee_id, date, note FROM excused_days WHERE date BETWEEN ? AND ?$filter", $args) as $r)
        $maps['excused'][$key($r['employee_id'], $r['date'])] = $r['note'] ?? '';
    foreach (q('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?', [$first, $last]) as $h)
        $maps['holidays'][$h['date']] = $h['name'];
    return ['month' => $month, 'days' => $days, 'maps' => $maps];
}

function compute_employee_month(array $emp, array $data, array $settings, ?string $todayStr = null): array
{
    $weeklyOff = array_map('intval', $settings['weeklyOff'] ?? []);
    $t = $todayStr ?: today();
    $joined = $emp['joined_on'] ?? null;
    // Access paused / removed: days from that date on are not tracked (no red marks)
    $stopFrom = null; $stopStatus = null;
    if (!empty($emp['removed_at'])) { $stopFrom = date('Y-m-d', strtotime($emp['removed_at'])); $stopStatus = 'removed'; }
    elseif ((int) ($emp['active'] ?? 1) === 0 && !empty($emp['suspended_from'])) { $stopFrom = $emp['suspended_from']; $stopStatus = 'paused'; }
    $m = $data['maps'];
    $s = ['updates' => 0, 'reportedDays' => 0, 'redCount' => 0, 'redDates' => [], 'presentDays' => 0, 'presentDates' => [],
        'leaveDays' => 0, 'leaveDates' => [], 'absentDays' => 0, 'absentDates' => [], 'workingDaysElapsed' => 0, 'pendingLeaveDates' => []];
    $out = [];
    foreach ($data['days'] as $date) {
        $k = $emp['id'] . '|' . $date;
        $updates = $m['visits'][$k] ?? 0;
        $markedAt = $m['attendance'][$k] ?? null;
        $leave = $m['leaves'][$k] ?? null;
        $holiday = $m['holidays'][$date] ?? null;
        $excused = array_key_exists($k, $m['excused']) ? $m['excused'][$k] : null;
        $wd = weekday($date);
        $isWeekOff = in_array($wd, $weeklyOff, true);
        $isWorking = !$isWeekOff && !$holiday;
        $beforeJoin = $joined && $date < $joined;
        $stopped = $stopFrom && $date >= $stopFrom && $updates === 0;
        $isFuture = $date > $t;
        $approved = $leave && $leave['status'] === 'approved';

        if ($beforeJoin) $status = 'na';
        elseif ($stopped) $status = $stopStatus;
        elseif ($updates > 0) $status = 'reported';
        elseif ($isFuture) $status = 'future';
        elseif ($holiday) $status = 'holiday';
        elseif ($isWeekOff) $status = 'weekoff';
        elseif ($approved) $status = 'leave';
        elseif ($excused !== null) $status = 'excused';
        elseif ($date === $t) $status = 'pending';
        else $status = 'red';

        if (!$beforeJoin && !$stopped) {
            $s['updates'] += $updates;
            if ($updates > 0) $s['reportedDays']++;
            if ($markedAt) { $s['presentDays']++; $s['presentDates'][] = $date; }
            if ($status === 'red') { $s['redCount']++; $s['redDates'][] = $date; }
            if ($leave && $leave['status'] === 'pending') $s['pendingLeaveDates'][] = $date;
            if ($isWorking && $date < $t) {
                $s['workingDaysElapsed']++;
                if (!$markedAt) {
                    if ($approved) { $s['leaveDays']++; $s['leaveDates'][] = $date; }
                    else { $s['absentDays']++; $s['absentDates'][] = $date; }
                }
            } elseif ($isWorking && $date === $t && $approved && !$markedAt) {
                $s['leaveDays']++; $s['leaveDates'][] = $date;
            }
        }
        $out[] = [
            'date' => $date, 'weekday' => $wd, 'status' => $status, 'updates' => $updates,
            'present' => (bool) $markedAt, 'markedAt' => $markedAt, 'markedTime' => $markedAt ? time_of($markedAt) : null,
            'leave' => $leave, 'holiday' => $holiday, 'excused' => $excused, 'weekOff' => $isWeekOff,
        ];
    }
    $s['offDays'] = $s['leaveDays'] + $s['absentDays'];
    $s['offDates'] = array_merge($s['leaveDates'], $s['absentDates']);
    sort($s['offDates']);
    return ['month' => $data['month'], 'days' => $out, 'summary' => $s];
}

function employee_month(array $emp, string $month): array
{
    return compute_employee_month($emp, load_month_data($month, [(int) $emp['id']]), get_settings());
}

function all_employees_month(string $month, bool $includeInactive = true): array
{
    $emps = q("SELECT * FROM users WHERE role = 'employee' " . ($includeInactive ? '' : 'AND active = 1') . ' ORDER BY active DESC, name COLLATE NOCASE');
    $data = load_month_data($month, null);
    $settings = get_settings();
    $t = today();
    $out = [];
    foreach ($emps as $e) $out[] = ['employee' => $e] + compute_employee_month($e, $data, $settings, $t);
    return $out;
}
