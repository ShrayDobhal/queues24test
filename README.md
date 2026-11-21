# Queue24 — TEST site

A copy of the full queue24.com site, used only to preview new features. **This is not the live site.**
The live site's source is in the main project folders and is never changed from here.

## What's different from the live site
1. **Navigation:** "Get App" removed; **🩸 Blood test** and **🧪 Lab partners** buttons next to "Get started free"
   (and in the phone menu). Below 1240 px wide the phone menu is used.
2. **`/blood-test/` and `/lab-partners/` run in demo mode** on Vercel (Vercel can't run PHP or a database).
   `js/demo-api.js` answers the apps' requests inside the browser, with the real tests, prices, cities and the
   51 lab accounts (exported from the seed data, no passwords). Both portals share one store, so in the same browser:
   - book tests or upload a prescription on `/blood-test/` → the area's lab sees it on `/lab-partners/`
   - the lab accepts / rejects (→ backup lab), suggests tests, marks collected → testing, uploads the report, chats
   - the patient sees every step, confirms suggested tests with **Book now**, downloads the report
   The demo bar (bottom-left) has **Auto lab** (a simulated lab does the lab's steps by itself; it turns off when you
   sign in to the lab portal), links between the two portals, and **Reset**. Lab sign-in: pick the lab in the
   "Demo sign-in" box (labs that received your orders are first). OTP codes are shown on screen.
   Photos and PDFs stay in the browser (IndexedDB). Nothing is sent to any server, and each browser has its own data.

## What works where
| Page | Vercel (this repo) | PHP host (Hostinger) |
|---|---|---|
| `/` main site + nav buttons | ✅ | ✅ |
| `/blood-test/` | ✅ demo | ✅ real backend + Bunny |
| `/lab-partners/` | ✅ demo | ✅ real backend + Bunny |
| `/sales-crm/` (incl. admin → Lab partners) | ❌ needs PHP | ✅ |

`.vercelignore` keeps the PHP parts out of the Vercel deploy. The whole site sends `X-Robots-Tag: noindex`
so this copy never competes with queue24.com on Google.

## Secrets
No passwords, keys or config files are in this repo (`config.php`, `.env*`, `ADMIN-LOGIN.txt` are excluded
by `tools/sync.js` and `.gitignore`).

## Update this copy after changing the main project
```bash
cd ../sales-crm && npm run build      # builds ../queue24-upload/public_html (main project)
cd ../test-site && node tools/sync.js # copies it here + re-applies the test changes
git add -A && git commit -m "Sync" && git push
```
`tools/sync.js` only reads the main build; it never writes outside this folder.
Preview locally like Vercel (static files only): `node tools/static-server.js 8095`.
