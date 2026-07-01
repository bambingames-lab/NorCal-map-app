# Territory Manager V2.1.1

Upload this full package to the V2 branch root and replace existing files.

## After upload
Open V2 with:
`?v=13`

## What changed
- ZIPs use team colors.
- Freehand areas are visually different from ZIP fills.
- Freehand fill = user color.
- Freehand outline = team color.
- Phone save errors should be reduced by retrying with a simpler database save.
- Tags are smaller.

## If phone freehand still says it cannot save
Run this in Supabase SQL Editor:
`v2.1.1-coverage-save-schema-fix.sql`

That SQL only adds missing optional columns and refreshes RLS policies for coverage areas.
