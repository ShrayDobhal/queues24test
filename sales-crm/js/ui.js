// Reusable UI components.
import { html, useState, useEffect, useRef, useToasts, initials, WEEKDAYS, fileUrl, OUTCOMES, fmtDay, fmtTime12, mapsLink, mapsSearch, addMonths, monthLabel, render, copyText } from './lib.js';

// ------------------------------------------------------------------ icons (stroke icons, 24px grid)
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  camera: 'M3 8a2 2 0 0 1 2-2h2.2l1.4-2h6.8l1.4 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  phone: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  calendar: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 3v4M16 3v4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.8 2.8L16.5 9.5',
  x: 'M6 6l12 12M18 6 6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M6 9l6 6 6-6',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  file: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  briefcase: 'M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M3 13h18',
  building: 'M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 9h3a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4z',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.3-1.4M17.7 6.3l1.4-1.4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  print: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  flask: 'M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3M7.5 14h9',
  clip: 'M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9',
  cart: 'M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2M9.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17.5 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  droplet: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z',
  whatsapp: 'M4 20l1.3-3.9A8.5 8.5 0 1 1 8 19zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2z',
};
export function Icon({ name, size = 18, stroke = 1.9, class: cls = '' }) {
  return html`<svg class=${'icon ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name] || ''} /></svg>`;
}

export function Spinner({ size = 18, light }) {
  return html`<span class=${'spinner' + (light ? ' spinner-light' : '')} style=${`width:${size}px;height:${size}px`} role="status" aria-label="Loading"></span>`;
}

export function Loading({ label = 'Loading…' }) {
  return html`<div class="loading-block"><${Spinner} size=${24} /><span>${label}</span></div>`;
}

export function ErrorBox({ message, onRetry }) {
  return html`<div class="error-box"><${Icon} name="alert" /><div><b>Couldn't load this.</b><div>${message}</div></div>
    ${onRetry && html`<button class="btn btn-sm btn-ghost" onClick=${() => onRetry()}><${Icon} name="refresh" size=${15} />Retry</button>`}</div>`;
}

export function Button({ children, variant = 'primary', size, icon, loading, class: cls = '', ...rest }) {
  return html`<button class=${`btn btn-${variant} ${size ? 'btn-' + size : ''} ${cls}`} disabled=${loading || rest.disabled} ...${rest}>
    ${loading ? html`<${Spinner} size=${16} light=${variant === 'primary' || variant === 'danger'} />` : icon && html`<${Icon} name=${icon} size=${size === 'sm' ? 15 : 17} />`}
    ${children}
  </button>`;
}

