'use strict';
// Local preview that behaves like Vercel: static files only, PHP never runs, .vercelignore'd paths 404.
//   node tools/static-server.js [port]
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PORT = Number(process.env.PORT || process.argv[2] || 8095);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const IGNORED = /^\/(_q24h|sales-crm|tools|blood-test\/api|lab-partners\/api)(\/|$)|\.php$|\.htaccess$|^\/(blood-test|lab-partners)\/app\.html$/;
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/blood-test' || p === '/lab-partners') { res.writeHead(307, { Location: p + '/' }); return res.end(); }
  if (IGNORED.test(p)) { res.writeHead(404); return res.end('Not on Vercel (needs PHP)'); }
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`Test site (Vercel-like) at http://localhost:${PORT}`));
