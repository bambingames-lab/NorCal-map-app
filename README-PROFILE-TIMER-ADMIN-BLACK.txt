Profile/tags + timer admin + black fade patch

Replace in GitHub:
- index.html
- style.css
- bundle.js
- sw.js

Run in Supabase SQL Editor:
- profile-timer-admin-black-patch.sql

What changed:
1. Account settings now control drawing tag/name and color.
2. When a user changes their profile name/color, their existing drawings update to match.
3. Freehand drawing colors now fade toward black with the timer.
4. Timer settings moved out of the normal Menu and into Admin.
5. Timer settings save to Supabase app_settings so all users share the same timer.
6. Coverage drawings are merged on reload so drawings should not disappear if one fetch fails.
