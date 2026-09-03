# MyFailPro deployment setup

The repository is prepared for GitHub, Netlify, and Supabase. The current user interface still uses browser storage until the Supabase project values are connected and the data adapter is switched on.

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor**, paste `supabase/migrations/20260903000000_initial_schema.sql`, and run it once.
3. In **Authentication > Users**, create your first admin account.
4. Run this statement in SQL Editor with your real admin email:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'your-admin@example.com';
   ```

5. Open the project's **Connect** dialog and copy:
   - Project URL
   - Publishable key (`sb_publishable_...`)
   - Secret key (`sb_secret_...`) for the Netlify Function only

Never put the secret key in HTML or `assets/app.js`.

## 2. Create and push the GitHub repository

The local repository uses the `main` branch. Create an empty private repository named `MyFailPro` on GitHub without adding a README, `.gitignore`, or license. Then run:

```bash
git remote add origin https://github.com/YOUR_USERNAME/MyFailPro.git
git push -u origin main
```

## 3. Deploy through Netlify

1. Log in to <https://app.netlify.com/> and choose **Add new project > Import an existing project**.
2. Select GitHub, then select the `MyFailPro` repository.
3. Netlify reads `netlify.toml`; no build command is required and the publish directory is `.`.
4. In **Project configuration > Environment variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (mark as a secret and scope it to Functions when available)
5. Deploy the site.
6. In Supabase **Authentication > URL Configuration**, set the Netlify production URL as the Site URL and add the deploy URL to Redirect URLs.

## Security model

- Supabase Auth verifies passwords and sessions.
- Row Level Security restricts agencies to rows where `owner_id = auth.uid()`.
- Admin profiles can manage all agency rows.
- The publishable key may be used by browser code because RLS enforces access.
- The secret key bypasses RLS and is only available in the `admin-create-user` Netlify Function.

## Remaining connection step

Provide the Supabase project URL and publishable key, plus your GitHub repository URL. Do not send the Supabase secret key in chat; add it directly in Netlify's environment-variable UI.
