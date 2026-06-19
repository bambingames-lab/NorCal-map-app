Shared Editable Coverage Areas Patch

Replace in GitHub:
- bundle.js
- sw.js

Run in Supabase SQL Editor:
- coverage-areas-shared-editable.sql

What changes:
- Every signed-in user can see every saved drawing.
- Every signed-in user can edit any drawing details.
- Every signed-in user can redraw/edit the shape.
- Every signed-in user can delete drawings.
- Drawings still sync through Supabase Realtime.

How to use:
1. Sign in.
2. Menu > Coverage Drawing.
3. Draw and save a coverage area.
4. On another device/user, the drawing appears.
5. Tap the drawing to:
   - change color
   - change worked date
   - redraw/edit shape
   - delete it
