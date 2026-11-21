// Employee (field sales) workspace.
import {
  html, useState, useEffect, useRef, useMemo, api, apiUpload, useApi, navigate, match, toast, fmtDay, fmtDate, fmtTime12,
  greeting, plural, OUTCOMES, LEAVE_TYPES, compressImage, getLocation, addMonths, timeAgo,
} from './lib.js';
import {
  Icon, Button, Loading, ErrorBox, Badge, Empty, Stat, Card, Calendar, CalendarLegend, MonthNav, VisitCard, Field, Avatar,
  confirmDialog, Spinner, useOutsideClose,
} from './ui.js';
import { ChangePasswordForm } from './common.js';

const NAV = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/updates', icon: 'building', label: 'Updates' },
  { to: '/leaves', icon: 'calendar', label: 'Leaves' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export function EmployeeApp({ user, route, onLogout }) {
  const p = route.path;
  let page;
  if (p === '/' || p === '') page = html`<${EmpHome} user=${user} />`;
  else if (p === '/updates/new') page = html`<${NewUpdate} />`;
  else if (p === '/updates') page = html`<${MyUpdates} />`;
  else if (p === '/leaves') page = html`<${Leaves} query=${route.query} />`;
  else if (p === '/attendance') page = html`<${MyTracker} query=${route.query} />`;
  else if (p === '/profile') page = html`<${Profile} user=${user} onLogout=${onLogout} />`;
  else page = html`<${Empty} icon="alert" title="Page not found" action=${html`<${Button} onClick=${() => navigate('/')}>Go home</${Button}>`} />`;
  const active = NAV.slice().reverse().find((n) => (n.to === '/' ? p === '/' : p.startsWith(n.to)));

  return html`<div class="emp-shell">
    <header class="emp-top">
      <a class="brand" href="#/"><span class="brand-mark">24</span><span class="brand-name">Queue24 <small>Sales</small></span></a>
      <nav class="emp-topnav">${NAV.map((n) => html`<a href=${'#' + n.to} class=${active === n ? 'active' : ''}><${Icon} name=${n.icon} size=${17} />${n.label}</a>`)}</nav>
      <${UserMenu} user=${user} onLogout=${onLogout} />
    </header>
    <main class="emp-main">${page}</main>
    <nav class="emp-tabbar">${NAV.map((n) => html`<a href=${'#' + n.to} class=${active === n ? 'active' : ''}><${Icon} name=${n.icon} size=${21} /><span>${n.label}</span></a>`)}</nav>
  </div>`;
}

export function UserMenu({ user, onLogout, profileHref = '#/profile' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClose(ref, () => setOpen(false));
  return html`<div class="user-menu" ref=${ref}>
    <button class="user-btn" onClick=${() => setOpen(!open)} aria-haspopup="menu" aria-expanded=${open}>
      <${Avatar} name=${user.name} size=${34} /><span class="user-btn-name">${user.name.split(' ')[0]}</span><${Icon} name="down" size=${15} />
    </button>
    ${open && html`<div class="menu" role="menu">
      <div class="menu-head"><b>${user.name}</b><span>${user.email}</span></div>
      <a href=${profileHref} onClick=${() => setOpen(false)}><${Icon} name="key" size=${16} />Change password</a>
      <button onClick=${onLogout}><${Icon} name="logout" size=${16} />Sign out</button>
    </div>`}
  </div>`;
}

// ------------------------------------------------------------------ Home / tracker
function EmpHome({ user }) {
  const { data, error, loading, reload } = useApi('/me/dashboard');
  const [marking, setMarking] = useState(false);

  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const { today, summary, recent, pendingLeaves, totals, redThreshold, monthLabel: ml } = data;

  async function markAttendance() {
    setMarking(true);
    let loc = {};
    try { loc = await getLocation(5000); } catch { /* location is optional */ }
    try {
      await api('/me/attendance', { method: 'POST', body: { lat: loc.lat, lng: loc.lng } });
      toast('Attendance marked for today. Have a great day in the field!');
      reload(true);
    } catch (e) { toast(e.message, 'error'); }
    setMarking(false);
  }

  const offDay = today.holiday || today.weekOff;
  const onLeave = today.leaveStatus === 'approved';
  const reported = today.updates > 0;

  return html`<div class="stack">
    <section class="hero">
      <div class="hero-text">
        <div class="eyebrow">${fmtDate(today.date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>${greeting()}, ${user.name.split(' ')[0]}</h1>
        <p>${onLeave ? 'You are on approved leave today. Enjoy your day off.' : offDay ? `Today is ${today.holiday ? today.holiday : 'your weekly off'}. You can still log visits if you're working.` : reported ? `Daily report submitted: ${plural(today.updates, 'clinic update')} today. Keep going!` : 'Mark your attendance and submit at least one clinic update today to complete your daily report.'}</p>
      </div>
      <div class="attendance-box">
        ${today.attendanceMarkedAt
          ? html`<div class="att-done"><span class="att-tick"><${Icon} name="check" size=${26} stroke=${3} /></span>
              <div><b>Present today</b><span>Marked at ${fmtTime12(today.attendanceTime)}</span></div></div>`
          : html`<button class="att-btn" onClick=${markAttendance} disabled=${marking || onLeave}>
              <span class="att-circle">${marking ? html`<${Spinner} size=${26} />` : html`<${Icon} name="check" size=${30} stroke=${2.6} />`}</span>
              <span><b>${onLeave ? 'On leave today' : 'Mark attendance'}</b><small>${onLeave ? 'No attendance needed' : "Tick when you start today's work"}</small></span>
            </button>`}
      </div>
    </section>

    <div class="status-strip">
      <div class=${'status-pill ' + (today.attendanceMarkedAt ? 'ok' : onLeave || offDay ? 'muted' : 'warn')}>
        <${Icon} name=${today.attendanceMarkedAt ? 'checkCircle' : 'clock'} size=${16} />Attendance: ${today.attendanceMarkedAt ? 'Marked' : onLeave ? 'On leave' : 'Not marked'}</div>
      <div class=${'status-pill ' + (reported ? 'ok' : onLeave || offDay ? 'muted' : 'warn')}>
        <${Icon} name=${reported ? 'checkCircle' : 'file'} size=${16} />Daily report: ${reported ? `${today.updates} submitted` : onLeave || offDay ? 'Not required' : 'Pending'}</div>
      ${today.leaveStatus === 'pending' && html`<div class="status-pill muted"><${Icon} name="calendar" size=${16} />Leave request pending</div>`}
    </div>

    <div class="action-tiles">
      <button class="action-tile primary" onClick=${() => navigate('/updates/new')}>
        <span class="tile-icon"><${Icon} name="camera" size=${26} /></span>
        <span class="tile-text"><b>Updates</b><small>Add clinic visit: photo, name, address</small></span>
        <${Icon} name="arrowRight" size=${20} />
      </button>
      <button class="action-tile" onClick=${() => navigate('/leaves')}>
        <span class="tile-icon"><${Icon} name="calendar" size=${26} /></span>
        <span class="tile-text"><b>Leaves</b><small>${pendingLeaves ? `${pendingLeaves} request${pendingLeaves > 1 ? 's' : ''} pending` : 'Pick dates on the calendar and apply'}</small></span>
        <${Icon} name="arrowRight" size=${20} />
      </button>
    </div>

    ${summary.redCount > 0 && html`<div class=${'notice ' + (summary.redCount >= redThreshold ? 'notice-red' : 'notice-amber')}>
      <${Icon} name="alert" size=${20} />
      <div><b>${summary.redCount} red mark${summary.redCount > 1 ? 's' : ''} this month</b>
      <span>No daily report on ${summary.redDates.map((d) => fmtDay(d)).join(', ')}. ${summary.redCount >= redThreshold ? 'Your admin has been notified of inactivity.' : `At ${redThreshold} red marks your admin receives an inactivity report.`}</span></div>
    </div>`}

    <section>
      <div class="section-head"><h2>This month <small>${ml}</small></h2><a href="#/attendance" class="link">Full tracker<${Icon} name="right" size=${15} /></a></div>
      <div class="stats-grid">
        <${Stat} icon="building" label="Clinic updates" value=${summary.updates} sub=${`${plural(summary.reportedDays, 'day')} reported`} />
        <${Stat} icon="checkCircle" label="Days present" value=${summary.presentDays} sub=${summary.workingDaysElapsed >= summary.presentDays && summary.workingDaysElapsed > 0 ? `of ${plural(summary.workingDaysElapsed, 'working day')} so far` : 'this month'} tone="blue" />
        <${Stat} icon="calendar" label="Leave days" value=${summary.leaveDays} sub=${summary.pendingLeaveDates.length ? `${summary.pendingLeaveDates.length} pending` : 'approved'} tone="violet" />
        <${Stat} icon="alert" label="Red marks" value=${summary.redCount} sub=${`limit ${redThreshold} / month`} tone=${summary.redCount ? 'red' : 'gray'} />
      </div>
    </section>

    <section>
      <div class="section-head"><h2>Recent updates <small>${totals.visits} total · ${totals.clinics} clinics</small></h2><a href="#/updates" class="link">See all<${Icon} name="right" size=${15} /></a></div>
      ${recent.length ? html`<div class="visit-list">${recent.map((v) => html`<${VisitCard} key=${v.id} visit=${v} compact />`)}</div>`
        : html`<${Empty} icon="camera" title="No clinic updates yet" action=${html`<${Button} icon="plus" onClick=${() => navigate('/updates/new')}>Add your first update</${Button}>`}>
            Every clinic you visit: click a photo, add the name and address, and submit.</${Empty}>`}
    </section>
  </div>`;
}

// ------------------------------------------------------------------ New clinic update
function NewUpdate() {
  const [photos, setPhotos] = useState([]); // {file, url}
  const [f, setF] = useState({ clinicName: '', address: '', contactPerson: '', contactPhone: '', outcome: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [loc, setLoc] = useState({ state: 'idle' });
  const [progress, setProgress] = useState(null);
  const camRef = useRef(null);
  const galRef = useRef(null);

  const fetchLoc = async () => {
    setLoc({ state: 'loading' });
    try { setLoc({ state: 'ok', ...(await getLocation()) }); } catch (e) { setLoc({ state: 'error', message: e.message }); }
  };
  useEffect(() => { fetchLoc(); return () => photos.forEach((p) => URL.revokeObjectURL(p.url)); }, []);

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (errors[k]) setErrors({ ...errors, [k]: null }); };

  async function addFiles(list) {
    const files = [...list].filter((x) => x.type.startsWith('image/') || /\.(heic|heif)$/i.test(x.name));
    const room = 4 - photos.length;
    if (files.length > room) toast(`You can attach up to 4 photos.`, 'error');
    const next = [];
    for (const file of files.slice(0, room)) {
      const c = await compressImage(file);
      next.push({ file: c, url: URL.createObjectURL(c) });
    }
    setPhotos((p) => [...p, ...next]);
    if (errors.photos) setErrors({ ...errors, photos: null });
  }

  function validate() {
    const e = {};
    if (!photos.length) e.photos = 'Add at least one photo of the clinic.';
    if (f.clinicName.trim().length < 2) e.clinicName = 'Enter the clinic name.';
    if (f.address.trim().length < 5) e.address = 'Enter the full address.';
    if (f.contactPhone.trim() && !/^[+]?[\d\s-]{7,16}$/.test(f.contactPhone.trim())) e.contactPhone = 'Enter a valid phone number.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit(ev) {
    ev.preventDefault();
    if (!validate()) { toast('Please fill the required fields.', 'error'); return; }
    const form = new FormData();
    photos.forEach((p) => form.append('photos[]', p.file, p.file.name || 'photo.jpg'));
    Object.entries(f).forEach(([k, v]) => form.append(k, v.trim()));
    if (loc.state === 'ok') { form.append('lat', loc.lat); form.append('lng', loc.lng); form.append('accuracy', loc.accuracy); }
    setProgress(0);
    try {
      await apiUpload('/me/updates', form, (x) => setProgress(x));
      toast(`Update for ${f.clinicName.trim()} submitted.`);
      navigate('/');
    } catch (e) {
      toast(e.message, 'error');
      setProgress(null);
    }
  }

  return html`<form class="stack narrow" onSubmit=${submit} novalidate>
    <div class="page-head">
      <button type="button" class="icon-btn" onClick=${() => history.length > 1 ? history.back() : navigate('/')} aria-label="Back"><${Icon} name="left" /></button>
      <div><h1>New clinic update</h1><p>Your daily report: one entry per clinic you visit.</p></div>
    </div>

    <${Card} title="Clinic photos" subtitle="Clear photo of the clinic board / entrance (up to 4)">
      <div class="photo-grid">
        ${photos.map((p, i) => html`<div class="photo-thumb" key=${p.url}>
          <img src=${p.url} alt=${'Photo ' + (i + 1)} />
          <button type="button" class="photo-remove" aria-label="Remove photo" onClick=${() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter((_, j) => j !== i)); }}><${Icon} name="x" size=${14} stroke=${2.6} /></button>
        </div>`)}
        ${photos.length < 4 && html`
          <button type="button" class="photo-add primary" onClick=${() => camRef.current.click()}><${Icon} name="camera" size=${24} /><span>Take photo</span></button>
          <button type="button" class="photo-add" onClick=${() => galRef.current.click()}><${Icon} name="image" size=${24} /><span>From gallery</span></button>`}
      </div>
      ${errors.photos && html`<div class="field-error">${errors.photos}</div>`}
      <input ref=${camRef} type="file" accept="image/*" capture="environment" hidden onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref=${galRef} type="file" accept="image/*" multiple hidden onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    </${Card}>

    <${Card} title="Clinic details">
      <div class="form-grid">
        <${Field} label="Clinic name" required error=${errors.clinicName}>
          <input value=${f.clinicName} onInput=${set('clinicName')} placeholder="e.g. Sai Care Clinic" maxlength="120" autocomplete="off" />
        </${Field}>
        <${Field} label="Clinic address" required error=${errors.address}>
          <textarea rows="2" value=${f.address} onInput=${set('address')} placeholder="Shop no., street, area, city" maxlength="500"></textarea>
        </${Field}>
        <div class="geo-row">
          ${loc.state === 'loading' && html`<span class="geo geo-wait"><${Spinner} size=${14} />Getting your GPS location…</span>`}
          ${loc.state === 'ok' && html`<span class="geo geo-ok"><${Icon} name="pin" size=${15} />GPS location attached (±${loc.accuracy}m)</span>`}
          ${loc.state === 'error' && html`<span class="geo geo-err"><${Icon} name="pin" size=${15} />${loc.message} <button type="button" class="link" onClick=${fetchLoc}>Try again</button></span>`}
        </div>
        <div class="form-row">
          <${Field} label="Contact person" optional>
            <input value=${f.contactPerson} onInput=${set('contactPerson')} placeholder="Doctor / staff name" maxlength="80" />
          </${Field}>
          <${Field} label="Phone number" optional error=${errors.contactPhone}>
            <input type="tel" inputmode="tel" value=${f.contactPhone} onInput=${set('contactPhone')} placeholder="98765 43210" maxlength="16" />
          </${Field}>
        </div>
        <${Field} label="Visit outcome" optional>
          <div class="chip-select">${Object.entries(OUTCOMES).map(([k, o]) => html`
            <button type="button" class=${'chip tone-' + o.tone + (f.outcome === k ? ' active' : '')} onClick=${() => setF({ ...f, outcome: f.outcome === k ? '' : k })}>${o.label}</button>`)}</div>
        </${Field}>
        <${Field} label="Notes" optional>
          <textarea rows="3" value=${f.notes} onInput=${set('notes')} placeholder="What was discussed, next steps, best time to call back…" maxlength="1000"></textarea>
        </${Field}>
      </div>
    </${Card}>

    <div class="sticky-submit">
      ${progress !== null && html`<div class="progress"><i style=${`width:${Math.round(progress * 100)}%`}></i></div>`}
      <${Button} type="submit" size="lg" icon="send" loading=${progress !== null} class="btn-block">
        ${progress !== null ? (progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Saving…') : 'Submit update'}
      </${Button}>
    </div>
  </form>`;
}

// ------------------------------------------------------------------ My updates
function MyUpdates() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = async (offset = 0) => {
    setLoading(true); setError(null);
    try {
      const d = await api(`/me/updates?limit=20&offset=${offset}`);
      setItems((x) => (offset ? [...x, ...d.items] : d.items)); setTotal(d.total);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(0); }, []);
  const groups = useMemo(() => {
    const g = [];
    for (const v of items) { const last = g[g.length - 1]; if (last && last.date === v.date) last.items.push(v); else g.push({ date: v.date, items: [v] }); }
    return g;
  }, [items]);

  return html`<div class="stack">
    <div class="page-head spread">
      <div><h1>My clinic updates</h1><p>${plural(total, 'update')} submitted</p></div>
      <${Button} icon="plus" onClick=${() => navigate('/updates/new')}>New update</${Button}>
    </div>
    ${error && html`<${ErrorBox} message=${error} onRetry=${() => load(0)} />`}
    ${!loading && !error && !items.length && html`<${Empty} icon="camera" title="No updates yet" action=${html`<${Button} icon="plus" onClick=${() => navigate('/updates/new')}>Add update</${Button}>`}>Your submitted clinic visits will show up here.</${Empty}>`}
    ${groups.map((g) => html`<section key=${g.date}>
      <div class="day-label">${fmtDate(g.date, { weekday: 'long', day: 'numeric', month: 'long' })}<span>${plural(g.items.length, 'clinic')}</span></div>
      <div class="visit-list">${g.items.map((v) => html`<${VisitCard} key=${v.id} visit=${v} />`)}</div>
    </section>`)}
    ${loading && html`<${Loading} />`}
    ${!loading && items.length < total && html`<${Button} variant="secondary" onClick=${() => load(items.length)}>Load more</${Button}>`}
  </div>`;
}

// ------------------------------------------------------------------ Leaves
function Leaves({ query }) {
  const [month, setMonth] = useState(query.month || null);
  const cal = useApi(`/me/calendar${month ? `?month=${month}` : ''}`);
  const reqs = useApi('/me/leaves');
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('');
  const [type, setType] = useState('casual');
  const [saving, setSaving] = useState(false);

  if ((cal.loading && !cal.data) || (reqs.loading && !reqs.data)) return html`<${Loading} />`;
  if (cal.error && !cal.data) return html`<${ErrorBox} message=${cal.error} onRetry=${cal.reload} />`;
  const { days, today, weeklyOff } = cal.data;
  const curMonth = cal.data.month;

  const selectable = (date, info) => date >= today && !info.holiday && !weeklyOff.includes(new Date(date + 'T00:00:00Z').getUTCDay()) && !info.leave;
  const toggle = (date) => { const s = new Set(selected); s.has(date) ? s.delete(date) : s.add(date); setSelected(s); };
  const sortedSel = [...selected].sort();

  async function apply() {
    if (!selected.size) return toast('Tap the dates you want leave for.', 'error');
    if (reason.trim().length < 3) return toast('Please write the reason for leave.', 'error');
    setSaving(true);
    try {
      await api('/me/leaves', { method: 'POST', body: { dates: sortedSel, reason: reason.trim(), type } });
      toast(`Leave request sent for ${plural(selected.size, 'day')}. Your admin will review it.`);
      setSelected(new Set()); setReason('');
      cal.reload(true); reqs.reload(true);
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }

  async function cancel(r) {
    if (!(await confirmDialog({ title: 'Cancel leave request?', message: `Cancel your ${LEAVE_TYPES[r.type].toLowerCase()} request for ${r.dates.map(fmtDay).join(', ')}?`, confirmText: 'Cancel request', danger: true }))) return;
    try { await api(`/me/leaves/${r.id}`, { method: 'DELETE' }); toast('Leave request cancelled.'); cal.reload(true); reqs.reload(true); } catch (e) { toast(e.message, 'error'); }
  }

  return html`<div class="stack">
    <div class="page-head"><div><h1>Leaves</h1><p>Tap one or more dates on the calendar, add a reason and apply.</p></div></div>
    <div class="two-col">
      <${Card} title="Select dates" action=${html`<${MonthNav} month=${curMonth} onChange=${(m) => { setMonth(m); }} />`}>
        <${Calendar} month=${curMonth} days=${days} today=${today} selectable=${selectable} selected=${selected} onSelect=${toggle} showCounts=${false} />
        <${CalendarLegend} items=${['selected', 'leave', 'leave-pending', 'holiday', 'weekoff', 'present']} />
      </${Card}>
      <${Card} title="Apply for leave" class="apply-card">
        ${sortedSel.length ? html`<div class="sel-dates">${sortedSel.map((d) => html`<span class="sel-date">${fmtDay(d)}<button onClick=${() => toggle(d)} aria-label="Remove"><${Icon} name="x" size=${12} stroke=${2.6} /></button></span>`)}</div>`
          : html`<p class="muted">No dates selected yet. Tap dates on the calendar (today or later).</p>`}
        <div class="form-grid">
          <${Field} label="Leave type">
            <select value=${type} onChange=${(e) => setType(e.target.value)}>${Object.entries(LEAVE_TYPES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
          </${Field}>
          <${Field} label="Reason" required>
            <textarea rows="3" value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder="e.g. Sister's wedding in Lucknow" maxlength="500"></textarea>
          </${Field}>
          <${Button} icon="send" loading=${saving} onClick=${apply} disabled=${!selected.size}>Apply for ${selected.size ? plural(selected.size, 'day') : 'leave'}</${Button}>
        </div>
      </${Card}>
    </div>

    <section>
      <div class="section-head"><h2>My leave requests</h2></div>
      ${reqs.data && reqs.data.items.length ? html`<div class="list-card">${reqs.data.items.map((r) => html`<${LeaveRow} key=${r.id} r=${r} onCancel=${() => cancel(r)} />`)}</div>`
        : html`<${Empty} icon="calendar" title="No leave requests">Requests you apply for will appear here with their status.</${Empty}>`}
    </section>
  </div>`;
}

export function LeaveStatus({ status }) {
  const t = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'gray' }[status];
  return html`<${Badge} tone=${t} dot>${status[0].toUpperCase() + status.slice(1)}</${Badge}>`;
}

function LeaveRow({ r, onCancel }) {
  return html`<div class="leave-row">
    <div class="leave-main">
      <div class="leave-top"><b>${LEAVE_TYPES[r.type] || r.type}</b><span class="muted">· ${plural(r.dates.length, 'day')}</span><${LeaveStatus} status=${r.status} /></div>
      <div class="leave-dates">${r.dates.map((d) => html`<span>${fmtDay(d)}</span>`)}</div>
      <div class="leave-reason">“${r.reason}”</div>
      ${r.adminNote && html`<div class="leave-note"><${Icon} name="user" size=${13} />Admin: ${r.adminNote}</div>`}
      <div class="leave-when">Applied ${timeAgo(r.createdAt)}${r.decidedAt ? ` · ${r.status} ${timeAgo(r.decidedAt)}` : ''}</div>
    </div>
    ${r.status === 'pending' && html`<${Button} variant="ghost" size="sm" onClick=${onCancel}>Cancel</${Button}>`}
  </div>`;
}

// ------------------------------------------------------------------ Tracker (my month calendar)
function MyTracker({ query }) {
  const [month, setMonth] = useState(query.month || null);
  const { data, error, loading, reload } = useApi(`/me/calendar${month ? `?month=${month}` : ''}`);
  if (loading && !data) return html`<${Loading} />`;
  if (error && !data) return html`<${ErrorBox} message=${error} onRetry=${reload} />`;
  const s = data.summary;
  return html`<div class="stack">
    <div class="page-head"><button class="icon-btn" onClick=${() => navigate('/')} aria-label="Back"><${Icon} name="left" /></button>
      <div><h1>My tracker</h1><p>Attendance, daily reports and leaves, day by day.</p></div></div>
    <div class="stats-grid">
      <${Stat} icon="building" label="Clinic updates" value=${s.updates} sub=${`${plural(s.reportedDays, 'day')} reported`} />
      <${Stat} icon="checkCircle" label="Days present" value=${s.presentDays} tone="blue" />
      <${Stat} icon="calendar" label="Leave days" value=${s.leaveDays} tone="violet" />
      <${Stat} icon="alert" label="Red marks" value=${s.redCount} tone=${s.redCount ? 'red' : 'gray'} />
    </div>
    <${Card} title=${data.monthLabel} action=${html`<${MonthNav} month=${data.month} onChange=${setMonth} max=${data.today.slice(0, 7)} />`}>
      <${Calendar} month=${data.month} days=${data.days} today=${data.today} />
      <${CalendarLegend} items=${['reported', 'red', 'leave', 'leave-pending', 'holiday', 'weekoff', 'present']} />
    </${Card}>
    ${s.absentDates.length > 0 && html`<${Card} title="Days without attendance"><div class="leave-dates">${s.absentDates.map((d) => html`<span>${fmtDay(d)}</span>`)}</div></${Card}>`}
  </div>`;
}

// ------------------------------------------------------------------ Profile
function Profile({ user, onLogout }) {
  return html`<div class="stack narrow">
    <div class="profile-card">
      <${Avatar} name=${user.name} size=${64} />
      <div><h1>${user.name}</h1><p>${user.designation || 'Sales team'}${user.territory ? ` · ${user.territory}` : ''}</p></div>
    </div>
    <${Card} title="Account">
      <dl class="kv">
        <dt>Login ID</dt><dd>${user.email}</dd>
        ${user.phone && html`<dt>Phone</dt><dd>${user.phone}</dd>`}
        <dt>Joined</dt><dd>${fmtDate(user.joinedOn)}</dd>
      </dl>
    </${Card}>
    <${Card} title="Change password" subtitle="Use at least 8 characters."><${ChangePasswordForm} /></${Card}>
    <${Button} variant="ghost" icon="logout" onClick=${onLogout}>Sign out</${Button}>
  </div>`;
}
