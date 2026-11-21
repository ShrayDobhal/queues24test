import { html, render, useState, useEffect, api, useRoute, navigate, setUnauthorizedHandler, toast } from './lib.js';
import { Toasts, Loading } from './ui.js';
import { LoginPage } from './common.js';
import { EmployeeApp } from './employee.js';
import { AdminApp } from './admin.js';

function App() {
  const [user, setUser] = useState(undefined); // undefined = checking session
  const route = useRoute();

  useEffect(() => {
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
    setUnauthorizedHandler(() => { setUser(null); toast('Your session ended. Please sign in again.', 'error'); });
  }, []);

  // keep the URL in the right area for the signed-in role
  useEffect(() => {
    if (user === undefined) return;
    const p = route.path;
    if (!user) { if (p !== '/login') navigate('/login', { replace: true }); return; }
    if (p === '/login') navigate(user.role === 'admin' ? '/admin' : '/', { replace: true });
    else if (user.role === 'admin' && !p.startsWith('/admin')) navigate('/admin', { replace: true });
    else if (user.role !== 'admin' && p.startsWith('/admin')) navigate('/', { replace: true });
  }, [user, route.path]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }

  let body;
  if (user === undefined) body = html`<div class="boot"><${Loading} label="Opening your workspace…" /></div>`;
  else if (!user) body = html`<${LoginPage} onLogin=${(u) => { setUser(u); navigate(u.role === 'admin' ? '/admin' : '/', { replace: true }); }} />`;
  else if (user.role === 'admin') body = route.path.startsWith('/admin') ? html`<${AdminApp} user=${user} route=${route} onLogout=${logout} />` : null;
  else body = !route.path.startsWith('/admin') && route.path !== '/login' ? html`<${EmployeeApp} user=${user} route=${route} onLogout=${logout} />` : null;

  return html`${body}<${Toasts} />`;
}

render(html`<${App} />`, document.getElementById('app'));
