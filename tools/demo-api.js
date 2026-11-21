/*
 * Queue24 Labs — DEMO MODE for static hosting (Vercel has no PHP).
 * Loaded only by the test site's /blood-test/index.html. It answers the same API calls as the
 * real PHP backend (/blood-test/api/...), but inside the browser:
 *   - catalog comes from demo-catalog.json (exported from the real seed data)
 *   - your orders, chat and files are kept in this browser (localStorage)
 *   - a simulated lab accepts, suggests tests for prescriptions and uploads a sample report
 * Nothing is sent to any server. Not used on the real site.
 */
(function () {
  'use strict';
  var API = '/blood-test/api';
  var KEY = 'q24_demo_state_v1';
  var catalog = null;
  var memFiles = {};

  // ------------------------------------------------------------------ state
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  var S = load() || { seq: 1, users: {}, me: null, orders: [], messages: [], files: {}, reads: {} };
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { // quota: keep big files in memory only
      Object.keys(S.files).forEach(function (k) { if (S.files[k].url && S.files[k].url.length > 2000) { memFiles[k] = S.files[k].url; S.files[k].url = ''; } });
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e2) { /* give up silently */ }
    }
  }
  function id() { return S.seq++; }
  function now() { return new Date().toISOString(); }
  function err(status, msg) { var e = new Error(msg); e.status = status; return e; }
  function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }

  var LABELS = { placed: 'Finding the best lab for you', assigned: 'Waiting for lab confirmation', needs_attention: 'Finding the best lab for you', in_review: 'Lab is reviewing prescription',
    quoted: 'Tests suggested by lab', scheduled: 'Sample collection scheduled', collected: 'Sample collected', processing: 'Testing in lab', report_ready: 'Report ready', completed: 'Completed', cancelled: 'Cancelled' };
  var CANCELLABLE = ['placed', 'assigned', 'in_review', 'quoted', 'scheduled', 'needs_attention'];

  function me() { return S.me ? S.users[S.me] : null; }
  function requireMe() { var u = me(); if (!u) throw err(401, 'Please verify your mobile number to continue.'); return u; }
  function userJson(u) { return { id: u.id, name: u.name, phone: '+91 ' + u.phone.slice(0, 5) + ' ' + u.phone.slice(5), email: u.email || '' }; }
  function normPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); return /^[6-9]\d{9}$/.test(d) ? d : null; }

  function resolveArea(state, city) {
    var st = catalog.areas.filter(function (a) { return a.name === state; })[0];
    if (!st) throw err(400, "Sorry, we don't serve this location yet. Please pick your state from the list.");
    var c = st.cities.filter(function (x) { return x.name.toLowerCase() === String(city).toLowerCase(); })[0];
    var areaId = c ? c.areaId : (st.otherAreaId || (st.cities[0] && st.cities[0].areaId));
    return { id: areaId, info: catalog.areaInfo[areaId] };
  }
  function validateBooking(b, u) {
    var m = b.member || {};
    if (!/^[1-9]\d{5}$/.test(b.pincode || '')) throw err(400, 'Enter a valid 6-digit pincode.');
    if (String(b.address || '').trim().length < 10) throw err(400, 'Enter the full address for sample collection (house no., street, area).');
    if (String(m.name || '').trim().length < 2) throw err(400, "Enter the patient's full name.");
    if (!m.age || m.age < 1 || m.age > 120) throw err(400, "Enter the patient's age.");
    if (!catalog.genders[m.gender]) throw err(400, 'Select gender.');
    if (!b.slotDate || b.slotDate < addDays(0) || b.slotDate > addDays(6)) throw err(400, 'Pick a collection date within the next 7 days.');
    if (!catalog.slots[b.slotWindow]) throw err(400, 'Pick a collection time slot.');
    if (b.slotDate === addDays(0) && Number(b.slotWindow.slice(0, 2)) < new Date().getHours() + 2) throw err(400, 'That time slot has passed for today. Please pick a later slot or another day.');
    var contact = b.contactPhone ? normPhone(b.contactPhone) : u.phone;
    if (!contact) throw err(400, 'Enter a valid 10-digit mobile number for the collection team.');
    return { pincode: b.pincode, address: String(b.address).trim(), memberName: String(m.name).trim(), age: Number(m.age), gender: m.gender, slotDate: b.slotDate, slotWindow: b.slotWindow, phone: contact };
  }
  function testsByIds(ids) {
    var t = catalog.tests.filter(function (x) { return ids.indexOf(x.id) >= 0; });
    if (!t.length) throw err(400, 'Add at least one test.');
    return t;
  }
  function msg(o, from, name, kind, body, fileIds, meta) {
    var m = { id: id(), orderId: o.id, from: from, name: name, kind: kind, body: body || null, fileIds: fileIds || [], meta: meta || null, at: now() };
    S.messages.push(m); o.updatedAt = m.at; return m;
  }
  function event(o, action, to, note) { o.timeline.push({ action: action, by: 'demo', to: to, note: note || null, at: now() }); }
  function fileJson(fid) { var f = S.files[fid]; return f ? { id: Number(fid), name: f.name, mime: f.mime, size: f.size, purpose: f.purpose, url: f.url || memFiles[fid] || '', at: f.at } : null; }

  // ------------------------------------------------------------------ simulated lab (time based)
  function simulate() {
    var t = Date.now();
    S.orders.forEach(function (o) {
      if (o.status === 'cancelled') return;
      var age = (t - new Date(o.stepAt).getTime()) / 1000;
      var lab = o.partner.name;
      if (o.status === 'assigned' && age > 8) {
        o.stepAt = now();
        if (o.kind === 'prescription') { o.status = 'in_review'; event(o, 'accepted', 'in_review'); msg(o, 'system', 'Queue24', 'system', lab + ' is reviewing your prescription and will reply here shortly.'); }
        else { o.status = 'scheduled'; event(o, 'accepted', 'scheduled'); msg(o, 'system', 'Queue24', 'system', lab + ' confirmed your order. Our phlebotomist will visit on ' + new Date(o.slotDate).toDateString().slice(0, 10) + ', ' + catalog.slots[o.slotWindow] + '.'); }
      } else if (o.status === 'in_review' && age > 10) {
        var pick = catalog.tests.filter(function (x) { return ['THY', 'CBC', 'VITD'].indexOf(x.code) >= 0; });
        o.lines = pick.map(function (x) { return { testId: x.id, name: x.name, price: x.price, mrp: x.mrp }; });
        o.total = pick.reduce(function (a, x) { return a + x.price; }, 0); o.mrp = pick.reduce(function (a, x) { return a + x.mrp; }, 0);
        o.status = 'quoted'; o.stepAt = now(); event(o, 'quoted', 'quoted', pick.length + ' test(s), ₹' + o.total);
        msg(o, 'partner', lab, 'text', 'Hi! We checked your prescription. Sending the test list with prices below.');
        msg(o, 'partner', lab, 'quote', 'No fasting needed for these tests. (Demo: a simulated lab picked these.)', [], { items: o.lines.map(function (l) { return { name: l.name, price: l.price, mrp: l.mrp }; }), total: o.total, mrp: o.mrp });
      } else if (o.status === 'scheduled' && age > 20) {
        o.status = 'collected'; o.stepAt = now(); event(o, 'collected', 'collected'); msg(o, 'system', 'Queue24', 'system', "Sample collected. It's on its way to the lab.");
      } else if (o.status === 'collected' && age > 15) {
        o.status = 'processing'; o.stepAt = now(); event(o, 'processing', 'processing'); msg(o, 'system', 'Queue24', 'system', 'Your sample is being tested in the lab.');
      } else if (o.status === 'processing' && age > 15) {
        var fid = id();
        var pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 40 120 Td (Queue24 DEMO report - not real) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
        S.files[fid] = { name: 'demo-report.pdf', mime: 'application/pdf', size: pdf.length, purpose: 'report', url: 'data:application/pdf;base64,' + btoa(pdf), at: now(), orderId: o.id };
        o.reports.push(fid);
        o.status = 'report_ready'; o.stepAt = now(); event(o, 'report', 'report_ready'); msg(o, 'partner', lab, 'file', 'Your report is ready. (Demo file)', [fid], { report: true });
      }
    });
  }

  function summary(o) {
    var mine = S.messages.filter(function (m) { return m.orderId === o.id; });
    var last = mine[mine.length - 1];
    var read = S.reads[o.id] || 0;
    return {
      id: o.id, orderNo: o.orderNo, kind: o.kind, status: o.status, statusLabel: LABELS[o.status] || o.status,
      patientName: o.memberName, age: o.age || null, gender: o.gender || null, city: o.city, state: o.state, pincode: o.pincode || null,
      area: o.areaName, areaKind: o.areaKind, slotDate: o.slotDate || null, slotWindow: o.slotWindow || null, slotLabel: o.slotWindow ? catalog.slots[o.slotWindow] : null,
      items: o.lines.map(function (l) { return l.name; }), total: o.total, mrp: o.mrp,
      partner: { id: 0, name: o.partner.name, city: o.city, role: null }, phone: '+91 ' + o.phone.slice(0, 5) + ' ' + o.phone.slice(5),
      unread: mine.filter(function (m) { return m.id > read && m.from !== 'patient' && m.from !== 'system'; }).length,
      lastMessage: last ? { from: last.from, text: last.kind === 'quote' ? 'Suggested tests & price' : (last.body || 'Attachment'), at: last.at } : null,
      offerExpiresAt: null, createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
  }
  function detail(o) {
    var s = summary(o);
    s.address = o.address || null; s.note = o.note || null; s.cancelReason = o.cancelReason || null; s.discount = Math.max(0, o.mrp - o.total);
    s.lines = o.lines.map(function (l) { return { name: l.name, price: l.price, mrp: l.mrp }; });
    s.prescriptions = o.prescriptions.map(fileJson).filter(Boolean);
    s.reports = o.reports.map(fileJson).filter(Boolean);
    s.timeline = o.timeline;
    s.actions = [];
    if (CANCELLABLE.indexOf(o.status) >= 0) s.actions.push('cancel');
    if (o.status === 'quoted') s.actions.push('confirm');
    if (o.status !== 'cancelled') s.actions.push('chat');
    return s;
  }
  function findOrder(oid) { var u = requireMe(); var o = S.orders.filter(function (x) { return x.id === Number(oid) && x.userPhone === u.phone; })[0]; if (!o) throw err(404, 'Order not found.'); return o; }
  function newOrder(u, kind, loc, extra) {
    var area = resolveArea(loc.state, loc.city);
    var o = { id: id(), kind: kind, status: 'assigned', userPhone: u.phone, city: loc.city, state: loc.state, areaName: area.info.name, areaKind: area.info.kind,
      partner: { name: area.info.primary || 'Partner lab' }, lines: [], total: 0, mrp: 0, prescriptions: [], reports: [], timeline: [], phone: u.phone, memberName: u.name,
      createdAt: now(), updatedAt: now(), stepAt: now() };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    var d = new Date();
    o.orderNo = (kind === 'prescription' ? 'RX' : 'BT') + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + '-D' + pad(o.id, 3);
    S.orders.unshift(o);
    event(o, 'placed', 'placed');
    return o;
  }
  function readFile(f) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { res(''); }; r.readAsDataURL(f); });
  }
  async function storeFiles(form, o, purpose) {
    var ids = [];
    var files = form ? form.getAll('files[]').filter(function (f) { return f && f.size; }) : [];
    if (files.length > 5) throw err(400, 'You can attach up to 5 files at a time.');
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\/|application\/pdf/.test(f.type)) throw err(400, 'Only photos (JPG, PNG, WEBP, HEIC) and PDF files can be uploaded.');
      var fid = id();
      S.files[fid] = { name: f.name || 'file', mime: f.type, size: f.size, purpose: purpose, url: await readFile(f), at: now(), orderId: o.id };
      ids.push(fid);
    }
    return ids;
  }

  // ------------------------------------------------------------------ router
  async function handle(method, path, body, form) {
    if (!catalog) catalog = await (await origFetch('/blood-test/demo-catalog.json')).json();
    simulate();
    var m;
    if (method === 'GET' && path === '/catalog') return catalog;
    if (method === 'POST' && path === '/auth/otp') {
      var ph = normPhone(body.phone); if (!ph) throw err(400, 'Enter a valid 10-digit Indian mobile number.');
      S.pendingOtp = { phone: ph, code: String(Math.floor(100000 + Math.random() * 900000)) };
      return { sent: true, phone: '+91 ' + ph.slice(0, 5) + ' ' + ph.slice(5), isNew: !S.users[ph], testCode: S.pendingOtp.code };
    }
    if (method === 'POST' && path === '/auth/verify') {
      var p2 = normPhone(body.phone);
      if (!S.pendingOtp || S.pendingOtp.phone !== p2 || String(body.code) !== S.pendingOtp.code) throw err(400, 'Incorrect code. Please try again.');
      if (!S.users[p2]) { if (String(body.name || '').trim().length < 2) throw err(400, 'Enter your full name.'); S.users[p2] = { id: id(), phone: p2, name: String(body.name).trim(), email: '' }; }
      S.me = p2; S.pendingOtp = null;
      return { user: userJson(S.users[p2]) };
    }
    if (method === 'POST' && path === '/auth/logout') { S.me = null; return { ok: true }; }
    if (method === 'GET' && path === '/auth/me') return { user: me() ? userJson(me()) : null };
    var u = requireMe();
    if (method === 'PATCH' && path === '/me') { u.name = String(body.name || u.name).trim(); u.email = String(body.email || ''); return { user: userJson(u) }; }
    if (method === 'GET' && path === '/orders') return { items: S.orders.filter(function (o) { return o.userPhone === u.phone; }).map(summary) };
    if (method === 'POST' && path === '/orders') {
      var dup = S.orders.filter(function (o) { return o.clientRef === body.clientRef && o.userPhone === u.phone; })[0];
      if (dup) return { order: detail(dup) };
      if (!body.state) throw err(400, 'Select your state.');
      var bk = validateBooking(body, u);
      var tests = testsByIds(body.items || []);
      var o = newOrder(u, 'tests', body, { clientRef: body.clientRef, pincode: bk.pincode, address: bk.address, memberName: bk.memberName, age: bk.age, gender: bk.gender, slotDate: bk.slotDate, slotWindow: bk.slotWindow, phone: bk.phone,
        lines: tests.map(function (t) { return { testId: t.id, name: t.name, price: t.price, mrp: t.mrp }; }),
        total: tests.reduce(function (a, t) { return a + t.price; }, 0), mrp: tests.reduce(function (a, t) { return a + t.mrp; }, 0) });
      msg(o, 'system', 'Queue24', 'system', 'Order ' + o.orderNo + " placed. We're assigning a certified partner lab near you. (Demo: a simulated lab replies in a few seconds.)");
      return { order: detail(o) };
    }
    if (method === 'POST' && path === '/prescriptions') {
      var loc = { state: form.get('state'), city: form.get('city') };
      if (!loc.state) throw err(400, 'Select your state.');
      if (!form.getAll('files[]').length) throw err(400, 'Attach a photo or PDF of your prescription.');
      var rx = newOrder(u, 'prescription', loc, { note: form.get('note') || null, clientRef: form.get('clientRef') });
      var fids = await storeFiles(form, rx, 'prescription');
      rx.prescriptions = fids;
      msg(rx, 'patient', u.name, 'file', form.get('note') || 'Prescription uploaded', fids);
      msg(rx, 'system', 'Queue24', 'system', 'Prescription received. A partner lab will review it and suggest the tests with prices here in this chat. (Demo: simulated lab)');
      return { order: detail(rx) };
    }
    if ((m = path.match(/^\/orders\/(\d+)$/)) && method === 'GET') return { order: detail(findOrder(m[1])) };
    if ((m = path.match(/^\/orders\/(\d+)\/cancel$/)) && method === 'POST') {
      var oc = findOrder(m[1]);
      if (CANCELLABLE.indexOf(oc.status) < 0) throw err(400, "This order can't be cancelled at this stage.");
      oc.status = 'cancelled'; oc.cancelReason = body.reason || null; event(oc, 'cancelled', 'cancelled', body.reason); msg(oc, 'system', 'Queue24', 'system', 'Order cancelled' + (body.reason ? ': ' + body.reason : '.'));
      return { order: detail(oc) };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/confirm$/)) && method === 'POST') {
      var oq = findOrder(m[1]);
      if (oq.status !== 'quoted') throw err(400, 'There is no suggested test list to confirm right now.');
      var b2 = validateBooking(body, u);
      Object.assign(oq, { pincode: b2.pincode, address: b2.address, memberName: b2.memberName, age: b2.age, gender: b2.gender, slotDate: b2.slotDate, slotWindow: b2.slotWindow, phone: b2.phone, status: 'scheduled', stepAt: now() });
      event(oq, 'confirmed', 'scheduled'); msg(oq, 'system', 'Queue24', 'system', 'Booking confirmed. Pay ₹' + oq.total + ' at collection.');
      return { order: detail(oq) };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/messages$/)) && method === 'GET') {
      var om = findOrder(m[1]); var after = Number((body && body.after) || 0);
      var list = S.messages.filter(function (x) { return x.orderId === om.id && x.id > after; });
      if (list.length) S.reads[om.id] = Math.max(S.reads[om.id] || 0, list[list.length - 1].id);
      return { items: list.map(function (x) { return { id: x.id, from: x.from, name: x.name, kind: x.kind, body: x.body, files: x.fileIds.map(fileJson).filter(Boolean), meta: x.meta, at: x.at }; }), status: om.status, updatedAt: om.updatedAt };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/messages$/)) && method === 'POST') {
      var op = findOrder(m[1]);
      if (op.status === 'cancelled') throw err(400, 'This order was cancelled.');
      var text = String((form ? form.get('body') : body.body) || '').trim();
      var ids2 = await storeFiles(form, op, op.kind === 'prescription' ? 'prescription' : 'chat');
      if (!text && !ids2.length) throw err(400, 'Type a message or attach a file.');
      if (op.kind === 'prescription') op.prescriptions = op.prescriptions.concat(ids2);
      var sent = msg(op, 'patient', u.name, ids2.length ? 'file' : 'text', text || null, ids2);
      S.reads[op.id] = sent.id;
      setTimeout(function () { msg(op, 'partner', op.partner.name, 'text', 'Thanks, noted! (Demo: this is an automatic reply from the simulated lab.)'); save(); }, 3000);
      return { id: sent.id };
    }
    throw err(404, 'Not found');
  }

  function respond(promise) {
    return promise.then(function (data) { save(); return { status: 200, body: JSON.stringify(data) }; })
      .catch(function (e) { save(); return { status: e.status || 500, body: JSON.stringify({ error: e.message || 'Demo error' }) }; });
  }
  function parse(url) {
    var u = new URL(url, location.origin);
    if (u.pathname.indexOf(API) !== 0) return null;
    var q = {}; u.searchParams.forEach(function (v, k) { q[k] = v; });
    return { path: u.pathname.slice(API.length) || '/', query: q };
  }

  // ------------------------------------------------------------------ intercept fetch + XHR (uploads use XHR)
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var r = parse(url);
    if (!r) return origFetch(input, init);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = {};
    if (init && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    var form = init && init.body instanceof FormData ? init.body : null;
    if (method === 'GET') body = r.query;
    return respond(handle(method, r.path, body, form)).then(function (res) { return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } }); });
  };
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    var r = parse(url);
    this._demo = r ? { method: String(method).toUpperCase(), path: r.path } : null;
    if (!r) return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (!this._demo) return origSend.apply(this, arguments);
    var xhr = this; var d = this._demo;
    var form = body instanceof FormData ? body : null;
    respond(handle(d.method, d.path, form ? {} : (function () { try { return JSON.parse(body); } catch (e) { return {}; } })(), form)).then(function (res) {
      Object.defineProperty(xhr, 'status', { value: res.status, configurable: true });
      Object.defineProperty(xhr, 'responseText', { value: res.body, configurable: true });
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
      if (xhr.upload && xhr.upload.onprogress) xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 });
      if (xhr.onload) xhr.onload();
    });
  };
  window.__Q24_DEMO__ = true;

  // ------------------------------------------------------------------ demo banner
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.setAttribute('role', 'note');
    b.style.cssText = 'position:fixed;left:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:45;background:rgba(16,33,25,.92);color:#e8efe9;font:600 11.5px/1.2 "Plus Jakarta Sans",Arial,sans-serif;padding:5px 5px 5px 11px;border-radius:999px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);display:flex;align-items:center;gap:10px';
    b.title = 'Demo preview: a simulated lab replies, nothing is sent to a server, your orders stay in this browser.';
    b.innerHTML = '<span>🧪 Demo preview</span>';
    var reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.style.cssText = 'border:0;background:#1FA36E;color:#fff;font:700 12px Arial,sans-serif;padding:4px 10px;border-radius:999px;cursor:pointer';
    reset.onclick = function () { try { localStorage.removeItem(KEY); localStorage.removeItem('q24bt_cart'); } catch (e) { /* ignore */ } location.hash = '#/'; location.reload(); };
    b.appendChild(reset);
    document.body.appendChild(b);
  });
})();
