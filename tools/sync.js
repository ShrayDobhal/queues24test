'use strict';
/**
 * Rebuilds the TEST site from the main build, then applies the test-only changes.
 *   node tools/sync.js        (run from the test-site folder, after `npm run build` in ../sales-crm)
 *
 * READ-ONLY on the main project: it only reads ../queue24-upload/public_html and never writes there.
 * Secrets (config.php files) are never copied — this folder is pushed to a PUBLIC GitHub repo.
 *
 * Test-only changes:
 *   1. "Blood test" button in the landing page navigation (desktop nav + mobile menu)
 *   2. /blood-test/index.html static page with DEMO mode (Vercel has no PHP; demo runs in the browser)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEST = path.resolve(__dirname, '..');
const SRC = path.resolve(DEST, '..', 'queue24-upload', 'public_html');
const KEEP = new Set(['.git', 'tools', 'README.md', 'vercel.json', '.vercelignore', '.gitignore']);
const SECRETS = ['sales-crm/app/config.php', '_q24h/config.php'];

if (!fs.existsSync(path.join(SRC, 'index.html'))) throw new Error(`Main build not found at ${SRC}. Run "npm run build" in sales-crm first.`);

// 1. clear previous copy (keep repo + tooling)
for (const name of fs.readdirSync(DEST)) if (!KEEP.has(name)) fs.rmSync(path.join(DEST, name), { recursive: true, force: true });

// 2. copy the full site, minus secrets
function copyDir(src, dest, rel = '') {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const r = rel ? `${rel}/${name}` : name;
    if (name === '.DS_Store' || SECRETS.includes(r)) continue;
    const s = path.join(src, name); const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, r); else fs.copyFileSync(s, d);
  }
}
copyDir(SRC, DEST);

// 3. landing page: add the "Blood test" button to the navigation (test site only)
const idxPath = path.join(DEST, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');
const desktopAnchor = '<li><a href="#resources" class="nav-link trigger-resources">Resources</a></li>';
const mobileAnchor = '<a href="#resources" class="nav-link trigger-resources">Resources</a>\n    <div class="mobile-drawer-actions">';
if (!idx.includes(desktopAnchor) || !idx.includes(mobileAnchor)) throw new Error('Navigation markup changed in main-site/index.html; update the anchors in tools/sync.js');
idx = idx.replace(desktopAnchor, desktopAnchor + '\n          <li><a href="/blood-test/" class="nav-link nav-bt-btn" id="nav-blood-test-btn"><span aria-hidden="true">🩸</span> Blood test</a></li>');
idx = idx.replace(mobileAnchor, '<a href="#resources" class="nav-link trigger-resources">Resources</a>\n    <a href="/blood-test/" class="nav-link nav-bt-btn nav-bt-mobile"><span aria-hidden="true">🩸</span> Blood test</a>\n    <div class="mobile-drawer-actions">');
idx = idx.replace('</head>', `  <!-- TEST SITE ONLY: Blood test button -->
  <style>
    .nav-bt-btn { display: inline-flex; align-items: center; gap: 6px; background: #1FA36E; color: #fff !important; padding: 7px 14px !important; border-radius: 999px; font-weight: 700; white-space: nowrap; box-shadow: 0 6px 16px -8px rgba(31, 163, 110, .8); transition: transform .15s, background .15s; }
    .nav-bt-btn:hover { background: #178a5c; transform: translateY(-1px); }
    .nav-bt-btn::after { display: none !important; }
    .nav-menu .nav-link { white-space: nowrap; }
    @media (max-width: 1320px) { .nav-menu { gap: 20px; } .nav-actions { gap: 12px; } }
    /* the full nav + button no longer fits below 1100px: use the phone menu there */
    @media (max-width: 1100px) { nav[aria-label="Primary Navigation"], .nav-menu, .nav-actions { display: none !important; } .mobile-toggle { display: flex !important; margin-left: auto; } }
    .mobile-drawer .nav-bt-mobile { display: flex; justify-content: center; margin: 8px 0; border-bottom: 0; }
  </style>
</head>`);
fs.writeFileSync(idxPath, idx);

// 4. /blood-test static page for Vercel (PHP hosts keep using index.php + app.html)
const appHtml = fs.readFileSync(path.join(DEST, 'blood-test', 'app.html'), 'utf8');
const demoShell = appHtml.replace(/\{\{BASE\}\}/g, '/blood-test')
  .replace('<script type="module" src="js/bt.js"></script>', '<script src="js/demo-api.js"></script>\n  <script type="module" src="js/bt.js"></script>');
fs.writeFileSync(path.join(DEST, 'blood-test', 'index.html'), demoShell);
fs.copyFileSync(path.join(__dirname, 'demo-api.js'), path.join(DEST, 'blood-test', 'js', 'demo-api.js'));
execFileSync('php', [path.join(__dirname, 'export-demo-catalog.php'), path.join(SRC, '_q24h'), path.join(DEST, 'blood-test', 'demo-catalog.json')], { stdio: 'inherit' });

console.log('Test site synced into', DEST);
