# MyFailPro: GitHub Pages + Supabase

The frontend is published by GitHub Pages. Supabase provides Authentication,
Postgres, Row Level Security, and the privileged Edge Functions used by the
administrator page. Netlify is no longer required.

## 1. Configure the Supabase project

1. Open the project at <https://supabase.com/dashboard>.
2. In **SQL Editor**, run these files in order:
   - `supabase/migrations/20260903000000_initial_schema.sql`
   - `supabase/migrations/20260903010000_optimize_database.sql`
   - `supabase/migrations/20260907030000_add_agency_staff_users.sql`
   - `supabase/migrations/20260907040000_allow_staff_manage_agency_settings.sql`
   - `supabase/migrations/20260907050000_add_staff_login_activity.sql`
   - `supabase/migrations/20260907060000_add_staff_avatar.sql`
   - `supabase/migrations/20260908010000_add_agency_bulk_settings.sql`
   - `supabase/migrations/20260908020000_add_movement_actor.sql`
   - `supabase/migrations/20260908030000_add_file_notifications.sql`
3. In **Authentication > Users**, create the first administrator account.
4. Promote it in SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'your-admin@example.com';
   ```

5. In **Authentication > URL Configuration**, set:
   - Site URL: `https://ppdlimbang.github.io/MyFailPro/`
   - Redirect URL: `https://ppdlimbang.github.io/MyFailPro/MyFailPro.html`

The Project URL and browser-safe publishable key are stored in
`assets/runtime-config.js`. The publishable key is intentionally public and all
table access remains protected by Row Level Security. Never place a secret or
service-role key in that file.

## 2. Allow GitHub to deploy Edge Functions

1. In Supabase, open **Account > Access Tokens** and generate an access token.
2. In GitHub, open the `MyFailPro` repository.
3. Go to **Settings > Secrets and variables > Actions > New repository secret**.
4. Create a secret named `SUPABASE_ACCESS_TOKEN` and paste the token there.
5. Open **Actions > Deploy Supabase Edge Functions > Run workflow**.

The workflow deploys:

- `admin-create-user`
- `admin-delete-user`
- `agency-create-staff`
- `agency-update-staff`

All functions validate the caller's Supabase session before using a server-only
secret key. Admin functions require an `admin` profile, while the agency staff
functions require an agency-owner profile. The functions accept
browser requests from `https://ppdlimbang.github.io` by default.

An agency owner can create staff accounts from **Tetapan Sistem > Akaun Pegawai
Agensi** by entering a name, email, and temporary password. Staff log in through
the normal login page and can manage the agency's shared files, classifications,
and recipient directory. Only the agency owner can view and manage staff login
accounts.

Successful sign-ins are counted for each profile. Agency owners can view each
staff account's total sign-ins and most recent sign-in under **Tetapan Sistem >
Akaun Pengguna Pegawai**.

Agency owners can also choose an avatar when creating a staff account. The
selected avatar appears in the staff account list and in the navigation header
when that staff member signs in.

Agency owners can use **Edit** beside a staff account to replace its avatar or
set a new password. Leaving the new-password field empty preserves the current
password.

Agency owners can add classification settings in bulk under **Tetapan Sistem >
Pengisian Data Pukal**. Each line is treated as one record, existing values are
skipped, and the database function rejects access from staff accounts.

The movement log records the name and email of the signed-in user responsible
for every new file movement. Historical movements created before the migration
remain labelled as unavailable because their actor cannot be determined safely.

Agency staff receive an in-app notification when another signed-in user moves a
file to their registered profile name. The bell refreshes periodically and marks
notifications as read when opened. Duplicate staff names are intentionally not
matched, preventing a notification from being delivered to the wrong account.

## 3. Enable GitHub Pages

1. In the GitHub repository, open **Settings > Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions > Deploy GitHub Pages > Run workflow**, or push to `main`.
4. The application will be available at:
   `https://ppdlimbang.github.io/MyFailPro/`

## Security model

- GitHub Pages receives only static HTML, CSS, JavaScript, and image files.
- Supabase Auth verifies passwords and sessions.
- Row Level Security restricts agencies to their own `owner_id` rows.
- Staff profiles are linked to one agency and inherit access only to that
  agency's workspace.
- Admin-only account operations run inside Supabase Edge Functions.
- `SUPABASE_ACCESS_TOKEN`, secret keys, and service-role keys must never be
  committed or placed in browser assets.

## Updating the application

Push frontend changes to `main`; the Pages workflow republishes the site.
Changes under `supabase/functions/` trigger the Edge Function workflow.
Database migrations are not applied automatically; run each new migration in
the Supabase SQL Editor before using its related feature.

Alternatively, create a scoped Supabase access token with **Database:
Read-write**, save it as the GitHub Actions secret
`SUPABASE_DATABASE_ACCESS_TOKEN`, then run **Apply Agency Staff Migration** from
the repository's Actions page.
