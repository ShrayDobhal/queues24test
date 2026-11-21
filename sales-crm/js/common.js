// Login screen + shared account forms.
import { html, useState, api, toast } from './lib.js';
import { Icon, Button, Field } from './ui.js';

export function LoginPage({ onLogin }) {
  const [role, setRole] = useState(() => { try { return localStorage.getItem('q24crm_role') || 'employee'; } catch { return 'employee'; } });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) { setError('Enter your login ID and password.'); return; }
    setLoading(true);
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { identifier: identifier.trim(), password, role } });
      try { localStorage.setItem('q24crm_role', role); } catch { /* ignore */ }
      onLogin(user);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return html`<div class="login-page">
    <div class="login-art" aria-hidden="true">
      <div class="login-art-inner">
        <div class="brand light"><span class="brand-mark">24</span><span class="brand-name">Queue24</span></div>
        <h2>Every clinic visit,<br /><em>tracked.</em></h2>
        <ul>
          <li><${Icon} name="camera" size=${18} />Log clinic visits with photos & GPS</li>
          <li><${Icon} name="checkCircle" size=${18} />One-tap morning attendance</li>
          <li><${Icon} name="calendar" size=${18} />Apply for leave from a calendar</li>
          <li><${Icon} name="chart" size=${18} />Admin reports, red marks & alerts</li>
        </ul>
      </div>
    </div>
    <div class="login-panel">
      <form class="login-card" onSubmit=${submit} novalidate>
        <div class="eyebrow"><i class="dot"></i>QUEUE24 SALES CRM</div>
        <h1>Sign in to your workspace</h1>
        <p class="muted">Internal tool for the Queue24 field sales team.</p>
        <div class="segmented login-tabs" role="tablist">
          <button type="button" role="tab" aria-selected=${role === 'employee'} class=${role === 'employee' ? 'active' : ''} onClick=${() => { setRole('employee'); setError(''); }}>Employee</button>
          <button type="button" role="tab" aria-selected=${role === 'admin'} class=${role === 'admin' ? 'active' : ''} onClick=${() => { setRole('admin'); setError(''); }}>Admin</button>
        </div>
        <${Field} label="Email or mobile number">
          <input value=${identifier} onInput=${(e) => setIdentifier(e.target.value)} autocomplete="username" inputmode="email" placeholder=${role === 'admin' ? 'admin@queue24.in' : 'you@queue24.in'} autofocus />
        </${Field}>
        <${Field} label="Password">
          <div class="pw-input">
            <input type=${show ? 'text' : 'password'} value=${password} onInput=${(e) => setPassword(e.target.value)} autocomplete="current-password" placeholder="••••••••" />
            <button type="button" class="icon-btn" onClick=${() => setShow(!show)} aria-label=${show ? 'Hide password' : 'Show password'}><${Icon} name="eye" size=${17} /></button>
          </div>
        </${Field}>
        ${error && html`<div class="form-error"><${Icon} name="alert" size=${16} />${error}</div>`}
        <${Button} type="submit" size="lg" class="btn-block" loading=${loading}>${role === 'admin' ? 'Sign in as Admin' : 'Sign in'} <${Icon} name="arrowRight" size=${17} /></${Button}>
        <p class="login-help">${role === 'admin' ? 'Admin accounts manage employees, leaves and reports.' : "Don't have a login or forgot your password? Ask your admin to generate one."}</p>
      </form>
    </div>
  </div>`;
}

export function ChangePasswordForm() {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setError('');
    if (f.next.length < 8) return setError('New password must be at least 8 characters.');
    if (f.next !== f.confirm) return setError('New passwords do not match.');
    setLoading(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current: f.current, next: f.next } });
      toast('Password changed.');
      setF({ current: '', next: '', confirm: '' });
    } catch (err) { setError(err.message); }
    setLoading(false);
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<form class="form-grid" onSubmit=${submit} novalidate>
    <${Field} label="Current password"><input type="password" value=${f.current} onInput=${set('current')} autocomplete="current-password" /></${Field}>
    <div class="form-row">
      <${Field} label="New password"><input type="password" value=${f.next} onInput=${set('next')} autocomplete="new-password" /></${Field}>
      <${Field} label="Confirm new password"><input type="password" value=${f.confirm} onInput=${set('confirm')} autocomplete="new-password" /></${Field}>
    </div>
    ${error && html`<div class="form-error"><${Icon} name="alert" size=${16} />${error}</div>`}
    <div><${Button} type="submit" icon="key" loading=${loading}>Update password</${Button}></div>
  </form>`;
}
