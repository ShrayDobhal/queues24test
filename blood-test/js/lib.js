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

/** Upload with progress (fetch has no upload progress). */
export function apiUpload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API + path);
    xhr.withCredentials = true;
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

/** Downscale a photo in the browser before upload (saves mobile data). */
export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // e.g. HEIC: send as-is
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function getLocation(timeout = 12000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not supported on this device.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission denied.' : 'Could not get your location.')),
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
