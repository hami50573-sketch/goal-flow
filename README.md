# GoalFlow

GoalFlow is a responsive goal and task workspace built with Vite, vanilla JavaScript and Supabase.
Tasks, weekly goals and projects are stored in Supabase and protected by per-user Row Level Security.
The browser only keeps the Supabase login session and appearance preference.

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard and run [`supabase/schema.sql`](./supabase/schema.sql).
   This creates the tasks, goals and projects tables and policies so signed-in users can access only
   their own rows.
3. In Supabase **Project Settings → API**, copy the project URL and the publishable key.
   Never use or share the `service_role` key in the browser or Vercel client environment.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your Vercel site. Add
   `http://localhost:5173/**` and your Vercel URL to the allowed redirect URLs. Enable email/password
   sign-in; if email confirmation is enabled, users must confirm the signup email before signing in.

## Run locally

1. Install Node.js 20.19+.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` using the values from Supabase. Add the VAPID public key as described in [Background reminders](#background-reminders) to enable push notifications.
4. Run `npm install`, then `npm run dev`.

Do not commit `.env.local`. The publishable key is intended for client use; database security comes from the
Supabase Row Level Security policies, not from hiding the publishable/anon key.

## Deploy to Vercel

1. Push this project to a Git provider and import it into Vercel.
2. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_VAPID_PUBLIC_KEY` under **Project → Settings → Environment Variables**
   for the environments you will use.
3. Deploy. Vercel uses `npm run build` and the `dist` output directory as configured in [`vercel.json`](./vercel.json).
4. Add the deployed Vercel URL to the Supabase Auth redirect allowlist and set it as the Supabase Site URL.
5. Redeploy after changing Vercel environment variables.

## Features

- Private email/password accounts, sign-in, sign-up, and password reset.
- Dashboard, daily tasks, weekly goals with linked steps, task list, task board and weekly calendar.
- Project spaces with linked tasks and completion progress.
- Manual rescheduling, focus timer, analytics, streaks and dark/light appearance.
- Optional hourly push reminders for incomplete tasks, with quiet hours from 10pm to 8am in each device's timezone.
- JSON backup and restore from Settings.
- Existing task, goal and project data from the old browser-only version can be copied into a new
  account on first sign-in, after an explicit confirmation, when the old data is available at the same
  browser origin. Otherwise export a backup from the old app and import it after signing in to the deployed app.

The app does not use browser local storage as the task database. Supabase stores each user's records
under their authenticated account; RLS protects them from other users.

## Background reminders

Push reminders can arrive while the site is closed, but require an HTTPS deployment, browser notification
permission, a Supabase Edge Function, and the hourly Supabase Cron job. Browser push support varies; on
iOS it may require adding the site to the Home Screen and enabling notifications for the installed web app.

1. Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Keep the private key secret.
2. Add the public key as `VITE_SUPABASE_VAPID_PUBLIC_KEY` in local `.env.local` and in Vercel's
   Production environment variables. Redeploy Vercel after adding it.
3. Sign in to the Supabase CLI and link this project from the repository root:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

   Deploy the sender:

   ```powershell
   npx supabase functions deploy send-reminders --no-verify-jwt
   ```

4. Set the server-only function secrets (never put the private key or reminder secret in Vite/Vercel
   client variables). Use the same generated VAPID public key in both places:

   ```powershell
   npx supabase secrets set VAPID_PUBLIC_KEY=your-vapid-public-key VAPID_PRIVATE_KEY=your-vapid-private-key VAPID_SUBJECT=mailto:you@example.com REMINDER_SECRET=your-long-random-secret
   ```

   Create a random secret locally, for example with Node.js:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. In Supabase **SQL Editor**, run the updated [`supabase/schema.sql`](./supabase/schema.sql) to
   create the RLS-protected push subscription table. This is safe to re-run.
6. In SQL Editor, store the project URL and the exact same random `REMINDER_SECRET` in Vault, replacing
   the example values (these values are server-side, not Vite environment variables):

   ```sql
   create extension if not exists supabase_vault with schema vault;
   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'goalflow_supabase_url');
   select vault.create_secret('YOUR_LONG_RANDOM_SECRET', 'goalflow_reminder_secret');
   ```
7. Run [`supabase/reminders-cron.sql`](./supabase/reminders-cron.sql) in SQL Editor to schedule the
   hourly function call. The function checks each subscription's saved timezone and sends only between
   8:00am and 9:59pm. It sends one grouped reminder only if the account has at least one task whose
   status is not Completed; expired subscriptions are removed automatically.
8. Sign in to GoalFlow, open **Settings**, and choose **Enable hourly reminders**. Permission must be
   granted in the browser. Re-run the deployment if the VAPID public key changes.

The web page itself cannot send reliable reminders while closed; background delivery depends on the
service worker and configured Supabase scheduler. `supabase/config.toml` disables JWT verification only
for the sender endpoint; the endpoint independently checks the server-only `REMINDER_SECRET`.
