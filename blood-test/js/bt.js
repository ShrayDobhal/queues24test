// Queue24 Labs — patient app (/blood-test): book blood tests at home, upload prescription, track orders.
import { html, render, useState, useEffect, useMemo, useRef, api, apiUpload, useRoute, navigate, match, toast, setUnauthorizedHandler, fmtDate, fmtDay, timeAgo, plural, compressImage, getLocation } from './lib.js';
import { Icon, Button, Loading, ErrorBox, Badge, Empty, Modal, Field, Toasts, Spinner, confirmDialog } from './ui.js';
import { ChatThread, FileChip } from './chat.js';
import { CAT_ART } from './cat-icons.js';

const CATS = [
  ['all', 'All', 'grid'], ['full-body', 'Full body', 'shield'], ['diabetes', 'Diabetes', 'droplet'], ['thyroid', 'Thyroid', 'target'],
  ['heart', 'Heart', 'chart'], ['vitamins', 'Vitamins', 'sun'], ['liver', 'Liver', 'flask'], ['kidney', 'Kidney', 'flask'],
  ['fever', 'Fever', 'alert'], ['women', 'Women', 'user'], ['hormones', 'Hormones', 'target'], ['blood', 'Blood', 'droplet'], ['infection', 'Infection', 'shield'],
];
const STATUS_TONE = { placed: 'amber', assigned: 'amber', needs_attention: 'amber', in_review: 'blue', quoted: 'violet', scheduled: 'blue', collected: 'blue', processing: 'blue', report_ready: 'green', completed: 'green', cancelled: 'gray' };
const STEPS = ['placed', 'scheduled', 'collected', 'processing', 'report_ready', 'completed'];
const STEP_LABEL = { placed: 'Booked', scheduled: 'Scheduled', collected: 'Collected', processing: 'Testing', report_ready: 'Report', completed: 'Done' };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '');
const off = (t) => (t.mrp > t.price ? Math.round((1 - t.price / t.mrp) * 100) : 0);

