// Admin workspace.
import {
  html, useState, useEffect, useMemo, api, useApi, navigate, match, toast, fmtDay, fmtDate, fmtDateTime, fmtTime12, plural,
  OUTCOMES, LEAVE_TYPES, WEEKDAYS, timeAgo, API, addMonths, monthLabel,
} from './lib.js';
import {
  Icon, Button, Loading, ErrorBox, Badge, Empty, Stat, Card, Calendar, CalendarLegend, MonthNav, VisitCard, Field, Avatar,
  Modal, confirmDialog, PasswordReveal, RedMarks, Segmented, useIsMobile, HoverCard, TipRows,
} from './ui.js';
import { ChatThread, FileChip } from './chat.js';
import { UserMenu, LeaveStatus } from './employee.js';
import { ChangePasswordForm } from './common.js';

const NAV = [
  { to: '/admin', icon: 'grid', label: 'Dashboard' },
  { to: '/admin/employees', icon: 'users', label: 'Employees' },
  { to: '/admin/updates', icon: 'building', label: 'Clinic updates' },
  { to: '/admin/attendance', icon: 'checkCircle', label: 'Attendance' },
  { to: '/admin/leaves', icon: 'calendar', label: 'Leaves', badge: 'pendingLeaves' },
  { to: '/admin/alerts', icon: 'bell', label: 'Inactivity alerts', badge: 'openAlerts' },
  { to: '/admin/labs', icon: 'flask', label: 'Lab partners', badge: 'labAttention' },
  { to: '/admin/settings', icon: 'settings', label: 'Settings' },
];

export function AdminApp({ user, route, onLogout }) {
  const p = route.path;
  const [drawer, setDrawer] = useState(false);
  const [counts, setCounts] = useState({});
  const mobile = useIsMobile();
  const refreshCounts = async () => {
    try { const d = await api('/admin/dashboard'); setCounts((c) => ({ ...c, ...d.kpis })); } catch { /* ignore */ }
    try { const h = await api('/admin/health/overview'); setCounts((c) => ({ ...c, labsInstalled: true, labAttention: h.kpis.needsAttention })); }
    catch (e) { if (e.status === 404) setCounts((c) => ({ ...c, labsInstalled: false })); /* module not installed: hide the tab */ }
  };
  useEffect(() => { refreshCounts(); }, [p]);
  useEffect(() => { setDrawer(false); }, [p]);

  let page; let m;
  if (p === '/admin' || p === '/admin/') page = html`<${Dashboard} />`;
  else if (p === '/admin/employees') page = html`<${Employees} query=${route.query} />`;
  else if ((m = match('/admin/employees/:id', p))) page = html`<${EmployeeReport} key=${m.id} id=${m.id} query=${route.query} me=${user} />`;
  else if (p === '/admin/updates') page = html`<${AllUpdates} query=${route.query} />`;
  else if (p === '/admin/attendance') page = html`<${Attendance} />`;
  else if (p === '/admin/leaves') page = html`<${LeavesAdmin} onChange=${refreshCounts} />`;
  else if (p === '/admin/alerts') page = html`<${Alerts} onChange=${refreshCounts} />`;
  else if (p === '/admin/settings') page = html`<${Settings} me=${user} />`;
  else if (p === '/admin/labs') page = html`<${LabPartners} query=${route.query} onChange=${refreshCounts} />`;
  else page = html`<${Empty} icon="alert" title="Page not found" action=${html`<${Button} onClick=${() => navigate('/admin')}>Dashboard</${Button}>`} />`;
  const active = NAV.slice().reverse().find((n) => (n.to === '/admin' ? p === '/admin' || p === '/admin/' : p.startsWith(n.to)));

  return html`<div class=${'adm-shell' + (drawer ? ' drawer-open' : '')}>
    <aside class="adm-side">
      <a class="brand" href="#/admin"><span class="brand-mark">24</span><span class="brand-name">Queue24 <small>Admin</small></span></a>
      <nav>${NAV.filter((n) => n.to !== '/admin/labs' || counts.labsInstalled !== false).map((n) => html`<a href=${'#' + n.to} class=${active === n ? 'active' : ''}>
        <${Icon} name=${n.icon} size=${18} /><span>${n.label}</span>${n.badge && counts[n.badge] > 0 && html`<em class=${n.badge === 'openAlerts' ? 'hot' : ''}>${counts[n.badge]}</em>`}</a>`)}</nav>
      <div class="adm-side-foot"><span class="muted">Signed in as</span><b>${user.name}</b></div>
    </aside>
    ${drawer && mobile && html`<div class="drawer-scrim" onClick=${() => setDrawer(false)}></div>`}
    <div class="adm-content">
      <header class="adm-top">
        <button class="icon-btn adm-burger" onClick=${() => setDrawer(!drawer)} aria-label="Menu"><${Icon} name="menu" /></button>
        <div class="adm-top-title">${active ? active.label : 'Admin'}</div>
        <a class="icon-btn bell" href="#/admin/alerts" aria-label="Alerts"><${Icon} name="bell" />${counts.openAlerts > 0 && html`<i></i>`}</a>
        <${UserMenu} user=${user} onLogout=${onLogout} profileHref="#/admin/settings" />
      </header>
      <main class="adm-main">${page}</main>
    </div>
  </div>`;
}

// ================================================================== Dashboard
function Dashboard() {
  const { data, error, loading, reload } = useApi('/admin/dashboard');
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const { kpis, team, chart, recent, pendingLeaves, alerts, today, redThreshold } = data;
  const max = Math.max(1, ...chart.map((c) => c.count));

  return html`<div class="stack">
    <div class="page-head spread">
      <div><h1>Team overview</h1><p>${fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="row-gap"><${Button} variant="secondary" icon="refresh" onClick=${() => reload()}>Refresh</${Button}><${Button} icon="plus" onClick=${() => navigate('/admin/employees?new=1')}>Add employee</${Button}></div>
    </div>

    ${alerts.length > 0 && html`<div class="notice notice-red">
      <${Icon} name="alert" size=${20} />
      <div><b>${plural(alerts.length, 'employee')} flagged inactive</b>
        <span>${alerts.map((a) => `${a.employeeName} (${a.redCount} red marks, ${a.monthLabel})`).join(' · ')}</span></div>
      <${Button} size="sm" variant="danger" onClick=${() => navigate('/admin/alerts')}>View reports</${Button}>
    </div>`}

    <div class="stats-grid five">
      <${Stat} icon="users" label="Active employees" value=${kpis.activeEmployees} onClick=${() => navigate('/admin/employees')}
        tip=${html`<${TipRows} title="Active employees" rows=${[['Present today', kpis.presentToday], ['On leave today', kpis.onLeaveToday], ['Inactivity alerts', kpis.openAlerts]]} foot="Paused and removed employees are not counted." />`} />
      <${Stat} tip=${html`<${TipRows} title="Attendance today" rows=${[['Marked present', kpis.presentToday], ['On approved leave', kpis.onLeaveToday], ['Not marked yet', Math.max(0, kpis.activeEmployees - kpis.presentToday - kpis.onLeaveToday)]]} foot="Employees tick attendance when they start work." />`} icon="checkCircle" label="Present today" value=${`${kpis.presentToday}/${kpis.activeEmployees}`} sub=${kpis.onLeaveToday ? `${kpis.onLeaveToday} on leave` : ''} tone="blue" onClick=${() => navigate('/admin/attendance')} />
      <${Stat} tip=${html`<${TipRows} title="Daily reports today" rows=${[['Employees reported', kpis.reportedToday], ['Clinic updates', kpis.updatesToday], ['Still to report', Math.max(0, kpis.activeEmployees - kpis.reportedToday - kpis.onLeaveToday)]]} foot="A working day with no update becomes a red mark tomorrow." />`} icon="file" label="Reported today" value=${`${kpis.reportedToday}/${kpis.activeEmployees}`} sub=${plural(kpis.updatesToday, 'clinic update')} tone="green" onClick=${() => navigate('/admin/updates')} />
      <${Stat} icon="calendar" label="Pending leaves" value=${kpis.pendingLeaves} tone="amber" onClick=${() => navigate('/admin/leaves')} tip=${html`<${TipRows} title="Leave requests" rows=${pendingLeaves.slice(0, 4).map((r) => [r.employeeName, plural(r.dates.length, 'day')])} foot=${kpis.pendingLeaves ? 'Click to approve or reject.' : 'No requests waiting.'} />`} />
      <${Stat} icon="building" label="Updates this month" value=${kpis.updatesMonth} tone="violet" onClick=${() => navigate('/admin/updates')} tip=${html`<${TipRows} title="Clinic visits this month" rows=${team.slice().sort((a, b) => b.updatesMonth - a.updatesMonth).slice(0, 5).map((t) => [t.name, t.updatesMonth])} foot="Top employees by clinic updates." />`} />
    </div>

    <div class="two-col wide-left">
      <${Card} title="Today's team status" subtitle="Attendance and daily report per employee" pad=${false}>
        ${team.length ? html`<div class="team-list">${team.map((t) => html`<${HoverCard} key=${t.id} tip=${html`<${TipRows} title=${t.name} rows=${[['Area', t.territory || '—'], ['Attendance', t.onLeave ? 'On leave' : t.present ? `In at ${fmtTime12(t.markedTime)}` : 'Not marked'], ['Updates today', t.updatesToday], ['Updates this month', t.updatesMonth], ['Red marks this month', t.redCount]]} foot="Click for the full report." />`}>
          <a class="team-row" href=${'#/admin/employees/' + t.id}>
            <${Avatar} name=${t.name} size=${36} />
            <div class="team-name"><div class="name-line">${t.redCount > 0 && html`<${RedMarks} count=${t.redCount} threshold=${redThreshold} compact />`}<b>${t.name}</b></div><span>${t.territory || t.designation}</span></div>
            <div class="team-cells">
              ${t.onLeave ? html`<${Badge} tone="blue">On leave</${Badge}>`
                : t.present ? html`<${Badge} tone="green" dot>In ${fmtTime12(t.markedTime)}</${Badge}>` : html`<${Badge} tone="gray">Not marked</${Badge}>`}
              ${t.updatesToday > 0 ? html`<${Badge} tone="green">${plural(t.updatesToday, 'update')}</${Badge}>` : !t.onLeave && html`<${Badge} tone="amber">No report yet</${Badge}>`}
            </div>
          </a></${HoverCard}>`)}</div>` : html`<${Empty} icon="users" title="No employees yet" action=${html`<${Button} icon="plus" onClick=${() => navigate('/admin/employees?new=1')}>Add employee</${Button}>`} />`}
      </${Card}>

      <div class="stack">
        <${Card} title="Clinic updates · last 14 days">
          <div class="bars">${chart.map((c) => html`<div class="bar-col" title=${`${fmtDay(c.date)}: ${c.count}`}>
            <span class="bar-val">${c.count || ''}</span><i style=${`height:${Math.max(3, (c.count / max) * 100)}%`} class=${c.date === today ? 'today' : ''}></i>
            <span class="bar-label">${Number(c.date.slice(8))}</span></div>`)}</div>
        </${Card}>
        <${Card} title="Pending leave requests" action=${html`<a class="link" href="#/admin/leaves">All<${Icon} name="right" size=${14} /></a>`}>
          ${pendingLeaves.length ? html`<div class="mini-list">${pendingLeaves.map((r) => html`<a class="mini-row" href="#/admin/leaves">
            <${Avatar} name=${r.employeeName} size=${30} /><div><b>${r.employeeName}</b><span>${plural(r.dates.length, 'day')} · ${r.dates.slice(0, 3).map(fmtDay).join(', ')}${r.dates.length > 3 ? '…' : ''}</span></div></a>`)}</div>`
            : html`<p class="muted">No pending requests.</p>`}
        </${Card}>
      </div>
    </div>

    <section>
      <div class="section-head"><h2>Latest clinic updates</h2><a class="link" href="#/admin/updates">View all<${Icon} name="right" size=${15} /></a></div>
      ${recent.length ? html`<div class="visit-grid">${recent.map((v) => html`<${VisitCard} key=${v.id} visit=${v} showEmployee compact hover />`)}</div>` : html`<${Empty} icon="building" title="No updates yet" />`}
    </section>
  </div>`;
}

