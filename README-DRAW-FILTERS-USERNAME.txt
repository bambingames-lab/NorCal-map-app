Drawing filter + username + mobile draw fix

Replace in GitHub:
- index.html
- style.css
- bundle.js
- sw.js

Run in Supabase SQL Editor:
- user-profiles-drawing-filter-patch.sql

Fixes:
1. Users can change their display name/tag in Login > My Profile or in the pencil drawing panel.
2. Drawings can be filtered:
   - All drawings
   - Only mine
   - By tag/name
3. PC drawing no longer keeps following the mouse after releasing.
4. Mobile drawing uses touch/pointer handlers and disables map touch movement while drawing.
5. Tags appear above freehand drawings.
