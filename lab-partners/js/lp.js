// Queue24 Lab Partners portal (/lab-partners): accept orders, collect samples, upload reports, chat about prescriptions.
import { html, render, useState, useEffect, useMemo, useRef, api, apiUpload, useRoute, navigate, match, toast, setUnauthorizedHandler, fmtDay, fmtDateTime, timeAgo, plural } from './lib.js';
import { Icon, Button, Loading, ErrorBox, Badge, Empty, Modal, Field, Toasts, Segmented, Stat, confirmDialog, useIsMobile } from './ui.js';
import { ChatThread, FileChip } from './chat.js';

const TONE = { assigned: 'amber', in_review: 'blue', quoted: 'violet', scheduled: 'blue', collected: 'blue', processing: 'blue', report_ready: 'green', completed: 'green', cancelled: 'gray' };
const TABS = [
  { to: '/', bucket: 'new', label: 'New', icon: 'bell', count: 'new' },
  { to: '/active', bucket: 'active', label: 'Active', icon: 'flask', count: 'active' },
  { to: '/done', bucket: 'done', label: 'Completed', icon: 'checkCircle' },
  { to: '/account', label: 'Account', icon: 'user' },
];

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const mins = Math.max(0, Math.round((new Date(until).getTime() - now) / 60000));
  return html`<span class=${'countdown' + (mins <= 10 ? ' hot' : '')}><${Icon} name="clock" size=${13} />${mins > 0 ? `Accept within ${mins} min` : 'Expiring…'}</span>`;
}

function OrderCard({ o }) {
  return html`<a class="lcard" href=${'#/orders/' + o.id}>
    <div class="lcard-top">
      <span class=${'kind ' + o.kind}>${o.kind === 'prescription' ? 'Prescription' : 'Tests'}</span>
      <span class="lcard-no">${o.orderNo}</span>
      <${Badge} tone=${TONE[o.status] || 'gray'} dot>${o.statusLabel}</${Badge}>
    </div>
    <div class="lcard-who"><b>${o.patientName || 'Patient'}</b>${o.age ? html`<span>${o.age} · ${o.gender || ''}</span>` : ''}</div>
    <div class="lcard-meta">
      <span><${Icon} name="pin" size=${13} />${o.city}${o.pincode ? ' ' + o.pincode : ''}</span>
      ${o.slotDate && html`<span><${Icon} name="calendar" size=${13} />${fmtDay(o.slotDate)}, ${o.slotLabel}</span>`}
      ${o.total > 0 && html`<span><b>₹${o.total}</b></span>`}
    </div>
    ${o.items.length > 0 && html`<div class="lcard-items">${o.items.slice(0, 3).join(' · ')}${o.items.length > 3 ? ` +${o.items.length - 3}` : ''}</div>`}
    <div class="lcard-foot">
      ${o.status === 'assigned' && o.offerExpiresAt && html`<${Countdown} until=${o.offerExpiresAt} />`}
      ${o.unread > 0 && html`<span class="unread"><${Icon} name="send" size=${12} />${plural(o.unread, 'new message')}</span>`}
      ${o.partner && o.partner.role === 'backup' && html`<span class="muted small">Backup lab</span>`}
    </div>
  </a>`;
}

function OrdersList({ bucket, counts, reloadCounts }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [kind, setKind] = useState('all');
  const load = () => api(`/orders?bucket=${bucket}${kind !== 'all' ? `&kind=${kind}` : ''}`).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); load(); const t = setInterval(() => { if (document.visibilityState === 'visible') { load(); reloadCounts(); } }, 12000); return () => clearInterval(t); }, [bucket, kind]);
  const title = { new: 'New requests', active: 'Active orders', done: 'Completed & cancelled' }[bucket];
  const hint = { new: 'Accept or reject quickly. Unanswered requests move to the backup lab.', active: 'Collect samples, upload reports and reply to patients.', done: 'Your history.' }[bucket];
  return html`<div class="stack">
    <div class="page-head spread"><div><h1>${title}</h1><p>${hint}</p></div>
      ${bucket !== 'new' && html`<${Segmented} value=${kind} onChange=${setKind} options=${[{ value: 'all', label: 'All' }, { value: 'tests', label: 'Tests' }, { value: 'prescription', label: 'Prescriptions' }]} />`}</div>
    ${err && html`<${ErrorBox} message=${err} onRetry=${load} />`}
    ${!d ? html`<${Loading} />` : d.items.length ? html`<div class="lgrid">${d.items.map((o) => html`<${OrderCard} o=${o} key=${o.id} />`)}</div>`
      : html`<${Empty} icon=${bucket === 'new' ? 'bell' : 'flask'} title=${bucket === 'new' ? 'No new requests right now' : 'Nothing here yet'}>${bucket === 'new' ? 'New orders from patients in your area appear here automatically.' : ''}</${Empty}>`}
  </div>`;
}