// ------------------------------------------------------------------ location from the phone's GPS
const norm = (x) => String(x || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const CITY_ALIAS = { gurgaon: 'gurugram', bangalore: 'bengaluru', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai', poona: 'pune', delhi: 'newdelhi' };
/**
 * GPS → { state, city, other, pincode, geo } matched to our service areas.
 * City/state/pincode come from BigDataCloud's free browser reverse-geocoding (only the coordinates are sent).
 * Returns { geo, error } when the place can't be matched, so the patient can still pick it by hand.
 */
async function detectLocation(areas) {
  const g = await getLocation(15000); // friendly errors: permission denied / not available
  const geo = { lat: g.lat, lng: g.lng, accuracy: g.accuracy, at: Date.now() };
  let place = null;
  try {
    const r = await fetch(`https://api-bdc.io/data/reverse-geocode-client?latitude=${g.lat}&longitude=${g.lng}&localityLanguage=en`);
    if (r.ok) place = await r.json();
  } catch { /* offline or blocked: manual pick */ }
  const pincode = place && /^[1-9]\d{5}$/.test(String(place.postcode || '')) ? String(place.postcode) : '';
  if (!place) return { geo, error: 'Location found, but we could not read the city. Please pick it below.' };
  if (place.countryCode && place.countryCode !== 'IN') return { geo: null, error: 'We collect samples in India only.' };
  const sub = norm(place.principalSubdivision);
  const st = areas.find((a) => norm(a.name) === sub) || areas.find((a) => sub && (sub.includes(norm(a.name)) || norm(a.name).includes(sub)));
  if (!st) return { geo, pincode, error: 'Location found, but please pick your state below.' };
  const names = [place.city, place.locality, ...((place.localityInfo && place.localityInfo.administrative) || []).map((x) => x.name)].filter(Boolean);
  let hit = null;
  for (const n of names) { const k = CITY_ALIAS[norm(n)] || norm(n); hit = st.cities.find((c) => norm(c.name) === k); if (hit) break; }
  const name = place.city || place.locality || '';
  const city = hit ? { city: hit.name, other: false }
    : st.otherAreaId && name ? { city: name, other: true }
    : st.cities.length ? { city: st.cities[0].name, other: false } : { city: name || st.name, other: true };
  return { state: st.name, ...city, pincode, geo };
}
/** Location card used on the booking and prescription pages: one tap GPS, or pick by hand. */
function LocationCard({ cat, loc, onLoc, onLocSet }) {
  if (loc) return html`<button class="loc-banner" onClick=${onLoc}><${Icon} name="pin" size=${18} /><b>${loc.city}, ${loc.state}</b>${loc.geo ? html`<span class="muted small">· GPS</span>` : ''}<span class="link">Change</span></button>`;
  return html`<div class="stack-sm">
    <${GpsButton} areas=${cat.areas} onFound=${(r) => {
      if (r.error) { toast(r.error, 'error'); onLoc(); return; }
      onLocSet({ state: r.state, city: r.city, other: r.other, pincode: r.pincode, geo: r.geo });
      toast(`Location set: ${r.city}, ${r.state}`);
    }} />
    <button type="button" class="link center-link" onClick=${onLoc}>or choose your city yourself</button>
  </div>`;
}
function GpsButton({ areas, onFound, label = 'Use my current location', small }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { onFound(await detectLocation(areas)); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }
  return html`<button type="button" class=${'gps-btn' + (small ? ' small' : '')} onClick=${go} disabled=${busy}>
    ${busy ? html`<${Spinner} size=${16} />` : html`<${Icon} name="pin" size=${16} />`}<span>${busy ? 'Finding your location…' : label}</span></button>`;
}

// ------------------------------------------------------------------ login (mobile + OTP) — promise based, opens when needed
let openLogin = () => Promise.reject(new Error('not ready'));
function LoginHost({ onUser }) {
  const [req, setReq] = useState(null); // {resolve, reject, reason}
  openLogin = (reason, hint = {}) => new Promise((resolve, reject) => setReq({ resolve, reject, reason, hint }));
  if (!req) return null;
  const close = (u) => { setReq(null); u ? req.resolve(u) : req.reject(new Error('cancelled')); };
  return html`<${LoginSheet} reason=${req.reason} hint=${req.hint || {}} onDone=${(u) => { onUser(u); close(u); }} onClose=${() => close(null)} />`;
}
function LoginSheet({ reason, hint, onDone, onClose }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState(hint.phone || '');
  const [code, setCode] = useState('');
  const [name, setName] = useState(hint.name || ''); // filled from the booking form, so nobody types it twice
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function sendOtp(e) {
    e && e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api('/auth/otp', { method: 'POST', body: { phone } }); setInfo(r); setStep('code'); if (r.testCode) setCode(r.testCode); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function verify(e) {
    e && e.preventDefault(); setErr(''); setBusy(true);
    try { const r = await api('/auth/verify', { method: 'POST', body: { phone, code, name } }); toast(`Welcome, ${r.user.name.split(' ')[0]}!`); onDone(r.user); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  return html`<${Modal} open size="sm" title=${step === 'phone' ? 'Verify your mobile number' : 'Enter the code'} subtitle=${reason || 'To book tests and get reports on your phone.'} onClose=${onClose}>
    ${step === 'phone' ? html`<form class="form-grid" onSubmit=${sendOtp}>
        <${Field} label="Mobile number"><div class="phone-input"><span>+91</span><input type="tel" inputmode="numeric" maxlength="11" placeholder="98765 43210" value=${phone} onInput=${(e) => setPhone(e.target.value)} autofocus /></div></${Field}>
        ${err && html`<div class="form-error"><${Icon} name="alert" size=${16} />${err}</div>`}
        <${Button} type="submit" size="lg" class="btn-block" loading=${busy}>Send code</${Button}>
      </form>`
    : html`<form class="form-grid" onSubmit=${verify}>
        ${info && info.testCode && html`<div class="notice notice-amber"><${Icon} name="key" size=${18} /><div><b>Test mode: your code is ${info.testCode}</b><span>SMS isn't connected yet, so the code is shown here.</span></div></div>`}
        <${Field} label=${`6-digit code sent to ${info ? info.phone : phone}`}><input inputmode="numeric" maxlength="6" class="otp-input" value=${code} onInput=${(e) => setCode(e.target.value.replace(/\D/g, ''))} autofocus /></${Field}>
        ${info && info.isNew && html`<${Field} label="Your full name"><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="As on your ID" /></${Field}>`}
        ${err && html`<div class="form-error"><${Icon} name="alert" size=${16} />${err}</div>`}
        <${Button} type="submit" size="lg" class="btn-block" loading=${busy}>Verify & continue</${Button}>
        <button type="button" class="link" onClick=${() => { setStep('phone'); setCode(''); }}>Change number</button>
      </form>`}
  </${Modal}>`;
}

// ------------------------------------------------------------------ location picker
function LocationModal({ areas, value, onSave, onClose }) {
  const [state, setState] = useState(value ? value.state : '');
  const [city, setCity] = useState(value ? value.city : '');
  const [other, setOther] = useState(value && value.other ? value.city : '');
  const [gps, setGps] = useState(value ? { geo: value.geo || null, pincode: value.pincode || '' } : { geo: null, pincode: '' });
  const st = areas.find((a) => a.name === state);
  function found(r) {
    if (r.error) { toast(r.error, 'error'); if (r.state) setState(r.state); setGps({ geo: r.geo || null, pincode: r.pincode || '' }); return; }
    toast(`Location set: ${r.city}, ${r.state}`);
    onSave({ state: r.state, city: r.city, other: r.other, pincode: r.pincode, geo: r.geo });
  }
  const cities = st ? st.cities : [];
  const isOther = city === '__other';
  function save() {
    if (!st) return toast('Select your state.', 'error');
    const c = isOther || !cities.length ? other.trim() : city;
    if (!c || c.length < 2) return toast('Enter your city.', 'error');
    onSave({ state, city: c, other: isOther || !cities.length, pincode: gps.pincode, geo: gps.geo });
  }
  return html`<${Modal} open size="sm" title="Where should we collect the sample?" subtitle="We'll assign a partner lab near you." onClose=${onClose}
    footer=${html`<${Button} onClick=${save}>Save location</${Button}>`}>
    <div class="form-grid">
      <${GpsButton} areas=${areas} onFound=${found} />
      <div class="or-line"><span>or pick it yourself</span></div>
      <${Field} label="State / UT"><select value=${state} onChange=${(e) => { setState(e.target.value); setCity(''); }}>
        <option value="">Select state</option>${areas.map((a) => html`<option value=${a.name}>${a.name}</option>`)}</select></${Field}>
      ${st && cities.length > 0 && html`<${Field} label="City"><div class="chip-select">
        ${cities.map((c) => html`<button type="button" class=${'chip' + (city === c.name ? ' active' : '')} onClick=${() => setCity(c.name)}>${c.name}</button>`)}
        ${st.otherAreaId && html`<button type="button" class=${'chip' + (isOther ? ' active' : '')} onClick=${() => setCity('__other')}>Other city</button>`}
      </div></${Field}>`}
      ${st && (isOther || !cities.length) && html`<${Field} label="City / town"><input value=${other} onInput=${(e) => setOther(e.target.value)} placeholder="e.g. Lucknow" /></${Field}>`}
    </div>
  </${Modal}>`;
}

// ------------------------------------------------------------------ test card + detail
function TestCard({ t, inCart, onToggle, onOpen, onBook }) {
  return html`<article class=${'tcard' + (t.kind === 'package' ? ' pkg' : '')}>
    <button class="tcard-main" onClick=${onOpen}>
      ${t.kind === 'package' && html`<span class="tcard-tag">Package · ${t.includes.length} tests · ${t.parameters} parameters</span>`}
      <h4>${t.name}</h4>
      <div class="tcard-meta">
        <span><${Icon} name="clock" size=${13} />Report in ${t.reportHours} hrs</span>
        ${t.fastingHours ? html`<span><${Icon} name="alert" size=${13} />${t.fastingHours} hrs fasting</span>` : html`<span><${Icon} name="check" size=${13} />No fasting</span>`}
        ${t.kind === 'test' && t.parameters > 1 && html`<span>${t.parameters} parameters</span>`}
      </div>
    </button>
    <div class="tcard-foot">
      <div class="price"><b>₹${t.price}</b>${t.mrp > t.price && html`<s>₹${t.mrp}</s><em>${off(t)}% off</em>`}</div>
      ${inCart
        ? html`<div class="tcard-actions"><button class="icon-btn sm" onClick=${onToggle} aria-label="Remove from cart" title="Remove from cart"><${Icon} name="x" size=${15} stroke=${2.4} /></button>
            <button class="btn btn-sm btn-primary" onClick=${onBook}>Book now</button></div>`
        : html`<button class="btn btn-sm btn-secondary add-btn" onClick=${onToggle}><${Icon} name="plus" size=${15} />Add</button>`}
    </div>
  </article>`;
}
function TestDetail({ t, inCart, onToggle, onClose, onBook }) {
  return html`<${Modal} open title=${t.name} subtitle=${t.kind === 'package' ? `Package · ${t.parameters} parameters` : `${t.sample} test`} onClose=${onClose}
    footer=${html`<div class="price big"><b>₹${t.price}</b>${t.mrp > t.price && html`<s>₹${t.mrp}</s><em>${off(t)}% off</em>`}</div>
      ${inCart ? html`<div class="row-gap"><${Button} variant="secondary" onClick=${onToggle}>Remove</${Button}><${Button} icon="arrowRight" onClick=${onBook}>Book now</${Button}></div>`
        : html`<${Button} icon="cart" onClick=${onToggle}>Add to cart</${Button}>`}`}>
    <p class="detail-desc">${t.description}</p>
    <div class="facts">
      <div><${Icon} name="droplet" size=${18} /><span>Sample</span><b>${t.sample}</b></div>
      <div><${Icon} name="alert" size=${18} /><span>Preparation</span><b>${t.fastingHours ? `${t.fastingHours} hours fasting` : 'No fasting needed'}</b></div>
      <div><${Icon} name="clock" size=${18} /><span>Report</span><b>Within ${t.reportHours} hours</b></div>
    </div>
    ${t.includes.length > 0 && html`<h4 class="detail-h">Includes ${t.includes.length} tests</h4><ul class="incl">${t.includes.map((n) => html`<li><${Icon} name="check" size=${14} />${n}</li>`)}</ul>`}
  </${Modal}>`;
}

// ------------------------------------------------------------------ home
function Home({ cat, tests, cart, toggle, loc, onLoc }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [open, setOpen] = useState(null);
  const list = useMemo(() => tests.filter((t) => (category === 'all' || t.category === category) && (!q || (t.name + ' ' + t.includes.join(' ')).toLowerCase().includes(q.toLowerCase()))), [tests, q, category]);
  const packages = list.filter((t) => t.kind === 'package');
  const singles = list.filter((t) => t.kind === 'test');
  const filtering = q || category !== 'all';
  return html`<div class="stack">
    <section class="bt-hero">
      <div class="bt-hero-text">
        <span class="eyebrow"><i class="dot"></i>Queue24 Labs</span>
        <h1>Blood tests at home,<br /><em>reports on your phone.</em></h1>
        <div class="trust">
          <span><${Icon} name="shield" size=${15} />Certified partner labs</span>
          <span><${Icon} name="droplet" size=${15} />Home sample collection</span>
          <span><${Icon} name="file" size=${15} />Digital reports</span>
        </div>
      </div>
      <button class="rx-card" onClick=${() => navigate('/rx')}>
        <span class="rx-icon"><${Icon} name="upload" size=${24} /></span>
        <span><b>Upload prescription</b><small>Send a photo of your doctor's slip. A lab replies with the tests & price in chat.</small></span>
        <${Icon} name="arrowRight" size=${20} />
      </button>
    </section>

    <div class="search big"><${Icon} name="search" size=${19} /><input placeholder="Search tests e.g. thyroid, CBC, vitamin D" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    <div class="cats">${CATS.map(([k, label, icon]) => html`<button class=${'cat' + (category === k ? ' active' : '')} onClick=${() => setCategory(k)} aria-pressed=${category === k}>
      <span style=${CAT_ART[k] ? `background:${CAT_ART[k].bg}` : ''}>${CAT_ART[k] ? CAT_ART[k].art : html`<${Icon} name=${icon} size=${18} />`}</span>${label}</button>`)}</div>

    ${!filtering && html`<button class="loc-banner" onClick=${onLoc}><${Icon} name="pin" size=${18} />${loc ? html`Sample collection in <b>${loc.city}, ${loc.state}</b>` : html`<b>Select your city</b> to see availability`}<span class="link">Change</span></button>`}

    ${packages.length > 0 && html`<section>
      <div class="section-head"><h2>${filtering ? 'Packages' : 'Popular health packages'}</h2></div>
      <div class=${filtering ? 'tgrid' : 'hscroll'}>${packages.map((t) => html`<${TestCard} key=${t.id} t=${t} inCart=${cart.includes(t.id)} onToggle=${() => toggle(t.id)} onOpen=${() => setOpen(t)} onBook=${() => navigate('/cart')} />`)}</div>
    </section>`}
    <section>
      <div class="section-head"><h2>${filtering ? `${plural(singles.length, 'test')}` : 'Book individual tests'}</h2></div>
      ${singles.length ? html`<div class="tgrid">${singles.map((t) => html`<${TestCard} key=${t.id} t=${t} inCart=${cart.includes(t.id)} onToggle=${() => toggle(t.id)} onOpen=${() => setOpen(t)} onBook=${() => navigate('/cart')} />`)}</div>`
        : !packages.length && html`<${Empty} icon="search" title="No tests found" action=${html`<${Button} variant="secondary" icon="upload" onClick=${() => navigate('/rx')}>Upload prescription instead</${Button}>`}>Try another name, or upload your prescription and the lab will tell you what to book.</${Empty}>`}
    </section>
    ${open && html`<${TestDetail} t=${open} inCart=${cart.includes(open.id)} onToggle=${() => toggle(open.id)} onClose=${() => setOpen(null)} onBook=${() => { setOpen(null); navigate('/cart'); }} />`}
  </div>`;
}

// ------------------------------------------------------------------ booking form pieces (used by checkout and "confirm quote")
function nextDays(n) {
  const out = []; const d = new Date();
  for (let i = 0; i < n; i++) { const x = new Date(d); x.setDate(d.getDate() + i); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
  return out;
}
function BookingFields({ cat, f, setF, user, onPlace }) {
  const days = nextDays(7);
  const hourNow = new Date().getHours();
  // functional updates: phone autofill fills several fields at once
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };
  const setM = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, member: { ...x.member, [k]: v } })); };
  return html`<div class="form-grid">
    <div class="form-row">
      <${Field} label="Patient name"><input value=${f.member.name} onInput=${setM('name')} placeholder="Full name" /></${Field}>
      <div class="form-row tight">
        <${Field} label="Age"><input type="number" inputmode="numeric" min="1" max="120" value=${f.member.age} onInput=${setM('age')} /></${Field}>
        <${Field} label="Gender"><select value=${f.member.gender} onChange=${setM('gender')}><option value="">Select</option>${Object.entries(cat.genders).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></${Field}>
      </div>
    </div>
    <${Field} label="Collection address"><textarea rows="2" value=${f.address} onInput=${set('address')} placeholder="House / flat no., building, street, area"></textarea></${Field}>
    <div class="geo-attach">${f.geo
      ? html`<span class="geo-ok"><${Icon} name="pin" size=${15} />Exact location shared with the collection team${f.geo.accuracy ? ` (±${f.geo.accuracy} m)` : ''}</span><button type="button" class="link" onClick=${() => setF((x) => ({ ...x, geo: null }))}>Remove</button>`
      : html`<${GpsButton} small areas=${cat.areas} label="Share my exact location (helps the collection team)" onFound=${(r) => {
          if (!r.geo) { toast(r.error || 'Could not get your location.', 'error'); return; }
          setF((x) => ({ ...x, geo: r.geo, pincode: x.pincode || r.pincode || '' }));
          if (onPlace) onPlace(r);
          toast(r.pincode ? 'Location added. Pincode filled in.' : 'Location added.');
        }} />`}</div>
    <div class="form-row">
      <${Field} label="Pincode"><input inputmode="numeric" maxlength="6" value=${f.pincode} onInput=${(e) => { const v = e.target.value.replace(/\D/g, ''); setF((x) => ({ ...x, pincode: v })); }} placeholder="6 digits" /></${Field}>
      <${Field} label="Phone for the collection team" optional><input type="tel" value=${f.contactPhone} onInput=${set('contactPhone')} placeholder=${user ? user.phone : 'Your mobile'} /></${Field}>
    </div>
    <${Field} label="Collection date"><div class="day-chips">${days.map((d, i) => html`<button type="button" class=${'day-chip' + (f.slotDate === d ? ' active' : '')} onClick=${() => setF({ ...f, slotDate: d, slotWindow: '' })}>
      <small>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(d, { weekday: 'short' })}</small><b>${Number(d.slice(8))}</b><small>${fmtDate(d, { month: 'short' })}</small></button>`)}</div></${Field}>
    <${Field} label="Time slot"><div class="chip-select">${Object.entries(cat.slots).map(([k, v]) => {
      const disabled = f.slotDate === days[0] && Number(k.slice(0, 2)) < hourNow + 2;
      return html`<button type="button" disabled=${disabled} class=${'chip' + (f.slotWindow === k ? ' active' : '') + (disabled ? ' off' : '')} onClick=${() => setF({ ...f, slotWindow: k })}>${v}</button>`;
    })}</div></${Field}>
  </div>`;
}
/** Everything the booking needs, checked at once (the server checks again). */
function bookingProblems(f, cat) {
  const out = [];
  const today = nextDays(1)[0];
  if (String(f.member.name || '').trim().length < 2) out.push("patient's name");
  const age = Number(f.member.age); if (!age || age < 1 || age > 120) out.push('age');
  if (!f.member.gender) out.push('gender');
  if (String(f.address || '').trim().length < 10) out.push('full address (house no., street, area)');
  if (!/^[1-9]\d{5}$/.test(f.pincode || '')) out.push('6-digit pincode');
  if (!f.slotDate) out.push('collection date');
  if (!f.slotWindow || !cat.slots[f.slotWindow]) out.push('time slot');
  else if (f.slotDate === today && Number(f.slotWindow.slice(0, 2)) < new Date().getHours() + 2) out.push('a later time slot (that one has passed today)');
  if (f.contactPhone && !/^(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(f.contactPhone.trim())) out.push('a valid 10-digit phone (or leave it empty)');
  return out;
}
function blankBooking(user) {
  const saved = store.get('q24bt_booking', null);
  return saved || { member: { name: user ? user.name : '', age: '', gender: '' }, address: '', pincode: '', contactPhone: '', slotDate: nextDays(2)[1], slotWindow: '' };
}

// ------------------------------------------------------------------ cart / checkout
function Checkout({ cat, cart, toggle, clearCart, user, loc, onLoc, onLocSet, ensureUser }) {
  const items = cat.tests.filter((t) => cart.includes(t.id));
  const [f, setF] = useState(() => blankBooking(user));
  const [busy, setBusy] = useState(false);
  const ref = useRef(store.get('q24bt_ref', '') || rid());
  useEffect(() => { store.set('q24bt_ref', ref.current); }, []);
  useEffect(() => { if (user && !f.member.name) setF((x) => ({ ...x, member: { ...x.member, name: user.name } })); }, [user]);
  useEffect(() => { if (loc && loc.geo && Date.now() - (loc.geo.at || 0) < 6 * 3600e3) setF((x) => ({ ...x, geo: x.geo || loc.geo, pincode: x.pincode || loc.pincode || '' })); }, [loc]);
  const total = items.reduce((a, t) => a + t.price, 0);
  const mrp = items.reduce((a, t) => a + t.mrp, 0);
  const fasting = Math.max(0, ...items.map((t) => t.fastingHours));

  async function place() {
    const missing = bookingProblems(f, cat);
    if (!loc) missing.unshift('your city');
    if (missing.length) { toast(`Please add: ${missing.join(', ')}.`, 'error'); document.querySelector('.checkout .card:nth-of-type(2), .checkout section.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!loc) onLoc(); return; }
    let u = user;
    try { u = await ensureUser('Verify your number to confirm the booking.', { name: f.member.name.trim(), phone: String(f.contactPhone || '').replace(/\D/g, '').slice(-10) }); } catch { return; }
    setBusy(true);
    try {
      const body = { clientRef: ref.current, items: items.map((t) => t.id), state: loc.state, city: loc.city, ...f, member: { ...f.member, age: Number(f.member.age) || null } };
      const r = await api('/orders', { method: 'POST', body });
      store.set('q24bt_booking', { ...f, geo: null, slotDate: '', slotWindow: '' });
      store.set('q24bt_ref', '');
      clearCart();
      toast(`Booked! Order ${r.order.orderNo}`);
      navigate(`/orders/${r.order.id}`);
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }

  if (!items.length) return html`<${Empty} icon="cart" title="Your cart is empty" action=${html`<${Button} onClick=${() => navigate('/')}>Browse tests</${Button}>`}>Add tests or a health package, or upload a prescription.</${Empty}>`;
  return html`<div class="checkout">
    <div class="stack">
      <div class="page-head"><button class="icon-btn" onClick=${() => navigate('/')} aria-label="Back"><${Icon} name="left" /></button><div><h1>Book home collection</h1><p>${plural(items.length, 'test')} · free home sample collection</p></div></div>
      <section class="card"><div class="card-body">
        ${items.map((t) => html`<div class="cart-row" key=${t.id}><div><b>${t.name}</b><small>${t.kind === 'package' ? `${t.includes.length} tests, ${t.parameters} parameters` : t.sample} · report in ${t.reportHours} hrs</small></div>
          <div class="price"><b>₹${t.price}</b>${t.mrp > t.price && html`<s>₹${t.mrp}</s>`}</div><button class="icon-btn" onClick=${() => toggle(t.id)} aria-label="Remove"><${Icon} name="trash" size=${16} /></button></div>`)}
        ${fasting > 0 && html`<div class="notice notice-amber" style="margin-top:12px"><${Icon} name="alert" size=${18} /><div><b>${fasting} hours fasting needed</b><span>Only water is allowed before the sample is taken. Pick a morning slot.</span></div></div>`}
      </div></section>
      <section class="card"><div class="card-head"><div><h3>Location</h3></div></div><div class="card-body">
        <${LocationCard} cat=${cat} loc=${loc} onLoc=${onLoc} onLocSet=${onLocSet} />
      </div></section>
      <section class="card"><div class="card-head"><div><h3>Patient, address & slot</h3></div></div><div class="card-body"><${BookingFields} cat=${cat} f=${f} setF=${setF} user=${user} onPlace=${(r) => { if (!loc && r.state) onLocSet({ state: r.state, city: r.city, other: r.other, pincode: r.pincode, geo: r.geo }); }} /></div></section>
    </div>
    <aside class="summary card"><div class="card-body">
      <h3>Booking summary</h3>
      <div class="sum-row"><span>${plural(items.length, 'test')} (MRP)</span><span>₹${mrp}</span></div>
      ${mrp > total && html`<div class="sum-row save"><span>Discount</span><span>−₹${mrp - total}</span></div>`}
      <div class="sum-row"><span>Home sample collection</span><span class="save-text">Free</span></div>
      <div class="sum-row total"><span>Total</span><b>₹${total}</b></div>
      <div class="pay-note"><${Icon} name="shield" size=${15} />A certified partner lab collects the sample at your address.</div>
      <${Button} size="lg" class="btn-block" icon="arrowRight" loading=${busy} onClick=${place}>Book now</${Button}>
      ${!user && html`<p class="book-hint">We'll verify your mobile number in the next step.</p>`}
    </div></aside>
  </div>`;
}

// ------------------------------------------------------------------ prescription upload (chat style)
function RxStart({ cat, user, loc, onLoc, onLocSet, ensureUser }) {
  const [files, setFiles] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const camRef = useRef(null); const galRef = useRef(null);
  const ref = useRef(rid());
  async function add(list) {
    const arr = [];
    for (const f of [...list].slice(0, 5 - files.length)) arr.push(f.type === 'application/pdf' ? f : await compressImage(f, 2200, 0.88)); // also shrinks HEIC / untyped phone photos
    setFiles((x) => [...x, ...arr.map((f) => ({ f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null }))]);
  }
  async function send() {
    if (!files.length) return toast('Attach a photo or PDF of the prescription.', 'error');
    if (!loc) { onLoc(); return toast('Select your city so we can find a lab near you.', 'error'); }
    try { await ensureUser('Verify your number so the lab can reply to you.'); } catch { return; }
    setBusy(true);
    const form = new FormData();
    form.append('clientRef', ref.current); form.append('state', loc.state); form.append('city', loc.city); form.append('note', note.trim());
    if (loc.geo) { form.append('lat', loc.geo.lat); form.append('lng', loc.geo.lng); if (loc.geo.accuracy) form.append('accuracy', loc.geo.accuracy); }
    files.forEach(({ f }) => form.append('files[]', f, f.name || 'prescription.jpg'));
    try {
      const r = await apiUpload('/prescriptions', form);
      toast(r.order && r.order.partner ? `Prescription sent to ${r.order.partner.name}.` : 'Prescription received. We are finding a lab near you.');
      navigate(`/orders/${r.order.id}`);
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  }
  return html`<div class="rx-page">
    <div class="page-head"><button class="icon-btn" onClick=${() => navigate('/')} aria-label="Back"><${Icon} name="left" /></button><div><h1>Upload prescription</h1><p>A certified lab near you replies with the tests and price.</p></div></div>
    <div class="chat rx-chat">
      <div class="chat-scroll">
        <div class="msg theirs from-system"><div class="msg-name">Queue24 Labs</div><div class="msg-bubble"><p>Hi${user ? ' ' + user.name.split(' ')[0] : ''}! 👋 Send a clear photo of your prescription (all pages). You can also add a note like "need report by tomorrow".</p></div></div>
        <div class="msg theirs from-system"><div class="msg-bubble"><p>We'll share it only with the partner lab serving <b>${loc ? loc.city : 'your city'}</b>. They will reply here with the tests and total price. You confirm before anything is booked.</p></div></div>
        ${files.length > 0 && html`<div class="msg mine"><div class="msg-bubble"><div class="rx-thumbs">${files.map((x, i) => html`<div class="rx-thumb" key=${i}>${x.url ? html`<img src=${x.url} alt="" />` : html`<span class="file-pdf"><${Icon} name="file" size=${22} /></span>`}<small>${x.f.name}</small>
          <button onClick=${() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><${Icon} name="x" size=${12} stroke=${2.6} /></button></div>`)}</div>${note && html`<p>${note}</p>`}</div></div>`}
      </div>
      <div class="chat-compose">
        <div class="rx-pick">
          <button class="photo-add primary" onClick=${() => camRef.current.click()}><${Icon} name="camera" size=${22} /><span>Take photo</span></button>
          <button class="photo-add" onClick=${() => galRef.current.click()}><${Icon} name="image" size=${22} /><span>Gallery / PDF</span></button>
          <button class="photo-add" onClick=${onLoc}><${Icon} name="pin" size=${22} /><span>${loc ? loc.city : 'Set city'}</span></button>
        </div>
        <div class="chat-row">
          <textarea rows="1" placeholder="Add a note (optional)" value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
          <button class="chat-send" onClick=${send} disabled=${busy || !files.length} aria-label="Send">${busy ? html`<${Spinner} size=${18} light />` : html`<${Icon} name="send" size=${18} />`}</button>
        </div>
        <input ref=${camRef} type="file" accept="image/*" capture="environment" hidden onChange=${(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref=${galRef} type="file" accept="image/*,application/pdf" multiple hidden onChange=${(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ orders
function StatusBadge({ o }) { return html`<${Badge} tone=${STATUS_TONE[o.status] || 'gray'} dot>${o.statusLabel}</${Badge}>`; }
function Orders() {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const load = () => api('/orders').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000); return () => clearInterval(t); }, []);
  if (err && !d) return html`<${ErrorBox} message=${err} onRetry=${load} />`;
  if (!d) return html`<${Loading} />`;
  return html`<div class="stack">
    <div class="page-head spread"><div><h1>My orders</h1><p>Bookings and prescription requests</p></div><${Button} variant="secondary" icon="upload" onClick=${() => navigate('/rx')}>Upload prescription</${Button}></div>
    ${d.items.length ? html`<div class="olist">${d.items.map((o) => html`<a class="ocard" href=${'#/orders/' + o.id} key=${o.id}>
      <div class="ocard-top"><span class="ocard-no">${o.kind === 'prescription' ? 'Prescription' : 'Tests'} · ${o.orderNo}</span><${StatusBadge} o=${o} /></div>
      <b class="ocard-title">${o.items.length ? o.items.slice(0, 2).join(', ') + (o.items.length > 2 ? ` +${o.items.length - 2} more` : '') : 'Waiting for the lab to suggest tests'}</b>
      <div class="ocard-meta">${o.slotDate && html`<span><${Icon} name="calendar" size=${13} />${fmtDay(o.slotDate)}, ${o.slotLabel}</span>`}<span><${Icon} name="pin" size=${13} />${o.city}</span>${o.total > 0 && html`<span>₹${o.total}</span>`}</div>
      ${o.lastMessage && html`<div class="ocard-last">${o.unread > 0 && html`<em>${o.unread}</em>`}<span>${o.lastMessage.text}</span><small>${timeAgo(o.lastMessage.at)}</small></div>`}
    </a>`)}</div>` : html`<${Empty} icon="flask" title="No orders yet" action=${html`<${Button} onClick=${() => navigate('/')}>Book a test</${Button}>`}>Your bookings and reports will appear here.</${Empty}>`}
  </div>`;
}

function Stepper({ o }) {
  if (o.status === 'cancelled') return html`<div class="notice notice-amber"><${Icon} name="x" size=${18} /><div><b>Order cancelled</b>${o.cancelReason && html`<span>${o.cancelReason}</span>`}</div></div>`;
  const idx = Math.max(0, STEPS.indexOf(['assigned', 'in_review', 'quoted', 'needs_attention'].includes(o.status) ? 'placed' : o.status));
  return html`<div class="stepper">${STEPS.map((s, i) => html`<div class=${'step' + (i < idx ? ' done' : i === idx ? ' now' : '')}><i>${i < idx ? html`<${Icon} name="check" size=${12} stroke=${3} />` : i + 1}</i><span>${STEP_LABEL[s]}</span></div>`)}</div>`;
}

function OrderDetail({ id, cat, user }) {
  const [o, setO] = useState(null); const [err, setErr] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const load = () => api(`/orders/${id}`).then((r) => setO(r.order)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err && !o) return html`<${ErrorBox} message=${err} onRetry=${load} />`;
  if (!o) return html`<${Loading} />`;
  async function cancel() {
    const r = await confirmDialog({ title: 'Cancel this order?', message: 'The lab will be informed. You can book again anytime.', confirmText: 'Cancel order', danger: true, input: { label: 'Reason (optional)' } });
    if (!r) return;
    try { const x = await api(`/orders/${id}/cancel`, { method: 'POST', body: { reason: r.value } }); setO(x.order); toast('Order cancelled.'); } catch (e) { toast(e.message, 'error'); }
  }
  return html`<div class="odetail">
    <div class="stack">
      <div class="page-head"><button class="icon-btn" onClick=${() => navigate('/orders')} aria-label="Back"><${Icon} name="left" /></button>
        <div><h1>${o.kind === 'prescription' ? 'Prescription request' : 'Test booking'}</h1><p>${o.orderNo} · placed ${timeAgo(o.createdAt)}</p></div></div>
      <div class="card"><div class="card-body stack-sm">
        <div class="row-gap"><${StatusBadge} o=${o} />${o.partner && html`<span class="muted">Lab: <b>${o.partner.name}</b></span>`}</div>
        <${Stepper} o=${o} />
        ${o.status === 'quoted' && html`<div class="notice notice-green"><${Icon} name="flask" size=${20} /><div><b>The lab suggested ${plural(o.lines.length, 'test')} for ₹${o.total}</b><span>Review the list in the chat and book a collection slot.</span></div><${Button} size="sm" onClick=${() => setConfirming(true)}>Review & book</${Button}></div>`}
        ${o.reports.length > 0 && html`<div class="reports"><h4>Your report</h4><div class="msg-files">${o.reports.map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div></div>`}
        ${o.slotDate && html`<div class="kv-inline"><span>Collection</span><b>${fmtDay(o.slotDate)}, ${o.slotLabel}</b></div>`}
        ${o.address && html`<div class="kv-inline"><span>Address</span><b>${o.address}, ${o.city} ${o.pincode || ''}</b></div>`}
        ${o.patientName && o.age && html`<div class="kv-inline"><span>Patient</span><b>${o.patientName}, ${o.age} ${o.gender ? '· ' + o.gender : ''}</b></div>`}
        ${o.lines.length > 0 && html`<div class="lines">${o.lines.map((l) => html`<div class="sum-row"><span>${l.name}</span><span>₹${l.price}</span></div>`)}
          <div class="sum-row total"><span>Total</span><b>₹${o.total}</b></div></div>`}
        ${o.prescriptions.length > 0 && html`<div><h4 class="detail-h">Prescription</h4><div class="msg-files">${o.prescriptions.map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div></div>`}
        ${o.actions.includes('cancel') && html`<div><${Button} variant="danger-ghost" size="sm" icon="x" onClick=${cancel}>Cancel order</${Button}></div>`}
      </div></div>
    </div>
    <section class="card chat-card"><div class="card-head"><div><h3>Chat with the lab</h3><p>Ask about preparation, timing or your report.</p></div></div>
      <${ChatThread} path=${`/orders/${id}`} me="patient" canSend=${o.actions.includes('chat')} lockedText="This order was cancelled." onActivity=${load}
        onQuote=${() => setConfirming(true)} quoteOpen=${o.status === 'quoted'} placeholder="Message the lab…" />
    </section>
    ${confirming && html`<${ConfirmQuote} o=${o} cat=${cat} user=${user} onClose=${() => setConfirming(false)} onDone=${(x) => { setO(x); setConfirming(false); }} />`}
  </div>`;
}

function ConfirmQuote({ o, cat, user, onClose, onDone }) {
  const [f, setF] = useState(() => ({ ...blankBooking(user), slotDate: nextDays(2)[1], slotWindow: '' }));
  const [busy, setBusy] = useState(false);
  async function submit() {
    const missing = bookingProblems(f, cat);
    if (missing.length) return toast(`Please add: ${missing.join(', ')}.`, 'error');
    setBusy(true);
    try { const r = await api(`/orders/${o.id}/confirm`, { method: 'POST', body: { ...f, member: { ...f.member, age: Number(f.member.age) || null } } }); store.set('q24bt_booking', { ...f, geo: null, slotDate: '', slotWindow: '' }); toast('Collection booked!'); onDone(r.order); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }
  return html`<${Modal} open size="lg" title="Book sample collection" subtitle=${`${plural(o.lines.length, 'test')} · ₹${o.total} · free home collection`} onClose=${onClose}
    footer=${html`<${Button} variant="ghost" onClick=${onClose}>Not now</${Button}><${Button} loading=${busy} onClick=${submit}>Book now · ₹${o.total}</${Button}>`}>
    <div class="lines" style="margin-bottom:16px">${o.lines.map((l) => html`<div class="sum-row"><span>${l.name}</span><span>₹${l.price}</span></div>`)}</div>
    <${BookingFields} cat=${cat} f=${f} setF=${setF} user=${user} />
  </${Modal}>`;
}

function Account({ user, onUser, onLogout }) {
  const [f, setF] = useState({ name: user.name, email: user.email });
  const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { const r = await api('/me', { method: 'PATCH', body: f }); onUser(r.user); toast('Saved.'); } catch (e) { toast(e.message, 'error'); } setBusy(false); }
  return html`<div class="stack narrow">
    <div class="page-head"><div><h1>Account</h1><p>${user.phone}</p></div></div>
    <div class="card"><div class="card-body form-grid">
      <${Field} label="Full name"><input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></${Field}>
      <${Field} label="Email" optional><input type="email" value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} /></${Field}>
      <div><${Button} loading=${busy} onClick=${save}>Save</${Button}></div>
    </div></div>
    <${Button} variant="ghost" icon="logout" onClick=${onLogout}>Sign out</${Button}>
  </div>`;
}

// ------------------------------------------------------------------ app shell
function App() {
  const route = useRoute();
  const [cat, setCat] = useState(null); const [err, setErr] = useState(null);
  const [user, setUser] = useState(undefined);
  const [cart, setCart] = useState(() => store.get('q24bt_cart', []));
  const [loc, setLoc] = useState(() => store.get('q24bt_loc', null));
  const [locOpen, setLocOpen] = useState(false);
  useEffect(() => {
    api('/catalog').then(setCat).catch((e) => setErr(e.message));
    api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
    setUnauthorizedHandler(() => setUser(null));
  }, []);
  useEffect(() => { store.set('q24bt_cart', cart); }, [cart]);
  useEffect(() => { if (cat) setCart((c) => c.filter((id) => cat.tests.some((t) => t.id === id))); }, [cat]);
  const toggle = (id) => setCart((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const ensureUser = async (reason, hint) => user || openLogin(reason, hint);
  const saveLoc = (l) => { setLoc(l); store.set('q24bt_loc', l); setLocOpen(false); };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); navigate('/'); };

  const p = route.path;
  const needsLogin = p.startsWith('/orders') || p === '/account';
  useEffect(() => { if (user === null && needsLogin) openLogin('Verify your number to see your orders.').catch(() => navigate('/', { replace: true })); }, [user, p]);

  let page; let m;
  if (err && !cat) page = html`<${ErrorBox} message=${err} onRetry=${() => location.reload()} />`;
  else if (!cat || user === undefined) page = html`<${Loading} />`;
  else if (p === '/' || p === '') page = html`<${Home} cat=${cat} tests=${cat.tests} cart=${cart} toggle=${toggle} loc=${loc} onLoc=${() => setLocOpen(true)} />`;
  else if (p === '/cart') page = html`<${Checkout} cat=${cat} cart=${cart} toggle=${toggle} clearCart=${() => setCart([])} user=${user} loc=${loc} onLoc=${() => setLocOpen(true)} onLocSet=${saveLoc} ensureUser=${ensureUser} />`;
  else if (p === '/rx') page = html`<${RxStart} cat=${cat} user=${user} loc=${loc} onLoc=${() => setLocOpen(true)} onLocSet=${saveLoc} ensureUser=${ensureUser} />`;
  else if (needsLogin && !user) page = html`<${Empty} icon="lock" title="Verify your number" action=${html`<${Button} onClick=${() => openLogin().catch(() => {})}>Verify</${Button}>`}>Your orders are private to your mobile number.</${Empty}>`;
  else if (p === '/orders') page = html`<${Orders} />`;
  else if ((m = match('/orders/:id', p))) page = html`<${OrderDetail} key=${m.id} id=${m.id} cat=${cat} user=${user} />`;
  else if (p === '/account') page = html`<${Account} user=${user} onUser=${setUser} onLogout=${logout} />`;
  else page = html`<${Empty} icon="alert" title="Page not found" action=${html`<${Button} onClick=${() => navigate('/')}>Home</${Button}>`} />`;

  const cartTotal = cat ? cat.tests.filter((t) => cart.includes(t.id)).reduce((a, t) => a + t.price, 0) : 0;
  return html`<div class="bt-shell">
    <header class="bt-top">
      <a class="brand" href="#/"><span class="brand-mark">24</span><span class="brand-name">Queue24 <small>Labs</small></span></a>
      <button class="loc-pill" onClick=${() => setLocOpen(true)}><${Icon} name="pin" size=${15} /><span>${loc ? loc.city : 'Select city'}</span><${Icon} name="down" size=${14} /></button>
      <nav class="bt-nav">
        <a href="#/rx" class=${p === '/rx' ? 'active' : ''}><${Icon} name="upload" size=${17} /><span>Prescription</span></a>
        <a href="#/orders" class=${p.startsWith('/orders') ? 'active' : ''}><${Icon} name="file" size=${17} /><span>Orders</span></a>
        ${user ? html`<a href="#/account" class=${p === '/account' ? 'active' : ''}><${Icon} name="user" size=${17} /><span>${user.name.split(' ')[0]}</span></a>`
          : html`<button class="link" onClick=${() => openLogin().catch(() => {})}><${Icon} name="user" size=${17} /><span>Sign in</span></button>`}
        <a href="#/cart" class=${'cart-btn' + (p === '/cart' ? ' active' : '')}><${Icon} name="cart" size=${18} />${cart.length > 0 && html`<em>${cart.length}</em>`}</a>
      </nav>
    </header>
    <main class="bt-main">${page}</main>
    ${cart.length > 0 && p === '/' && html`<button class="cart-bar" onClick=${() => navigate('/cart')}><span>${plural(cart.length, 'item')} · <b>₹${cartTotal}</b></span><span>Book now <${Icon} name="arrowRight" size=${16} /></span></button>`}
    ${locOpen && cat && html`<${LocationModal} areas=${cat.areas} value=${loc} onSave=${saveLoc} onClose=${() => setLocOpen(false)} />`}
    <${LoginHost} onUser=${setUser} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
