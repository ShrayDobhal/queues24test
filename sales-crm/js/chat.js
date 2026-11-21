// Order conversation (patient ↔ lab partner ↔ Queue24 admin). Shared by /blood-test, /lab-partners and the CRM admin.
import { html, useState, useEffect, useRef, api, apiUpload, toast, compressImage, fmtDateTime } from './lib.js';
import { Icon, Spinner } from './ui.js';

const isImage = (f) => /^image\//.test(f.mime);
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const WHO = { patient: 'Patient', partner: 'Lab', admin: 'Queue24 Support', system: 'Queue24' };

export function FileChip({ file }) {
  return html`<a class="file-chip" href=${file.url} target="_blank" rel="noopener">
    ${isImage(file) ? html`<img src=${file.url} alt=${file.name} loading="lazy" />` : html`<span class="file-pdf"><${Icon} name="file" size=${18} /></span>`}
    <span class="file-meta"><b>${file.name}</b><small>${fmtSize(file.size)}${file.purpose === 'report' ? ' · Report' : ''}</small></span>
  </a>`;
}

/**
 * path: API path of the order (e.g. '/orders/12' or '/admin/health/orders/12')
 * me: 'patient' | 'partner' | 'admin'
 * onQuote(meta): show a "Review & book" button on the latest quote (patient only)
 */
export function ChatThread({ path, me, canSend = true, lockedText, onQuote, quoteOpen, onActivity, placeholder = 'Type a message…' }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const lastId = useRef(0);
  const box = useRef(null);
  const fileRef = useRef(null);

  const nearBottom = () => { const b = box.current; return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 120; };
  const toBottom = () => requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; });

  async function load(initial) {
    try {
      const d = await api(`${path}/messages?after=${lastId.current}`);
      if (d.items.length) {
        const stick = initial || nearBottom();
        lastId.current = d.items[d.items.length - 1].id;
        setMsgs((m) => [...m, ...d.items]);
        if (stick) toBottom();
        if (!initial && d.items.some((x) => x.from !== me) && onActivity) onActivity();
      }
    } catch (e) { if (initial) toast(e.message, 'error'); }
    if (initial) setLoading(false);
  }
  useEffect(() => {
    lastId.current = 0; setMsgs([]); setLoading(true);
    load(true);
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 4000);
    return () => clearInterval(t);
  }, [path]);

  async function pick(list) {
    const arr = [];
    for (const f of [...list].slice(0, 5 - files.length)) arr.push(f.type === 'application/pdf' ? f : await compressImage(f, 2000, 0.85)); // also shrinks HEIC / untyped phone photos
    setFiles((x) => [...x, ...arr]);
  }
  async function send() {
    if (sending || (!text.trim() && !files.length)) return;
    setSending(true);
    const form = new FormData();
    form.append('body', text.trim());
    files.forEach((f) => form.append('files[]', f, f.name || 'file'));
    try {
      await apiUpload(`${path}/messages`, form);
      setText(''); setFiles([]);
      await load(false); toBottom();
      if (onActivity) onActivity();
    } catch (e) { toast(e.message, 'error'); }
    setSending(false);
  }
  const lastQuoteId = [...msgs].reverse().find((m) => m.kind === 'quote')?.id;

  return html`<div class="chat">
    <div class="chat-scroll" ref=${box}>
      ${loading && html`<div class="chat-empty"><${Spinner} /></div>`}
      ${!loading && !msgs.length && html`<div class="chat-empty">No messages yet.</div>`}
      ${msgs.map((m) => {
        if (m.from === 'system') return html`<div class="msg-sys" key=${m.id}><span>${m.body}</span><time>${fmtDateTime(m.at)}</time></div>`;
        const mine = m.from === me;
        return html`<div class=${'msg ' + (mine ? 'mine' : 'theirs') + ' from-' + m.from} key=${m.id}>
          ${!mine && html`<div class="msg-name">${m.name || WHO[m.from]}${m.from === 'admin' ? ' ✓' : ''}</div>`}
          <div class="msg-bubble">
            ${m.kind === 'quote' && m.meta ? html`<div class="quote">
                <div class="quote-head"><${Icon} name="flask" size=${16} />Suggested tests</div>
                ${m.meta.items.map((it) => html`<div class="quote-row"><span>${it.name}</span><b>₹${it.price}</b></div>`)}
                <div class="quote-total"><span>Total${m.meta.mrp > m.meta.total ? html` <s>₹${m.meta.mrp}</s>` : ''}</span><b>₹${m.meta.total}</b></div>
                ${m.body && html`<p class="quote-note">${m.body}</p>`}
                ${onQuote && quoteOpen && m.id === lastQuoteId && html`<button class="btn btn-primary btn-sm quote-btn" onClick=${() => onQuote(m.meta)}>Review & book collection</button>`}
              </div>`
              : html`${m.body && html`<p>${m.body}</p>`}${m.files.length > 0 && html`<div class="msg-files">${m.files.map((f) => html`<${FileChip} file=${f} key=${f.id} />`)}</div>`}`}
          </div>
          <time>${fmtDateTime(m.at)}</time>
        </div>`;
      })}
    </div>
    ${canSend ? html`<div class="chat-compose">
        ${files.length > 0 && html`<div class="chat-files">${files.map((f, i) => html`<span class="sel-date" key=${i}>${f.name || 'photo'}<button onClick=${() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><${Icon} name="x" size=${12} stroke=${2.6} /></button></span>`)}</div>`}
        <div class="chat-row">
          <button class="icon-btn" title="Attach photo or PDF" onClick=${() => fileRef.current.click()} aria-label="Attach"><${Icon} name="clip" size=${20} /></button>
          <textarea rows="1" placeholder=${placeholder} value=${text} onInput=${(e) => setText(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); } }}></textarea>
          <button class="chat-send" onClick=${send} disabled=${sending || (!text.trim() && !files.length)} aria-label="Send">${sending ? html`<${Spinner} size=${18} light />` : html`<${Icon} name="send" size=${18} />`}</button>
        </div>
        <input ref=${fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange=${(e) => { pick(e.target.files); e.target.value = ''; }} />
      </div>`
      : html`<div class="chat-locked"><${Icon} name="lock" size=${15} />${lockedText || 'Chat is closed for this order.'}</div>`}
  </div>`;
}