// ================================================================== Employees
function Employees({ query }) {
  const [month, setMonth] = useState(query.month || '');
  const { data, error, loading, reload } = useApi(`/admin/employees${month ? `?month=${month}` : ''}`);
  const [showAdd, setShowAdd] = useState(query.new === '1');
  const [created, setCreated] = useState(null);
  const [pwFor, setPwFor] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('active');
  const mobile = useIsMobile(760);

  const items = useMemo(() => {
    if (!data) return [];
    const match = (e) => {
      if (filter === 'all') return true;
      if (filter === 'flagged') return e.status === 'active' && e.summary.redCount >= data.redThreshold;
      return e.status === filter;
    };
    return data.items.filter(match)
      .filter((e) => !q || `${e.name} ${e.email} ${e.phone} ${e.territory} ${e.designation}`.toLowerCase().includes(q.toLowerCase()));
  }, [data, q, filter]);

  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const count = (st) => data.items.filter((e) => e.status === st).length;
  const flagged = data.items.filter((e) => e.status === 'active' && e.summary.redCount >= data.redThreshold).length;
  const open = (e) => navigate(`/admin/employees/${e.id}${month ? `?month=${month}` : ''}`);
  const keyBtn = (e) => e.status !== 'removed' && html`<button class="icon-btn" title="View password" aria-label=${'View password of ' + e.name}
    onClick=${(ev) => { ev.stopPropagation(); setPwFor(e); }}><${Icon} name="key" size=${16} /></button>`;
  const todayBadge = (e) => (e.status !== 'active' ? html`<${AccessBadge} user=${e} />`
    : !e.today ? '–' : e.today.onLeave ? html`<${Badge} tone="blue">Leave</${Badge}>`
      : e.today.present ? html`<${Badge} tone="green" dot>${fmtTime12(e.today.markedTime)}</${Badge}>` : html`<${Badge} tone="gray">Not marked</${Badge}>`);

  return html`<div class="stack">
    <div class="page-head spread">
      <div><h1>Employees</h1><p>A red dot before a name = working days without a daily report this month (alert at ${data.redThreshold}).</p></div>
      <${Button} icon="plus" onClick=${() => setShowAdd(true)}>Add employee</${Button}>
    </div>
    <div class="toolbar">
      <div class="search"><${Icon} name="search" size=${17} /><input placeholder="Search name, phone, territory…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <${MonthNav} month=${data.month} onChange=${(m) => setMonth(m)} />
    </div>
    <${Segmented} value=${filter} onChange=${setFilter} options=${[
      { value: 'active', label: 'Active', count: count('active') },
      { value: 'flagged', label: 'Inactive alert', count: flagged },
      { value: 'paused', label: 'Paused', count: count('paused') },
      { value: 'removed', label: 'Removed', count: count('removed') },
      { value: 'all', label: 'All', count: data.items.length }]} />

    ${!items.length ? html`<${Empty} icon="users" title=${data.items.length ? 'No employees here' : 'No employees yet'} action=${!data.items.length && html`<${Button} icon="plus" onClick=${() => setShowAdd(true)}>Add your first employee</${Button}>`}>
          ${data.items.length ? 'Try a different search or filter.' : 'Create a login for each field sales employee. A password is generated for you to share.'}</${Empty}>`
    : mobile ? html`<div class="emp-cards">${items.map((e) => html`<div key=${e.id} class=${'emp-card' + (e.status === 'active' ? '' : ' dim')} onClick=${() => open(e)}>
        <div class="emp-card-top">
          ${e.summary.redCount > 0 ? html`<span class=${'red-dot' + (e.summary.redCount >= data.redThreshold ? ' hot' : '')}></span>` : html`<span class="red-dot none"></span>`}
          <${Avatar} name=${e.name} size=${38} />
          <div class="emp-card-name"><b>${e.name}</b><span>${[e.designation, e.territory].filter(Boolean).join(' · ') || e.email}</span></div>
          ${keyBtn(e)}
        </div>
        <div class="emp-card-badges">${todayBadge(e)}${e.today && e.today.updates > 0 && e.status === 'active' && html`<${Badge} tone="green">${plural(e.today.updates, 'update')} today</${Badge}>`}
          ${e.summary.redCount > 0 && html`<${RedMarks} count=${e.summary.redCount} threshold=${data.redThreshold} />`}</div>
        <div class="emp-card-stats">
          <div><b>${e.summary.updates}</b><span>Updates</span></div><div><b>${e.summary.presentDays}</b><span>Present</span></div>
          <div><b>${e.summary.leaveDays}</b><span>Leave</span></div><div><b>${e.summary.absentDays}</b><span>Absent</span></div>
        </div>
      </div>`)}</div>`
    : html`<div class="table-wrap"><table class="table emp-table">
      <thead><tr><th>Employee</th><th>Today</th><th class="num">Updates</th><th class="num">Present</th><th class="num">Leave</th><th class="num">Absent</th><th class="num">Red marks</th><th>Last update</th><th></th></tr></thead>
      <tbody>${items.map((e) => html`<tr key=${e.id} class=${'clickable' + (e.status === 'active' ? '' : ' dim')} onClick=${() => open(e)}>
        <td><${HoverCard} tip=${html`<${TipRows} title=${e.name} rows=${[['Login', e.email], ['Mobile', e.phone || '—'], ['Area', e.territory || '—'], ['Updates this month', e.summary.updates], ['Present / leave / absent', `${e.summary.presentDays} / ${e.summary.leaveDays} / ${e.summary.absentDays}`], ['Red marks', e.summary.redCount], ['Last login', e.lastLoginAt ? timeAgo(e.lastLoginAt) : 'never']]} foot="Click for the full report." />`}><div class="emp-cell">
          ${e.summary.redCount > 0 ? html`<span class=${'red-dot' + (e.summary.redCount >= data.redThreshold ? ' hot' : '')} title=${`${e.summary.redCount} red marks`}></span>` : html`<span class="red-dot none"></span>`}
          <${Avatar} name=${e.name} size=${34} />
          <div><b>${e.name}</b><span>${[e.designation, e.territory].filter(Boolean).join(' · ') || e.email}</span></div>
        </div></${HoverCard}></td>
        <td>${todayBadge(e)}${e.today && e.today.updates > 0 && e.status === 'active' && html` <${Badge} tone="green">${e.today.updates}</${Badge}>`}</td>
        <td class="num"><b>${e.summary.updates}</b></td>
        <td class="num">${e.summary.presentDays}</td>
        <td class="num">${e.summary.leaveDays}</td>
        <td class="num">${e.summary.absentDays}</td>
        <td class="num">${e.summary.redCount ? html`<${RedMarks} count=${e.summary.redCount} threshold=${data.redThreshold} compact />` : html`<span class="muted">0</span>`}</td>
        <td class="muted">${e.lastUpdateAt ? timeAgo(e.lastUpdateAt) : 'never'}</td>
        <td class="row-actions">${keyBtn(e)}<${Icon} name="right" size=${16} /></td>
      </tr>`)}</tbody></table></div>`}

    <${AccountModal} open=${showAdd} role="employee" onClose=${() => { setShowAdd(false); if (query.new) navigate('/admin/employees', { replace: true }); }} onCreated=${(r) => { setShowAdd(false); setCreated(r); reload(true); if (query.new) navigate('/admin/employees', { replace: true }); }} />
    <${Modal} open=${Boolean(created)} title="Employee account created" subtitle=${created && `Share these login details with ${created.user.name}.`} onClose=${() => setCreated(null)}
      footer=${html`<${Button} onClick=${() => setCreated(null)}>Done</${Button}>`}>
      ${created && html`<${PasswordReveal} name=${created.user.name} email=${created.user.email} password=${created.password} />`}
    </${Modal}>
    ${pwFor && html`<${PasswordModal} account=${pwFor} onClose=${() => setPwFor(null)} onChange=${() => reload(true)} />`}
  </div>`;
}

export function AccessBadge({ user }) {
  if (user.status === 'removed') return html`<${Badge} tone="red">Removed</${Badge}>`;
  if (user.status === 'paused') return html`<${Badge} tone="amber">${user.suspendedUntil ? `Paused till ${fmtDay(user.suspendedUntil)}` : 'Paused'}</${Badge}>`;
  return null;
}

