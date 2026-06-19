Freehand Coverage Drawing Patch

Replace in GitHub:
- index.html
- style.css
- bundle.js
- sw.js

Then run in Supabase SQL Editor:
- coverage-areas-supabase-patch.sql

New feature:
- Menu > Coverage Drawing
- Pick "My drawing color"
- Start Freehand Drawing
- Drag finger over the area that was hit
- Finish / Save Drawing
- Drawing saves with the user's email, color, date, and shape
- It syncs to other devices through Supabase
- The fill color ages with the same timer

Notes:
- Users must be signed in for shared drawings.
- Local-only mode can still draw locally, but it will not sync.
