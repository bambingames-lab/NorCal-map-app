Territory Manager V2 Starter

Upload these files to your V2 branch only.

Main branch stays live.
V2 branch is your new development build.

IMPORTANT:
1. Copy your real Supabase values from main/config.js into this V2 config.js.
2. Run v2-supabase-migration.sql in Supabase SQL Editor.
3. If you want admin temporary password resets, deploy:
   supabase/functions/admin-reset-password/index.ts
4. Open your V2 branch preview using GitHub Pages or a second repo.

This V2 starter keeps your existing Supabase data:
- users
- teams
- territories
- freehand coverage
- notes
- locations

V2 structure:
- src/app.js
- src/map.js
- src/auth.js
- src/data.js
- src/location.js
- src/admin.js
- src/state.js
- src/ui.js
