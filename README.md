# Umar International High School Portal

A configured deployment uses Supabase Auth, Postgres row-level security, private Supabase Storage buckets, and authenticated Supabase Edge Functions. The portal has no browser-local authentication or demo credentials and fails closed if Supabase is not configured. The frontend never contains a Supabase service-role key.

## What is included

- Hosted Supabase roles: Super Admin, Admin, Student, and Teacher.
- Supabase schema for profiles, student/teacher records, classes, subjects, assignments, results, fee schedules/payments, timetables, announcements, learning materials, and activities.
- Row-level security for account-scoped data and administrative permissions.
- Server functions for account creation, temporary-password activation, account status changes, password resets, administrator permission changes, and account deletion.
- Random temporary passwords are returned to the authorized administrator once, expire after a configurable interval, and are not written to the database.
- Student and teacher accounts can be created and activated without photographs. Dashboards use initials avatars. The new migrations do not create photo columns, buckets, or policies; any photo resources already present remotely are not removed.
- Static Vercel deployment configuration.

## Requirements and credentials

Create a Supabase project and a Vercel project. Install the Supabase CLI and Deno on the administrator's development machine.

The public Supabase project URL and anon/publishable key are required by the browser. Put them in `supabase-config.js`:

```js
window.UMAR_SUPABASE_CONFIG = {
    url: "https://YOUR_PROJECT_ID.supabase.co",
    anonKey: "YOUR_PUBLIC_ANON_KEY",
    accountEmailDomain: "portal.umarhighschool.com"
};
```

The account email domain must match the Supabase Edge Function secret `ACCOUNT_EMAIL_DOMAIN`. It is an address namespace for username/password sign-in; the application does not send account mail to this domain. Use the same values everywhere and ensure its format is a valid domain.

Only the Supabase URL and public anon/publishable key belong in the frontend. Never copy `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or other private credentials into `supabase-config.js`, HTML, JavaScript, or the Vercel static output.

## Database and Super Admin setup

From the project directory:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase migration list --linked
supabase db push --dry-run
# Review the pending migrations and confirm the target project before applying:
supabase db push
```

Apply the starter subject records by pasting `supabase/seed.sql` into the Supabase SQL Editor after reviewing the target database.

Create a new Auth user manually in Supabase Dashboard → Authentication → Users with email `ayuba@portal.umarhighschool.com`, confirm it, and set a strong unique password directly in the Dashboard. First verify that this email is not already in Auth; do not change an existing user's password or reuse an existing account. Copy the new user's exact UUID and `created_at` value from the Dashboard into the two placeholders at the top of `supabase/bootstrap-super-admin.sql`, verify both values, then run the script in the SQL Editor once. It also checks the exact email and that the email is confirmed, and refuses an existing profile or taken username. It inserts only the `Ayuba` profile; it does not update the Auth user or password. Do not enable public sign-up.

Create initial classes from the Super Admin dashboard before enrolling students. Administrators do not receive hidden default permissions; grant only the needed permissions from Accounts.

## Edge Functions

Set server-only secrets in the Supabase project. Copy `.env.example` to the ignored `.env.production`, replace placeholders locally with the actual values, and never commit or share that file. `.env.example` contains placeholders only.

```powershell
Copy-Item .env.example .env.production
supabase secrets set --env-file .env.production

supabase functions deploy create-account
supabase functions deploy account-action
supabase functions deploy activate-account
```

`ALLOWED_ORIGINS` is a comma-separated exact origin allowlist; include the production Vercel domain and any local development origin you use. The functions verify Supabase access tokens themselves and check the active profile and permissions. Do not remove those checks or deploy service credentials to the browser.

## Vercel deployment

1. Set `supabase-config.js` to the project's URL and public anon key. These two frontend values are public, but should still point to the intended Supabase project.
2. Push the project to a private or public GitHub repository. Do not add a populated `.env` or private service key.
3. Import the repository in Vercel and deploy it as a static site from the project root.
4. Add the final Vercel origin to Supabase's `ALLOWED_ORIGINS` secret and redeploy the Edge Functions.
5. Disable public Auth sign-ups in Supabase and configure Auth session/password policies for the school.
6. Smoke-test with the manually created Super Admin, then create a student and test the temporary-password activation flow before inviting real users.

The Super Admin is created once through Supabase Dashboard + the bootstrap SQL, not from a public registration page. Admins can create student/teacher accounts if their permissions allow; only Super Admins can create/manage administrator accounts.

The migration `20261119010000_secure_profile_privileges.sql` removes direct profile insert/delete and broad update privileges from authenticated users. Students can update only the `display_name` column; profile role, permissions, status, and identifiers remain backend-managed. It is included in the ordered pending migrations above; do not manually rerun a version already recorded as applied. In Supabase Dashboard → Authentication → Settings, turn off **Allow new users to sign up**. The matching local setting is `enable_signup = false` in `supabase/config.toml`. Admin-created accounts continue to use the protected Edge Functions.

## Local development

The local website is only a frontend for the configured Supabase project; it does not provide demo accounts, local registration, or browser-stored passwords. Set the public Supabase URL and publishable key in `supabase-config.js`, deploy the Edge Functions, and allow the local origin in `ALLOWED_ORIGINS` before testing sign-in.

```powershell
python -m http.server 8765
```

Then open `http://localhost:8765`. Without the Supabase configuration, sign-in and the dashboard remain unavailable.

## Limitations and manual configuration

No Supabase server credentials or Vercel project link were validated here, so migrations and functions were not applied to a live project. The frontend URL and public anon key are configured locally, but the live project, authentication, persistence, account activation, RLS behavior, and payment verification still require testing. Payments are record keeping only; no payment gateway is connected. A payment remains unverified until an authorized administrator confirms receipt. Email delivery and self-service email-based password recovery are not configured; administrators issue temporary password resets through the portal.

The new migrations contain no photo requirements or photo-storage resource creation. They do not delete pre-existing remote photo buckets or stored objects. The obsolete photo-update Edge Function has been removed locally and is not included in the deployment configuration; whether an older deployed copy still exists remotely has not been checked.
