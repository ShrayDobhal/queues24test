'use strict';
/**
 * Rebuilds the TEST site from the main build, then applies the test-only changes.
 *   node tools/sync.js        (run from the test-site folder, after `npm run build` in ../sales-crm)
 *
 * READ-ONLY on the main project: it only reads ../queue24-upload/public_html and never writes there.
 * Secrets (config.php files) are never copied — this folder is pushed to a PUBLIC GitHub repo.
 *
 * Test-only changes:
 *   1. Landing page nav: "Get App" removed, "Blood test" button added (desktop + phone menu), spacing fixed
 *   2. /blood-test and /lab-partners static pages in DEMO mode (Vercel has no PHP; one shared in-browser store)
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

// 3. landing page navigation (test site only):
//    - remove the desktop "Get App" button (phone menu keeps its Download App button)
//    - add a "Blood test" button next to "Get started free" (desktop) and in the phone menu
//    - even spacing between logo, links and buttons
const idxPath = path.join(DEST, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');
const getAppRe = /\n\s*<button class="nav-download-btn smart-download-btn" id="nav-download-app-btn"[\s\S]*?<\/button>/;
const ctaAnchor = '<button class="btn btn-primary nav-get-started trigger-get-started" id="nav-cta-btn">';
const mobileAnchor = '<a href="#resources" class="nav-link trigger-resources">Resources</a>\n    <div class="mobile-drawer-actions">';
if (!getAppRe.test(idx) || !idx.includes(ctaAnchor) || !idx.includes(mobileAnchor)) throw new Error('Navigation markup changed in main-site/index.html; update the anchors in tools/sync.js');
idx = idx.replace(getAppRe, '');
idx = idx.replace(ctaAnchor, '<a href="/blood-test/" class="nav-bt-btn" id="nav-blood-test-btn"><span aria-hidden="true">🩸</span> Blood test</a>\n        '
  + '<a href="/lab-partners/" class="nav-bt-btn nav-lab-btn" id="nav-lab-partners-btn"><span aria-hidden="true">🧪</span> Lab partners</a>\n        ' + ctaAnchor);
idx = idx.replace(mobileAnchor, '<a href="#resources" class="nav-link trigger-resources">Resources</a>\n    <a href="/blood-test/" class="nav-link nav-bt-btn nav-bt-mobile"><span aria-hidden="true">🩸</span> Blood test</a>\n'
  + '    <a href="/lab-partners/" class="nav-link nav-bt-btn nav-bt-mobile nav-lab-btn"><span aria-hidden="true">🧪</span> Lab partners</a>\n    <div class="mobile-drawer-actions">');
idx = idx.replace('</head>', `  <!-- TEST SITE ONLY: navigation changes -->
  <style>
    .site-header .navbar { gap: 40px; }
    .site-header .brand-logo { flex-shrink: 0; }
    .site-header nav[aria-label="Primary Navigation"] { flex: 1; display: flex; justify-content: center; }
    .nav-menu { gap: 32px; }
    .nav-menu .nav-link { white-space: nowrap; }
    .nav-actions { gap: 12px; flex-shrink: 0; }
    .nav-bt-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 16px; font-size: 0.86rem; font-weight: 600; line-height: 1.2; white-space: nowrap;
      color: #178a5c !important; background: #fff; border: 1.5px solid #1FA36E; border-radius: 999px; transition: background .15s, transform .15s; }
    .nav-bt-btn:hover { background: #E8F6EF; transform: translateY(-1px); }
    .nav-bt-btn::after { display: none !important; }
    .nav-lab-btn { color: #2a5bb8 !important; border-color: #4f7fd6; }
    .nav-lab-btn:hover { background: #ecf2fd; }
    @media (max-width: 1500px) { .site-header .navbar { gap: 24px; } .nav-menu { gap: 22px; } .nav-actions { gap: 8px; } .nav-bt-btn { padding: 7px 12px; } }
    /* links + buttons no longer fit side by side: use the phone menu */
    @media (max-width: 1240px) { nav[aria-label="Primary Navigation"], .nav-menu, .nav-actions { display: none !important; } .mobile-toggle { display: flex !important; margin-left: auto; } }
    .mobile-drawer .nav-bt-mobile { display: flex; margin: 8px 0; padding: 11px 16px; font-size: 1rem; border-bottom: 1.5px solid #1FA36E; }
  </style>
</head>`);
fs.writeFileSync(idxPath, idx);

// 4. /blood-test and /lab-partners static pages for Vercel, in DEMO mode (PHP hosts keep using index.php + app.html).
//    Both load demo-api.js, which shares one in-browser store, so a patient order reaches the lab portal.
for (const [dir, entry] of [['blood-test', 'bt.js'], ['lab-partners', 'lp.js']]) {
  const tag = `<script type="module" src="js/${entry}"></script>`;
  const shell = fs.readFileSync(path.join(DEST, dir, 'app.html'), 'utf8');
  if (!shell.includes(tag)) throw new Error(`${dir}/app.html changed; update tools/sync.js`);
  fs.writeFileSync(path.join(DEST, dir, 'index.html'), shell.replace(/\{\{BASE\}\}/g, '/' + dir).replace(tag, `<script src="js/demo-api.js"></script>\n  ${tag}`));
  fs.copyFileSync(path.join(__dirname, 'demo-api.js'), path.join(DEST, dir, 'js', 'demo-api.js'));
}
execFileSync('php', [path.join(__dirname, 'export-demo-catalog.php'), path.join(SRC, '_q24h'), path.join(DEST, 'blood-test', 'demo-catalog.json')], { stdio: 'inherit' });

console.log('Test site synced into', DEST);
