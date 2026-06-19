# Territory Manager Community Starter

This package is designed for GitHub Pages + optional Supabase login/sync.

## What is included

- GitHub Pages compatible static app
- Leaflet map
- California ZIP boundary loading
- Performance mode: ZIPs only draw when zoomed in
- Visible-area rendering only
- Dynamic teams: admin can choose 1–12 teams
- Team names and colors
- Owner Team + Handoff Team per ZIP
- Timer gradient: owner color fades to handoff color
- Notes per ZIP
- Optional Supabase login and realtime sync

## How to use without Supabase

Upload everything to GitHub repo root:

- index.html
- style.css
- bundle.js
- config.js
- sw.js
- manifest.json

The app will work in local-only mode.

## How to turn on login/community sync

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase-setup.sql`.
3. Go to Authentication > Providers and make sure Email is enabled.
4. Go to Database > Replication and enable Realtime for:
   - teams
   - territories
5. Open `config.js`.
6. Paste your Supabase project URL and anon key:

```js
window.TM_SUPABASE_URL = "https://YOURPROJECT.supabase.co";
window.TM_SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
```

7. Upload again to GitHub Pages.

## Login workflow

- Click Login
- Create Account
- Sign In
- Admin button appears after signing in
- Admin can change team count, names, and colors
- Users can update ZIPs and notes
- Other logged-in users see updates through Supabase Realtime