/** Shows an account's current password (admin only) with copy / WhatsApp share / regenerate. */
function PasswordModal({ account, onClose, onChange, base = '/admin/employees' }) {
  const [state, setState] = useState({ loading: true });
  const load = async () => {
    setState({ loading: true });
    try { setState({ loading: false, ...(await api(`${base}/${account.id}/password`)) }); } catch (e) { setState({ loading: false, error: e.message }); }
  };
  useEffect(() => { load(); }, [account.id]);
  async function regenerate() {
    if (!(await confirmDialog({ title: 'Generate a new password?', message: `${account.name}'s current password will stop working and they'll be signed out.`, confirmText: 'Generate' }))) return;
    try { const r = await api(`${base}/${account.id}/reset-password`, { method: 'POST', body: {} }); setState({ loading: false, available: true, password: r.password, email: account.email, name: account.name }); toast('New password generated.'); onChange && onChange(); }
    catch (e) { toast(e.message, 'error'); }
  }
  return html`<${Modal} open title=${`${account.name}'s login`} subtitle="Only admins can see this." onClose=${onClose}
    footer=${html`<${Button} variant="ghost" icon="refresh" onClick=${regenerate}>New password</${Button}><${Button} onClick=${onClose}>Done</${Button}>`}>
    ${state.loading ? html`<${Loading} label="Fetching password…" />`
      : state.error ? html`<${ErrorBox} message=${state.error} onRetry=${load} />`
      : state.available ? html`<${PasswordReveal} name=${account.name} email=${state.email || account.email} password=${state.password} hideNote />`
      : html`<div class="notice notice-amber"><${Icon} name="key" size=${20} /><div><b>Password not available</b><span>${state.message}</span></div></div>`}
  </${Modal}>`;
}

function AccountModal({ open, role, onClose, onCreated }) {
  const blank = { name: '', email: '', phone: '', designation: role === 'admin' ? 'Administrator' : 'Field Sales Executive', territory: '', password: '', custom: false };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setF(blank); setError(''); } }, [open]);
  const set = (k) => (e) => { const v = e.target.value; setF((p) => ({ ...p, [k]: v })); };
  async function submit(e) {
    e && e.preventDefault();
    setError(''); setSaving(true);
    try {
      const body = { name: f.name, email: f.email, phone: f.phone, designation: f.designation, territory: f.territory };
      if (f.custom) body.password = f.password;
      const r = await api(role === 'admin' ? '/admin/admins' : '/admin/employees', { method: 'POST', body });
      onCreated(r);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }
  return html`<${Modal} open=${open} onClose=${onClose} title=${role === 'admin' ? 'Add admin' : 'Add employee'} subtitle="A login is created with a generated password."
    footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}><${Button} icon="key" loading=${saving} onClick=${submit}>Create & generate password</${Button}>`}>
    <form class="form-grid" onSubmit=${submit} novalidate>
      <${Field} label="Full name" required><input value=${f.name} onInput=${set('name')} placeholder="e.g. Aman Khan" autofocus /></${Field}>
      <div class="form-row">
        <${Field} label="Email (login ID)" required><input type="email" value=${f.email} onInput=${set('email')} placeholder="aman@queue24.in" autocomplete="off" /></${Field}>
        <${Field} label="Mobile number" hint="Can also be used to log in"><input type="tel" value=${f.phone} onInput=${set('phone')} placeholder="98765 43210" /></${Field}>
      </div>
      ${role !== 'admin' && html`<div class="form-row">
        <${Field} label="Designation"><input value=${f.designation} onInput=${set('designation')} /></${Field}>
        <${Field} label="Territory / area"><input value=${f.territory} onInput=${set('territory')} placeholder="e.g. Civil Lines, Bareilly" /></${Field}>
      </div>`}
      <label class="check"><input type="checkbox" checked=${f.custom} onChange=${(e) => { const v = e.target.checked; setF((p) => ({ ...p, custom: v })); }} /><span>Set the password myself instead of generating one</span></label>
      ${f.custom && html`<${Field} label="Password" hint="At least 8 characters"><input value=${f.password} onInput=${set('password')} autocomplete="new-password" /></${Field}>`}
      ${error && html`<div class="form-error"><${Icon} name="alert" size=${16} />${error}</div>`}
    </form>
  </${Modal}>`;
}

// ================================================================== Employee report
function EmployeeReport({ id, query, me }) {
  const [month, setMonth] = useState(query.month || '');
  const [tab, setTab] = useState(query.tab || 'overview');
  const { data, error, loading, reload } = useApi(`/admin/employees/${id}/report${month ? `?month=${month}` : ''}`);
  const [dayInfo, setDayInfo] = useState(null);

  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const { employee: e, summary: s, days, visits, leaves, totals, alerts, redThreshold, today, outcomes } = data;
  const pendingCount = leaves.filter((l) => l.status === 'pending').length;

  return html`<div class="stack report">
    <div class="report-head">
      <button class="icon-btn no-print" onClick=${() => navigate('/admin/employees')} aria-label="Back"><${Icon} name="left" /></button>
      <${Avatar} name=${e.name} size=${56} />
      <div class="report-title">
        <h1>${s.redCount > 0 && html`<${RedMarks} count=${s.redCount} threshold=${redThreshold} />`}${e.name} <${AccessBadge} user=${e} /></h1>
        <p>${[e.designation, e.territory].filter(Boolean).join(' · ')}</p>
        <div class="report-contact"><span><${Icon} name="mail" size=${14} />${e.email}</span>${e.phone && html`<a href=${'tel:' + e.phone}><${Icon} name="phone" size=${14} />${e.phone}</a>`}
          <span><${Icon} name="clock" size=${14} />Last login ${e.lastLoginAt ? timeAgo(e.lastLoginAt) : 'never'}</span></div>
      </div>
      <div class="report-actions no-print">
        <${MonthNav} month=${data.month} onChange=${setMonth} />
        <${Button} variant="secondary" icon="print" onClick=${() => window.print()}>Print</${Button}>
      </div>
    </div>

    ${s.redCount >= redThreshold && html`<div class="notice notice-red"><${Icon} name="alert" size=${20} /><div><b>Inactive: ${s.redCount} red marks in ${data.monthLabel}</b>
      <span>No daily report on ${s.redDates.map(fmtDay).join(', ')}.</span></div></div>`}

    <div class="no-print"><${Segmented} value=${tab} onChange=${setTab} options=${[
      { value: 'overview', label: 'Overview' }, { value: 'visits', label: 'Visits', count: visits.length },
      { value: 'leaves', label: 'Leaves', count: pendingCount || undefined }, { value: 'account', label: 'Account' }]} /></div>

    ${(tab === 'overview') && html`
      <div class="stats-grid">
        <${Stat} icon="building" label="Clinic updates" value=${s.updates} sub=${`${plural(s.reportedDays, 'day')} reported · ${totals.visits} all-time`} tip=${html`<${TipRows} title="Clinic updates" rows=${[['This month', s.updates], ['Days with a report', s.reportedDays], ['All-time visits', totals.visits], ['Unique clinics', totals.clinics]]} />`} />
        <${Stat} icon="checkCircle" label="Days present" value=${s.presentDays} sub=${s.workingDaysElapsed >= s.presentDays && s.workingDaysElapsed > 0 ? `of ${plural(s.workingDaysElapsed, 'working day')} so far` : 'this month'} tone="blue" />
        <${Stat} icon="calendar" label="Days off" value=${s.offDays} sub=${`${s.leaveDays} leave · ${s.absentDays} absent`} tone="violet" tip=${html`<${TipRows} title="Days off this month" rows=${[['Approved leave', s.leaveDates.map(fmtDay).join(', ') || '—'], ['Absent (no leave)', s.absentDates.map(fmtDay).join(', ') || '—']]} />`} />
        <${Stat} icon="alert" label="Red marks" value=${s.redCount} sub=${`alert at ${redThreshold}`} tone=${s.redCount ? 'red' : 'gray'} tip=${html`<${TipRows} title="Red marks" rows=${[['Days without a report', s.redDates.map(fmtDay).join(', ') || 'None'], ['Alert limit', `${redThreshold} per month`]]} foot="Excuse a day from the calendar if there was a valid reason." />`} />
      </div>
      <div class="two-col">
        <${Card} title=${`Daily tracker · ${data.monthLabel}`} subtitle="Tap a day for details">
          <${Calendar} month=${data.month} days=${days} today=${today} onDayClick=${(d, info) => setDayInfo({ date: d, ...info })} />
          <${CalendarLegend} items=${['reported', 'red', 'leave', 'leave-pending', 'excused', 'paused', 'holiday', 'weekoff', 'present']} />
        </${Card}>
        <div class="stack">
          <${Card} title="Attendance & days off">
            <${DateGroup} label="Absent (no attendance, no leave)" tone="red" dates=${s.absentDates} />
            <${DateGroup} label="Approved leave" tone="blue" dates=${s.leaveDates} />
            <${DateGroup} label="Red marks (no daily report)" tone="red" dates=${s.redDates} />
            <${DateGroup} label="Leave pending approval" tone="amber" dates=${s.pendingLeaveDates} />
            <${DateGroup} label="Present" tone="green" dates=${s.presentDates} times=${days} />
          </${Card}>
          <${Card} title="Visit outcomes this month">
            ${outcomes.length ? html`<div class="outcome-bars">${outcomes.sort((a, b) => b.n - a.n).map((o) => {
              const meta = OUTCOMES[o.outcome] || { label: 'Not specified', tone: 'gray' };
              return html`<div class="ob-row"><span>${meta.label}</span><div class="ob-track"><i class=${'tone-' + meta.tone} style=${`width:${(o.n / s.updates) * 100}%`}></i></div><b>${o.n}</b></div>`;
            })}</div>` : html`<p class="muted">No visits this month.</p>`}
            <div class="kv-inline"><span>Unique clinics (all-time)</span><b>${totals.clinics}</b></div>
            <div class="kv-inline"><span>First update</span><b>${totals.first ? fmtDate(totals.first) : '–'}</b></div>
          </${Card}>
        </div>
      </div>
      ${alerts.length > 0 && html`<${Card} title="Inactivity alerts history">${alerts.map((a) => html`<div class="kv-inline"><span>${a.monthLabel}</span><b class="text-red">${a.redCount} red marks</b></div>`)}</${Card}>`}
      <section class="print-only"><h2>Visits</h2>${visits.map((v) => html`<${VisitCard} key=${v.id} visit=${v} />`)}</section>
    `}

    ${tab === 'visits' && html`<section>
      <div class="section-head"><h2>${plural(visits.length, 'clinic visit')} in ${data.monthLabel}</h2>
        <a class="btn btn-secondary btn-sm" href=${`${API}/admin/updates.csv?employeeId=${e.id}&from=${days[0].date}&to=${days[days.length - 1].date}`}><${Icon} name="download" size=${15} />Export CSV</a></div>
      ${visits.length ? html`<div class="visit-grid">${visits.map((v) => html`<${VisitCard} key=${v.id} visit=${v} />`)}</div>` : html`<${Empty} icon="building" title="No visits this month" />`}
    </section>`}

    ${tab === 'leaves' && html`<section>
      ${leaves.length ? html`<div class="list-card">${leaves.map((r) => html`<${LeaveDecisionRow} key=${r.id} r=${r} onDone=${() => reload(true)} />`)}</div>` : html`<${Empty} icon="calendar" title="No leave requests" />`}
    </section>`}

    ${tab === 'account' && html`<${AccountPanel} employee=${e} me=${me} onChange=${() => reload(true)} />`}

    <${DayModal} info=${dayInfo} employee=${e} onClose=${() => setDayInfo(null)} visits=${visits} onChange=${() => { setDayInfo(null); reload(true); }} />
  </div>`;
}

function DateGroup({ label, dates, tone, times }) {
  if (!dates || !dates.length) return null;
  const byDate = times ? new Map(times.map((d) => [d.date, d.markedTime])) : null;
  return html`<div class="date-group"><div class="dg-label"><i class=${'tone-' + tone}></i>${label}<b>${dates.length}</b></div>
    <div class="leave-dates">${dates.map((d) => html`<span>${fmtDay(d)}${byDate && byDate.get(d) ? ` · ${fmtTime12(byDate.get(d))}` : ''}</span>`)}</div></div>`;
}

