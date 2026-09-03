# MyFailPro: GitHub Pages + Supabase

The frontend is published by GitHub Pages. Supabase provides Authentication,
Postgres, Row Level Security, and the privileged Edge Functions used by the
administrator page. Netlify is no longer required.

## 1. Configure the Supabase project

1. Open the project at <https://supabase.com/dashboard>.
2. In **SQL Editor**, run these files in order:
   - `supabase/migrations/20260903000000_initial_schema.sql`
   - `supabase/migrations/20260903010000_optimize_database.sql`
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

Both functions validate the caller's Supabase session and confirm that the
profile role is `admin` before using a server-only secret key. The functions
accept browser requests from `https://ppdlimbang.github.io` by default.

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
- Admin-only account operations run inside Supabase Edge Functions.
- `SUPABASE_ACCESS_TOKEN`, secret keys, and service-role keys must never be
  committed or placed in browser assets.

## Updating the application

Push frontend changes to `main`; the Pages workflow republishes the site.
Changes under `supabase/functions/` trigger the Edge Function workflow.
