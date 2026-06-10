# JobCommand Supabase Setup

## 1. Create Supabase Project

Create a Supabase project. In the SQL Editor, paste and run `supabase-schema.sql`.

## 2. Add Frontend Keys

Open `supabase-config.js` and paste:

```js
export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY";
```

Use only the anon public key. Do not put service role keys or private keys in this GitHub Pages app.

## 3. Create Beta Users

In Supabase Authentication, create email/password users for:

- Seth
- Lynn

Set their `full_name` user metadata to `Seth` and `Lynn` if possible. If not, sign in once and update the `profiles.full_name` row manually.

## 4. Shared Workspace

The first user who logs in creates the default workspace named `JobCommand Beta`. To add the second user to the same workspace:

1. Find the workspace ID in `companies`.
2. Find the second user's ID in `profiles`.
3. Insert a row into `company_members` with that `company_id`, `user_id`, and role `member`.

Example:

```sql
insert into public.company_members (company_id, user_id, role)
values ('COMPANY_UUID_HERE', 'LYNN_USER_UUID_HERE', 'member');
```

## 5. GitHub Pages Upload

Upload the full `contractor-crm` folder contents to GitHub Pages after updating `supabase-config.js`.

## 6. Migration From LocalStorage

Before switching to Supabase, use the old app's Settings > Export backup JSON if you need a copy. In the Supabase version, Settings > Import backup JSON to Workspace imports that backup into the active shared workspace.

## Later Backend Work

This app uses Supabase directly from a static PWA with Row Level Security. Real push notifications, background jobs, invite flows, two-way Apple/Google/Outlook calendar sync, and advanced conflict handling should be built with backend functions or calendar provider integrations later.
