/*
 * Queue24 Labs — DEMO MODE for static hosting (Vercel has no PHP or database).
 * Loaded only by the TEST site's /blood-test and /lab-partners pages. It answers the same API calls as the
 * real PHP backend, inside the browser, and both portals share one store, so in the same browser:
 *   patient books / uploads a prescription on /blood-test  →  the area's lab sees it on /lab-partners
 *   lab accepts, suggests tests, collects, uploads the report, chats  →  the patient sees it live.
 * Catalog, cities and lab accounts come from demo-catalog.json (exported from the real seed data, no passwords).
 * Orders/chat live in localStorage, files (photos, PDFs) in IndexedDB. Nothing is sent to any server.
 * "Auto lab" (on by default) plays the lab for you; it switches off when you sign in to the lab portal.
 */
(function () {
  'use strict';
  var SCOPE = location.pathname.indexOf('/lab-partners') === 0 ? 'partner' : 'patient'; // which page we are on (demo bar)
  var API = SCOPE === 'partner' ? '/lab-partners/api' : '/blood-test/api';
  var BASES = { '/blood-test/api': 'patient', '/lab-partners/api': 'partner' }; // either page answers both APIs
  var KEY = 'q24_demo_v2';
  var catalog = null;

  // ------------------------------------------------------------------ store (re-read on every request: two tabs stay in sync)
  function fresh() { return { seq: 1, users: {}, me: null, partnerMe: null, autoLab: true, orders: [], messages: [], reads: { patient: {}, partner: {} }, otp: null }; }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { return fresh(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } }
  var S = load();

  var idb = null;
  function fdb() {
    if (idb) return idb;
    idb = new Promise(function (res, rej) {
      var r = indexedDB.open('q24-demo-files', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return idb;
  }
  function fput(id, rec) { return fdb().then(function (db) { return new Promise(function (res) { var t = db.transaction('files', 'readwrite'); t.objectStore('files').put(rec, id); t.oncomplete = res; t.onerror = res; }); }).catch(function () {}); }
  function fget(id) { return fdb().then(function (db) { return new Promise(function (res) { var g = db.transaction('files').objectStore('files').get(id); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }

  // ------------------------------------------------------------------ helpers
  function nid() { return S.seq++; }
  function now() { return new Date().toISOString(); }
  function err(status, msg) { var e = new Error(msg); e.status = status; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function fmtPhone(p) { return p ? '+91 ' + p.slice(0, 5) + ' ' + p.slice(5) : ''; }
  function maskPhone(p) { return p ? p.slice(0, 2) + 'XXXXXX' + p.slice(-2) : ''; }
  function normPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); return /^[6-9]\d{9}$/.test(d) ? d : null; }
  function lab(id) { return catalog.partners.filter(function (p) { return p.id === id; })[0] || null; }
  function prettyDay(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }

  var LABELS = { placed: 'Placed', assigned: 'Waiting for lab to accept', in_review: 'Lab is reviewing prescription', quoted: 'Tests suggested by lab', scheduled: 'Sample collection scheduled',
    collected: 'Sample collected', processing: 'Testing in lab', report_ready: 'Report ready', completed: 'Completed', cancelled: 'Cancelled', needs_attention: 'Needs attention' };
  function label(st, scope) {
    if (scope === 'patient' && (st === 'needs_attention' || st === 'placed')) return 'Finding the best lab for you';
    if (scope === 'patient' && st === 'assigned') return 'Waiting for lab confirmation';
    if (scope === 'partner' && st === 'assigned') return 'New request: accept or reject';
    return LABELS[st] || st;
  }
  var CANCELLABLE = ['placed', 'assigned', 'in_review', 'quoted', 'scheduled', 'needs_attention'];
  var BUCKETS = { 'new': ['assigned'], active: ['in_review', 'quoted', 'scheduled', 'collected', 'processing', 'report_ready'], done: ['completed', 'cancelled'] };
  function offerMs() { return (catalog.acceptTimeoutMin || 30) * 60000; }

  function event(o, action, by, to, note) { o.timeline.push({ action: action, by: by, to: to || null, note: note || null, at: now() }); }
  function msg(o, from, name, kind, body, fileIds, meta) {
    var m = { id: nid(), orderId: o.id, from: from, name: name, kind: kind, body: body || null, fileIds: fileIds || [], meta: meta || null, at: now() };
    S.messages.push(m); o.updatedAt = m.at; return m;
  }
  function setStatus(o, to) { o.status = to; o.stepAt = now(); o.updatedAt = o.stepAt; }

  // offer to primary → backup → needs attention (same routing as the real backend)
  function offerTo(o, partnerId, role) {
    o.partnerId = partnerId; o.partnerRole = role; o.offerExpiresAt = new Date(Date.now() + offerMs()).toISOString();
    o.offered = (o.offered || []).concat(partnerId);
    setStatus(o, 'assigned'); event(o, 'offered', 'system', 'assigned', (lab(partnerId) || {}).name);
  }
  function offerNext(o) {
    var a = catalog.areaInfo[o.areaId] || {};
    var next = [[a.primaryId, 'primary'], [a.backupId, 'backup']].filter(function (x) { return x[0] && (o.offered || []).indexOf(x[0]) < 0; })[0];
    if (next) offerTo(o, next[0], next[1]);
    else { o.partnerId = null; o.partnerRole = null; o.offerExpiresAt = null; setStatus(o, 'needs_attention'); event(o, 'unassigned', 'system', 'needs_attention', 'No lab accepted'); }
  }

  // ------------------------------------------------------------------ lab actions (used by the portal AND by "Auto lab")
  function doAccept(o) {
    var p = lab(o.partnerId);
    var to = o.kind === 'prescription' ? 'in_review' : 'scheduled';
    o.offerExpiresAt = null; setStatus(o, to); event(o, 'accepted', 'partner', to, p.name);
    msg(o, 'system', 'Queue24', 'system', o.kind === 'prescription' ? p.name + ' is reviewing your prescription and will reply here shortly.'
      : p.name + ' confirmed your order. Our phlebotomist will visit on ' + prettyDay(o.slotDate) + ', ' + catalog.slots[o.slotWindow] + '.');
  }
  function doQuote(o, ids, note) {
    var tests = catalog.tests.filter(function (t) { return ids.indexOf(t.id) >= 0; });
    if (!tests.length) throw err(400, 'Select the tests from the prescription.');
    o.lines = tests.map(function (t) { return { testId: t.id, name: t.name, price: t.price, mrp: t.mrp }; });
    o.total = tests.reduce(function (a, t) { return a + t.price; }, 0); o.mrp = tests.reduce(function (a, t) { return a + t.mrp; }, 0);
    var from = o.status; setStatus(o, 'quoted');
    msg(o, 'partner', lab(o.partnerId).name, 'quote', note || 'Based on your prescription, these are the tests you need.', [],
      { items: o.lines.map(function (l) { return { name: l.name, price: l.price, mrp: l.mrp }; }), total: o.total, mrp: o.mrp });
    event(o, 'quoted', 'partner', 'quoted', tests.length + ' test(s), ₹' + o.total + (from === 'quoted' ? ' (updated)' : ''));
  }
  var STEPS = { collected: 'scheduled', processing: 'collected', completed: 'report_ready' };
  var STEP_MSG = { collected: "Sample collected. It's on its way to the lab.", processing: 'Your sample is being tested in the lab.', completed: 'Order completed. Thank you for choosing Queue24!' };
  function doStep(o, to) {
    if (o.status !== STEPS[to]) throw err(400, "This order isn't at that step. Please refresh.");
    setStatus(o, to); event(o, to, 'partner', to); msg(o, 'system', 'Queue24', 'system', STEP_MSG[to]);
  }
  function doReport(o, fileIds) {
    if (o.status !== 'report_ready') { setStatus(o, 'report_ready'); event(o, 'report', 'partner', 'report_ready', fileIds.length + ' file(s)'); }
    o.reports = o.reports.concat(fileIds);
    msg(o, 'partner', lab(o.partnerId).name, 'file', 'Your report is ready.', fileIds, { report: true });
  }

  var pendingFiles = [];
  // simulated lab: time-based, only while "Auto lab" is on
  function simulate() {
    var t = Date.now();
    S.orders.forEach(function (o) {
      if (o.status === 'assigned' && o.offerExpiresAt && t > new Date(o.offerExpiresAt).getTime()) { event(o, 'expired', 'system', null, (lab(o.partnerId) || {}).name); offerNext(o); return; }
      if (!S.autoLab) return;
      var age = (t - new Date(o.stepAt).getTime()) / 1000;
      if (o.status === 'assigned' && age > 8) doAccept(o);
      else if (o.status === 'in_review' && age > 10) {
        msg(o, 'partner', lab(o.partnerId).name, 'text', 'Hi! We checked your prescription. Sending the test list with prices below.');
        doQuote(o, catalog.tests.filter(function (x) { return ['THY', 'CBC', 'VITD'].indexOf(x.code) >= 0; }).map(function (x) { return x.id; }), 'No fasting needed for these tests. (Auto lab demo)');
      } else if (o.status === 'scheduled' && age > 20) doStep(o, 'collected');
      else if (o.status === 'collected' && age > 15) doStep(o, 'processing');
      else if (o.status === 'processing' && age > 15) {
        var fid = nid();
        var pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 62>>stream\nBT /F1 18 Tf 40 120 Td (Queue24 DEMO report - not real) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
        pendingFiles.push([fid, { name: 'demo-report.pdf', mime: 'application/pdf', size: pdf.length, purpose: 'report', url: 'data:application/pdf;base64,' + btoa(pdf), at: now(), orderId: o.id }]);
        doReport(o, [fid]);
      }
    });
  }

  // ------------------------------------------------------------------ serializers (same shapes as the PHP API)
  function partnerJson(p) { return { id: p.id, code: p.code, name: p.name, email: p.email, phone: '', city: p.city, state: p.state, contactPerson: 'Lab manager', areas: p.areas.map(function (a) { return { name: a.name, kind: a.kind, role: a.role }; }) }; }
  function userJson(u) { return { id: u.id, name: u.name, phone: fmtPhone(u.phone), email: u.email || '' }; }
  async function fileJson(fid) {
    var pending = pendingFiles.filter(function (x) { return x[0] === fid; })[0]; // uploaded in this request, not saved yet
    var f = pending ? pending[1] : await fget(fid);
    return f ?{ id: fid, name: f.name, mime: f.mime, size: f.size, purpose: f.purpose, url: f.url, at: f.at } : null; }
  async function filesJson(ids) { var out = []; for (var i = 0; i < ids.length; i++) { var f = await fileJson(ids[i]); if (f) out.push(f); } return out; }
  function summary(o, scope) {
    var mine = S.messages.filter(function (m) { return m.orderId === o.id; });
    var last = mine[mine.length - 1];
    var read = S.reads[scope][o.id] || 0;
    var hide = scope === 'partner' && o.status === 'assigned';
    var p = o.partnerId ? lab(o.partnerId) : null;
    var area = catalog.areaInfo[o.areaId] || {};
    return {
      id: o.id, orderNo: o.orderNo, kind: o.kind, status: o.status, statusLabel: label(o.status, scope),
      patientName: o.memberName, age: o.age || null, gender: o.gender || null, city: o.city, state: o.state, pincode: o.pincode || null,
      area: area.name || '', areaKind: area.kind || '',
      slotDate: o.slotDate || null, slotWindow: o.slotWindow || null, slotLabel: o.slotWindow ? catalog.slots[o.slotWindow] : null,
      items: o.lines.map(function (l) { return l.name; }), total: o.total, mrp: o.mrp,
      partner: p ? { id: p.id, name: p.name, city: p.city, role: scope === 'patient' ? null : o.partnerRole } : null,
      phone: hide ? maskPhone(o.phone) : fmtPhone(o.phone),
      unread: mine.filter(function (m) { return m.id > read && m.from !== scope && m.from !== 'system'; }).length,
      lastMessage: last ? { from: last.from, text: last.kind === 'quote' ? 'Suggested tests & price' : (last.body || 'Attachment'), at: last.at } : null,
      offerExpiresAt: o.status === 'assigned' ? o.offerExpiresAt : null, createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
  }
  async function detail(o, scope) {
    var s = summary(o, scope);
    var hide = scope === 'partner' && o.status === 'assigned';
    s.address = hide ? null : (o.address || null); s.note = o.note || null; s.cancelReason = o.cancelReason || null; s.discount = Math.max(0, o.mrp - o.total);
    s.lines = o.lines.map(function (l) { return { name: l.name, price: l.price, mrp: l.mrp }; });
    s.prescriptions = await filesJson(o.prescriptions); s.reports = await filesJson(o.reports);
    var hidden = scope === 'patient' ? ['offered', 'expired', 'rejected', 'unassigned'] : ['expired', 'unassigned'];
    s.timeline = o.timeline.filter(function (e) { return hidden.indexOf(e.action) < 0; });
    var a = [], st = o.status;
    if (scope === 'patient') { if (CANCELLABLE.indexOf(st) >= 0) a.push('cancel'); if (st === 'quoted') a.push('confirm'); if (st !== 'cancelled') a.push('chat'); }
    else {
      if (st === 'assigned') a.push('accept', 'reject');
      if (o.kind === 'prescription' && (st === 'in_review' || st === 'quoted')) a.push('quote');
      if (st === 'scheduled') a.push('collected');
      if (st === 'collected') a.push('processing');
      if (['collected', 'processing', 'report_ready'].indexOf(st) >= 0) a.push('report');
      if (st === 'report_ready') a.push('completed');
      if (st !== 'assigned' && st !== 'cancelled') a.push('chat');
    }
    s.actions = a;
    return s;
  }
  async function messagesFor(o, scope, after) {
    var list = S.messages.filter(function (x) { return x.orderId === o.id && x.id > after; });
    if (list.length) S.reads[scope][o.id] = Math.max(S.reads[scope][o.id] || 0, list[list.length - 1].id);
    var out = [];
    for (var i = 0; i < list.length; i++) { var m = list[i]; out.push({ id: m.id, from: m.from, name: m.name, kind: m.kind, body: m.body, files: await filesJson(m.fileIds), meta: m.meta, at: m.at }); }
    return { items: out, status: o.status, updatedAt: o.updatedAt };
  }

  // ------------------------------------------------------------------ uploads
  function readAsDataURL(f) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { res(''); }; r.readAsDataURL(f); }); }
  async function takeFiles(form, o, purpose) {
    var files = form ? form.getAll('files[]').filter(function (f) { return f && f.size; }) : [];
    if (files.length > 5) throw err(400, 'You can attach up to 5 files at a time.');
    var ids = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.type && !/^image\/|application\/pdf/.test(f.type)) throw err(400, 'Only photos (JPG, PNG, WEBP, HEIC) and PDF files can be uploaded.');
      if (f.size > 15 * 1048576) throw err(400, 'Each file must be under 15 MB.');
      var fid = nid();
      pendingFiles.push([fid, { name: f.name || 'file', mime: f.type || 'image/jpeg', size: f.size, purpose: purpose, url: await readAsDataURL(f), at: now(), orderId: o.id }]);
      ids.push(fid);
    }
    return ids;
  }

  // ------------------------------------------------------------------ booking validation (same rules and messages as the PHP API)
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
  function resolveArea(state, city) {
    var st = catalog.areas.filter(function (a) { return a.name === state; })[0];
    if (!st) throw err(400, "Sorry, we don't serve this location yet. Please pick your state from the list.");
    var c = st.cities.filter(function (x) { return x.name.toLowerCase() === String(city || '').toLowerCase(); })[0];
    return c ? c.areaId : (st.otherAreaId || (st.cities[0] && st.cities[0].areaId));
  }
  function newOrder(u, kind, loc, extra) {
    var areaId = resolveArea(loc.state, loc.city);
    var o = { id: nid(), kind: kind, status: 'placed', userPhone: u.phone, city: loc.city, state: loc.state, areaId: areaId, partnerId: null, partnerRole: null, offered: [],
      lines: [], total: 0, mrp: 0, prescriptions: [], reports: [], timeline: [], phone: u.phone, memberName: u.name, createdAt: now(), updatedAt: now(), stepAt: now() };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    var d = new Date();
    o.orderNo = (kind === 'prescription' ? 'RX' : 'BT') + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-D' + ('00' + o.id).slice(-3);
    S.orders.unshift(o);
    event(o, 'placed', 'patient', 'placed');
    offerNext(o);
    return o;
  }

  // ------------------------------------------------------------------ patient API (/blood-test/api)
  function me() { return S.me ? S.users[S.me] : null; }
  function myOrder(oid) { var u = me(); if (!u) throw err(401, 'Please verify your mobile number to continue.'); var o = S.orders.filter(function (x) { return x.id === Number(oid) && x.userPhone === u.phone; })[0]; if (!o) throw err(404, 'Order not found.'); return o; }
  async function patientApi(method, path, body, form) {
    var m;
    if (method === 'GET' && path === '/catalog') return { tests: catalog.tests, areas: catalog.areas, slots: catalog.slots, genders: catalog.genders, otpTestMode: true, acceptTimeoutMin: catalog.acceptTimeoutMin };
    if (method === 'POST' && path === '/auth/otp') {
      var ph = normPhone(body.phone); if (!ph) throw err(400, 'Enter a valid 10-digit Indian mobile number.');
      S.otp = { phone: ph, code: String(Math.floor(100000 + Math.random() * 900000)) };
      return { sent: true, phone: fmtPhone(ph), isNew: !S.users[ph], testCode: S.otp.code };
    }
    if (method === 'POST' && path === '/auth/verify') {
      var p2 = normPhone(body.phone);
      if (!S.otp || S.otp.phone !== p2 || String(body.code) !== S.otp.code) throw err(400, 'Incorrect code. Please try again.');
      if (!S.users[p2]) { if (String(body.name || '').trim().length < 2) throw err(400, 'Enter your full name.'); S.users[p2] = { id: nid(), phone: p2, name: String(body.name).trim(), email: '' }; }
      S.me = p2; S.otp = null;
      return { user: userJson(S.users[p2]) };
    }
    if (method === 'POST' && path === '/auth/logout') { S.me = null; return { ok: true }; }
    if (method === 'GET' && path === '/auth/me') return { user: me() ? userJson(me()) : null };
    var u = me(); if (!u) throw err(401, 'Please verify your mobile number to continue.');
    if (method === 'PATCH' && path === '/me') { u.name = String(body.name || u.name).trim(); u.email = String(body.email || ''); return { user: userJson(u) }; }
    if (method === 'GET' && path === '/orders') return { items: S.orders.filter(function (o) { return o.userPhone === u.phone; }).map(function (o) { return summary(o, 'patient'); }) };
    if (method === 'POST' && path === '/orders') {
      var dup = S.orders.filter(function (o) { return o.clientRef && o.clientRef === body.clientRef && o.userPhone === u.phone; })[0];
      if (dup) return { order: await detail(dup, 'patient') };
      if (!body.state) throw err(400, 'Select your state.');
      var bk = validateBooking(body, u);
      var tests = catalog.tests.filter(function (t) { return (body.items || []).indexOf(t.id) >= 0; });
      if (!tests.length) throw err(400, 'Add at least one test.');
      var o = newOrder(u, 'tests', body, { clientRef: body.clientRef, pincode: bk.pincode, address: bk.address, memberName: bk.memberName, age: bk.age, gender: bk.gender, slotDate: bk.slotDate, slotWindow: bk.slotWindow, phone: bk.phone,
        lines: tests.map(function (t) { return { testId: t.id, name: t.name, price: t.price, mrp: t.mrp }; }),
        total: tests.reduce(function (a, t) { return a + t.price; }, 0), mrp: tests.reduce(function (a, t) { return a + t.mrp; }, 0) });
      msg(o, 'system', 'Queue24', 'system', 'Order ' + o.orderNo + " placed. We're assigning a certified partner lab near you.");
      return { order: await detail(o, 'patient') };
    }
    if (method === 'POST' && path === '/prescriptions') {
      var loc = { state: form.get('state'), city: form.get('city') };
      if (!loc.state) throw err(400, 'Select your state.');
      if (!form.getAll('files[]').filter(function (f) { return f && f.size; }).length) throw err(400, 'Attach a photo or PDF of your prescription.');
      var ref = form.get('clientRef');
      var dupRx = S.orders.filter(function (o) { return ref && o.clientRef === ref && o.userPhone === u.phone; })[0];
      if (dupRx) return { order: await detail(dupRx, 'patient') };
      var rx = newOrder(u, 'prescription', loc, { note: form.get('note') || null, clientRef: ref });
      var fids = await takeFiles(form, rx, 'prescription');
      rx.prescriptions = fids;
      msg(rx, 'patient', u.name, 'file', form.get('note') || 'Prescription uploaded', fids);
      msg(rx, 'system', 'Queue24', 'system', 'Prescription received. A partner lab will review it and suggest the tests with prices here in this chat.');
      return { order: await detail(rx, 'patient') };
    }
    if ((m = path.match(/^\/orders\/(\d+)$/)) && method === 'GET') return { order: await detail(myOrder(m[1]), 'patient') };
    if ((m = path.match(/^\/orders\/(\d+)\/cancel$/)) && method === 'POST') {
      var oc = myOrder(m[1]);
      if (CANCELLABLE.indexOf(oc.status) < 0) throw err(400, "This order can't be cancelled at this stage.");
      oc.cancelReason = body.reason || null; oc.offerExpiresAt = null; setStatus(oc, 'cancelled'); event(oc, 'cancelled', 'patient', 'cancelled', body.reason);
      msg(oc, 'system', 'Queue24', 'system', 'Order cancelled' + (body.reason ? ': ' + body.reason : '.'));
      return { order: await detail(oc, 'patient') };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/confirm$/)) && method === 'POST') {
      var oq = myOrder(m[1]);
      if (oq.status !== 'quoted') throw err(400, 'There is no suggested test list to confirm right now.');
      var b2 = validateBooking(body, u);
      Object.keys(b2).forEach(function (k) { oq[k] = b2[k]; });
      setStatus(oq, 'scheduled'); event(oq, 'confirmed', 'patient', 'scheduled', '₹' + oq.total);
      msg(oq, 'system', 'Queue24', 'system', 'Booking confirmed. Sample collection on ' + prettyDay(oq.slotDate) + ', ' + catalog.slots[oq.slotWindow] + '.');
      return { order: await detail(oq, 'patient') };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/messages$/)) && method === 'GET') return messagesFor(myOrder(m[1]), 'patient', Number(body.after || 0));
    if ((m = path.match(/^\/orders\/(\d+)\/messages$/)) && method === 'POST') {
      var op = myOrder(m[1]);
      if (op.status === 'cancelled') throw err(400, 'This order was cancelled.');
      var text = String((form ? form.get('body') : body.body) || '').trim();
      var ids2 = await takeFiles(form, op, op.kind === 'prescription' ? 'prescription' : 'chat');
      if (!text && !ids2.length) throw err(400, 'Type a message or attach a file.');
      if (op.kind === 'prescription') op.prescriptions = op.prescriptions.concat(ids2);
      var sent = msg(op, 'patient', u.name, ids2.length ? 'file' : 'text', text || null, ids2);
      S.reads.patient[op.id] = sent.id;
      if (S.autoLab && op.partnerId && op.status !== 'assigned') op.autoReplyAt = Date.now() + 3000;
      return { id: sent.id };
    }
    throw err(404, 'Not found');
  }

  // ------------------------------------------------------------------ lab partner API (/lab-partners/api)
  function myLab() { var p = S.partnerMe ? lab(S.partnerMe) : null; if (!p) throw err(401, 'Please sign in to continue.'); return p; }
  function labOrder(p, oid) { var o = S.orders.filter(function (x) { return x.id === Number(oid); })[0]; if (!o || o.partnerId !== p.id) throw err(404, 'Order not found.'); return o; }
  async function partnerApi(method, path, body, form) {
    var m;
    if (method === 'POST' && path === '/auth/login') {
      var id = String(body.identifier || '').trim().toLowerCase();
      if (!id || !String(body.password || '')) throw err(400, 'Enter your login ID and password.');
      var p = catalog.partners.filter(function (x) { return x.email.toLowerCase() === id || x.code.toLowerCase() === id; })[0];
      if (!p) throw err(401, 'Incorrect login ID or password. (Demo: use a lab code such as DEL-P, any password.)');
      S.partnerMe = p.id;
      S.autoLab = false; // you are the lab now
      return { user: partnerJson(p) };
    }
    if (method === 'POST' && path === '/auth/logout') { S.partnerMe = null; return { ok: true }; }
    if (method === 'GET' && path === '/auth/me') return { user: S.partnerMe && lab(S.partnerMe) ? partnerJson(lab(S.partnerMe)) : null };
    if (method === 'GET' && path === '/catalog') return { tests: catalog.tests };
    var p2 = myLab();
    if (method === 'POST' && path === '/auth/change-password') { if (String(body.next || '').length < 8) throw err(400, 'New password must be at least 8 characters.'); return { ok: true }; }
    var mine = S.orders.filter(function (o) { return o.partnerId === p2.id; });
    if (method === 'GET' && path === '/dashboard') {
      var c = {};
      Object.keys(BUCKETS).forEach(function (k) { c[k] = mine.filter(function (o) { return BUCKETS[k].indexOf(o.status) >= 0; }).length; });
      c.today = mine.filter(function (o) { return o.status === 'scheduled' && o.slotDate === addDays(0); }).length;
      c.prescriptions = mine.filter(function (o) { return o.kind === 'prescription' && (o.status === 'in_review' || o.status === 'quoted'); }).length;
      c.reportsDue = mine.filter(function (o) { return o.status === 'collected' || o.status === 'processing'; }).length;
      c.unread = mine.reduce(function (a, o) { return a + summary(o, 'partner').unread; }, 0);
      return { counts: c, user: partnerJson(p2), acceptTimeoutMin: catalog.acceptTimeoutMin };
    }
    if (method === 'GET' && path === '/orders') {
      var b = BUCKETS[body.bucket] ? body.bucket : 'active';
      var list = mine.filter(function (o) { return BUCKETS[b].indexOf(o.status) >= 0 && (!body.kind || body.kind === o.kind); });
      if (b === 'new') list.sort(function (x, y) { return x.id - y.id; });
      return { items: list.map(function (o) { return summary(o, 'partner'); }) };
    }
    if ((m = path.match(/^\/orders\/(\d+)$/)) && method === 'GET') return { order: await detail(labOrder(p2, m[1]), 'partner') };
    if ((m = path.match(/^\/orders\/(\d+)\/(accept|reject|collected|processing|completed|quote)$/)) && method === 'POST') {
      var o = labOrder(p2, m[1]); var action = m[2];
      if (action === 'accept') { if (o.status !== 'assigned') throw err(400, 'This request is no longer available to you.'); doAccept(o); }
      else if (action === 'reject') {
        if (o.status !== 'assigned') throw err(400, 'This request is no longer available to you.');
        if (String(body.reason || '').trim().length < 3) throw err(400, 'Please give a short reason.');
        event(o, 'rejected', 'partner', null, body.reason); offerNext(o);
      } else if (action === 'quote') {
        if (o.kind !== 'prescription' || (o.status !== 'in_review' && o.status !== 'quoted')) throw err(400, 'You can suggest tests only while reviewing a prescription.');
        doQuote(o, (body.items || []).map(Number), String(body.note || '').trim());
      } else doStep(o, action);
      return { order: o.partnerId === p2.id ? await detail(o, 'partner') : null };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/report$/)) && method === 'POST') {
      var orp = labOrder(p2, m[1]);
      if (['collected', 'processing', 'report_ready'].indexOf(orp.status) < 0) throw err(400, 'Reports can be uploaded after the sample is collected.');
      var rids = await takeFiles(form, orp, 'report');
      if (!rids.length) throw err(400, 'Attach the report (PDF or photo).');
      doReport(orp, rids);
      return { order: await detail(orp, 'partner') };
    }
    if ((m = path.match(/^\/orders\/(\d+)\/messages$/)) && method === 'GET') return messagesFor(labOrder(p2, m[1]), 'partner', Number(body.after || 0));
    if ((m = path.match(/^\/orders\/(\d+)\/messages$/)) && method === 'POST') {
      var om = labOrder(p2, m[1]);
      if (om.status === 'assigned' || om.status === 'cancelled') throw err(400, 'Chat is not available for this order.');
      var t2 = String((form ? form.get('body') : body.body) || '').trim();
      var fi = await takeFiles(form, om, 'chat');
      if (!t2 && !fi.length) throw err(400, 'Type a message or attach a file.');
      var s2 = msg(om, 'partner', p2.name, fi.length ? 'file' : 'text', t2 || null, fi);
      S.reads.partner[om.id] = s2.id;
      return { id: s2.id };
    }
    throw err(404, 'Not found');
  }

  // ------------------------------------------------------------------ dispatcher
  function getCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return origFetch('/blood-test/demo-catalog.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (c) { catalog = c; return c; });
  }
  async function handle(scope, method, path, body, form) {
    await getCatalog();
    S = load(); pendingFiles = [];
    simulate();
    S.orders.forEach(function (o) { if (o.autoReplyAt && Date.now() > o.autoReplyAt) { o.autoReplyAt = null; msg(o, 'partner', lab(o.partnerId).name, 'text', 'Thanks, noted! (Auto lab demo reply)'); } });
    try { return scope === 'partner' ? await partnerApi(method, path, body, form) : await patientApi(method, path, body, form); }
    finally { for (var i = 0; i < pendingFiles.length; i++) await fput(pendingFiles[i][0], pendingFiles[i][1]); pendingFiles = []; }
  }
  function respond(p) {
    return p.then(function (data) { save(); return { status: 200, body: JSON.stringify(data) }; })
      .catch(function (e) { S = load(); return { status: e.status || 500, body: JSON.stringify({ error: e.message || 'Demo error' }) }; });
  }
  function parse(url) {
    var u = new URL(url, location.origin);
    if (u.origin !== location.origin) return null;
    var base = Object.keys(BASES).filter(function (b) { return u.pathname.indexOf(b) === 0; })[0];
    if (!base) return null;
    var q = {}; u.searchParams.forEach(function (v, k) { q[k] = v; });
    return { scope: BASES[base], path: u.pathname.slice(base.length) || '/', query: q };
  }

  // ------------------------------------------------------------------ intercept fetch + XHR (uploads use XHR)
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var r = parse(typeof input === 'string' ? input : input.url);
    if (!r) return origFetch(input, init);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = {};
    if (init && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    var form = init && typeof FormData !== 'undefined' && init.body instanceof FormData ? init.body : null;
    if (method === 'GET') body = r.query;
    return respond(handle(r.scope, method, r.path, body, form)).then(function (res) { return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } }); });
  };
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    var r = parse(url);
    this._demo = r ? { scope: r.scope, method: String(method).toUpperCase(), path: r.path } : null;
    if (!r) return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (!this._demo) return origSend.apply(this, arguments);
    var xhr = this, d = this._demo, form = body instanceof FormData ? body : null;
    var json = {}; if (!form && typeof body === 'string') { try { json = JSON.parse(body); } catch (e) { json = {}; } }
    respond(handle(d.scope, d.method, d.path, json, form)).then(function (res) {
      Object.defineProperty(xhr, 'status', { value: res.status, configurable: true });
      Object.defineProperty(xhr, 'responseText', { value: res.body, configurable: true });
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
      if (xhr.upload && xhr.upload.onprogress) xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 });
      if (xhr.onload) xhr.onload();
    });
  };
  window.__Q24_DEMO__ = true;

  // ------------------------------------------------------------------ demo bar (bottom-left; sheets and menus cover it)
  function bar() {
    S = load();
    var b = document.getElementById('q24-demo-bar') || document.createElement('div');
    b.id = 'q24-demo-bar'; b.setAttribute('role', 'note');
    b.style.cssText = 'position:fixed;left:10px;bottom:calc(' + (SCOPE === 'partner' ? 76 : 84) + 'px + env(safe-area-inset-bottom));z-index:45;max-width:calc(100vw - 20px);background:rgba(16,33,25,.94);color:#e8efe9;font:600 11.5px/1.2 "Plus Jakarta Sans",Arial,sans-serif;padding:5px;border-radius:999px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);display:flex;align-items:center;gap:5px';
    var btn = 'border:0;color:#fff;font:700 11.5px Arial,sans-serif;padding:5px 9px;border-radius:999px;cursor:pointer;white-space:nowrap;';
    b.innerHTML = '<span style="padding-left:6px;white-space:nowrap" title="Demo preview: nothing is sent to a server. Orders, chats and files stay in this browser and are shared between /blood-test and /lab-partners.">🧪 Demo</span>'
      + '<button data-a="auto" style="' + btn + 'background:' + (S.autoLab ? '#1FA36E' : '#4a5a52') + '" title="When on, a simulated lab accepts, quotes and sends a sample report by itself. Signing in to the lab portal turns it off.">Auto lab ' + (S.autoLab ? 'ON' : 'OFF') + '</button>'
      + (SCOPE === 'patient' ? '<a href="/lab-partners/" style="' + btn + 'background:#2b3d34;text-decoration:none">Lab portal ↗</a>' : '<a href="/blood-test/" style="' + btn + 'background:#2b3d34;text-decoration:none">Patient site ↗</a>')
      + '<button data-a="reset" style="' + btn + 'background:#7a2b2b">Reset</button>';
    b.onclick = function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'auto') { S = load(); S.autoLab = !S.autoLab; save(); bar(); }
      if (a === 'reset') {
        if (!confirm('Clear all demo orders, chats and sign-ins in this browser?')) return;
        try { localStorage.removeItem(KEY); localStorage.removeItem('q24bt_cart'); localStorage.removeItem('q24bt_ref'); indexedDB.deleteDatabase('q24-demo-files'); } catch (x) { /* ignore */ }
        location.hash = '#/'; location.reload();
      }
    };
    if (!b.parentNode) document.body.appendChild(b);
  }
  // lab portal login: one-tap sign-in as any seeded lab (labs that received your orders are listed first)
  function labPicker() {
    if (SCOPE !== 'partner') return;
    setInterval(function () {
      var card = document.querySelector('.login-card');
      if (!card || card.querySelector('#q24-demo-labs')) return;
      getCatalog().then(function () {
        if (card.querySelector('#q24-demo-labs')) return;
        S = load();
        var used = {}; S.orders.forEach(function (o) { if (o.partnerId) used[o.partnerId] = (used[o.partnerId] || 0) + 1; });
        var labs = catalog.partners.slice().sort(function (a, b) { return (used[b.id] || 0) - (used[a.id] || 0); });
        var box = document.createElement('div');
        box.id = 'q24-demo-labs';
        box.style.cssText = 'margin:4px 0 6px;padding:12px;border-radius:14px;background:#eef7f2;border:1px dashed #1FA36E;font:500 13px/1.4 "Plus Jakarta Sans",Arial,sans-serif;color:#0b5d3b';
        box.innerHTML = '<b>Demo sign-in</b><br>Pick a lab. Labs that received your orders are listed first. No password needed in the demo.'
          + '<select style="width:100%;margin-top:8px;padding:10px;border-radius:10px;border:1px solid #cfe3d8;font-size:14px;background:#fff">'
          + labs.map(function (l) { return '<option value="' + l.code + '">' + l.name + (used[l.id] ? ' · ' + used[l.id] + ' order(s)' : '') + '</option>'; }).join('') + '</select>'
          + '<button type="button" style="margin-top:8px;width:100%;border:0;background:#1FA36E;color:#fff;font:700 14px Arial,sans-serif;padding:11px;border-radius:12px;cursor:pointer">Sign in as this lab</button>';
        box.querySelector('button').onclick = function () {
          fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: box.querySelector('select').value, password: 'demo' }) })
            .then(function () { location.hash = '#/'; location.reload(); });
        };
        var after = card.querySelector('p');
        card.insertBefore(box, after ? after.nextSibling : card.firstChild);
      });
    }, 500);
  }
  document.addEventListener('DOMContentLoaded', function () {
    bar(); labPicker();
    setInterval(function () { var x = load(); if (x.autoLab !== S.autoLab) bar(); }, 3000);
  });
})();