export function Avatar({ name, size = 38, tone }) {
  const tones = ['green', 'blue', 'amber', 'violet', 'teal', 'rose'];
  const t = tone || tones[[...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];
  return html`<span class=${`avatar tone-${t}`} style=${`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`}>${initials(name)}</span>`;
}

export function Badge({ tone = 'gray', children, dot }) {
  return html`<span class=${`badge tone-${tone}`}>${dot && html`<i class="badge-dot"></i>`}${children}</span>`;
}

export function RedMarks({ count, threshold = 5, compact }) {
  if (!count) return null;
  const hot = count >= threshold;
  return html`<span class=${'redmarks' + (hot ? ' hot' : '')} title=${`${count} red mark${count === 1 ? '' : 's'} this month: working days without a daily report`}>
    <i></i>${compact ? count : `${count} red`}
  </span>`;
}

export function Empty({ icon = 'file', title, children, action }) {
  return html`<div class="empty"><div class="empty-icon"><${Icon} name=${icon} size=${26} /></div>
    <div class="empty-title">${title}</div>${children && html`<div class="empty-text">${children}</div>`}${action}</div>`;
}

export function Stat({ label, value, sub, icon, tone = 'green', onClick, tip }) {
  const card = html`<div class=${'stat' + (onClick ? ' clickable' : '')} onClick=${onClick}>
    <div class=${`stat-icon tone-${tone}`}><${Icon} name=${icon} size=${18} /></div>
    <div class="stat-body"><div class="stat-value">${value}</div><div class="stat-label">${label}</div>${sub && html`<div class="stat-sub">${sub}</div>`}</div>
  </div>`;
  return tip ? html`<${HoverCard} tip=${tip}>${card}</${HoverCard}>` : card;
}

// ------------------------------------------------------------------ hover popup (desktop pointers only)
const canHover = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
/** Wrap any card: shows a floating info popup after a short hover. `tip` = string or html. */
export function HoverCard({ tip, children, wide, class: cls = '' }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const timer = useRef(null);
  const show = () => {
    if (!tip || !canHover()) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = ref.current && ref.current.getBoundingClientRect();
      if (!r) return;
      const w = wide ? 380 : 300;
      const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
      const below = r.bottom + 10 + 220 < window.innerHeight || r.top < 240;
      setPos({ left, top: below ? r.bottom + 10 : r.top - 10, below, w });
    }, 280);
  };
  const hide = () => { clearTimeout(timer.current); setPos(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return html`<div class=${'hovercard-wrap ' + cls} ref=${ref} onMouseEnter=${show} onMouseLeave=${hide} onMouseDown=${hide}>
    ${children}
    ${pos && html`<div class=${'hovercard' + (pos.below ? ' below' : ' above')} role="tooltip" style=${`left:${pos.left}px;top:${pos.top}px;width:${pos.w}px`}>${tip}</div>`}
  </div>`;
}
/** Simple key/value list for hover popups. rows = [[label, value], ...] */
export function TipRows({ title, rows, foot }) {
  return html`<div class="tip">
    ${title && html`<div class="tip-title">${title}</div>`}
    ${rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v]) => html`<div class="tip-row"><span>${k}</span><b>${v}</b></div>`)}
    ${foot && html`<div class="tip-foot">${foot}</div>`}
  </div>`;
}

export function Card({ title, subtitle, action, children, class: cls = '', pad = true }) {
  return html`<section class=${'card ' + cls}>
    ${(title || action) && html`<header class="card-head"><div><h3>${title}</h3>${subtitle && html`<p>${subtitle}</p>`}</div>${action}</header>`}
    <div class=${pad ? 'card-body' : ''}>${children}</div>
  </section>`;
}

export function Toasts() {
  const items = useToasts();
  return html`<div class="toasts" aria-live="polite">${items.map((t) => html`
    <div key=${t.id} class=${'toast toast-' + t.type}><${Icon} name=${t.type === 'error' ? 'alert' : 'checkCircle'} size=${18} /><span>${t.message}</span></div>`)}</div>`;
}

// ------------------------------------------------------------------ modal + confirm
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [open]);
  if (!open) return null;
  return html`<div class="modal-backdrop" onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class=${'modal modal-' + size} role="dialog" aria-modal="true" aria-label=${title}>
      <header class="modal-head"><div><h2>${title}</h2>${subtitle && html`<p>${subtitle}</p>`}</div>
        ${onClose && html`<button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>`}</header>
      <div class="modal-body">${children}</div>
      ${footer && html`<footer class="modal-foot">${footer}</footer>`}
    </div>
  </div>`;
}

/** Promise-based confirm dialog: `if (await confirmDialog({...})) ...` */
export function confirmDialog({ title, message, confirmText = 'Confirm', danger, input }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    function Dlg() {
      const [val, setVal] = useState('');
      const taRef = useRef(null);
      useEffect(() => { if (taRef.current) setTimeout(() => taRef.current && taRef.current.focus(), 30); }, []);
      const done = (v) => { render(null, host); host.remove(); resolve(v); };
      return html`<${Modal} open title=${title} onClose=${() => done(false)} size="sm"
        footer=${html`<${Button} variant="ghost" onClick=${() => done(false)}>Cancel</${Button}>
          <${Button} variant=${danger ? 'danger' : 'primary'} disabled=${input && input.required && !val.trim()} onClick=${() => done(input ? { value: val } : true)}>${confirmText}</${Button}>`}>
        <p class="confirm-msg">${message}</p>
        ${input && html`<label class="field"><span>${input.label}</span>
          <textarea ref=${taRef} rows="2" placeholder=${input.placeholder || ''} value=${val} onInput=${(e) => setVal(e.target.value)}></textarea></label>`}
      </${Modal}>`;
    }
    render(html`<${Dlg} />`, host);
  });
}