function DayModal({ info, employee, visits, onClose, onChange }) {
  const [busy, setBusy] = useState(false);
  if (!info) return null;
  const dayVisits = visits.filter((v) => v.date === info.date);
  const label = { reported: 'Daily report submitted', red: 'Red mark: no daily report', leave: 'On approved leave', holiday: `Holiday: ${info.holiday}`, weekoff: 'Weekly off',
    excused: 'Excused by admin', pending: 'Today (report pending)', future: 'Upcoming', na: 'Before joining date', paused: 'Access paused', removed: 'Access removed' }[info.status] || '';
  async function excuse() {
    const r = await confirmDialog({ title: 'Excuse this red mark?', message: `${employee.name} won't get a red mark for ${fmtDay(info.date)}.`, confirmText: 'Excuse day', input: { label: 'Note (optional)', placeholder: 'e.g. Attended training at office' } });
    if (!r) return;
    setBusy(true);
    try { await api(`/admin/employees/${employee.id}/excuse`, { method: 'POST', body: { date: info.date, note: r.value } }); toast('Day excused.'); onChange(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }
  async function unexcuse() {
    setBusy(true);
    try { await api(`/admin/employees/${employee.id}/excuse/${info.date}`, { method: 'DELETE' }); toast('Excuse removed.'); onChange(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }
  return html`<${Modal} open title=${fmtDate(info.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} subtitle=${label} onClose=${onClose} size="lg"
    footer=${html`${info.status === 'red' && html`<${Button} variant="secondary" icon="check" loading=${busy} onClick=${excuse}>Excuse this day</${Button}>`}
      ${info.status === 'excused' && html`<${Button} variant="secondary" loading=${busy} onClick=${unexcuse}>Remove excuse</${Button}>`}
      <${Button} onClick=${onClose}>Close</${Button}>`}>
    <div class="day-facts">
      <div><span>Attendance</span><b>${info.present ? `Present · ${fmtTime12(info.markedTime)}` : 'Not marked'}</b></div>
      <div><span>Clinic updates</span><b>${info.updates || 0}</b></div>
      ${info.leave && html`<div><span>Leave</span><b>${info.leave.status} · ${info.leave.reason}</b></div>`}
      ${info.excused !== null && info.excused !== undefined && html`<div><span>Excuse note</span><b>${info.excused || '–'}</b></div>`}
    </div>
    ${dayVisits.length > 0 && html`<div class="visit-list">${dayVisits.map((v) => html`<${VisitCard} key=${v.id} visit=${v} />`)}</div>`}
  </${Modal}>`;
}

function AccountPanel({ employee: e, me, onChange }) {
  const [f, setF] = useState({ name: e.name, email: e.email, phone: e.phone, designation: e.designation, territory: e.territory, joinedOn: e.joinedOn });
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [pausing, setPausing] = useState(false);
  const set = (k) => (ev) => { const v = ev.target.value; setF((p) => ({ ...p, [k]: v })); };
  const isMe = e.id === me.id;
  async function save() {
    setSaving(true);
    try { await api(`/admin/employees/${e.id}`, { method: 'PATCH', body: f }); toast('Profile saved.'); onChange(); } catch (err) { toast(err.message, 'error'); }
    setSaving(false);
  }
  async function restore() {
    if (!(await confirmDialog({ title: 'Restore access?', message: `${e.name} will be able to sign in again. Paused days won't count as red marks.`, confirmText: 'Restore access' }))) return;
    try { await api(`/admin/employees/${e.id}/restore`, { method: 'POST', body: {} }); toast('Access restored.'); onChange(); } catch (err) { toast(err.message, 'error'); }
  }
  async function removeForever() {
    const r = await confirmDialog({ title: 'Remove access permanently?', message: `${e.name} will never be able to sign in again. Their visits, attendance and reports stay saved for your records. This cannot be undone. Type REMOVE to confirm.`, confirmText: 'Remove permanently', danger: true, input: { label: 'Type REMOVE', required: true } });
    if (!r) return;
    if (r.value.trim().toUpperCase() !== 'REMOVE') return toast('Type REMOVE to confirm.', 'error');
    try { await api(`/admin/employees/${e.id}/remove`, { method: 'POST', body: {} }); toast('Access removed permanently.'); onChange(); } catch (err) { toast(err.message, 'error'); }
  }
  async function wipe() {
    const r = await confirmDialog({ title: 'Delete account and all data?', message: `This deletes ${e.name}'s account AND all their clinic updates, photos, attendance and leaves. This cannot be undone. Type DELETE to confirm.`, confirmText: 'Delete forever', danger: true, input: { label: 'Type DELETE', required: true } });
    if (!r) return;
    if (r.value.trim() !== 'DELETE') return toast('Type DELETE to confirm.', 'error');
    try { await api(`/admin/employees/${e.id}`, { method: 'DELETE' }); toast('Employee and all data deleted.'); navigate('/admin/employees'); } catch (err) { toast(err.message, 'error'); }
  }

  return html`<div class="two-col">
    <div class="stack">
      <${Card} title="Login & password" subtitle="Share these details with the employee.">
        <div class="pw-row"><span>Login ID</span><b>${e.email}</b></div>
        ${e.phone && html`<div class="pw-row" style="margin-top:8px"><span>Or mobile</span><b>${e.phone}</b></div>`}
        <div class="row-gap" style="margin-top:14px">
          ${e.status !== 'removed' ? html`<${Button} icon="eye" onClick=${() => setShowPw(true)}>View password</${Button}>` : html`<span class="muted">Password removed with the account.</span>`}
        </div>
      </${Card}>
      <${Card} title="Access" subtitle=${e.status === 'active' ? 'This employee can sign in.' : e.status === 'paused' ? (e.suspendedUntil ? `Paused since ${fmtDay(e.suspendedFrom)} · restores automatically on ${fmtDay(e.suspendedUntil)}` : `Paused since ${fmtDay(e.suspendedFrom)} · until you restore it`) : `Removed permanently on ${fmtDate(e.removedAt)}`}>
        <div class="access-status"><span class=${'access-dot ' + e.status}></span><b>${{ active: 'Active', paused: 'Access paused (temporary)', removed: 'Access removed (permanent)' }[e.status]}</b></div>
        ${!isMe && html`<div class="access-actions">
          ${e.status === 'active' && html`<button class="access-btn" onClick=${() => setPausing(true)}>
            <span class="tile-icon tone-amber"><${Icon} name="clock" size=${20} /></span><span><b>Pause access</b><small>Temporary: they can't sign in until the date you pick, or until you restore it. No red marks while paused.</small></span></button>`}
          ${e.status === 'paused' && html`<button class="access-btn" onClick=${restore}>
            <span class="tile-icon tone-green"><${Icon} name="check" size=${20} /></span><span><b>Restore access</b><small>Let them sign in again now.</small></span></button>
            <button class="access-btn" onClick=${() => setPausing(true)}>
            <span class="tile-icon tone-amber"><${Icon} name="calendar" size=${20} /></span><span><b>Change pause end date</b><small>${e.suspendedUntil ? `Currently ${fmtDay(e.suspendedUntil)}` : 'Currently until you restore it'}</small></span></button>`}
          ${e.status !== 'removed' && html`<button class="access-btn danger" onClick=${removeForever}>
            <span class="tile-icon tone-red"><${Icon} name="lock" size=${20} /></span><span><b>Remove access permanently</b><small>They can never sign in again. Their reports and visits are kept.</small></span></button>`}
          <button class="link danger-link" onClick=${wipe}><${Icon} name="trash" size=${14} />Delete account and all data</button>
        </div>`}
        ${isMe && html`<p class="muted">This is your own account.</p>`}
      </${Card}>
    </div>
    <${Card} title="Profile">
      <div class="form-grid">
        <${Field} label="Full name"><input value=${f.name} onInput=${set('name')} /></${Field}>
        <div class="form-row">
          <${Field} label="Email (login ID)"><input value=${f.email} onInput=${set('email')} /></${Field}>
          <${Field} label="Mobile"><input type="tel" value=${f.phone} onInput=${set('phone')} /></${Field}>
        </div>
        <div class="form-row">
          <${Field} label="Designation"><input value=${f.designation} onInput=${set('designation')} /></${Field}>
          <${Field} label="Territory"><input value=${f.territory} onInput=${set('territory')} /></${Field}>
        </div>
        <${Field} label="Joining date" hint="Red marks are only counted from this date"><input type="date" value=${f.joinedOn} onInput=${set('joinedOn')} /></${Field}>
        <div><${Button} loading=${saving} onClick=${save}>Save changes</${Button}></div>
      </div>
    </${Card}>
    ${showPw && html`<${PasswordModal} account=${e} onClose=${() => setShowPw(false)} onChange=${onChange} />`}
    ${pausing && html`<${PauseModal} account=${e} onClose=${() => setPausing(false)} onDone=${() => { setPausing(false); onChange(); }} />`}
  </div>`;
}

function PauseModal({ account, onClose, onDone }) {
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [mode, setMode] = useState(account.suspendedUntil ? 'date' : 'manual');
  const [until, setUntil] = useState(account.suspendedUntil || '');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (mode === 'date' && !until) return toast('Pick the date access comes back.', 'error');
    setBusy(true);
    try {
      await api(`/admin/employees/${account.id}/pause`, { method: 'POST', body: { until: mode === 'date' ? until : null } });
      toast(mode === 'date' ? `Access paused until ${fmtDay(until)}.` : 'Access paused.');
      onDone();
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  }
  return html`<${Modal} open title=${`Pause ${account.name}'s access`} subtitle="They'll be signed out right away. Their data stays." onClose=${onClose} size="sm"
    footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}><${Button} loading=${busy} onClick=${submit}>Pause access</${Button}>`}>
    <div class="form-grid">
      <label class=${'radio-card' + (mode === 'manual' ? ' active' : '')}><input type="radio" name="pm" checked=${mode === 'manual'} onChange=${() => setMode('manual')} />
        <span><b>Until I restore it</b><small>You restore access manually from this page.</small></span></label>
      <label class=${'radio-card' + (mode === 'date' ? ' active' : '')}><input type="radio" name="pm" checked=${mode === 'date'} onChange=${() => setMode('date')} />
        <span><b>Until a date</b><small>Access comes back automatically on this date.</small></span></label>
      ${mode === 'date' && html`<${Field} label="Restore access on"><input type="date" min=${tomorrow} value=${until} onInput=${(ev) => setUntil(ev.target.value)} /></${Field}>`}
    </div>
  </${Modal}>`;
}

// ================================================================== All updates
function AllUpdates({ query }) {
  const [filters, setFilters] = useState({ employeeId: query.employeeId || '', from: query.from || '', to: query.to || '', q: '', outcome: '' });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const emps = useApi('/admin/employees');
  const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...filters, ...extra }).filter(([, v]) => v !== '' && v !== undefined)).toString();
  async function load(offset = 0) {
    setLoading(true); setError(null);
    try { const d = await api(`/admin/updates?${qs({ limit: 24, offset })}`); setItems((x) => (offset ? [...x, ...d.items] : d.items)); setTotal(d.total); } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { const t = setTimeout(() => load(0), filters.q ? 300 : 0); return () => clearTimeout(t); }, [filters]);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return html`<div class="stack">
    <div class="page-head spread">
      <div><h1>Clinic updates</h1><p>${plural(total, 'update')} found: every clinic visit reported by the team.</p></div>
      <a class="btn btn-secondary" href=${`${API}/admin/updates.csv?${qs()}`}><${Icon} name="download" size=${17} />Export CSV</a>
    </div>
    <div class="filters">
      <div class="search"><${Icon} name="search" size=${17} /><input placeholder="Clinic, address, contact…" value=${filters.q} onInput=${set('q')} /></div>
      <select value=${filters.employeeId} onChange=${set('employeeId')}><option value="">All employees</option>
        ${emps.data && emps.data.items.map((e) => html`<option value=${e.id}>${e.name}</option>`)}</select>
      <select value=${filters.outcome} onChange=${set('outcome')}><option value="">Any outcome</option>
        ${Object.entries(OUTCOMES).map(([k, o]) => html`<option value=${k}>${o.label}</option>`)}</select>
      <label class="date-filter"><span>From</span><input type="date" value=${filters.from} onInput=${set('from')} /></label>
      <label class="date-filter"><span>To</span><input type="date" value=${filters.to} onInput=${set('to')} /></label>
      ${(filters.employeeId || filters.from || filters.to || filters.q || filters.outcome) && html`<${Button} variant="ghost" size="sm" onClick=${() => setFilters({ employeeId: '', from: '', to: '', q: '', outcome: '' })}>Clear</${Button}>`}
    </div>
    ${error && html`<${ErrorBox} message=${error} onRetry=${() => load(0)} />`}
    ${!loading && !error && !items.length && html`<${Empty} icon="building" title="No clinic updates found">Try changing the filters.</${Empty}>`}
    ${items.length > 0 && html`<div class="visit-grid">${items.map((v) => html`<${VisitCard} key=${v.id} visit=${v} showEmployee hover />`)}</div>`}
    ${loading && html`<${Loading} />`}
    ${!loading && items.length < total && html`<div class="center"><${Button} variant="secondary" onClick=${() => load(items.length)}>Load more (${total - items.length} left)</${Button}></div>`}
  </div>`;
}

