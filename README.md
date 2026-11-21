# Queue24 — TEST site

A copy of the full queue24.com site, used only to preview new features. **This is not the live site.**
The live site's source is in the main project folders and is never changed from here.

## What's different from the live site
1. The landing page navigation has a **🩸 Blood test** button (desktop menu + phone menu) that opens `/blood-test/`.
2. `/blood-test/` runs in **demo mode** on Vercel: Vercel can't run PHP, so a small script
   (`blood-test/js/demo-api.js`) answers the app's requests inside the browser. Tests, prices, cities and
   lab names are exported from the real seed data. A simulated lab accepts orders, suggests tests for
   prescriptions and sends a sample report. Orders and photos stay in the visitor's browser (Reset button
   on the page clears them). Nothing is sent to a server, and no OTP SMS is sent (the code is shown).

## What works where
| Page | Vercel | PHP host (Hostinger) |
|---|---|---|
| `/` main site + Blood test button | ✅ | ✅ |
| `/blood-test/` | ✅ demo mode | ✅ real backend |
| `/sales-crm/` | ❌ needs PHP | ✅ |
| `/lab-partners/` | ❌ needs PHP | ✅ |

`.vercelignore` keeps the PHP parts out of the Vercel deploy. The whole site has `X-Robots-Tag: noindex`
so this copy never competes with queue24.com on Google.

## Secrets
No passwords, keys or config files are in this repo (`config.php`, `.env*`, `ADMIN-LOGIN.txt` are excluded
by `tools/sync.js` and `.gitignore`). To run the PHP parts elsewhere, create fresh config files there.

## Update this copy after changing the main site
```bash
cd ../sales-crm && npm run build      # builds ../queue24-upload/public_html (main project)
cd ../test-site && node tools/sync.js # copies it here + re-applies the test changes
git add -A && git commit -m "Sync" && git push
```
`tools/sync.js` only reads the main build; it never writes outside this folder.
