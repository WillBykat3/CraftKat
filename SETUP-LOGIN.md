# Setting up logins (one time, about 10 minutes)

CraftKat uses [Supabase](https://supabase.com) (free) for accounts, because GitHub Pages
can't store passwords safely. When you're done:

- **The game asks everyone to log in.** Friends use the username and password you give them.
- **Only you can create, edit and delete accounts**, on your private admin page:
  `https://willbykat3.github.io/CraftKat/admin.html`
- Nobody can sign themselves up, and your password is never stored in this repository.

Until you finish these steps the live game shows "Almost ready" instead of the title screen.

---

## 1. Create a Supabase project

1. Go to <https://supabase.com>, click **Start your project**, and sign up (free).
2. Click **New project**. Name it `craftkat`, pick a region near you, and choose a database password.
   Save that password somewhere, though CraftKat never needs it. Click **Create new project** and wait a minute.

## 2. Turn off public sign-ups

1. In the left menu open **Authentication** → **Sign In / Providers**. In older dashboards it's **Providers**, then **Email**.
2. Turn **off** "Allow new users to sign up". Keep the **Email** provider itself turned **on**.
3. Click **Save**.

Now accounts can only be created by your admin page.

## 3. Create your owner account

1. Open **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: `willbykat@outlook.com`. Password: the password you want to use for the admin page.
   (You shared a password in our chat, so consider choosing a new one here.)
3. Tick **Auto Confirm User**, then click **Create user**.

## 4. Add the account-management function

1. Open **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly **`admin-users`**.
3. Delete the example code, paste the whole contents of
   [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts) from this repository,
   and click **Deploy function**.
4. In the function's **Details**/**Settings**, turn **off** "Verify JWT with legacy secret" (or "Enforce JWT
   verification"), then save. This is safe: the function checks every caller's login itself and only
   accepts your email. Leaving it on can block the admin page.
5. Open **Edge Functions** → **Secrets** and add a secret:
   - Name: `ADMIN_EMAIL`
   - Value: `willbykat@outlook.com`

## 5. Connect the game to your project

1. Click **Connect** at the top of the dashboard, or open **Project Settings** → **API Keys**. Copy:
   - your **Project URL** (looks like `https://abcdefghijkl.supabase.co`)
   - your **Publishable key** (starts with `sb_publishable_`; older projects call it the `anon` `public` key)

   These two are **meant to be public**. Never copy the **secret** / `service_role` key anywhere.
2. On GitHub open [`public/js/config.js`](public/js/config.js), click the pencil (Edit), and fill them in:
   ```js
   export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
   export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
   ```
   Then click **Commit changes**. (Or paste the two values to Claude and it will do this.)
3. Wait about a minute for the "Deploy to GitHub Pages" action to finish.

## 6. Try it

1. Open `https://willbykat3.github.io/CraftKat/admin.html` and log in with your email and password.
2. Create an account for each friend (the **Generate** button makes an easy-to-type password),
   and send them their username and password.
3. Open the game. Friends log in with their **username**, and you log in with your **email**.

On the admin page you can rename accounts, change passwords and delete accounts.
A deleted account can't log in or join any world any more.

---

### How safe is this?

- Passwords are checked by Supabase. They aren't stored in the game or in this repository.
- Only someone logged in as `ADMIN_EMAIL` can list, create, change or delete accounts. The function
  checks this on Supabase's servers, so editing the web page can't get around it.
- When a friend joins your world, your browser asks Supabase whether their login is real, and the
  name everyone sees comes from their account, so people can't pretend to be someone else.
- The game's code is public (that's how GitHub Pages works). A programmer could download it and play
  single-player on their own computer without logging in, but they can't create accounts, use your
  admin page, or join anyone's world without an account you made.

### Troubleshooting

- **"Wrong username or password"**: check the spelling. Usernames aren't case-sensitive; passwords are.
- **Admin page says "Set the ADMIN_EMAIL secret"**: finish step 4.5.
- **Admin page says "Only the owner can manage accounts"**: you logged in with a different account than `ADMIN_EMAIL`.
- **Admin page shows "Failed to send a request" or a CORS error**: the function isn't deployed under the
  exact name `admin-users`, or JWT verification is still turned on (step 4.4).
- **Game still says "Almost ready"**: `config.js` is still empty on GitHub, or the deploy hasn't finished.