// ------------------------------------------------------------------ form fields
export function Field({ label, hint, error, required, children, optional }) {
  return html`<label class=${'field' + (error ? ' has-error' : '')}>
    <span class="field-label">${label}${required && html`<em>*</em>`}${optional && html`<small>Optional</small>`}</span>
    ${children}
    ${error ? html`<span class="field-error">${error}</span>` : hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

export function MonthNav({ month, onChange, max }) {
  const next = addMonths(month, 1);
  return html`<div class="month-nav">
    <button class="icon-btn" onClick=${() => onChange(addMonths(month, -1))} aria-label="Previous month"><${Icon} name="left" /></button>
    <span>${monthLabel(month)}</span>
    <button class="icon-btn" disabled=${max && next > max} onClick=${() => onChange(next)} aria-label="Next month"><${Icon} name="right" /></button>
  </div>`;
}

// ------------------------------------------------------------------ calendar
/**
 * Month calendar grid.
 *  days: [{date, status, present, markedTime, leave, holiday, updates, excused}] (optional)
 *  selectable(date) -> bool, selected: Set, onSelect(date)
 */
export function Calendar({ month, days = [], today, selectable, selected, onSelect, onDayClick, showCounts = true }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);

  return html`<div class=${'cal' + (selectable ? ' pickmode' : '')}>
    <div class="cal-head">${WEEKDAYS.map((w) => html`<span>${w}</span>`)}</div>
    <div class="cal-grid">${cells.map((date, i) => {
      if (!date) return html`<span key=${'e' + i} class="cal-cell empty"></span>`;
      const info = byDate.get(date) || {};
      const can = selectable ? selectable(date, info) : Boolean(onDayClick);
      const isSel = selected && selected.has(date);
      let st = info.status || '';
      if (info.leave && info.leave.status === 'pending' && st !== 'reported') st += ' leave-pending';
      if (info.leave && info.leave.status === 'approved' && st === 'future') st += ' leave';
      const cls = ['cal-cell', st, date === today ? 'today' : '', isSel ? 'selected' : '', can ? 'can' : 'locked',
        info.weekOff ? 'is-weekoff' : '', info.holiday ? 'is-holiday' : ''].join(' ');
      const title = [fmtDay(date), info.holiday, info.leave ? `Leave ${info.leave.status}` : '', info.present ? `Present ${fmtTime12(info.markedTime)}` : '',
        info.updates ? `${info.updates} update(s)` : '', st.includes('red') ? 'Red mark: no report' : '', info.excused !== null && info.excused !== undefined ? 'Excused' : ''].filter(Boolean).join(' · ');
      return html`<button key=${date} type="button" class=${cls} title=${title} disabled=${!can}
        onClick=${() => { if (selectable && onSelect) onSelect(date); else if (onDayClick) onDayClick(date, info); }}>
        <span class="cal-num">${Number(date.slice(8))}</span>
        ${info.present && html`<i class="cal-present" title="Attendance marked"></i>`}
        ${showCounts && info.updates > 0 && html`<span class="cal-count">${info.updates}</span>`}
        ${isSel && html`<span class="cal-check"><${Icon} name="check" size=${12} stroke=${3} /></span>`}
      </button>`;
    })}</div>
  </div>`;
}

export function CalendarLegend({ items }) {
  const all = {
    reported: 'Report submitted', red: 'Red mark (no report)', leave: 'On leave', 'leave-pending': 'Leave pending',
    holiday: 'Holiday', weekoff: 'Weekly off', excused: 'Excused', paused: 'Access paused', present: 'Attendance marked', pending: 'Today', selected: 'Selected',
  };
  return html`<div class="legend">${(items || Object.keys(all)).map((k) => html`<span class="legend-item"><i class=${'lg-' + k}></i>${all[k]}</span>`)}</div>`;
}

// ------------------------------------------------------------------ photos
export function Lightbox({ photos, index, onClose }) {
  const [i, setI] = useState(index || 0);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % photos.length);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + photos.length) % photos.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return html`<div class="lightbox" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <button class="icon-btn lb-close" onClick=${onClose} aria-label="Close"><${Icon} name="x" size=${22} /></button>
    ${photos.length > 1 && html`<button class="icon-btn lb-prev" onClick=${() => setI((i - 1 + photos.length) % photos.length)}><${Icon} name="left" size=${22} /></button>`}
    <img src=${fileUrl(photos[i])} alt="Clinic photo" />
    ${photos.length > 1 && html`<button class="icon-btn lb-next" onClick=${() => setI((i + 1) % photos.length)}><${Icon} name="right" size=${22} /></button>`}
    ${photos.length > 1 && html`<div class="lb-count">${i + 1} / ${photos.length}</div>`}
  </div>`;
}

export function VisitCard({ visit, showEmployee, compact, hover }) {
  const card = html`<${VisitCardInner} visit=${visit} showEmployee=${showEmployee} compact=${compact} />`;
  if (!hover) return card;
  const o = OUTCOMES[visit.outcome];
  return html`<${HoverCard} wide tip=${html`<div class="tip">
      ${visit.photos[0] && html`<img class="tip-photo" src=${fileUrl(visit.photos[0])} alt="" />`}
      <div class="tip-title">${visit.clinicName}</div>
      <div class="tip-row"><span>By</span><b>${visit.employeeName}</b></div>
      <div class="tip-row"><span>When</span><b>${fmtDay(visit.date)}, ${fmtTime12(visit.time)}</b></div>
      ${o && html`<div class="tip-row"><span>Outcome</span><b>${o.label}</b></div>`}
      ${visit.contactPerson && html`<div class="tip-row"><span>Contact</span><b>${visit.contactPerson}</b></div>`}
      <div class="tip-row"><span>Photos</span><b>${visit.photos.length}</b></div>
      ${visit.notes && html`<div class="tip-foot">${visit.notes}</div>`}
    </div>`}>${card}</${HoverCard}>`;
}
function VisitCardInner({ visit, showEmployee, compact }) {
  const [lb, setLb] = useState(null);
  const o = OUTCOMES[visit.outcome];
  return html`<article class=${'visit' + (compact ? ' compact' : '')}>
    <button class="visit-photo" onClick=${() => visit.photos.length && setLb(0)} aria-label="View photos">
      ${visit.photos[0] ? html`<img src=${fileUrl(visit.photos[0])} alt=${visit.clinicName} loading="lazy" />` : html`<${Icon} name="building" size=${26} />`}
      ${visit.photos.length > 1 && html`<span class="visit-photo-count"><${Icon} name="image" size=${12} />${visit.photos.length}</span>`}
    </button>
    <div class="visit-body">
      <div class="visit-top">
        <h4>${visit.clinicName}</h4>
        ${o && html`<${Badge} tone=${o.tone}>${o.label}</${Badge}>`}
      </div>
      <div class="visit-meta">
        ${showEmployee && html`<span class="visit-emp"><${Icon} name="user" size=${13} />${visit.employeeName}</span>`}
        <span><${Icon} name="clock" size=${13} />${fmtDay(visit.date)}, ${fmtTime12(visit.time)}</span>
      </div>
      <div class="visit-line"><${Icon} name="pin" size=${14} /><span>${visit.address}</span></div>
      ${(visit.contactPerson || visit.contactPhone) && html`<div class="visit-line"><${Icon} name="user" size=${14} />
        <span>${visit.contactPerson}${visit.contactPerson && visit.contactPhone ? ' · ' : ''}${visit.contactPhone && html`<a href=${'tel:' + visit.contactPhone}>${visit.contactPhone}</a>`}</span></div>`}
      ${!compact && visit.notes && html`<p class="visit-notes">${visit.notes}</p>`}
      <div class="visit-links">
        ${visit.lat != null ? html`<a href=${mapsLink(visit.lat, visit.lng)} target="_blank" rel="noopener"><${Icon} name="pin" size=${13} />GPS location${visit.accuracy ? ` (±${Math.round(visit.accuracy)}m)` : ''}</a>`
          : html`<a href=${mapsSearch(visit.clinicName + ' ' + visit.address)} target="_blank" rel="noopener"><${Icon} name="search" size=${13} />Find on map</a>`}
      </div>
    </div>
    ${lb !== null && html`<${Lightbox} photos=${visit.photos} index=${lb} onClose=${() => setLb(null)} />`}
  </article>`;
}

export function PasswordReveal({ email, password, name, hideNote, title = 'Queue24 Sales CRM login', url, note }) {
  const [copied, setCopied] = useState(false);
  const text = `${title}\nName: ${name}\nLogin ID: ${email}\nPassword: ${password}\nOpen: ${url || location.origin + location.pathname}`;
  return html`<div class="pw-reveal">
    <div class="pw-row"><span>Login ID</span><b>${email}</b></div>
    <div class="pw-row"><span>Password</span><code>${password}</code></div>
    ${!hideNote && html`<p class="pw-note"><${Icon} name="shield" size=${14} />${note || 'Share this with the employee. You can see it again anytime from Employees (key icon) or their Account tab.'}</p>`}
    <${Button} variant="secondary" icon=${copied ? 'check' : 'copy'} onClick=${async () => { await copyText(text); setCopied(true); }}>
      ${copied ? 'Copied login details' : 'Copy login details'}
    </${Button}>
    <a class="btn btn-ghost" href=${'https://wa.me/?text=' + encodeURIComponent(text)} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${17} />Share on WhatsApp</a>
  </div>`;
}

export function useIsMobile(bp = 900) {
  const [m, setM] = useState(window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return m;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="tablist">${options.map((o) => html`
    <button type="button" role="tab" aria-selected=${value === o.value} class=${value === o.value ? 'active' : ''} onClick=${() => onChange(o.value)}>
      ${o.label}${o.count !== undefined && html`<span class="seg-count">${o.count}</span>`}</button>`)}</div>`;
}

export function useOutsideClose(ref, onClose) {
  useEffect(() => {
    const on = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
}
export { useRef };