// ================================================================== Attendance matrix
function Attendance() {
  const [month, setMonth] = useState('');
  const { data, error, loading, reload } = useApi(`/admin/attendance${month ? `?month=${month}` : ''}`);
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const rows = data.rows.filter((r) => r.employee.active);
  const sym = (c, d) => {
    if (c.status === 'na') return { cls: 'na', t: '' };
    if (c.present) return { cls: 'p', t: 'P' };
    if (c.leave === 'approved') return { cls: 'l', t: 'L' };
    if (d.holiday) return { cls: 'h', t: 'H' };
    if (d.weekOff) return { cls: 'w', t: '' };
    if (d.date > data.today) return { cls: c.leave === 'pending' ? 'lp' : 'f', t: c.leave === 'pending' ? 'L?' : '' };
    if (d.date === data.today) return { cls: 't', t: '·' };
    return { cls: 'a', t: 'A' };
  };
  return html`<div class="stack">
    <div class="page-head spread">
      <div><h1>Attendance</h1><p>Morning attendance ticks by employees. P = present, A = absent (off without leave), L = approved leave, H = holiday.</p></div>
      <${MonthNav} month=${data.month} onChange=${setMonth} />
    </div>
    ${rows.length ? html`<div class="table-wrap att-wrap"><table class="att-table">
      <thead><tr><th class="sticky-col">Employee</th>${data.days.map((d) => html`<th class=${(d.weekOff ? 'wk ' : '') + (d.holiday ? 'hol ' : '') + (d.date === data.today ? 'today' : '')} title=${d.holiday || ''}><span>${WEEKDAYS[d.weekday][0]}</span>${Number(d.date.slice(8))}</th>`)}
        <th class="sum">Present</th><th class="sum">Leave</th><th class="sum">Absent</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td class="sticky-col"><a href=${'#/admin/employees/' + r.employee.id + '?month=' + data.month} class="att-emp"><${Avatar} name=${r.employee.name} size=${26} /><span>${r.employee.name}</span></a></td>
        ${r.cells.map((c, i) => { const d = data.days[i]; const s = sym(c, d); return html`<td class=${'ac ac-' + s.cls} title=${`${fmtDay(d.date)}${c.markedTime ? ' · in at ' + fmtTime12(c.markedTime) : ''}${c.updates ? ` · ${c.updates} update(s)` : ''}`}>${s.t}</td>`; })}
        <td class="sum p">${r.summary.presentDays}</td><td class="sum l">${r.summary.leaveDays}</td><td class="sum a">${r.summary.absentDays}</td>
      </tr>`)}</tbody></table></div>` : html`<${Empty} icon="users" title="No active employees" />`}
    ${rows.length > 0 && html`<${Card} title="Days off per employee" subtitle=${data.monthLabel}>
      <div class="offs-grid">${rows.map((r) => html`<div class="offs-card">
        <div class="offs-head"><${Avatar} name=${r.employee.name} size=${30} /><b>${r.employee.name}</b><span>${plural(r.summary.offDays, 'day')} off</span></div>
        ${r.summary.offDays ? html`
          ${r.summary.absentDates.length > 0 && html`<div class="offs-line"><${Badge} tone="red">Absent ${r.summary.absentDates.length}</${Badge}><span>${r.summary.absentDates.map(fmtDay).join(', ')}</span></div>`}
          ${r.summary.leaveDates.length > 0 && html`<div class="offs-line"><${Badge} tone="blue">Leave ${r.summary.leaveDates.length}</${Badge}><span>${r.summary.leaveDates.map(fmtDay).join(', ')}</span></div>`}`
          : html`<p class="muted">Full attendance 🎉</p>`}
      </div>`)}</div>
    </${Card}>`}
  </div>`;
}

// ================================================================== Leaves
function LeavesAdmin({ onChange }) {
  const [status, setStatus] = useState('pending');
  const { data, error, loading, reload } = useApi(`/admin/leaves?status=${status}`);
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const c = data.counts;
  return html`<div class="stack">
    <div class="page-head"><div><h1>Leave requests</h1><p>Approved leave days don't get red marks and count as leave in attendance.</p></div></div>
    <${Segmented} value=${status} onChange=${setStatus} options=${[
      { value: 'pending', label: 'Pending', count: c.pending || 0 }, { value: 'approved', label: 'Approved', count: c.approved || 0 },
      { value: 'rejected', label: 'Rejected', count: c.rejected || 0 }, { value: 'cancelled', label: 'Cancelled', count: c.cancelled || 0 }]} />
    ${data.items.length ? html`<div class="list-card">${data.items.map((r) => html`<${LeaveDecisionRow} key=${r.id} r=${r} showName onDone=${() => { reload(true); onChange && onChange(); }} />`)}</div>`
      : html`<${Empty} icon="calendar" title=${`No ${status} requests`} />`}
  </div>`;
}

function LeaveDecisionRow({ r, showName, onDone }) {
  const [busy, setBusy] = useState(null);
  async function decide(st) {
    const res = await confirmDialog({
      title: st === 'approved' ? 'Approve leave?' : 'Reject leave?',
      message: `${r.employeeName}: ${plural(r.dates.length, 'day')} (${r.dates.map(fmtDay).join(', ')}).`,
      confirmText: st === 'approved' ? 'Approve' : 'Reject', danger: st === 'rejected',
      input: { label: 'Note to employee (optional)', placeholder: st === 'approved' ? 'e.g. Approved, take care' : 'e.g. Big client meeting that week' },
    });
    if (!res) return;
    setBusy(st);
    try { await api(`/admin/leaves/${r.id}/decision`, { method: 'POST', body: { status: st, note: res.value } }); toast(`Leave ${st}.`); onDone(); } catch (e) { toast(e.message, 'error'); }
    setBusy(null);
  }
  return html`<div class="leave-row">
    ${showName && html`<${Avatar} name=${r.employeeName} size=${40} />`}
    <div class="leave-main">
      <div class="leave-top">${showName && html`<a href=${'#/admin/employees/' + r.employeeId}><b>${r.employeeName}</b></a>`}
        <span class=${showName ? 'muted' : ''}>${showName ? '· ' : ''}${LEAVE_TYPES[r.type] || r.type} · ${plural(r.dates.length, 'day')}</span><${LeaveStatus} status=${r.status} /></div>
      <div class="leave-dates">${r.dates.map((d) => html`<span>${fmtDay(d)}</span>`)}</div>
      <div class="leave-reason">“${r.reason}”</div>
      ${r.adminNote && html`<div class="leave-note"><${Icon} name="user" size=${13} />${r.decidedBy ? r.decidedBy + ': ' : ''}${r.adminNote}</div>`}
      <div class="leave-when">Applied ${fmtDateTime(r.createdAt)}${r.decidedAt ? ` · ${r.status} ${timeAgo(r.decidedAt)}${r.decidedBy ? ' by ' + r.decidedBy : ''}` : ''}</div>
    </div>
    ${r.status !== 'cancelled' && html`<div class="leave-actions">
      ${r.status !== 'approved' && html`<${Button} size="sm" icon="check" loading=${busy === 'approved'} onClick=${() => decide('approved')}>Approve</${Button}>`}
      ${r.status !== 'rejected' && html`<${Button} size="sm" variant="danger-ghost" icon="x" loading=${busy === 'rejected'} onClick=${() => decide('rejected')}>${r.status === 'approved' ? 'Revoke' : 'Reject'}</${Button}>`}
    </div>`}
  </div>`;
}

// ================================================================== Alerts
function Alerts({ onChange }) {
  const { data, error, loading, reload } = useApi('/admin/alerts');
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  async function markRead(a) { await api(`/admin/alerts/${a.id}/read`, { method: 'POST' }).catch(() => {}); reload(true); onChange && onChange(); }
  async function email(a) {
    try { const r = await api(`/admin/alerts/${a.id}/email`, { method: 'POST' }); toast(`Report emailed to ${r.to.join(', ')}.`); reload(true); } catch (e) { toast(e.message, 'error'); }
  }
  const emailBadge = (a) => ({ sent: html`<${Badge} tone="green">Emailed ${timeAgo(a.emailedAt)}</${Badge}>`, failed: html`<${Badge} tone="red">Email failed</${Badge}>`,
    skipped: html`<${Badge} tone="gray">Email not configured</${Badge}>`, pending: html`<${Badge} tone="amber">Email pending</${Badge}>` }[a.emailStatus]);
  return html`<div class="stack">
    <div class="page-head"><div><h1>Inactivity alerts</h1><p>Raised automatically when an employee gets enough red marks (no daily report on a working day) in a month.</p></div></div>
    ${!data.smtpConfigured && html`<div class="notice notice-amber"><${Icon} name="mail" size=${20} /><div><b>Email delivery is off</b>
      <span>Alerts appear here in the admin panel. To also receive them by email, add the email (SMTP) settings on the server (see DEPLOY.md).</span></div></div>`}
    ${data.smtpConfigured && html`<p class="muted">Email reports go to: <b>${data.recipients.join(', ') || 'no recipients set'}</b></p>`}
    ${data.items.length ? html`<div class="list-card">${data.items.map((a) => html`<div class=${'alert-row' + (a.readAt ? ' read' : '')} key=${a.id}>
      <span class="alert-icon"><${Icon} name="alert" size=${20} /></span>
      <div class="alert-main">
        <div class="leave-top"><a href=${`#/admin/employees/${a.employeeId}?month=${a.month}`}><b>${a.employeeName}</b></a><span class="muted">· ${a.monthLabel}</span>${!a.readAt && html`<${Badge} tone="red" dot>New</${Badge}>`}${emailBadge(a)}</div>
        <div><b class="text-red">${a.redCount} red marks</b>: no daily report on:</div>
        <div class="leave-dates">${a.redDates.map((d) => html`<span class="red">${fmtDay(d)}</span>`)}</div>
        <div class="leave-when">Raised ${fmtDateTime(a.createdAt)}${a.emailError && a.emailStatus === 'failed' ? ` · ${a.emailError}` : ''}</div>
      </div>
      <div class="leave-actions">
        <${Button} size="sm" variant="secondary" icon="file" onClick=${() => { markRead(a); navigate(`/admin/employees/${a.employeeId}?month=${a.month}`); }}>Full report</${Button}>
        ${data.smtpConfigured && html`<${Button} size="sm" variant="ghost" icon="mail" onClick=${() => email(a)}>${a.emailStatus === 'sent' ? 'Resend' : 'Email'}</${Button}>`}
        ${!a.readAt && html`<${Button} size="sm" variant="ghost" icon="check" onClick=${() => markRead(a)}>Mark seen</${Button}>`}
      </div>
    </div>`)}</div>` : html`<${Empty} icon="checkCircle" title="No inactivity alerts">Everyone is submitting their daily reports.</${Empty}>`}
  </div>`;
}

// ================================================================== Settings
function Settings({ me }) {
  const s = useApi('/admin/settings');
  const hol = useApi('/admin/holidays');
  const admins = useApi('/admin/admins');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newHol, setNewHol] = useState({ date: '', name: '' });
  const [addAdmin, setAddAdmin] = useState(false);
  const [created, setCreated] = useState(null);
  const [pwFor, setPwFor] = useState(null);
  useEffect(() => { if (s.data && !form) setForm({ ...s.data.settings }); }, [s.data]);

  if (s.loading && !s.data) return html`<${Loading} />`;
  if (s.error && !s.data) return html`<${ErrorBox} message=${s.error} onRetry=${s.reload} />`;
  if (!form) return html`<${Loading} />`;

  async function save() {
    setSaving(true);
    try { await api('/admin/settings', { method: 'PUT', body: { weeklyOff: form.weeklyOff, redThreshold: Number(form.redThreshold), alertEmails: form.alertEmails } }); toast('Settings saved.'); s.reload(true); } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }
  async function addHoliday() {
    try { await api('/admin/holidays', { method: 'POST', body: newHol }); setNewHol({ date: '', name: '' }); hol.reload(true); toast('Holiday added.'); } catch (e) { toast(e.message, 'error'); }
  }
  async function delHoliday(h) {
    if (!(await confirmDialog({ title: 'Remove holiday?', message: `${h.name} (${fmtDate(h.date)})`, confirmText: 'Remove', danger: true }))) return;
    await api(`/admin/holidays/${h.date}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error')); hol.reload(true);
  }

  const toggleDay = (d) => setForm({ ...form, weeklyOff: form.weeklyOff.includes(d) ? form.weeklyOff.filter((x) => x !== d) : [...form.weeklyOff, d].sort() });

  return html`<div class="stack">
    <div class="page-head"><div><h1>Settings</h1><p>Rules for red marks, alerts, holidays and admin accounts.</p></div></div>
    ${s.data.photoStorage && (s.data.photoStorage.provider === 'bunny'
      ? html`<div class="notice notice-green"><${Icon} name="image" size=${20} /><div><b>Clinic photos are stored on Bunny CDN</b>
          <span>Storage zone ${s.data.photoStorage.zone} · served from ${s.data.photoStorage.cdn}${s.data.photoStorage.protected ? ' with private, expiring links' : ''}.</span></div></div>`
      : html`<div class="notice notice-amber"><${Icon} name="image" size=${20} /><div><b>Clinic photos are stored on this server's disk</b>
          <span>Add the Bunny settings on the server to store them on Bunny CDN instead (see DEPLOY.md).</span></div></div>`)}
    <div class="two-col">
      <${Card} title="Tracking rules">
        <div class="form-grid">
          <${Field} label="Weekly off days" hint="No red marks or attendance expected on these days">
            <div class="chip-select">${WEEKDAYS.map((w, i) => html`<button type="button" class=${'chip' + (form.weeklyOff.includes(i) ? ' active tone-green' : '')} onClick=${() => toggleDay(i)}>${w}</button>`)}</div>
          </${Field}>
          <${Field} label="Red marks per month before inactivity alert" hint="A red mark = a working day with no clinic update submitted">
            <input type="number" min="1" max="31" value=${form.redThreshold} onInput=${(e) => setForm({ ...form, redThreshold: e.target.value })} />
          </${Field}>
          <${Field} label="Send inactivity reports to (email)" hint=${s.data.smtpConfigured ? 'Comma separated. Leave empty to use admin account emails.' : 'Email sending is not set up on the server yet; alerts will show in the panel only.'}>
            <input value=${form.alertEmails} onInput=${(e) => setForm({ ...form, alertEmails: e.target.value })} placeholder="owner@queue24.in, manager@queue24.in" />
          </${Field}>
          <div><${Button} loading=${saving} onClick=${save}>Save rules</${Button}></div>
        </div>
      </${Card}>
      <${Card} title="Holidays" subtitle="Company holidays don't get red marks">
        <div class="hol-add">
          <input type="date" value=${newHol.date} onInput=${(e) => setNewHol({ ...newHol, date: e.target.value })} />
          <input placeholder="Holiday name, e.g. Diwali" value=${newHol.name} onInput=${(e) => setNewHol({ ...newHol, name: e.target.value })} />
          <${Button} icon="plus" onClick=${addHoliday} disabled=${!newHol.date || !newHol.name}>Add</${Button}>
        </div>
        ${hol.data && hol.data.items.length ? html`<div class="hol-list">${hol.data.items.map((h) => html`<div class="hol-row">
          <span class="hol-date">${fmtDate(h.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span><span>${h.name}</span>
          <button class="icon-btn" onClick=${() => delHoliday(h)} aria-label="Remove"><${Icon} name="trash" size=${16} /></button></div>`)}</div>` : html`<p class="muted">No holidays added.</p>`}
      </${Card}>
    </div>
    <div class="two-col">
      <${Card} title="Admin accounts" action=${html`<${Button} size="sm" variant="secondary" icon="plus" onClick=${() => setAddAdmin(true)}>Add admin</${Button}>`}>
        ${admins.data && html`<div class="mini-list">${admins.data.items.map((a) => html`<div class="mini-row">
          <${Avatar} name=${a.name} size=${32} /><div><b>${a.name}${a.id === me.id ? ' (you)' : ''}</b><span>${a.email}</span></div>
          <button class="icon-btn" title="View password" onClick=${() => setPwFor(a)}><${Icon} name="key" size=${16} /></button>
        </div>`)}</div>`}
      </${Card}>
      <${Card} title="Change your password"><${ChangePasswordForm} /></${Card}>
    </div>
    <${AccountModal} open=${addAdmin} role="admin" onClose=${() => setAddAdmin(false)} onCreated=${(r) => { setAddAdmin(false); setCreated({ ...r, title: 'Admin account created' }); admins.reload(true); }} />
    <${Modal} open=${Boolean(created)} title=${created && created.title} onClose=${() => setCreated(null)} footer=${html`<${Button} onClick=${() => setCreated(null)}>Done</${Button}>`}>
      ${created && html`<${PasswordReveal} name=${created.user.name} email=${created.user.email} password=${created.password} />`}
    </${Modal}>
    ${pwFor && html`<${PasswordModal} account=${pwFor} onClose=${() => setPwFor(null)} onChange=${() => admins.reload(true)} />`}
  </div>`;
}

