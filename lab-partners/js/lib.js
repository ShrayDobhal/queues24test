// Shared runtime: Preact + htm, API client, router, formatting helpers, toasts.
import { h, html, render, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext } from '../vendor/preact-htm.js';

export { h, html, render, useState, useEffect, useRef, useMemo, useCallback, useContext, createContext };

export const BASE = window.__BASE__ || '';
export const API = `${BASE}/api`;

// ------------------------------------------------------------------ API client
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res;
  try {
    res = await fetch(API + path, opts);
  } catch {
    throw new ApiError(0, 'No internet connection. Please check your network and try again.');
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

/** Upload with progress (fetch has no upload progress). Network failures reject with status 0. */
export function apiUpload(path, form, onProgress, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API + path);
    xhr.withCredentials = true;
    xhr.timeout = timeoutMs;
    xhr.ontimeout = () => reject(new ApiError(0, 'The upload took too long: the network is slow. Please try again.'));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) onUnauthorized();
        reject(new ApiError(xhr.status, (data && data.error) || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: check your internet connection and try again.'));
    xhr.send(form);
  });
}

// Photos come from the API as ready URLs (signed Bunny CDN links or local /api/files paths).
export const fileUrl = (p) => (/^(https?:)?\//.test(p) ? p : `${API}/files/${p}`);

/** Hook: load data from the API, with reload(). */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async (silent) => {
    if (!path) return;
    const my = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      if (my === seq.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (my === seq.current) setState((s) => ({ data: s.data, error: e.message, loading: false }));
    }
  }, [path]);
  useEffect(() => { load(); }, [path, ...deps]);
  return { ...state, reload: load };
}

// ------------------------------------------------------------------ router (hash based → no server rewrites needed)
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: p || '/', query };
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => { setRoute(parseHash()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export function navigate(to, { replace = false } = {}) {
  const target = '#' + to;
  if (replace) history.replaceState(null, '', target);
  else if (location.hash === target) return;
  else history.pushState(null, '', target);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  window.scrollTo({ top: 0 });
}
export function match(pattern, path) {
  const pp = pattern.split('/'); const ap = path.split('/');
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (pp[i] !== ap[i]) return null;
  }
  return params;
}

// ------------------------------------------------------------------ toasts
const toastListeners = new Set();
let toastId = 0;
export function toast(message, type = 'success') {
  const t = { id: ++toastId, message, type };
  toastListeners.forEach((fn) => fn(t));
}
export function useToasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.type === 'error' ? 5200 : 3200);
    };
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  }, []);
  return items;
}

// ------------------------------------------------------------------ formatting
export const pad = (n) => String(n).padStart(2, '0');
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDate(dateStr, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!dateStr) return '';
  return new Date(dateStr.length === 10 ? dateStr + 'T00:00:00Z' : dateStr).toLocaleDateString('en-IN', { ...opts, timeZone: dateStr.length === 10 ? 'UTC' : 'Asia/Kolkata' });
}
export const fmtDay = (d) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
export function fmtTime12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}
export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}
export function plural(n, word, pluralWord) { return `${n} ${n === 1 ? word : (pluralWord || word + 's')}`; }
export function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
export const mapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
export const mapsSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export const OUTCOMES = {
  interested: { label: 'Interested', tone: 'green' },
  follow_up: { label: 'Follow-up needed', tone: 'amber' },
  demo_scheduled: { label: 'Demo scheduled', tone: 'blue' },
  onboarded: { label: 'Onboarded', tone: 'violet' },
  not_interested: { label: 'Not interested', tone: 'gray' },
  closed: { label: 'Clinic closed', tone: 'gray' },
};
export const LEAVE_TYPES = { casual: 'Casual leave', sick: 'Sick leave', emergency: 'Emergency', other: 'Other' };
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** True for anything that may be a photo. Some Android cameras/galleries report an empty type. */
export const looksLikeImage = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name || '') || !f.type;

// Decode a photo for resizing. <img> honours the EXIF rotation on every current phone browser;
// createImageBitmap is faster but older Safari/Android reject the orientation option, so it is only a fast path.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: b, w: b.width, h: b.height, done: () => b.close && b.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = url; });
  } catch (e) { URL.revokeObjectURL(url); throw e; }
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/**
 * Downscale a photo in the browser before upload: a 4-8 MB phone photo becomes ~250-500 KB,
 * so uploads finish fast on mobile data. Also converts HEIC to JPEG where the browser can read it (iPhone Safari).
 * Never throws: if the photo can't be read it is sent as it is.
 */
export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  if (!looksLikeImage(file) || file.type === 'image/gif') return file;
  const webSafe = /^image\/(jpeg|png|webp)$/.test(file.type);
  let d = null;
  try {
    d = await decodeImage(file);
    if (!d.w || !d.h) throw new Error('empty image');
    const scale = Math.min(1, maxSide / Math.max(d.w, d.h));
    if (scale === 1 && webSafe && file.size < 700 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(d.w * scale));
    canvas.height = Math.max(1, Math.round(d.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // PNG transparency → white, not black
    ctx.drawImage(d.src, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    canvas.width = canvas.height = 0; // free memory right away on low-end phones
    if (!blob) throw new Error('encode failed');
    if (webSafe && blob.size >= file.size) return file;
    const name = (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg';
    try { return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }); } catch { blob.name = name; return blob; }
  } catch {
    return file;
  } finally {
    if (d) d.done();
  }
}

// ------------------------------------------------------------------ unsent-form drafts (survive reloads)
// Android often reloads the page while the camera app is open; a failed upload must not lose the work either.
// Text goes to localStorage, photos to IndexedDB. Every call is best-effort (private mode may block storage).
const DRAFT_DB = 'q24crm-drafts';
function draftDb() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no indexedDB'));
    const r = indexedDB.open(DRAFT_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function draftTx(mode, fn) {
  const db = await draftDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('drafts', mode);
    const out = fn(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); res(out && 'result' in out ? out.result : undefined); };
    tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
  });
}
export const drafts = {
  async save(key, value) { try { await draftTx('readwrite', (s) => s.put(value, key)); return true; } catch { return false; } },
  async load(key) { try { return (await draftTx('readonly', (s) => s.get(key))) || null; } catch { return null; } },
  async clear(key) { try { await draftTx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ } },
};

export function getLocation(timeout = 12000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not supported on this device.'));
    // hard stop: some phones never answer when the permission popup is ignored or dismissed
    const guard = setTimeout(() => reject(new Error('Could not get your location.')), timeout + 3000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(guard); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); },
      (e) => { clearTimeout(guard); reject(new Error(e.code === 1 ? 'Location permission denied. Allow location for this site in your browser settings.' : 'Could not get your location.')); },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
