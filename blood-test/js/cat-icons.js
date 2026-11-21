// Illustrated category icons for /blood-test (flat, multi-colour, 48×48). Each has its own soft tile colour.
import { html } from './lib.js';

const svg = (body) => html`<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true" fill="none">${body}</svg>`;

export const CAT_ART = {
  all: { bg: '#e8f5ee', art: svg(html`
    <rect x="7" y="7" width="15" height="15" rx="4.5" fill="#1FA36E"/><rect x="26" y="7" width="15" height="15" rx="4.5" fill="#60A5FA"/>
    <rect x="7" y="26" width="15" height="15" rx="4.5" fill="#FBBF24"/><rect x="26" y="26" width="15" height="15" rx="4.5" fill="#F472B6"/>`) },
  'full-body': { bg: '#e7effc', art: svg(html`
    <circle cx="22" cy="11" r="6" fill="#F5C29B"/><path d="M13 22c0-3.3 2.7-6 6-6h6c3.3 0 6 2.7 6 6v8h-4v12h-10V30h-4z" fill="#3B82F6"/>
    <path d="M17.5 16.5h9" stroke="#2563EB" stroke-width="2" stroke-linecap="round"/>
    <circle cx="35" cy="34" r="8" fill="#1FA36E"/><path d="M31.5 34.2l2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`) },
  diabetes: { bg: '#ecebfd', art: svg(html`
    <rect x="9" y="10" width="22" height="31" rx="6" fill="#6366F1"/><rect x="13" y="14" width="14" height="10" rx="2.5" fill="#E0E7FF"/>
    <path d="M16 19.5h3M21 19.5h3" stroke="#4F46E5" stroke-width="2" stroke-linecap="round"/>
    <circle cx="16" cy="31" r="2" fill="#A5B4FC"/><circle cx="24" cy="31" r="2" fill="#A5B4FC"/><rect x="17" y="35" width="6" height="2.5" rx="1.2" fill="#A5B4FC"/>
    <path d="M37 13c3 4 5 6.6 5 9.2a5 5 0 0 1-10 0c0-2.6 2-5.2 5-9.2z" fill="#EF4444"/><path d="M35.2 22.6a2 2 0 0 0 1.8 1.9" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`) },
  thyroid: { bg: '#fde8f2', art: svg(html`
    <path d="M23 14c-6-6-15-4-15 4 0 7 6 12 11 14 2.4 1 4 0 4-2.5z" fill="#EC4899"/>
    <path d="M25 14c6-6 15-4 15 4 0 7-6 12-11 14-2.4 1-4 0-4-2.5z" fill="#F9A8D4"/>
    <rect x="22" y="12" width="4" height="22" rx="2" fill="#BE185D"/><path d="M24 34v6" stroke="#BE185D" stroke-width="3" stroke-linecap="round"/>`) },
  heart: { bg: '#fdeceb', art: svg(html`
    <path d="M24 40S7 30 7 18.5C7 12.7 11.3 9 16 9c3.4 0 6.3 1.9 8 4.8C25.7 10.9 28.6 9 32 9c4.7 0 9 3.7 9 9.5C41 30 24 40 24 40z" fill="#EF4444"/>
    <path d="M11 23h8l2.5-5 4 10 2.6-5H37" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`) },
  vitamins: { bg: '#fdf3dc', art: svg(html`
    <g transform="rotate(-40 24 26)"><rect x="9" y="19" width="30" height="14" rx="7" fill="#FDE68A"/><path d="M24 19h8a7 7 0 0 1 0 14h-8z" fill="#F59E0B"/>
    <path d="M13 23.5h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>
    <circle cx="37" cy="11" r="4.5" fill="#FB923C"/><path d="M37 3.5v1.6M44.5 11h-1.6M42.3 5.7l-1.1 1.1" stroke="#FB923C" stroke-width="1.8" stroke-linecap="round"/>`) },
  liver: { bg: '#fbece4', art: svg(html`
    <path d="M6 20c0-6 6-9 14-9h14c6 0 9 3 8 8-1 6-6 10-13 13-5 2.2-9 6-12 8-4 2.6-8-1.5-8-6.5z" fill="#C2410C"/>
    <path d="M23 12c3 6 3 13-1 22" stroke="#9A3412" stroke-width="2" stroke-linecap="round"/>
    <path d="M11 19c1.5-2 4-3 7-3" stroke="#FDBA74" stroke-width="2.2" stroke-linecap="round"/>`) },
  kidney: { bg: '#fdeaee', art: svg(html`
    <path d="M17 8c-6 0-10 6-10 14s4 17 10 17c4 0 5-3 4-6-1-2.5-3-3.5-3-6.5 0-2.6 2.5-3.5 3-6 .8-3.7-.6-12.5-4-12.5z" fill="#E11D48"/>
    <path d="M31 8c6 0 10 6 10 14s-4 17-10 17c-4 0-5-3-4-6 1-2.5 3-3.5 3-6.5 0-2.6-2.5-3.5-3-6-.8-3.7.6-12.5 4-12.5z" fill="#FB7185"/>
    <path d="M21 25h3v15M27 25h-3" stroke="#9F1239" stroke-width="2.2" stroke-linecap="round"/>`) },
  fever: { bg: '#fdeceb', art: svg(html`
    <rect x="16" y="5" width="11" height="28" rx="5.5" fill="#E2E8F0"/><rect x="19.5" y="13" width="4" height="20" rx="2" fill="#EF4444"/>
    <circle cx="21.5" cy="36" r="7.5" fill="#EF4444"/><circle cx="19.5" cy="34" r="2" fill="#FCA5A5"/>
    <path d="M33 12c2 2 2 4 0 6s-2 4 0 6M38.5 12c2 2 2 4 0 6s-2 4 0 6" stroke="#F97316" stroke-width="2.2" stroke-linecap="round"/>`) },
  women: { bg: '#f6e8fb', art: svg(html`
    <path d="M12 22c0-8 5-14 12-14s12 6 12 14v13H12z" fill="#7C3AED"/>
    <circle cx="24" cy="21" r="8.5" fill="#F5C29B"/><path d="M15.5 19c3 0 7-2 9.5-5.5 1.5 3 4.5 5 7.5 5.3" stroke="#7C3AED" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M13 42c0-5.5 4.9-9 11-9s11 3.5 11 9z" fill="#C084FC"/>`) },
  hormones: { bg: '#e0f3f4', art: svg(html`
    <path d="M14 15l10 9 10-8M24 24v12" stroke="#94A3B8" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="13" cy="14" r="6" fill="#14B8A6"/><circle cx="35" cy="15" r="5" fill="#6366F1"/>
    <circle cx="24" cy="24" r="6.5" fill="#F59E0B"/><circle cx="24" cy="38" r="5" fill="#EC4899"/>`) },
  blood: { bg: '#fdeceb', art: svg(html`
    <path d="M20 6c6 8 11 13.5 11 19.5a11 11 0 0 1-22 0C9 19.5 14 14 20 6z" fill="#DC2626"/>
    <path d="M14.5 26.5a5.5 5.5 0 0 0 5 5" stroke="#FCA5A5" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="32" y="14" width="8" height="26" rx="4" fill="#E2E8F0"/><path d="M32 27h8v9a4 4 0 0 1-8 0z" fill="#EF4444"/><rect x="31" y="12" width="10" height="4" rx="1.5" fill="#64748B"/>`) },
  infection: { bg: '#e6f6ea', art: svg(html`
    <path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M36.7 11.3l-4.2 4.2M15.5 32.5l-4.2 4.2" stroke="#16A34A" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="24" cy="6" r="2.4" fill="#16A34A"/><circle cx="24" cy="42" r="2.4" fill="#16A34A"/><circle cx="6" cy="24" r="2.4" fill="#16A34A"/><circle cx="42" cy="24" r="2.4" fill="#16A34A"/>
    <circle cx="24" cy="24" r="11" fill="#22C55E"/><circle cx="20" cy="21" r="2.6" fill="#BBF7D0"/><circle cx="28" cy="27" r="2" fill="#BBF7D0"/><circle cx="27" cy="19" r="1.4" fill="#15803D"/>`) },
};