function QuoteModal({ o, onClose, onDone }) {
  const [tests, setTests] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/catalog').then((r) => setTests(r.tests)).catch((e) => toast(e.message, 'error')); }, []);
  const list = (tests || []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  const chosen = (tests || []).filter((t) => sel.has(t.id));
  const total = chosen.reduce((a, t) => a + t.price, 0);
  const toggle = (id) => setSel((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  async function send() {
    if (!sel.size) return toast('Select the tests from the prescription.', 'error');
    setBusy(true);
    try { const r = await api(`/orders/${o.id}/quote`, { method: 'POST', body: { items: [...sel], note } }); toast('Test list sent to the patient.'); onDone(r.order); }
    catch (e) { toast(e.message, 'error'); setBusy(false); }
  }
  return html`<${Modal} open size="lg" title="Suggest tests from the prescription" subtitle="The patient sees this list with prices in the chat and confirms the booking." onClose=${onClose}
    footer=${html`<span class="quote-sum">${plural(sel.size, 'test')} · <b>₹${total}</b></span><${Button} variant="ghost" onClick=${onClose}>Cancel</${Button}><${Button} icon="send" loading=${busy} onClick=${send}>Send to patient</${Button}>`}>
    ${o.prescriptions.length > 0 && html`<div class="msg-files" style="margin-bottom:12px">${o.prescriptions.map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div>`}
    <div class="search"><${Icon} name="search" size=${17} /><input placeholder="Search tests…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus /></div>
    <div class="pick-list">${!tests ? html`<${Loading} />` : list.map((t) => html`<label class=${'pick-row' + (sel.has(t.id) ? ' on' : '')} key=${t.id}>
      <input type="checkbox" checked=${sel.has(t.id)} onChange=${() => toggle(t.id)} />
      <span><b>${t.name}</b><small>${t.kind === 'package' ? `Package · ${t.includes.length} tests` : t.sample}${t.fastingHours ? ` · ${t.fastingHours}h fasting` : ''}</small></span><em>₹${t.price}</em></label>`)}</div>
    <${Field} label="Note to patient" optional><textarea rows="2" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="e.g. 12 hours fasting needed for lipid profile"></textarea></${Field}>
  </${Modal}>`;
}

function OrderDetail({ id, reloadCounts }) {
  const [o, setO] = useState(null); const [err, setErr] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState('');
  const repRef = useRef(null);
  const load = () => api(`/orders/${id}`).then((r) => setO(r.order)).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000); return () => clearInterval(t); }, [id]);
  if (err && !o) return html`<${ErrorBox} message=${err} onRetry=${() => navigate('/')} />`;
  if (!o) return html`<${Loading} />`;
  const act = async (action, body, msg) => {
    setBusy(action);
    try {
      const r = await api(`/orders/${id}/${action}`, { method: 'POST', body: body || {} });
      if (msg) toast(msg);
      reloadCounts();
      if (!r.order) { navigate('/'); return; }
      setO(r.order);
    } catch (e) { toast(e.message, 'error'); load(); }
    setBusy('');
  };
  const reject = async () => {
    const r = await confirmDialog({ title: 'Reject this request?', message: 'It will be passed to another partner lab immediately.', confirmText: 'Reject', danger: true, input: { label: 'Reason', required: true, placeholder: 'e.g. No phlebotomist available at this time' } });
    if (r) act('reject', { reason: r.value }, 'Request passed to another lab.');
  };
  async function uploadReport(list) {
    if (!list.length) return;
    setBusy('report');
    const form = new FormData();
    [...list].slice(0, 5).forEach((f) => form.append('files[]', f, f.name));
    try { const r = await apiUpload(`/orders/${id}/report`, form); setO(r.order); toast('Report uploaded. The patient can download it now.'); reloadCounts(); } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }
  const a = o.actions;
  return html`<div class="ldetail">
    <div class="stack">
      <div class="page-head"><button class="icon-btn" onClick=${() => history.length > 1 ? history.back() : navigate('/')} aria-label="Back"><${Icon} name="left" /></button>
        <div><h1>${o.patientName || 'Patient'}</h1><p>${o.orderNo} · ${o.kind === 'prescription' ? 'Prescription request' : 'Test booking'} · ${timeAgo(o.createdAt)}</p></div></div>

      <div class="card"><div class="card-body stack-sm">
        <div class="row-gap"><${Badge} tone=${TONE[o.status] || 'gray'} dot>${o.statusLabel}</${Badge}>${o.status === 'assigned' && o.offerExpiresAt && html`<${Countdown} until=${o.offerExpiresAt} />`}</div>
        ${a.includes('accept') && html`<div class="action-bar">
          <${Button} size="lg" icon="check" loading=${busy === 'accept'} onClick=${() => act('accept', null, 'Accepted. Patient has been notified.')}>Accept</${Button}>
          <${Button} size="lg" variant="danger-ghost" icon="x" onClick=${reject}>Reject</${Button}></div>`}
        ${a.includes('quote') && html`<${Button} icon="flask" onClick=${() => setQuoting(true)}>${o.status === 'quoted' ? 'Update suggested tests' : 'Suggest tests & price'}</${Button}>`}
        ${a.includes('collected') && html`<${Button} size="lg" icon="droplet" loading=${busy === 'collected'} onClick=${() => act('collected', null, 'Marked as collected.')}>Mark sample collected</${Button}>`}
        ${a.includes('processing') && html`<${Button} variant="secondary" icon="flask" loading=${busy === 'processing'} onClick=${() => act('processing', null, 'Marked as testing.')}>Mark testing in lab</${Button}>`}
        ${a.includes('report') && html`<${Button} variant=${o.status === 'report_ready' ? 'secondary' : 'primary'} icon="upload" loading=${busy === 'report'} onClick=${() => repRef.current.click()}>${o.reports.length ? 'Upload another report file' : 'Upload report (PDF / photo)'}</${Button}>`}
        ${a.includes('completed') && html`<${Button} icon="checkCircle" loading=${busy === 'completed'} onClick=${() => act('completed', null, 'Order completed.')}>Mark completed</${Button}>`}
        <input ref=${repRef} type="file" accept="application/pdf,image/*" multiple hidden onChange=${(e) => { uploadReport(e.target.files); e.target.value = ''; }} />

        <div class="kv-list">
          <div><span>Patient</span><b>${o.patientName || '—'}${o.age ? `, ${o.age} · ${o.gender}` : ''}</b></div>
          <div><span>Phone</span><b>${o.status === 'assigned' ? o.phone + ' (shown after you accept)' : html`<a href=${'tel:' + o.phone.replace(/\s/g, '')}>${o.phone}</a>`}</b></div>
          ${o.slotDate && html`<div><span>Collection</span><b>${fmtDay(o.slotDate)}, ${o.slotLabel}</b></div>`}
          <div><span>Address</span><b>${o.address ? html`${o.address}, ${o.city} ${o.pincode || ''} <a class="link" target="_blank" rel="noopener" href=${'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${o.address}, ${o.city} ${o.pincode || ''}`)}>Map</a>` : `${o.city}${o.pincode ? ' ' + o.pincode : ''}${o.status === 'assigned' ? ' (full address after you accept)' : ''}`}</b></div>
          ${o.note && html`<div><span>Patient note</span><b>${o.note}</b></div>`}
        </div>
        ${o.lines.length > 0 && html`<div class="lines">${o.lines.map((l) => html`<div class="sum-row"><span>${l.name}</span><span>₹${l.price}</span></div>`)}
          <div class="sum-row total"><span>Collect from patient</span><b>₹${o.total}</b></div></div>`}
        ${o.prescriptions.length > 0 && html`<div><h4 class="detail-h">Prescription</h4><div class="msg-files">${o.prescriptions.map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div></div>`}
        ${o.reports.length > 0 && html`<div><h4 class="detail-h">Reports uploaded</h4><div class="msg-files">${o.reports.map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div></div>`}
        <details class="timeline"><summary>Timeline (${o.timeline.length})</summary>${o.timeline.map((t) => html`<div class="tl-row"><i></i><span><b>${t.action.replace('_', ' ')}</b>${t.note ? ' · ' + t.note : ''}</span><time>${fmtDateTime(t.at)}</time></div>`)}</details>
      </div></div>
    </div>
    <section class="card chat-card"><div class="card-head"><div><h3>Chat with patient</h3><p>${o.status === 'assigned' ? 'Available after you accept.' : 'Messages are visible to the patient and Queue24 support.'}</p></div></div>
      <${ChatThread} path=${`/orders/${id}`} me="partner" canSend=${a.includes('chat')} lockedText=${o.status === 'assigned' ? 'Accept the request to chat with the patient.' : 'Chat is closed for this order.'} onActivity=${load} placeholder="Reply to patient…" />
    </section>
    ${quoting && html`<${QuoteModal} o=${o} onClose=${() => setQuoting(false)} onDone=${(x) => { setO(x); setQuoting(false); }} />`}
  </div>`;
}

function Account({ user, onLogout }) {
  const [f, setF] = useState({ current: '', next: '' }); const [busy, setBusy] = useState(false);
  async function change() { setBusy(true); try { await api('/auth/change-password', { method: 'POST', body: f }); toast('Password changed.'); setF({ current: '', next: '' }); } catch (e) { toast(e.message, 'error'); } setBusy(false); }
  return html`<div class="stack narrow">
    <div class="page-head"><div><h1>${user.name}</h1><p>${user.code} · ${user.city}, ${user.state}</p></div></div>
    <div class="card"><div class="card-head"><div><h3>Areas you serve</h3><p>Orders from these areas come to you.</p></div></div><div class="card-body"><div class="row-gap">
      ${user.areas.map((a) => html`<${Badge} tone=${a.role === 'primary' ? 'green' : 'blue'}>${a.name} · ${a.role}</${Badge}>`)}</div></div></div>
    <div class="card"><div class="card-head"><div><h3>Change password</h3></div></div><div class="card-body form-grid">
      <${Field} label="Current password"><input type="password" value=${f.current} onInput=${(e) => setF({ ...f, current: e.target.value })} /></${Field}>
      <${Field} label="New password" hint="At least 8 characters"><input type="password" value=${f.next} onInput=${(e) => setF({ ...f, next: e.target.value })} /></${Field}>
      <div><${Button} loading=${busy} onClick=${change}>Update password</${Button}></div></div></div>
    <${Button} variant="ghost" icon="logout" onClick=${onLogout}>Sign out</${Button}>
  </div>`;
}

function Login({ onLogin }) {
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setErr(''); setBusy(true); try { const r = await api('/auth/login', { method: 'POST', body: { identifier: id, password: pw } }); onLogin(r.user); } catch (x) { setErr(x.message); setBusy(false); } }
  return html`<div class="login-page">
    <div class="login-art" aria-hidden="true"><div class="login-art-inner">
      <div class="brand light"><span class="brand-mark">24</span><span class="brand-name">Queue24</span></div>
      <h2>Lab partner<br /><em>portal.</em></h2>
      <ul><li><${Icon} name="bell" size=${18} />New orders from your area, instantly</li><li><${Icon} name="flask" size=${18} />Review prescriptions & suggest tests</li><li><${Icon} name="upload" size=${18} />Upload reports straight to patients</li></ul>
    </div></div>
    <div class="login-panel"><form class="login-card" onSubmit=${submit}>
      <div class="eyebrow"><i class="dot"></i>QUEUE24 LAB PARTNERS</div>
      <h1>Sign in to your lab</h1>
      <p class="muted">Use the login details shared by Queue24.</p>
      <${Field} label="Email, mobile or lab code"><input value=${id} onInput=${(e) => setId(e.target.value)} autocomplete="username" autofocus /></${Field}>
      <${Field} label="Password"><input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="current-password" /></${Field}>
      ${err && html`<div class="form-error"><${Icon} name="alert" size=${16} />${err}</div>`}
      <${Button} type="submit" size="lg" class="btn-block" loading=${busy}>Sign in</${Button}>
    </form></div>
  </div>`;
}

function App() {
  const route = useRoute();
  const [user, setUser] = useState(undefined);
  const [counts, setCounts] = useState({});
  const mobile = useIsMobile(760);
  const reloadCounts = () => api('/dashboard').then((d) => { setCounts(d.counts); document.title = (d.counts.new ? `(${d.counts.new}) ` : '') + 'Queue24 Lab Partners'; }).catch(() => {});
  useEffect(() => { api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)); setUnauthorizedHandler(() => setUser(null)); }, []);
  useEffect(() => { if (user) reloadCounts(); }, [user, route.path]);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); };
  if (user === undefined) return html`<div class="boot"><${Loading} /></div>`;
  if (!user) return html`<${Login} onLogin=${(u) => { setUser(u); navigate('/', { replace: true }); }} /><${Toasts} />`;
  const p = route.path; let page; let m;
  if (p === '/' || p === '') page = html`<${OrdersList} bucket="new" counts=${counts} reloadCounts=${reloadCounts} />`;
  else if (p === '/active') page = html`<${OrdersList} bucket="active" counts=${counts} reloadCounts=${reloadCounts} />`;
  else if (p === '/done') page = html`<${OrdersList} bucket="done" counts=${counts} reloadCounts=${reloadCounts} />`;
  else if ((m = match('/orders/:id', p))) page = html`<${OrderDetail} key=${m.id} id=${m.id} reloadCounts=${reloadCounts} />`;
  else if (p === '/account') page = html`<${Account} user=${user} onLogout=${logout} />`;
  else page = html`<${Empty} icon="alert" title="Page not found" />`;
  const activeTab = TABS.slice().reverse().find((t) => (t.to === '/' ? p === '/' : p.startsWith(t.to)));
  return html`<div class="lp-shell">
    <header class="lp-top">
      <a class="brand" href="#/"><span class="brand-mark">24</span><span class="brand-name">${mobile ? 'Lab' : 'Queue24'} <small>Partners</small></span></a>
      <nav class="lp-nav">${TABS.map((t) => html`<a href=${'#' + t.to} class=${activeTab === t ? 'active' : ''}><${Icon} name=${t.icon} size=${17} /><span>${t.label}</span>${t.count && counts[t.count] > 0 && html`<em class=${t.count === 'new' ? 'hot' : ''}>${counts[t.count]}</em>`}</a>`)}</nav>
      <span class="lp-lab">${user.name}</span>
    </header>
    ${!mobile && (p === '/' || p === '/active') && html`<div class="lp-stats">
      <${Stat} icon="bell" label="New requests" value=${counts.new || 0} tone="amber" onClick=${() => navigate('/')} />
      <${Stat} icon="calendar" label="Collections today" value=${counts.today || 0} tone="blue" onClick=${() => navigate('/active')} />
      <${Stat} icon="flask" label="Prescriptions to review" value=${counts.prescriptions || 0} tone="violet" onClick=${() => navigate('/active')} />
      <${Stat} icon="upload" label="Reports to upload" value=${counts.reportsDue || 0} tone="green" onClick=${() => navigate('/active')} />
    </div>`}
    <main class="lp-main">${page}</main>
    <nav class="lp-tabbar">${TABS.map((t) => html`<a href=${'#' + t.to} class=${activeTab === t ? 'active' : ''}><${Icon} name=${t.icon} size=${21} /><span>${t.label}</span>${t.count && counts[t.count] > 0 && html`<em>${counts[t.count]}</em>`}</a>`)}</nav>
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
