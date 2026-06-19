Territory Manager Admin Patched

What changed:
- Admin button only appears for users listed in public.admins
- Team count/name/color controls are guarded in the app
- Includes admin-permissions-patch.sql to lock team editing to admins in Supabase

Your admin user ID is included:
d46fb0e8-14f7-45f2-be53-e3c1916ce05d

Steps:
1. Upload these app files to GitHub.
2. In Supabase SQL Editor, run admin-permissions-patch.sql.
3. Sign in with your admin account.
4. Only your account should see the Admin button.

Important:
Regular users can still:
- sign in
- view territories
- update territory dates
- add notes
- choose owner/handoff teams

Regular users should not be able to:
- open Admin panel
- change team count
- change team names/colors
