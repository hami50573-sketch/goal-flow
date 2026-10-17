# GoalFlow

GoalFlow is a responsive goal and task workspace built with Vite, vanilla JavaScript and Supabase.
Tasks, weekly goals and projects are stored in Supabase and protected by per-user Row Level Security.
The browser only keeps the Supabase login session and appearance preference.

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard and run [`supabase/schema.sql`](./supabase/schema.sql).
   This creates the tasks, goals and projects tables and policies so signed-in users can access only
   their own rows.
3. In Supabase **Project Settings → API**, copy the project URL and the publishable key (or legacy anon key).
   Never use or share the `service_role` key in the browser or Vercel client environment.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your Vercel site. Add
   `http://localhost:5173/**` and your Vercel URL to the allowed redirect URLs. Enable email/password
   sign-in; if email confirmation is enabled, users must confirm the signup email before signing in.

## Run locally

1. Install Node.js 20.19+.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` using the values from Supabase.
4. Run `npm install`, then `npm run dev`.

Do not commit `.env.local`. The client key is intentionally public; database security comes from the
Supabase Row Level Security policies, not from hiding the publishable/anon key.

## Deploy to Vercel

1. Push this project to a Git provider and import it into Vercel.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Project → Settings → Environment Variables**
   for the environments you will use.
3. Deploy. Vercel uses `npm run build` and the `dist` output directory as configured in [`vercel.json`](./vercel.json).
4. Add the deployed Vercel URL to the Supabase Auth redirect allowlist and set it as the Supabase Site URL.
5. Redeploy after changing Vercel environment variables.

## Features

- Private email/password accounts, sign-in, sign-up, and password reset.
- Dashboard, daily tasks, weekly goals with linked steps, task list, task board and weekly calendar.
- Project spaces with linked tasks and completion progress.
- Manual rescheduling, focus timer, analytics, streaks and dark/light appearance.
- JSON backup and restore from Settings.
- Existing task, goal and project data from the old browser-only version can be copied into a new
  account on first sign-in, after an explicit confirmation, when the old data is available at the same
  browser origin. Otherwise export a backup from the old app and import it after signing in to the deployed app.

The app does not use browser local storage as the task database. Supabase stores each user's records
under their authenticated account; RLS protects them from other users.