// ================================================================== Lab partners (blood tests module)
const LAB_TONE = { placed: 'amber', assigned: 'amber', needs_attention: 'red', in_review: 'blue', quoted: 'violet', scheduled: 'blue', collected: 'blue', processing: 'blue', report_ready: 'green', completed: 'green', cancelled: 'gray' };
const LAB_STATUS = [['open', 'All open'], ['needs_attention', 'Needs attention'], ['assigned', 'Waiting for lab'], ['in_review', 'Rx in review'], ['quoted', 'Quoted'], ['scheduled', 'Scheduled'], ['collected', 'Collected'], ['processing', 'Testing'], ['report_ready', 'Report ready'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
const H = '/admin/health';

function LabPartners({ query, onChange }) {
  const [tab, setTab] = useState(query.tab || 'overview');
  const [openId, setOpenId] = useState(null);
  return html`<div class="stack">
    <div class="page-head spread"><div><h1>Lab partners</h1><p>Blood test orders from <b>/blood-test</b>, routed to partner labs on <b>/lab-partners</b>.</p></div>
      <div class="row-gap"><a class="btn btn-secondary btn-sm" href="/blood-test/" target="_blank" rel="noopener"><${Icon} name="droplet" size=${15} />Patient page</a>
        <a class="btn btn-secondary btn-sm" href="/lab-partners/" target="_blank" rel="noopener"><${Icon} name="flask" size=${15} />Lab portal</a></div></div>
    <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'overview', label: 'Overview' }, { value: 'orders', label: 'Orders' }, { value: 'partners', label: 'Partners' }, { value: 'coverage', label: 'Coverage' }, { value: 'tests', label: 'Tests & prices' }]} />
    ${tab === 'overview' && html`<${LabOverview} onOpen=${setOpenId} goOrders=${() => setTab('orders')} />`}
    ${tab === 'orders' && html`<${LabOrders} onOpen=${setOpenId} />`}
    ${tab === 'partners' && html`<${LabPartnerList} />`}
    ${tab === 'coverage' && html`<${LabCoverage} />`}
    ${tab === 'tests' && html`<${LabTests} />`}
    ${openId && html`<${LabOrderModal} id=${openId} onClose=${() => { setOpenId(null); onChange && onChange(); }} />`}
  </div>`;
}

function useLive(path, ms = 20000) {
  const r = useApi(path);
  useEffect(() => { const t = setInterval(() => document.visibilityState === 'visible' && r.reload(true), ms); return () => clearInterval(t); }, [path]);
  return r;
}

function LabOrderCard({ o, onOpen }) {
  const tip = html`<${TipRows} title=${`${o.orderNo} · ${o.kind === 'prescription' ? 'Prescription' : 'Tests'}`} rows=${[
    ['Patient', `${o.patientName || '—'}${o.age ? `, ${o.age}` : ''}`], ['Phone', o.phone], ['Area', `${o.city} (${o.area})`],
    ['Lab', o.partner ? `${o.partner.name}${o.partner.role ? ` · ${o.partner.role}` : ''}` : 'Not assigned'],
    ['Collection', o.slotDate ? `${fmtDay(o.slotDate)}, ${o.slotLabel}` : '—'], ['Total', o.total ? `₹${o.total}` : '—'],
    ['Last message', o.lastMessage ? `${o.lastMessage.text.slice(0, 40)}${o.lastMessage.text.length > 40 ? '…' : ''}` : '—'],
  ]} foot=${o.items.length ? o.items.join(', ') : 'Waiting for the lab to suggest tests.'} />`;
  return html`<${HoverCard} tip=${tip} wide><button class="lab-card" onClick=${() => onOpen(o.id)}>
    <div class="lab-card-top"><span class=${'lab-kind ' + o.kind}>${o.kind === 'prescription' ? 'Rx' : 'Tests'}</span><b>${o.orderNo}</b><${Badge} tone=${LAB_TONE[o.status] || 'gray'} dot>${o.statusLabel}</${Badge}></div>
    <div class="lab-card-mid"><span>${o.patientName || 'Patient'}</span><span class="muted">${o.city}</span>${o.total > 0 && html`<b>₹${o.total}</b>`}</div>
    <div class="lab-card-foot"><span class="muted">${o.partner ? o.partner.name : 'No lab yet'}</span>${o.unread > 0 && html`<${Badge} tone="blue">${o.unread} new</${Badge}>`}<small>${timeAgo(o.updatedAt)}</small></div>
  </button></${HoverCard}>`;
}

function LabOverview({ onOpen, goOrders }) {
  const { data, error, loading, reload } = useLive(`${H}/overview`);
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const k = data.kpis;
  return html`<div class="stack">
    ${k.needsAttention > 0 && html`<div class="notice notice-red"><${Icon} name="alert" size=${20} /><div><b>${plural(k.needsAttention, 'order')} without a lab</b><span>No partner accepted in time. Open the order and assign a lab.</span></div><${Button} size="sm" variant="danger" onClick=${goOrders}>View</${Button}></div>`}
    <div class="stats-grid five">
      <${Stat} icon="cart" label="Orders today" value=${k.ordersToday} tip=${html`<${TipRows} title="Today" rows=${[['New orders', k.ordersToday], ['Collections scheduled today', k.collectionsToday], ['Patients (all-time)', k.patients]]} />`} />
      <${Stat} icon="clock" label="Waiting for a lab" value=${k.awaitingAccept} tone="amber" tip=${html`<${TipRows} title="Offered, not yet accepted" rows=${[['Waiting', k.awaitingAccept], ['Moves to backup after', `${data.acceptTimeoutMin} min`], ['Without any lab', k.needsAttention]]} foot="Primary lab first, then backup, then you." />`} />
      <${Stat} icon="flask" label="Prescriptions open" value=${k.prescriptionsPending} tone="violet" tip=${html`<${TipRows} title="Prescription requests" rows=${[['Awaiting lab review', k.prescriptionsPending]]} foot="Labs reply in chat with the tests and price." />`} />
      <${Stat} icon="upload" label="Reports pending" value=${k.reportsPending} tone="blue" tip=${html`<${TipRows} title="Samples in the lab" rows=${[['Collected / testing', k.reportsPending], ['Open orders', k.open]]} />`} />
      <${Stat} icon="chart" label="Revenue this month" value=${`₹${k.revenueMonth.toLocaleString('en-IN')}`} tone="green" tip=${html`<${TipRows} title="This month" rows=${[['Completed orders', k.completedMonth], ['Collected amount', `₹${k.revenueMonth.toLocaleString('en-IN')}`], ['Active partner labs', k.partnersActive]]} foot="Pay-at-collection orders, counted when completed." />`} />
    </div>
    <div class="two-col wide-left">
      <${Card} title="Needs a look" subtitle="Orders without a lab, or waiting for a lab to accept">
        ${data.attention.length ? html`<div class="lab-list">${data.attention.map((o) => html`<${LabOrderCard} o=${o} onOpen=${onOpen} key=${o.id} />`)}</div>` : html`<p class="muted">All clear. Every order has a lab.</p>`}
      </${Card}>
      <div class="stack">
        <${Card} title="Orders by status">${Object.keys(data.byStatus).length ? html`<div class="status-bars">${LAB_STATUS.filter(([s]) => data.byStatus[s]).map(([s, label]) => html`<div class="sb-row"><${Badge} tone=${LAB_TONE[s]}>${label}</${Badge}><b>${data.byStatus[s]}</b></div>`)}</div>` : html`<p class="muted">No orders yet.</p>`}</${Card}>
        <${Card} title="Top areas">${data.topAreas.length ? data.topAreas.map((a) => html`<div class="kv-inline"><span>${a.name} ${a.kind === 'metro' ? html`<${Badge} tone="blue">metro</${Badge}>` : ''}</span><b>${a.orders}</b></div>`) : html`<p class="muted">No orders yet.</p>`}</${Card}>
      </div>
    </div>
    <section><div class="section-head"><h2>Latest orders</h2><button class="link" onClick=${goOrders}>All orders<${Icon} name="right" size=${15} /></button></div>
      ${data.recent.length ? html`<div class="lab-grid">${data.recent.map((o) => html`<${LabOrderCard} o=${o} onOpen=${onOpen} key=${o.id} />`)}</div>` : html`<${Empty} icon="flask" title="No orders yet">Orders placed on /blood-test show up here.</${Empty}>`}</section>
  </div>`;
}

function LabOrders({ onOpen }) {
  const [f, setF] = useState({ status: 'open', kind: '', partner: '', q: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useLive(`${H}/orders?${qs}`, 15000);
  const partners = useApi(`${H}/partners`);
  const set = (k) => (e) => { const v = e.target.value; setF((p) => ({ ...p, [k]: v })); };
  return html`<div class="stack">
    <div class="filters">
      <div class="search"><${Icon} name="search" size=${17} /><input placeholder="Order no., patient, city, phone…" value=${f.q} onInput=${set('q')} /></div>
      <select value=${f.status} onChange=${set('status')}><option value="">All statuses</option>${LAB_STATUS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <select value=${f.kind} onChange=${set('kind')}><option value="">Tests + prescriptions</option><option value="tests">Test bookings</option><option value="prescription">Prescriptions</option></select>
      <select value=${f.partner} onChange=${set('partner')}><option value="">All labs</option>${partners.data && partners.data.items.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>
    </div>
    ${error && html`<${ErrorBox} message=${error} onRetry=${reload} />`}
    ${loading && !data ? html`<${Loading} />` : data && data.items.length ? html`<p class="muted">${plural(data.total, 'order')}</p><div class="lab-grid">${data.items.map((o) => html`<${LabOrderCard} o=${o} onOpen=${onOpen} key=${o.id} />`)}</div>`
      : html`<${Empty} icon="flask" title="No orders match">Try another filter.</${Empty}>`}
  </div>`;
}

function LabOrderModal({ id, onClose }) {
  const [o, setO] = useState(null); const [err, setErr] = useState(null);
  const partners = useApi(`${H}/partners`);
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api(`${H}/orders/${id}`).then((r) => setO(r.order)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  async function assign() {
    if (!assignTo) return toast('Pick a lab.', 'error');
    setBusy('assign');
    try { const r = await api(`${H}/orders/${id}/assign`, { method: 'POST', body: { partnerId: Number(assignTo) } }); setO(r.order); setAssignTo(''); toast('Sent to the selected lab.'); } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }
  async function cancel() {
    const r = await confirmDialog({ title: 'Cancel this order?', message: 'The patient and the lab will see it as cancelled by Queue24 support.', confirmText: 'Cancel order', danger: true, input: { label: 'Reason (shown to patient)', required: true } });
    if (!r) return;
    try { const x = await api(`${H}/orders/${id}/cancel`, { method: 'POST', body: { reason: r.value } }); setO(x.order); toast('Order cancelled.'); } catch (e) { toast(e.message, 'error'); }
  }
  const sorted = partners.data && o ? partners.data.items.filter((p) => p.active).sort((a, b) => (b.coverage.some((c) => c.area === o.area) - a.coverage.some((c) => c.area === o.area)) || a.state.localeCompare(b.state)) : [];
  return html`<${Modal} open size="lg" title=${o ? `${o.orderNo} · ${o.kind === 'prescription' ? 'Prescription' : 'Test booking'}` : 'Order'} subtitle=${o ? `${o.patientName || 'Patient'} · ${o.city}, ${o.state}` : ''} onClose=${onClose}>
    ${err ? html`<${ErrorBox} message=${err} onRetry=${load} />` : !o ? html`<${Loading} />` : html`<div class="lab-modal">
      <div class="stack-sm">
        <div class="row-gap"><${Badge} tone=${LAB_TONE[o.status] || 'gray'} dot>${o.statusLabel}</${Badge}>${o.partner && html`<span class="muted">Lab: <b>${o.partner.name}</b> (${o.partner.role})</span>`}</div>
        <div class="kv-inline"><span>Account</span><b>${o.account ? `${o.account.name} · ${o.account.phone}` : '—'}</b></div>
        <div class="kv-inline"><span>Patient</span><b>${o.patientName || '—'}${o.age ? `, ${o.age} · ${o.gender}` : ''}</b></div>
        <div class="kv-inline"><span>Contact</span><b>${o.phone}</b></div>
        ${o.slotDate && html`<div class="kv-inline"><span>Collection</span><b>${fmtDay(o.slotDate)}, ${o.slotLabel}</b></div>`}
        ${o.address && html`<div class="kv-inline"><span>Address</span><b>${o.address}, ${o.city} ${o.pincode || ''}</b></div>`}
        ${o.note && html`<div class="kv-inline"><span>Note</span><b>${o.note}</b></div>`}
        ${o.lines.length > 0 && html`<div class="lines">${o.lines.map((l) => html`<div class="kv-inline"><span>${l.name}</span><b>₹${l.price}</b></div>`)}<div class="kv-inline"><span><b>Total</b></span><b>₹${o.total}</b></div></div>`}
        ${(o.prescriptions.length > 0 || o.reports.length > 0) && html`<div class="msg-files">${[...o.prescriptions, ...o.reports].map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div>`}
        ${o.actions.includes('assign') && html`<div class="assign-row"><select value=${assignTo} onChange=${(e) => setAssignTo(e.target.value)}><option value="">Send to another lab…</option>
          ${sorted.map((p) => html`<option value=${p.id}>${p.coverage.some((c) => c.area === o.area) ? '★ ' : ''}${p.name} · ${p.city}</option>`)}</select>
          <${Button} size="sm" loading=${busy === 'assign'} onClick=${assign}>Assign</${Button}></div>`}
        ${o.actions.includes('cancel') && html`<div><${Button} size="sm" variant="danger-ghost" icon="x" onClick=${cancel}>Cancel order</${Button}></div>`}
        <details class="timeline" open><summary>Routing history</summary>${o.assignments.map((a) => html`<div class="tl-row"><i class=${'tl-' + a.status}></i><span><b>${a.partner}</b> · ${a.role} · ${a.status}${a.reason ? ` (${a.reason})` : ''}</span><time>${fmtDateTime(a.at)}</time></div>`)}</details>
        <details class="timeline"><summary>Timeline (${o.timeline.length})</summary>${o.timeline.map((t) => html`<div class="tl-row"><i></i><span><b>${t.action.replace('_', ' ')}</b> by ${t.by}${t.note ? ` · ${t.note}` : ''}</span><time>${fmtDateTime(t.at)}</time></div>`)}</details>
      </div>
      <div class="lab-chat"><${ChatThread} path=${`${H}/orders/${id}`} me="admin" canSend=${o.actions.includes('chat')} onActivity=${load} placeholder="Message patient & lab as Queue24 Support…" /></div>
    </div>`}
  </${Modal}>`;
}

function LabPartnerList() {
  const { data, error, loading, reload } = useApi(`${H}/partners`);
  const [q, setQ] = useState('');
  const [pwFor, setPwFor] = useState(null);
  const [edit, setEdit] = useState(null);
  const [created, setCreated] = useState(null);
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const items = data.items.filter((p) => !q || `${p.name} ${p.city} ${p.state} ${p.code} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  async function toggle(p) {
    if (p.active && !(await confirmDialog({ title: `Deactivate ${p.name}?`, message: 'They will be signed out and get no new orders. Areas where they are primary will route to the backup lab.', confirmText: 'Deactivate', danger: true }))) return;
    try { await api(`${H}/partners/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); toast(p.active ? 'Lab deactivated.' : 'Lab activated.'); reload(true); } catch (e) { toast(e.message, 'error'); }
  }
  return html`<div class="stack">
    <div class="toolbar"><div class="search"><${Icon} name="search" size=${17} /><input placeholder="Search lab, city, state, code…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <${Button} icon="plus" onClick=${() => setEdit({})}>Add lab partner</${Button}></div>
    <p class="muted">${plural(data.items.length, 'lab')} · metros have a primary and a backup lab, other states one lab. Partner names are placeholders: rename them to the real labs.</p>
    <div class="partner-grid">${items.map((p) => html`<${HoverCard} key=${p.id} tip=${html`<${TipRows} title=${p.name} rows=${[['Login ID', p.email], ['Lab code', p.code], ['Contact', [p.contactPerson, p.phone].filter(Boolean).join(' · ') || '—'], ['Open orders', p.stats.open], ['Completed', p.stats.completed], ['Accepted / rejected / missed', `${p.stats.accepted} / ${p.stats.rejected} / ${p.stats.expired}`], ['Last login', p.lastLoginAt ? timeAgo(p.lastLoginAt) : 'never']]} />`}>
      <div class=${'partner-card' + (p.active ? '' : ' dim')}>
        <div class="partner-top"><b>${p.name}</b>${!p.active && html`<${Badge} tone="gray">Inactive</${Badge}>`}</div>
        <span class="muted">${p.city}, ${p.state} · ${p.code}</span>
        <div class="row-gap">${p.coverage.map((c) => html`<${Badge} tone=${c.role === 'primary' ? 'green' : 'blue'}>${c.area} · ${c.role}</${Badge}>`)}</div>
        <div class="partner-stats"><span><b>${p.stats.open}</b> open</span><span><b>${p.stats.completed}</b> done</span><span><b>${p.stats.rejected + p.stats.expired}</b> passed on</span></div>
        <div class="partner-actions">
          <button class="icon-btn" title="View login" onClick=${() => setPwFor(p)}><${Icon} name="key" size=${16} /></button>
          <button class="icon-btn" title="Edit" onClick=${() => setEdit(p)}><${Icon} name="edit" size=${16} /></button>
          <button class="link" onClick=${() => toggle(p)}>${p.active ? 'Deactivate' : 'Activate'}</button>
        </div>
      </div></${HoverCard}>`)}</div>
    ${pwFor && html`<${PasswordModal} account=${pwFor} base=${`${H}/partners`} onClose=${() => setPwFor(null)} onChange=${() => reload(true)} />`}
    ${edit && html`<${PartnerEditModal} p=${edit} onClose=${() => setEdit(null)} onSaved=${(r) => { setEdit(null); reload(true); if (r.password) setCreated(r); }} />`}
    <${Modal} open=${Boolean(created)} title="Lab partner added" subtitle="Share these login details with the lab." onClose=${() => setCreated(null)} footer=${html`<${Button} onClick=${() => setCreated(null)}>Done</${Button}>`}>
      ${created && html`<${PasswordReveal} name=${created.partner.name} email=${created.partner.email} password=${created.password} />`}
    </${Modal}>
  </div>`;
}

function PartnerEditModal({ p, onClose, onSaved }) {
  const isNew = !p.id;
  const [f, setF] = useState({ name: p.name || '', email: p.email || '', phone: p.phone || '', contactPerson: p.contactPerson || '', city: p.city || '', state: p.state || '', address: p.address || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { const v = e.target.value; setF((p) => ({ ...p, [k]: v })); };
  async function save() {
    setBusy(true);
    try { const r = await api(isNew ? `${H}/partners` : `${H}/partners/${p.id}`, { method: isNew ? 'POST' : 'PATCH', body: f }); toast(isNew ? 'Lab added.' : 'Saved.'); onSaved(r); }
    catch (e) { toast(e.message, 'error'); setBusy(false); }
  }
  return html`<${Modal} open title=${isNew ? 'Add lab partner' : `Edit ${p.name}`} subtitle=${isNew ? 'A login is created with a generated password. Assign areas in Coverage.' : 'The email is the lab\'s login ID.'} onClose=${onClose}
    footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}><${Button} loading=${busy} onClick=${save}>${isNew ? 'Create lab' : 'Save'}</${Button}>`}>
    <div class="form-grid">
      <${Field} label="Lab name"><input value=${f.name} onInput=${set('name')} placeholder="e.g. City Diagnostics, Lucknow" /></${Field}>
      <div class="form-row"><${Field} label="Email (login ID)"><input type="email" value=${f.email} onInput=${set('email')} /></${Field}><${Field} label="Mobile"><input type="tel" value=${f.phone} onInput=${set('phone')} /></${Field}></div>
      <div class="form-row"><${Field} label="Contact person"><input value=${f.contactPerson} onInput=${set('contactPerson')} /></${Field}><${Field} label="City"><input value=${f.city} onInput=${set('city')} /></${Field}></div>
      <div class="form-row"><${Field} label="State"><input value=${f.state} onInput=${set('state')} /></${Field}><${Field} label="Address" optional><input value=${f.address} onInput=${set('address')} /></${Field}></div>
    </div>
  </${Modal}>`;
}

function LabCoverage() {
  const areas = useApi(`${H}/areas`);
  const partners = useApi(`${H}/partners`);
  const [draft, setDraft] = useState({});
  const [q, setQ] = useState('');
  if ((areas.loading && !areas.data) || (partners.loading && !partners.data)) return html`<${Loading} />`;
  if (areas.error) return html`<${ErrorBox} message=${areas.error} onRetry=${areas.reload} />`;
  const opts = partners.data.items.filter((p) => p.active);
  const val = (a, role) => (draft[a.id] && draft[a.id][role] !== undefined ? draft[a.id][role] : (a[role] ? String(a[role].id) : ''));
  const setVal = (a, role, v) => setDraft({ ...draft, [a.id]: { ...(draft[a.id] || {}), [role]: v } });
  async function save(a) {
    try { await api(`${H}/areas/${a.id}/coverage`, { method: 'PUT', body: { primary: Number(val(a, 'primary')), backup: Number(val(a, 'backup')) || null } }); toast(`${a.name} updated.`); const d = { ...draft }; delete d[a.id]; setDraft(d); areas.reload(true); }
    catch (e) { toast(e.message, 'error'); }
  }
  const list = areas.data.items.filter((a) => !q || `${a.name} ${a.state} ${a.cities.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return html`<div class="stack">
    <div class="toolbar"><div class="search"><${Icon} name="search" size=${17} /><input placeholder="Search area or city…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div></div>
    <p class="muted">New orders go to the <b>primary</b> lab first. If it rejects or doesn't accept in time, the <b>backup</b> gets it.</p>
    <div class="table-wrap"><table class="table cov-table"><thead><tr><th>Area</th><th>Primary lab</th><th>Backup lab</th><th class="num">Open</th><th></th></tr></thead><tbody>
      ${list.map((a) => html`<tr key=${a.id}>
        <td><b>${a.name}</b> ${a.kind === 'metro' ? html`<${Badge} tone="blue">metro</${Badge}>` : ''}<div class="muted small">${a.kind === 'metro' ? a.cities.join(', ') : `Rest of ${a.state}`}</div></td>
        <td><select value=${val(a, 'primary')} onChange=${(e) => setVal(a, 'primary', e.target.value)}>${opts.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select></td>
        <td><select value=${val(a, 'backup')} onChange=${(e) => setVal(a, 'backup', e.target.value)}><option value="">— none —</option>${opts.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select></td>
        <td class="num">${a.openOrders}</td>
        <td>${draft[a.id] && html`<${Button} size="sm" onClick=${() => save(a)}>Save</${Button}>`}</td>
      </tr>`)}</tbody></table></div>
  </div>`;
}

function LabTests() {
  const { data, error, loading, reload } = useApi(`${H}/tests`);
  const [draft, setDraft] = useState({});
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const v = (t, k) => (draft[t.id] && draft[t.id][k] !== undefined ? draft[t.id][k] : t[k]);
  const set = (t, k, x) => setDraft({ ...draft, [t.id]: { ...(draft[t.id] || {}), [k]: x } });
  async function save(t, patch) {
    try { await api(`${H}/tests/${t.id}`, { method: 'PATCH', body: patch || { price: Number(v(t, 'price')), mrp: Number(v(t, 'mrp')) } }); toast(`${t.name} saved.`); const d = { ...draft }; delete d[t.id]; setDraft(d); reload(true); }
    catch (e) { toast(e.message, 'error'); }
  }
  return html`<div class="stack">
    <p class="muted">Prices are what patients pay on /blood-test. Changes apply to new orders only (old orders keep their price).</p>
    <div class="table-wrap"><table class="table tests-table"><thead><tr><th>Test / package</th><th class="num">Price ₹</th><th class="num">MRP ₹</th><th>Popular</th><th>Visible</th><th></th></tr></thead><tbody>
      ${data.items.map((t) => html`<tr key=${t.id} class=${t.active ? '' : 'dim'}>
        <td><b>${t.name}</b><div class="muted small">${t.kind === 'package' ? `Package · ${t.includes.length} tests` : t.sample} · ${t.category}</div></td>
        <td class="num"><input class="num-input" type="number" value=${v(t, 'price')} onInput=${(e) => set(t, 'price', e.target.value)} /></td>
        <td class="num"><input class="num-input" type="number" value=${v(t, 'mrp')} onInput=${(e) => set(t, 'mrp', e.target.value)} /></td>
        <td><input type="checkbox" checked=${t.popular} onChange=${() => save(t, { popular: !t.popular })} /></td>
        <td><input type="checkbox" checked=${t.active} onChange=${() => save(t, { active: !t.active })} /></td>
        <td>${draft[t.id] && html`<${Button} size="sm" onClick=${() => save(t)}>Save</${Button}>`}</td>
      </tr>`)}</tbody></table></div>
  </div>`;
}
