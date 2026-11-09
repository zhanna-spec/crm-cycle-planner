# Login and shared workspaces (Supabase)

This turns on sign-in with an email code, invite-only access, and workspaces that save to the cloud: one for your team and one per client. Each person only sees the workspaces they've been invited to.

Until these steps are done, the planner keeps working without login and saves to the browser.

## 1. Create the project (5 minutes)

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it "cycle-planner", set a database password (save it somewhere safe), and pick the region closest to you.
3. Wait about a minute for it to start.

## 2. Create the database

1. Open [`schema.sql`](schema.sql) and copy everything.
2. **Near the bottom, replace `you@yourcompany.com` with your own work email.** This is what lets you sign in the first time.
3. In Supabase, open **SQL Editor → New query**, paste, and click **Run**. It should say "Success".

## 3. Only let invited people sign up

1. Open **Authentication → Hooks** (sometimes under **Authentication → Auth Hooks**).
2. Add a **Before User Created** hook, choose **Postgres**, schema `public`, function `hook_before_user_created`, and save.

The database also only shows people the workspaces they belong to, so even without this hook an uninvited person would see nothing. The hook stops them creating an account at all.

## 4. Point sign-in emails at the planner

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://zhanna-spec.github.io/crm-cycle-planner/`.
3. Add the same address under **Redirect URLs**.

## 5. Put the code in the email

1. Open **Authentication → Emails** (or **Email Templates**) → **Magic Link**.
2. Add this line to the message so people get a code they can type:

   ```html
   <p>Your sign-in code: <strong>{{ .Token }}</strong></p>
   ```

3. Save. The link in the email keeps working too.

## 6. Send email from your own domain before inviting clients

Supabase's built-in email is only for testing: it sends very few emails per hour and may only deliver to members of your Supabase team. Before inviting clients, connect a real email sender under **Project Settings → Authentication → SMTP Settings**. [Resend](https://resend.com) and [Postmark](https://postmarkapp.com) both have free tiers and step-by-step guides for Supabase.

## 7. Connect the planner

1. Open **Project Settings → API** (or **Data API / API Keys**).
2. Copy the **Project URL** and the **publishable** key (older projects call it the **anon public** key).
3. Send both to whoever maintains the planner, or put them in `src/app.html` (`SUPABASE_URL` and `SUPABASE_KEY`), run `./build.sh` and push.

Both values are safe to publish: the access rules in the database decide what each signed-in person can see. Never put the **secret** or **service_role** key in the planner.

## Using it

- Sign in with your email, create your team workspace, and copy over the cycles saved in your browser when the planner offers.
- **Workspace menu → New workspace** for each client.
- **Workspace menu → Members and invites** to invite people by email. Owners can invite; members can edit. The planner doesn't send invite emails, so tell people to open the planner and sign in with that address.
- Changes save automatically. If two people edit the same workspace at once, the second save loads the other person's version and tells you.

The Google script connection (competitor emails and AI) is still set per browser, so each person who needs it connects it once.
